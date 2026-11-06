import {
	type FullscreenPass,
	autoBindGroup,
	encodeFullscreen,
	fullscreenPipeline,
} from '../../gfx/fullscreen-pass.ts';

import gtaoWgsl from './gtao.wgsl?raw';
import { postShaderModule } from './shader-source.ts';

const AO_FORMAT: GPUTextureFormat = 'r8unorm';
/** the reduced view depth the AO marches */
const AO_DEPTH_FORMAT: GPUTextureFormat = 'r32float';
/** full-resolution pixels per AO pixel along each axis; matches `AO_SCALE` in gtao.wgsl */
const AO_SCALE = 2;

interface Sized {
	width: number;
	height: number;
	/** half resolution: view depth, and the AO marched over it */
	textures: GPUTexture[];
	/** full resolution */
	blurred: GPUTextureView;
	/** the reduced depth, the march and the depth-aware blur that upsamples it */
	passes: FullscreenPass[];
}

/** the ground-truth ambient occlusion (gtao.wgsl): marched at half resolution, blurred back up */
export class AmbientOcclusion {
	#device: GPUDevice;
	#postUniforms: GPUBuffer;
	#pipelines: Record<'depth' | 'gtao' | 'blur', GPURenderPipeline>;
	#sized: Sized | null = null;

	/**
	 * @param device the device
	 * @param postUniforms the post chain's `Post` uniforms
	 */
	constructor(device: GPUDevice, postUniforms: GPUBuffer) {
		this.#device = device;
		this.#postUniforms = postUniforms;
		const module = postShaderModule(device, 'gtao', [gtaoWgsl]);
		const pipeline = (label: string, entryPoint: string, format: GPUTextureFormat): GPURenderPipeline =>
			fullscreenPipeline(device, { label, module, entryPoint, targets: [{ format }] });
		this.#pipelines = {
			depth: pipeline('ao depth', 'fs_ao_depth', AO_DEPTH_FORMAT),
			gtao: pipeline('gtao', 'fs_gtao', AO_FORMAT),
			blur: pipeline('gtao blur', 'fs_blur', AO_FORMAT),
		};
	}

	#ensureSized(): Sized {
		if (this.#sized === null) {
			throw new Error('ambient occlusion used before resize()');
		}
		return this.#sized;
	}

	/** @returns the blurred occlusion at the render size, which the composite reads; valid after {@link resize} */
	get output(): GPUTextureView {
		return this.#ensureSized().blurred;
	}

	/** @returns bytes of the targets */
	get bytes(): number {
		const sized = this.#sized;
		// the reduced depth and AO, and the blurred AO
		return sized === null ? 0 : sized.width * sized.height * ((4 + 1) / AO_SCALE ** 2 + 1);
	}

	/**
	 * (re)creates the targets for a new render size or depth.
	 *
	 * @param input the main pass's depth and the render size
	 */
	resize(input: { depth: GPUTextureView; width: number; height: number }): void {
		this.#release();
		const { depth, width, height } = input;
		const device = this.#device;
		const p = this.#pipelines;
		const texture = (label: string, w: number, h: number, format: GPUTextureFormat): GPUTexture =>
			device.createTexture({
				label,
				size: [w, h],
				format,
				usage:
					GPUTextureUsage.RENDER_ATTACHMENT |
					GPUTextureUsage.TEXTURE_BINDING |
					GPUTextureUsage.COPY_SRC |
					GPUTextureUsage.COPY_DST,
			});
		const aoWidth = Math.max(1, Math.ceil(width / AO_SCALE));
		const aoHeight = Math.max(1, Math.ceil(height / AO_SCALE));
		const aoDepth = texture('ao depth', aoWidth, aoHeight, AO_DEPTH_FORMAT);
		const ao = texture('ao', aoWidth, aoHeight, AO_FORMAT);
		const blurred = texture('ao blurred', width, height, AO_FORMAT);
		const post = (pipeline: GPURenderPipeline): GPUBindGroup =>
			autoBindGroup(device, pipeline, 0, { 0: { buffer: this.#postUniforms } });
		const blurredView = blurred.createView();
		this.#sized = {
			width,
			height,
			textures: [aoDepth, ao, blurred],
			blurred: blurredView,
			passes: [
				{
					label: 'ao depth',
					pipeline: p.depth,
					groups: [post(p.depth), autoBindGroup(device, p.depth, 1, { 0: depth })],
					targets: [aoDepth.createView()],
				},
				{
					label: 'gtao',
					pipeline: p.gtao,
					groups: [post(p.gtao), autoBindGroup(device, p.gtao, 1, { 1: aoDepth.createView() })],
					targets: [ao.createView()],
				},
				{
					label: 'gtao blur',
					pipeline: p.blur,
					groups: [
						post(p.blur),
						autoBindGroup(device, p.blur, 1, { 0: depth, 1: aoDepth.createView(), 2: ao.createView() }),
					],
					targets: [blurredView],
				},
			],
		};
	}

	/** @param encoder this frame's encoder, after the main pass */
	encode(encoder: GPUCommandEncoder): void {
		for (const pass of this.#ensureSized().passes) {
			encodeFullscreen(encoder, pass);
		}
	}

	#release(): void {
		for (const texture of this.#sized?.textures ?? []) {
			texture.destroy();
		}
		this.#sized = null;
	}

	/** frees the targets */
	destroy(): void {
		this.#release();
	}
}
