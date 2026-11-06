import type { PipelineCache } from '../../gfx/pipeline-cache.ts';
import { GeometryFlags, LOOK_FLOATS, type LookStencil } from '../../looks/look.ts';
import type { DecodedGeometry } from '../../package/decode-protocol.ts';
import type { MeshBucket } from '../../streaming/mesh-buckets.ts';
import type { ResidentGeometry } from '../../streaming/resident.ts';
import type { BindLayouts } from '../frame/bind-layouts.ts';
import type { MainPassFormat } from '../frame/render-targets.ts';
import { LIST_CAPACITY, type ListedSpan } from '../instances/instance-renderer.ts';
import type { TextureStore } from '../textures/texture-store.ts';

import { COMPARATORS, type DrawEntry, drawRangeOf, sortKeyOf } from './draw-order.ts';
import {
	DRAW_RANGES,
	type DrawPhase,
	type DrawRange,
	type DrawRangeInfo,
	type EffectPass,
	type MeshPass,
	PAIRED_PASSES,
	PASS_PHASES,
	type SurfacePass,
} from './draw-ranges.ts';
import { releaseGeometry, uploadGeometry } from './geometry-residency.ts';
import { type EffectInputs, type EffectMaterial, MaterialBindings } from './material-bindings.ts';
import { type PhaseDescriber, prepareMeshPipelines } from './mesh-pipelines.ts';
import {
	VARIANTS,
	faceCullOf,
	stencilPipelineKey,
	variantKeys,
	variantOf,
	withStencil,
} from './pipeline-variants.ts';
import { type ResidentSkin, SkinAnimator } from './skin-animation.ts';
import { VertexBindings } from './vertex-bindings.ts';

/** floats of `Draw` in mesh.wgsl: the position and UV dequantizations, then the material look */
const DRAW_FLOATS = 16 + LOOK_FLOATS;
/** draws per frame at most; buckets past it aren't drawn */
const MAX_DRAWS = 16_384;

interface PreparedDraw {
	geometry: ResidentGeometry;
	indexCount: number;
	firstIndex: number;
	baseVertex: number;
	first: number;
	count: number;
	/** per shadow layer, how many of the rows from `first` it draws */
	layerCounts: readonly number[];
	/** the material group; `null` for an effect until its pass builds it */
	material: GPUBindGroup | null;
	/** the pipeline variant for its face culling and its geometry's UV format ({@link variantOf}) */
	variant: number;
	/** for scene effects: the material id and slot bindings their group is built from at encode */
	effect: EffectMaterial | null;
	/** the stencil state its pipeline variant uses, or `null` for the phase's own pipeline */
	stencil: LookStencil | null;
}

/** a range's queued buckets and where its draws landed this frame */
interface PreparedRange {
	info: DrawRangeInfo;
	/** this frame's buckets in the range, in draw order */
	entries: DrawEntry[];
	/** the range's draws, [start, end) of the prepared draws */
	start: number;
	end: number;
	/** the end of the cast-only draws, sorted first, where the passes over draws in view start */
	castOnlyEnd: number;
	/** the end of the shadow-casting draws, sorted before the rest, where the shadow passes stop */
	castersEnd: number;
}

/**
 * draws the mesh buckets: owns geometry buffers, material bind groups and the mesh pipelines, prepares each
 * frame's draws into the ranges of draw-ranges.ts and encodes the passes over them
 */
export class MeshRenderer {
	/** mesh instances last frame */
	instanceCount = 0;
	/** mesh triangles last frame */
	triangles = 0;
	/** draws whose base colour texture was bound */
	texturedDraws = 0;

	#device: GPUDevice;
	#pipelines: PipelineCache;
	#instances: { readonly bindGroup: GPUBindGroup };
	#params: GPUBuffer;
	#paramData = new Float32Array(MAX_DRAWS * DRAW_FLOATS);
	#paramWords = new Uint32Array(this.#paramData.buffer);
	#drawIds: GPUBuffer;
	#drawIdData = new Uint32Array(LIST_CAPACITY);
	#drawGroup: GPUBindGroup;
	#vertexBindings: VertexBindings;
	#materials: MaterialBindings;
	/** every range, in {@link DRAW_RANGES} order */
	#ranges: PreparedRange[] = DRAW_RANGES.map((info) => ({
		info,
		entries: [],
		start: 0,
		end: 0,
		castOnlyEnd: 0,
		castersEnd: 0,
	}));
	#rangeOf = new Map(this.#ranges.map((range) => [range.info.range, range]));
	/** the entries queued in the ranges, reused across frames */
	#entries: DrawEntry[] = [];
	/** prepared draws in {@link DRAW_RANGES} order; entries past {@link #drawCount} are reused next frame */
	#draws: PreparedDraw[] = [];
	#drawCount = 0;
	/** whether the depth buffer has a stencil; without one, draws that use it are skipped */
	#stencil: boolean;
	/** each phase's pipeline descriptor by face culling and UV format, for its stencil variants */
	#describers: Map<string, PhaseDescriber>;
	/** each phase's variant keys by phase key */
	#phaseKeys = new Map<string, readonly string[]>();
	/** the passes whose pipelines have all compiled */
	#compiledPasses = new Set<MeshPass>();
	#skins: SkinAnimator;
	/** the animations of this frame's draws, which are skinned before they draw */
	#drawnSkins = new Set<ResidentSkin>();

	/**
	 * @param device the device
	 * @param layouts shared layouts
	 * @param pipelines pipeline cache
	 * @param instances the owner of group 1 (instance rows, block origins and the visible list), asked for it
	 *   on every encode since it changes when the rows grow
	 * @param format the main pass's targets
	 */
	constructor(
		device: GPUDevice,
		layouts: BindLayouts,
		pipelines: PipelineCache,
		instances: { readonly bindGroup: GPUBindGroup },
		format: MainPassFormat,
	) {
		this.#device = device;
		this.#pipelines = pipelines;
		this.#instances = instances;
		this.#stencil = format.stencil;
		this.#skins = new SkinAnimator(device, pipelines);
		this.#vertexBindings = new VertexBindings(device);
		this.#params = device.createBuffer({
			label: 'mesh draws',
			size: this.#paramData.byteLength,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
		});
		this.#drawIds = device.createBuffer({
			label: 'mesh draw ids',
			size: this.#drawIdData.byteLength,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
		});
		this.#drawGroup = device.createBindGroup({
			label: 'mesh draws',
			layout: layouts.draw,
			entries: [
				{ binding: 0, resource: { buffer: this.#params } },
				{ binding: 1, resource: { buffer: this.#drawIds } },
			],
		});
		const { describers, effectLayout } = prepareMeshPipelines(device, layouts, pipelines, format);
		this.#describers = describers;
		this.#materials = new MaterialBindings(device, layouts.materials, effectLayout);
	}

	// #region residency

	/**
	 * uploads a decoded geometry.
	 *
	 * @param blob the geometry's blob, for labels
	 * @param decoded vertex streams and indices
	 * @returns the residency (geometry buffers aren't pooled; the memory budget bounds them)
	 */
	upload(blob: number, decoded: DecodedGeometry): ResidentGeometry {
		return uploadGeometry(
			this.#device,
			{ skins: this.#skins, bindings: this.#vertexBindings },
			blob,
			decoded,
		);
	}

	/** @param resident a geometry from {@link upload}; its buffers are destroyed */
	release(resident: ResidentGeometry): void {
		if (resident.skin !== null) {
			this.#drawnSkins.delete(resident.skin);
		}
		releaseGeometry(resident);
	}

	/** forgets material bind groups (when a package is unloaded) */
	releaseMaterials(): void {
		this.#materials.release();
	}

	/** @returns bytes of the fixed GPU allocations: the draw parameters, the draw ids and the zero streams */
	get bytes(): number {
		return this.#params.size + this.#drawIds.size + this.#vertexBindings.bytes;
	}

	/**
	 * destroys the renderer's own GPU allocations; geometries stay with their residency, released through
	 * {@link release}. the renderer can't be used after
	 */
	destroy(): void {
		this.#params.destroy();
		this.#drawIds.destroy();
		this.#vertexBindings.destroy();
		this.#materials.release();
	}

	// #endregion

	// #region animation

	/**
	 * skins the animated geometries this frame draws at the time's frame; encode before anything draws meshes
	 *
	 * @param encoder the frame's encoder
	 * @param time seconds of the viewer's clock
	 * @returns whether a drawn geometry moved, so the shadows it casts must be drawn again
	 */
	animate(encoder: GPUCommandEncoder, time: number): boolean {
		return this.#skins.encode(encoder, this.#drawnSkins, time);
	}

	// #endregion

	// #region prepare

	/** draws nothing this frame */
	clear(): void {
		this.#drawCount = 0;
		this.instanceCount = 0;
		this.triangles = 0;
		this.texturedDraws = 0;
		this.#drawnSkins.clear();
	}

	/**
	 * writes this frame's draw parameters.
	 *
	 * @param buckets this frame's mesh buckets
	 * @param spans where `InstanceRenderer.prepareList` placed each bucket's rows in the visible list, by index
	 *   into `buckets`
	 * @param textures the package's textures
	 */
	prepare(buckets: readonly MeshBucket[], spans: readonly ListedSpan[], textures: TextureStore): void {
		this.clear();
		for (const range of this.#ranges) {
			range.entries.length = 0;
		}
		let entries = 0;
		for (let b = 0; b < buckets.length; b++) {
			const bucket = buckets[b];
			const span = spans[b];
			if (span.count === 0 || bucket.geometry.resident?.kind !== 'geometry') {
				continue;
			}
			const look = bucket.look;
			const state = this.#materials.state(bucket.material, look, textures);
			const range = drawRangeOf(look, { castOnly: bucket.castOnly, stencil: this.#stencil, state });
			if (range === null) {
				continue;
			}
			const entry = this.#entries[entries];
			if (entry === undefined) {
				this.#entries[entries] = { bucket, span, key: sortKeyOf(bucket) };
			} else {
				entry.bucket = bucket;
				entry.span = span;
				entry.key = sortKeyOf(bucket);
			}
			this.#range(range).entries.push(this.#entries[entries]);
			entries++;
		}

		let listStart = LIST_CAPACITY;
		let listEnd = 0;
		let d = 0;
		for (const range of this.#ranges) {
			range.entries.sort(COMPARATORS[range.info.order]);
			range.start = d;
			range.castOnlyEnd = d;
			range.castersEnd = d;
			for (const { bucket, span } of range.entries) {
				if (d >= MAX_DRAWS || !this.#prepareDraw(d, bucket, span, range.info, textures)) {
					continue;
				}
				listStart = Math.min(listStart, span.first);
				listEnd = Math.max(listEnd, span.first + span.count);
				d++;
				if (bucket.look.castsShadows) {
					range.castersEnd = d;
				}
				if (bucket.castOnly) {
					range.castOnlyEnd = d;
				}
			}
			range.end = d;
		}
		this.#drawCount = d;
		if (d > 0) {
			const queue = this.#device.queue;
			queue.writeBuffer(this.#params, 0, this.#paramData, 0, d * DRAW_FLOATS);
			queue.writeBuffer(this.#drawIds, listStart * 4, this.#drawIdData, listStart, listEnd - listStart);
		}
	}

	/** @returns the prepared range of a draw range */
	#range(range: DrawRange): PreparedRange {
		const prepared = this.#rangeOf.get(range);
		if (prepared === undefined) {
			throw new Error(`draw range ${range} isn't in DRAW_RANGES`);
		}
		return prepared;
	}

	/**
	 * writes the parameters of a bucket's draw and counts its instances in the stats
	 *
	 * @returns whether it draws (its submesh is resident)
	 */
	#prepareDraw(
		d: number,
		bucket: MeshBucket,
		span: ListedSpan,
		info: DrawRangeInfo,
		textures: TextureStore,
	): boolean {
		const resident = bucket.geometry.resident;
		const range = resident?.kind === 'geometry' ? resident.submeshes[bucket.submesh] : undefined;
		if (resident?.kind !== 'geometry' || range === undefined) {
			return false;
		}
		const look = bucket.look;
		const state = this.#materials.state(bucket.material, look, textures);
		if (resident.skin !== null) {
			this.#drawnSkins.add(resident.skin);
		}
		const params = this.#paramData;
		const words = this.#paramWords;
		const at = d * DRAW_FLOATS;
		// element by element: `set` from a small plain array costs more than the copy
		const [ox, oy, oz] = resident.positionOffset;
		const [sx, sy, sz] = resident.positionScale;
		params[at] = ox;
		params[at + 1] = oy;
		params[at + 2] = oz;
		words[at + 3] =
			state.flags |
			(resident.normalOffset === null ? 0 : GeometryFlags.HasNormals) |
			(resident.tangentOffset === null ? 0 : GeometryFlags.HasTangents) |
			(resident.colorOffset === null ? 0 : GeometryFlags.HasColors);
		params[at + 4] = sx;
		params[at + 5] = sy;
		params[at + 6] = sz;
		params[at + 7] = 0;
		for (let set = 0; set < 2; set++) {
			const transform = resident.uvTransforms[set];
			const to = at + 8 + set * 4;
			params[to] = transform[0];
			params[to + 1] = transform[1];
			params[to + 2] = transform[2];
			params[to + 3] = transform[3];
		}
		params.set(look.params, at + 16);
		this.#drawIdData.fill(d, span.first, span.first + span.count);

		// an effect's group also binds the main pass's outputs, so it's built when its pass encodes
		const material = info.effect ? null : state.group;
		const effect = info.effect ? state : null;
		const variant = variantOf(faceCullOf(bucket), resident.uvFormat);
		const draw = this.#draws[d];
		if (draw === undefined) {
			this.#draws[d] = {
				geometry: resident,
				indexCount: range.indexCount,
				firstIndex: range.firstIndex,
				baseVertex: range.baseVertex,
				first: span.first,
				count: span.count,
				layerCounts: span.layerCounts,
				material,
				variant,
				effect,
				stencil: look.stencil,
			};
		} else {
			draw.geometry = resident;
			draw.indexCount = range.indexCount;
			draw.firstIndex = range.firstIndex;
			draw.baseVertex = range.baseVertex;
			draw.first = span.first;
			draw.count = span.count;
			draw.layerCounts = span.layerCounts;
			draw.material = material;
			draw.variant = variant;
			draw.effect = effect;
			draw.stencil = look.stencil;
		}
		if (!bucket.castOnly) {
			this.instanceCount += span.count;
			this.triangles += (span.count * range.indexCount) / 3;
			if (state.slots[0] !== null) {
				this.texturedDraws++;
			}
		}
		return true;
	}

	// #endregion

	// #region encode

	/**
	 * @param which the pass
	 * @returns whether this frame has draws in the pass, so it needs to be run
	 */
	has(which: MeshPass): boolean {
		return PASS_PHASES[which].some((phase) => {
			const range = this.#range(phase.range);
			return range.end > range.start;
		});
	}

	/**
	 * encodes a pass over the main pass's targets, with group 0 bound: `prepass` lays down the opaque meshes'
	 * depth, so call it before anything else draws into the main pass, then `main`
	 *
	 * @param which the pass
	 * @param pass the main pass
	 * @returns draw calls issued
	 */
	encodePass(which: SurfacePass, pass: GPURenderPassEncoder): number {
		return this.#encode(which, pass, -1);
	}

	/**
	 * encodes a pass of scene effects, with group 0 bound. in frame order:
	 *
	 * - `relight` adds the light that relit decals change to the main pass's radiance, into a pass whose only
	 *   attachment is that radiance, kept (`load`)
	 * - `transparent` into the transparent pass, with the main pass's depth attached read-only
	 * - `waterFoam` draws the WaterDecal boxes into a pass whose only colour attachment is the foam target
	 *   (`WATER_FOAM_FORMAT`), cleared to (0, 0, 0, 1), with the main pass's depth attached read-only; `inputs`
	 *   hold the water surface's depth in place of the scene's
	 * - `multiply` multiplies the composited scene, into a pass whose only colour attachment is the composited
	 *   scene, kept (`load`), with the main pass's depth attached read-only
	 * - `refract` blends refracting effects over the composited scene, into a pass as `multiply`'s; `inputs` must
	 *   have the composited scene's copy as their `background`
	 *
	 * @param which the pass
	 * @param pass the pass
	 * @param inputs the main pass's outputs, which the effects read
	 * @returns draw calls issued
	 */
	encodeEffectPass(which: EffectPass, pass: GPURenderPassEncoder, inputs: EffectInputs): number {
		// effect groups also bind the main pass's outputs
		for (const phase of PASS_PHASES[which]) {
			const range = this.#range(phase.range);
			for (let i = range.start; i < range.end; i++) {
				const draw = this.#draws[i];
				if (draw.effect !== null) {
					draw.material = this.#materials.effectGroup(draw.effect, inputs);
				}
			}
		}
		return this.#encode(which, pass, -1);
	}

	/**
	 * draws this frame's meshes into a shadow cascade.
	 *
	 * @param pass a shadow pass, with group 0 bound
	 * @param layer the shadow layer, which draws only the instances that can cast into it
	 * @returns draw calls issued
	 */
	encodeShadow(pass: GPURenderPassEncoder, layer: number): number {
		return this.#encode('shadow', pass, layer);
	}

	/** @returns the cache keys of a phase's pipeline variants, by {@link variantOf} */
	#variantKeys(phase: DrawPhase): readonly string[] {
		return this.#phaseKeys.getOrInsertComputed(phase.key, variantKeys);
	}

	/** @returns whether every pipeline of a pass's phases is compiled; once they are, they stay */
	#compiled(which: MeshPass): boolean {
		if (this.#compiledPasses.has(which)) {
			return true;
		}
		for (const phase of PASS_PHASES[which]) {
			for (const key of this.#variantKeys(phase)) {
				if (this.#pipelines.get(key) === undefined) {
					return false;
				}
			}
		}
		this.#compiledPasses.add(which);
		return true;
	}

	/**
	 * encodes a pass's phases in order; nothing if any of its or its paired pass's pipelines isn't ready.
	 * `layer` limits each draw to the rows that shadow layer draws, or is -1 for all of them
	 */
	#encode(which: MeshPass, pass: GPURenderPassEncoder, layer: number): number {
		if (this.#drawCount === 0) {
			return 0;
		}
		// cutout depth and depth-equal shading must rasterize identically, so nothing draws until every variant
		// is ready
		const paired = PAIRED_PASSES[which];
		if (!this.#compiled(which) || (paired !== undefined && !this.#compiled(paired))) {
			return 0;
		}
		pass.setBindGroup(1, this.#instances.bindGroup);
		pass.setBindGroup(2, this.#drawGroup);
		const bindings = this.#vertexBindings;
		bindings.reset();
		let draws = 0;
		for (const phase of PASS_PHASES[which]) {
			const range = this.#range(phase.range);
			// shadow passes draw the casters, cast-only ones first; the rest skip those
			const from = phase.shadow ? range.start : range.castOnlyEnd;
			const to = phase.shadow ? range.castersEnd : range.end;
			if (from === to) {
				continue;
			}
			const keys = this.#variantKeys(phase);
			let variant = -1;
			let stencil: LookStencil | null = null;
			let reference = -1;
			let geometry: ResidentGeometry | null = null;
			let material: GPUBindGroup | null = null;
			for (let i = from; i < to; i++) {
				const draw = this.#draws[i];
				const count = layer < 0 ? draw.count : draw.layerCounts[layer];
				// only an effect drawn outside its pass would lack its group
				if (draw.material === null || count === 0) {
					continue;
				}
				if (draw.variant !== variant || draw.stencil !== stencil) {
					if (draw.stencil === null) {
						const pipeline = this.#pipelines.get(keys[draw.variant]);
						if (pipeline === undefined) {
							return draws;
						}
						pass.setPipeline(pipeline);
					} else {
						// a variant still compiling skips its draws; the next draw picks a pipeline again
						const pipeline = this.#stencilPipeline(phase, keys, draw.variant, draw.stencil);
						if (pipeline === undefined) {
							variant = -1;
							continue;
						}
						pass.setPipeline(pipeline);
						if (draw.stencil.reference !== reference) {
							reference = draw.stencil.reference;
							pass.setStencilReference(reference);
						}
					}
					variant = draw.variant;
					stencil = draw.stencil;
				}
				if ((phase.textured || material === null) && draw.material !== material) {
					material = draw.material;
					pass.setBindGroup(3, material);
				}
				if (draw.geometry !== geometry) {
					geometry = draw.geometry;
					bindings.bindStreams(pass, geometry, phase.streams);
					pass.setIndexBuffer(geometry.indices, geometry.indexFormat);
				}
				pass.drawIndexed(draw.indexCount, count, draw.firstIndex, draw.baseVertex, draw.first);
				draws++;
			}
		}
		return draws;
	}

	/**
	 * @param phase the phase
	 * @param keys the phase's variant keys
	 * @param variant the draw's variant
	 * @param stencil the draw's stencil state
	 * @returns the phase's pipeline variant for the stencil state, or `undefined` while it compiles (compiling
	 *   starts on the first call)
	 */
	#stencilPipeline(
		phase: DrawPhase,
		keys: readonly string[],
		variant: number,
		stencil: LookStencil,
	): GPURenderPipeline | undefined {
		const key = stencilPipelineKey(keys[variant], stencil);
		const pipeline = this.#pipelines.get(key);
		if (pipeline !== undefined) {
			return pipeline;
		}
		const describer = this.#describers.get(phase.key);
		if (describer === undefined) {
			throw new Error(`phase ${phase.key} has no pipeline descriptor`);
		}
		const { cull, uvFormat } = VARIANTS[variant];
		void this.#pipelines.prepare(key, () => withStencil(describer(cull, uvFormat), stencil));
		return undefined;
	}

	// #endregion
}
