import type { LightShaftLook } from '../../environment/environment.ts';
import {
	type FullscreenPass,
	autoBindGroup,
	encodeFullscreen,
	fullscreenPipeline,
} from '../../gfx/fullscreen-pass.ts';
import type { Camera } from '../../scene/camera.ts';
import { HDR_FORMAT, type SceneTextures } from '../frame/render-targets.ts';

import lightShaftsWgsl from './light-shafts.wgsl?raw';
import { postShaderModule } from './shader-source.ts';

/** byte size of `Shafts` in light-shafts.wgsl */
const UNIFORM_BYTES = 48;
/** the game's `lightShaftDownSampleFactor` at PC quality tiers 2000 and up */
const DOWNSAMPLE = 2;
/** the game's default `lightShaftSampleNum` */
const SAMPLES = 12;
/** the game's default `lightShaftBlurPassCount` */
const BLUR_PASSES = 3;

interface Sized {
	width: number;
	height: number;
	textures: GPUTexture[];
	/** the downsample, then the blur passes, ping-ponging */
	passes: FullscreenPass[];
	/** adds the last blur onto the scene */
	apply: FullscreenPass;
}

/** owns the shafts' reduced-size targets and passes */
export class LightShafts {
	#device: GPUDevice;
	#postUniforms: GPUBuffer;
	#uniforms: GPUBuffer;
	/** per blur pass: its index */
	#passUniforms: GPUBuffer[];
	#data = new Float32Array(UNIFORM_BYTES / 4);
	#sampler: GPUSampler;
	#pipelines: Record<'downsample' | 'blur' | 'apply', GPURenderPipeline>;
	#sized: Sized | null = null;

	/**
	 * @param device the device
	 * @param postUniforms the post chain's `Post` uniforms
	 */
	constructor(device: GPUDevice, postUniforms: GPUBuffer) {
		this.#device = device;
		this.#postUniforms = postUniforms;
		this.#uniforms = device.createBuffer({
			label: 'light shaft uniforms',
			size: UNIFORM_BYTES,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		this.#passUniforms = Array.from({ length: BLUR_PASSES }, (_, i) => {
			const buffer = device.createBuffer({
				label: `light shaft blur ${i}`,
				size: 16,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
			});
			device.queue.writeBuffer(buffer, 0, new Float32Array([i, 0, 0, 0]));
			return buffer;
		});
		this.#sampler = device.createSampler({
			label: 'light shaft bilinear',
			magFilter: 'linear',
			minFilter: 'linear',
			addressModeU: 'clamp-to-edge',
			addressModeV: 'clamp-to-edge',
		});
		const module = postShaderModule(device, 'light shafts', [lightShaftsWgsl]);
		const pipeline = (label: string, entryPoint: string, target: GPUColorTargetState): GPURenderPipeline =>
			fullscreenPipeline(device, { label, module, entryPoint, targets: [target] });
		const add: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one', operation: 'add' };
		this.#pipelines = {
			downsample: pipeline('light shaft downsample', 'fs_downsample', { format: HDR_FORMAT }),
			blur: pipeline('light shaft blur', 'fs_blur', { format: HDR_FORMAT }),
			// the game adds the colour only
			apply: pipeline('light shaft apply', 'fs_apply', {
				format: HDR_FORMAT,
				blend: { color: add, alpha: add },
				writeMask: GPUColorWrite.RED | GPUColorWrite.GREEN | GPUColorWrite.BLUE,
			}),
		};
	}

	/** @returns bytes of the targets */
	get bytes(): number {
		const sized = this.#sized;
		return sized === null ? 0 : sized.width * sized.height * 8 * sized.textures.length;
	}

	/**
	 * (re)creates the targets for a new render size or inputs.
	 *
	 * @param input the main pass's textures, the composited scene (read, then added onto) and the render size
	 */
	resize(input: { scene: SceneTextures; composited: GPUTextureView; width: number; height: number }): void {
		this.#release();
		const device = this.#device;
		const p = this.#pipelines;
		const width = Math.max(1, Math.ceil(input.width / DOWNSAMPLE));
		const height = Math.max(1, Math.ceil(input.height / DOWNSAMPLE));
		const textures = [0, 1].map((i) =>
			device.createTexture({
				label: `light shafts ${i}`,
				size: [width, height],
				format: HDR_FORMAT,
				usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
			}),
		);
		const views = textures.map((texture) => texture.createView());
		const shafts = { buffer: this.#uniforms };
		const passes: FullscreenPass[] = [
			{
				label: 'light shaft downsample',
				pipeline: p.downsample,
				groups: [
					autoBindGroup(device, p.downsample, 0, {
						0: { buffer: this.#postUniforms },
						1: shafts,
						2: this.#sampler,
					}),
					autoBindGroup(device, p.downsample, 1, { 0: input.composited, 1: input.scene.depth }),
				],
				targets: [views[0]],
			},
		];
		// the blurs and the apply read none of the post uniforms
		const blurShared = autoBindGroup(device, p.blur, 0, { 1: shafts, 2: this.#sampler });
		for (let i = 0; i < BLUR_PASSES; i++) {
			passes.push({
				label: 'light shaft blur',
				pipeline: p.blur,
				groups: [
					blurShared,
					autoBindGroup(device, p.blur, 1, { 2: { buffer: this.#passUniforms[i] }, 3: views[i % 2] }),
				],
				targets: [views[(i + 1) % 2]],
			});
		}
		const apply: FullscreenPass = {
			label: 'light shaft apply',
			pipeline: p.apply,
			groups: [
				autoBindGroup(device, p.apply, 0, { 2: this.#sampler }),
				autoBindGroup(device, p.apply, 1, { 3: views[BLUR_PASSES % 2] }),
			],
			targets: [input.composited],
		};
		this.#sized = { width, height, textures, passes, apply };
	}

	/**
	 * adds this frame's shafts onto the composited scene, when the look has them and the sun is in front of the
	 * camera.
	 *
	 * @param encoder this frame's encoder, after compositing and before temporal antialiasing
	 * @param input the camera (unjittered), the render size's aspect and the environment's shafts (`null`:
	 *   none)
	 */
	encode(
		encoder: GPUCommandEncoder,
		input: { camera: Camera; aspect: number; look: LightShaftLook | null },
	): void {
		const sized = this.#sized;
		if (sized === null) {
			throw new Error('light shafts used before resize()');
		}
		const { camera, aspect, look } = input;
		if (look === null) {
			return;
		}
		const sun = camera.projectDirection(look.sunDirection, aspect);
		if (sun === null) {
			return;
		}
		const f = this.#data;
		f.set([1 / look.occlusionDepthRange, look.bloomScale, 0, look.maxBrightness], 0);
		f.set([...look.tint, look.threshold], 4);
		f.set([sun[0], sun[1], SAMPLES, look.blurIntensity], 8);
		this.#device.queue.writeBuffer(this.#uniforms, 0, f);
		for (const pass of sized.passes) {
			encodeFullscreen(encoder, pass);
		}
		encodeFullscreen(encoder, sized.apply, 'load');
	}

	#release(): void {
		for (const texture of this.#sized?.textures ?? []) {
			texture.destroy();
		}
		this.#sized = null;
	}

	/** frees the targets and the uniforms */
	destroy(): void {
		this.#release();
		this.#uniforms.destroy();
		for (const buffer of this.#passUniforms) {
			buffer.destroy();
		}
	}
}
