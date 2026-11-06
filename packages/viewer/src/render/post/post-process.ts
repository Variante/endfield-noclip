import type { Environment } from '../../environment/environment.ts';
import type { Camera } from '../../scene/camera.ts';
import { type SceneTextures, HDR_FORMAT } from '../frame/render-targets.ts';
import { AtmosphereLuts, SkyBinding } from '../sky/atmosphere-luts.ts';
import { CelestialLayer } from '../sky/celestial.ts';
import type { VolumetricFog } from '../sky/volumetric-fog.ts';
import type { TextureBinding } from '../textures/texture-store.ts';
import type { WaterContext, WaterRenderer } from '../water/water-renderer.ts';

import { AmbientOcclusion } from './ambient-occlusion.ts';
import { AutoExposure } from './auto-exposure.ts';
import { Bloom } from './bloom.ts';
import { Composite } from './composite.ts';
import { LensFlares } from './lens-flare.ts';
import { LightShafts } from './light-shafts.ts';
import { POST_BYTES, writeEnvironmentUniforms, writeFrameUniforms } from './post-uniforms.ts';
import { ScreenSpaceReflections } from './screen-space-reflections.ts';
import { type PostSettings, effectiveSettings, postExposure } from './settings.ts';
import { TemporalAA } from './temporal-aa.ts';
import { Tonemap } from './tonemap.ts';

/** the targets sized with the scene textures */
interface Sized {
	/** the render size */
	width: number;
	height: number;
	/** the scene textures' version the targets were made for */
	version: number;
	/** the composited scene at the render size, which the temporal resolve reads */
	scene: GPUTexture;
	sceneView: GPUTextureView;
	/** views of the temporal histories, the antialiased scene at the output size */
	historyViews: [GPUTextureView, GPUTextureView];
}

/** owns the post chain's shared uniforms and sampler, and runs its passes in order */
export class PostProcess {
	/** the post exposure the game's auto exposure picks; the caller steps it each frame */
	readonly autoExposure: AutoExposure;
	/** the antialiasing; the caller jitters the main pass with it */
	readonly taa: TemporalAA;
	/** the nebula and planets the composite draws on the sky; the caller sets their look and textures */
	readonly celestial: CelestialLayer;
	/** the screen-space reflections; the caller resets their history on cuts */
	readonly reflections: ScreenSpaceReflections;
	/** the sun's lens flare; the caller sets its look and textures */
	readonly lensFlares: LensFlares;
	/**
	 * explicit layouts of the post uniforms and of the sky's reads (the sky-view LUT, its sampler and the
	 * volumetric fog, at their atmosphere.wgsl and sky.wgsl bindings), for passes that also bind the main
	 * pass's frame group and so can't use `auto` layouts
	 */
	readonly skyLayouts: { uniforms: GPUBindGroupLayout; sky: GPUBindGroupLayout };
	#device: GPUDevice;
	#uniforms: GPUBuffer;
	#data = new Float32Array(POST_BYTES / 4);
	#luts: AtmosphereLuts;
	#ao: AmbientOcclusion;
	#composite: Composite;
	#lightShafts: LightShafts;
	#bloom: Bloom;
	#tonemap: Tonemap;
	#sized: Sized | null = null;
	#environment: Environment;
	/** the volumetric fog the composite and water passes add in front */
	#fog: VolumetricFog;
	/** groups for {@link skyLayouts} */
	#skyLayoutGroups: { uniforms: GPUBindGroup; sky: GPUBindGroup };

	/**
	 * @param device the device
	 * @param swapchainFormat the canvas format the final pass writes
	 * @param environment the environment to start with
	 * @param fog the volumetric fog, which the caller encodes before {@link encode}
	 */
	constructor(
		device: GPUDevice,
		swapchainFormat: GPUTextureFormat,
		environment: Environment,
		fog: VolumetricFog,
	) {
		this.#device = device;
		this.#fog = fog;
		this.#uniforms = device.createBuffer({
			label: 'post uniforms',
			size: POST_BYTES,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		const sampler = device.createSampler({
			label: 'post bilinear',
			magFilter: 'linear',
			minFilter: 'linear',
			addressModeU: 'clamp-to-edge',
			addressModeV: 'clamp-to-edge',
		});
		const postUniforms = this.#uniforms;
		this.autoExposure = new AutoExposure(device);
		this.#luts = new AtmosphereLuts(device, postUniforms, sampler);
		this.#ao = new AmbientOcclusion(device, postUniforms);
		this.reflections = new ScreenSpaceReflections(device, postUniforms);
		this.celestial = new CelestialLayer(device, { postUniforms, sampler });
		this.#composite = new Composite(device, {
			postUniforms,
			sampler,
			skyView: this.#luts.skyView,
			froxels: fog.view,
		});
		this.#lightShafts = new LightShafts(device, postUniforms);
		this.lensFlares = new LensFlares(device);
		this.taa = new TemporalAA(device, postUniforms);
		this.#bloom = new Bloom(device, postUniforms, sampler);
		this.#tonemap = new Tonemap(device, postUniforms, sampler, swapchainFormat);
		this.#environment = environment;
		writeEnvironmentUniforms(this.#data, environment);

		{
			const fragment = GPUShaderStage.FRAGMENT;
			const texture = (binding: number, viewDimension: GPUTextureViewDimension): GPUBindGroupLayoutEntry => ({
				binding,
				visibility: fragment,
				texture: { sampleType: 'float', viewDimension },
			});
			const uniforms = device.createBindGroupLayout({
				label: 'post uniforms',
				entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | fragment, buffer: { type: 'uniform' } }],
			});
			const sky = device.createBindGroupLayout({
				label: 'sky reads',
				entries: [
					texture(SkyBinding.skyView, '2d'),
					{ binding: SkyBinding.sampler, visibility: fragment, sampler: { type: 'filtering' } },
					texture(SkyBinding.froxels, '3d'),
				],
			});
			this.skyLayouts = { uniforms, sky };
			this.#skyLayoutGroups = {
				uniforms: device.createBindGroup({
					layout: uniforms,
					entries: [{ binding: 0, resource: { buffer: postUniforms } }],
				}),
				sky: device.createBindGroup({
					layout: sky,
					entries: [
						{ binding: SkyBinding.skyView, resource: this.#luts.skyView },
						{ binding: SkyBinding.sampler, resource: sampler },
						{ binding: SkyBinding.froxels, resource: fog.view },
					],
				}),
			};
		}
	}

	/** @returns bytes of the targets the chain holds */
	get bytes(): number {
		const sized = this.#sized;
		// the composited scene, and each pass's own targets
		return (
			(sized === null ? 0 : sized.width * sized.height * 8) +
			this.#ao.bytes +
			this.#bloom.bytes +
			this.taa.bytes +
			this.reflections.bytes +
			this.#lightShafts.bytes
		);
	}

	/**
	 * binds the cloud panorama, once it streams in.
	 *
	 * @param cloud the texture's binding, or `null` for none
	 */
	setCloud(cloud: TextureBinding | null): void {
		this.celestial.setCloud(cloud);
	}

	/**
	 * binds the height fog's flow noise, once it streams in.
	 *
	 * @param noise the 3D texture's binding, or `null` for none
	 */
	setFlowNoise(noise: TextureBinding | null): void {
		this.#composite.setFlowNoise(noise);
	}

	/**
	 * @param settings the settings in effect
	 * @returns whether the composite draws drifting fog, which changes from frame to frame
	 */
	#drifts(settings: PostSettings): boolean {
		return (
			settings.flowNoise &&
			settings.heightFog &&
			this.#environment.heightFog.flowNoise !== null &&
			this.#composite.hasFlowNoise
		);
	}

	/**
	 * sets the environment; the atmosphere LUTs are rebuilt on the next frame.
	 *
	 * @param environment the shown level's environment
	 */
	setEnvironment(environment: Environment): void {
		this.#environment = environment;
		this.#luts.invalidate();
		writeEnvironmentUniforms(this.#data, environment);
	}

	#ensureSized(
		scene: SceneTextures,
		size: { width: number; height: number; outputWidth: number; outputHeight: number },
	): Sized {
		const { width, height, outputWidth, outputHeight } = size;
		const current = this.#sized;
		if (current !== null && current.version === scene.version) {
			return current;
		}
		current?.scene.destroy();
		const sceneTexture = this.#device.createTexture({
			label: 'hdr scene',
			size: [width, height],
			format: HDR_FORMAT,
			usage:
				GPUTextureUsage.RENDER_ATTACHMENT |
				GPUTextureUsage.TEXTURE_BINDING |
				GPUTextureUsage.COPY_SRC |
				GPUTextureUsage.COPY_DST,
		});
		const sceneView = sceneTexture.createView();
		this.#ao.resize({ depth: scene.depth, width, height });
		// the reflections run before compositing, so the scene they read still holds last frame's
		this.reflections.resize({ scene, previousScene: sceneView, width, height });
		this.celestial.resize({ depth: scene.depth, target: scene.reflection });
		this.#composite.resize({
			scene,
			ao: this.#ao.output,
			reflections: this.reflections.output.createView(),
			target: sceneView,
		});
		this.#lightShafts.resize({ scene, composited: sceneView, width, height });
		this.lensFlares.resize({ scene, composited: sceneView });
		this.taa.resize({ scene: sceneView, depth: scene.depth, width, height, outputWidth, outputHeight });
		const histories = this.taa.histories;
		this.#bloom.resize({ histories, outputWidth, outputHeight });
		this.#tonemap.resize({ histories, bloom: this.#bloom.result });
		const sized: Sized = {
			width,
			height,
			version: scene.version,
			scene: sceneTexture,
			sceneView,
			historyViews: [histories[0].createView(), histories[1].createView()],
		};
		this.#sized = sized;
		return sized;
	}

	/**
	 * encodes the chain from the main pass's outputs to the swapchain.
	 *
	 * @param encoder this frame's encoder, after the main pass
	 * @param input the main pass's textures, the camera (unjittered), the render and output sizes and settings
	 */
	encode(
		encoder: GPUCommandEncoder,
		input: {
			scene: SceneTextures;
			swapchain: GPUTextureView;
			camera: Camera;
			width: number;
			height: number;
			outputWidth: number;
			outputHeight: number;
			settings: PostSettings;
			frame: number;
			/** whether the volumetric fog was encoded this frame */
			froxels: boolean;
			/** drawn after compositing, when it has surfaces */
			water: WaterRenderer;
			/** draws the WaterDecal boxes into the water's foam (`WaterContext.foam`), `null` without any */
			waterFoam: WaterContext['foam'];
			/**
			 * draws effects over the composited scene, after the water: `target` is the scene, and `copy` copies it
			 * into the main pass's radiance target (which nothing reads after compositing) for effects that sample
			 * it
			 */
			screenEffects: (encoder: GPUCommandEncoder, target: GPUTextureView, copy: () => void) => void;
			/** the main pass's frame group and its uniforms' offset, which the water pass lights with */
			frameGroup: { group: GPUBindGroup; offset: number };
		},
	): void {
		const { scene, swapchain, camera, width, height, outputWidth, outputHeight } = input;
		const settings = effectiveSettings(input.settings);
		const environment = this.#environment;
		const sized = this.#ensureSized(scene, { width, height, outputWidth, outputHeight });
		writeFrameUniforms(this.#data, {
			camera,
			width,
			height,
			frame: input.frame,
			jitter: this.taa.jitter,
			settings,
			exposure: postExposure(settings, this.autoExposure),
			environment,
			froxels: input.froxels && settings.heightFog ? this.#fog.sampling : null,
			flowNoise: this.#drifts(settings) ? environment.heightFog.flowNoise : null,
			cloud: this.celestial.hasCloud,
		});
		this.#device.queue.writeBuffer(this.#uniforms, 0, this.#data);
		this.#luts.encode(encoder, settings.sky);
		if (settings.ao && environment.post.ao !== null) {
			this.#ao.encode(encoder);
		}
		// with reflections off this still clears what composite reads
		this.reflections.encode(encoder, { camera, look: environment.post.ssr, enabled: settings.reflections });
		this.celestial.encode(encoder, {
			eye: camera.position,
			sun: environment.sunDirection,
			sunIlluminance: environment.sunIlluminance,
		});
		const water = input.water;
		let waterContext: WaterContext | null = null;
		if (settings.debugView === 'lit' && water.active) {
			waterContext = {
				scene,
				background: scene.radiance,
				frame: input.frameGroup,
				postUniforms: this.#skyLayoutGroups.uniforms,
				sky: this.#skyLayoutGroups.sky,
				version: sized.version,
				width,
				height,
				foam: input.waterFoam,
			};
		}
		// the composite keeps back the transparent layers where there's water, which the water lays over itself
		if (waterContext !== null) {
			water.encodeDepth(encoder, waterContext);
		} else {
			water.clearDepth(encoder, scene);
		}
		this.#composite.encode(encoder);
		// the water and effects that refract read a copy of the composited scene, kept in the main pass's radiance
		// target, which nothing reads after compositing
		const copyScene = (): void => {
			encoder.copyTextureToTexture({ texture: sized.scene }, { texture: scene.radianceTexture }, [
				width,
				height,
			]);
		};
		if (waterContext !== null) {
			copyScene();
			water.encode(encoder, sized.sceneView, waterContext);
		}
		input.screenEffects(encoder, sized.sceneView, copyScene);
		if (settings.debugView === 'lit') {
			this.#lightShafts.encode(encoder, { camera, aspect: width / height, look: environment.lightShaft });
			// the game draws the flare after the shafts, which don't see it
			this.lensFlares.encode(encoder, { camera, width, height });
		}
		const resolved = this.taa.encode(encoder, camera);
		if (settings.autoExposure) {
			this.autoExposure.encode(
				encoder,
				{ view: sized.historyViews[resolved], width: outputWidth, height: outputHeight },
				environment.autoExposure,
			);
		}
		if (settings.bloom) {
			this.#bloom.encode(encoder, { history: resolved, half: environment.post.bloom?.half ?? true });
		}
		this.#tonemap.encode(encoder, { swapchain, history: resolved });
	}

	/** frees the chain's GPU resources */
	destroy(): void {
		this.#sized?.scene.destroy();
		this.#luts.destroy();
		this.#ao.destroy();
		this.#bloom.destroy();
		this.#uniforms.destroy();
		this.celestial.destroy();
		this.autoExposure.destroy();
		this.taa.destroy();
		this.reflections.destroy();
		this.#lightShafts.destroy();
		this.lensFlares.destroy();
	}
}
