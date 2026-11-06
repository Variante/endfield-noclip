import type { DecodedSkin } from '../../package/decode-protocol.ts';

import { skinFrame } from './skin-frame.ts';
import skinWgsl from './skin.wgsl?raw';

/** bytes of `Skin` in skin.wgsl */
const PARAMS_BYTES = 112;
const WORKGROUP = 64;
/** `NONE` in skin.wgsl: a stream the geometry lacks */
const NONE = 0xff_ff_ff_ff;

/** an animated geometry's GPU side: its bind pose, frames and the pass that skins it into its vertices */
export interface ResidentSkin {
	vertexCount: number;
	frameCount: number;
	frameRate: number;
	/** `Skin` in skin.wgsl; the frame fields change each frame */
	params: GPUBuffer;
	paramData: ArrayBuffer;
	group: GPUBindGroup;
	/** GPU bytes of the bind pose and frames */
	bytes: number;
	/** buffers the skin owns, destroyed with it */
	buffers: GPUBuffer[];
}

/** skins animated geometries into their own vertex buffers before they're drawn */
export class SkinAnimator {
	#device: GPUDevice;
	#pipeline: GPUComputePipeline;

	/** @param device the device */
	constructor(device: GPUDevice) {
		this.#device = device;
		const module = device.createShaderModule({ label: 'skin', code: skinWgsl });
		this.#pipeline = device.createComputePipeline({
			label: 'skin',
			layout: 'auto',
			compute: { module, entryPoint: 'cs_skin' },
		});
	}

	/**
	 * uploads an animated geometry's bind pose and frames
	 *
	 * @param label names the buffers
	 * @param skin the decoded animation
	 * @param target the geometry's vertex buffer, created with storage usage, and where its streams start
	 * @returns the residency; destroy its buffers with the geometry's
	 */
	create(
		label: string,
		skin: DecodedSkin,
		target: {
			vertices: GPUBuffer;
			vertexCount: number;
			normalOffset: number | null;
			tangentOffset: number | null;
			positionOffset: readonly number[];
			positionScale: readonly number[];
		},
	): ResidentSkin {
		const device = this.#device;
		const storage = (name: string, data: ArrayBuffer): GPUBuffer => {
			const buffer = device.createBuffer({
				label: `${label} ${name}`,
				size: Math.max(16, Math.ceil(data.byteLength / 4) * 4),
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
			});
			device.queue.writeBuffer(buffer, 0, data);
			return buffer;
		};
		const source = storage('bind pose', skin.source);
		const frames = storage('frames', skin.matrices);
		const params = device.createBuffer({
			label: `${label} skin`,
			size: PARAMS_BYTES,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		const paramData = new ArrayBuffer(PARAMS_BYTES);
		{
			const words = new Uint32Array(paramData);
			const floats = new Float32Array(paramData);
			words[0] = target.vertexCount;
			words[1] = skin.boneCount;
			// a stream the geometry has is written in place of its bind pose's, which the source keeps
			const out = (offset: number | null, from: number): number =>
				offset !== null && from >= 0 ? offset / 4 : NONE;
			words[5] = out(target.normalOffset, skin.normalWord);
			words[6] = out(target.tangentOffset, skin.tangentWord);
			words[7] = Math.max(skin.normalWord, 0);
			words[8] = Math.max(skin.tangentWord, 0);
			words[9] = skin.weightWord;
			words[10] = skin.boneWord;
			floats.set(skin.bindOffset, 12);
			floats.set(skin.bindScale, 16);
			floats.set(target.positionOffset, 20);
			floats.set(
				target.positionScale.map((scale) => (scale === 0 ? 0 : 1 / scale)),
				24,
			);
		}
		device.queue.writeBuffer(params, 0, paramData);
		const group = device.createBindGroup({
			label: `${label} skin`,
			layout: this.#pipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: params } },
				{ binding: 1, resource: { buffer: source } },
				{ binding: 2, resource: { buffer: frames } },
				{ binding: 3, resource: { buffer: target.vertices } },
			],
		});
		return {
			vertexCount: target.vertexCount,
			frameCount: skin.frameCount,
			frameRate: skin.frameRate,
			params,
			paramData,
			group,
			bytes: source.size + frames.size + params.size,
			buffers: [source, frames, params],
		};
	}

	/**
	 * skins each geometry at the time's frame, before anything draws them
	 *
	 * @param encoder the frame's encoder
	 * @param skins the resident animated geometries
	 * @param time seconds of the viewer's clock; every geometry plays from the same start
	 */
	encode(encoder: GPUCommandEncoder, skins: Iterable<ResidentSkin>, time: number): void {
		let pass: GPUComputePassEncoder | null = null;
		for (const skin of skins) {
			const { a, b, blend } = skinFrame(time, skin.frameCount, skin.frameRate);
			const words = new Uint32Array(skin.paramData);
			words[2] = a;
			words[3] = b;
			new Float32Array(skin.paramData)[4] = blend;
			// only the frame fields change
			this.#device.queue.writeBuffer(skin.params, 0, skin.paramData, 0, 20);
			pass ??= encoder.beginComputePass({ label: 'skin' });
			pass.setPipeline(this.#pipeline);
			pass.setBindGroup(0, skin.group);
			pass.dispatchWorkgroups(Math.ceil(skin.vertexCount / WORKGROUP));
		}
		pass?.end();
	}
}
