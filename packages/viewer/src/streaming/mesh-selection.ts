import type { GeometryEntry } from '@endfield-noclip/package-format/geometry';
import type { Chain } from '@endfield-noclip/package-format/instances';

import { CULL_FLOATS, ROW_WORDS } from '../content/instance-rows.ts';
import { type MaterialLook, alphaTextureOf } from '../looks/look.ts';
import type { ParticleField, ParticleView } from '../particles/particle-rows.ts';
import { SHADOW_LAYERS, type ShadowLayerVolumes } from '../render/shadows/shadow-map.ts';
import type { TextureStore } from '../render/textures/texture-store.ts';
import type { Plane, Vec3 } from '../scene/camera.ts';

import { firstRunAt, firstShadowLayer, sphereInPlanes } from './instance-culling.ts';
import {
	BUCKET_LIFETIME,
	type ChainSlot,
	type MeshBucket,
	MeshBuckets,
	bucketIndex,
	slotHidden,
} from './mesh-buckets.ts';
import type { CasterVolume, InstanceRange } from './selection.ts';
import type { StreamManager } from './stream-manager.ts';
import { TextureRequests } from './texture-requests.ts';

/** this frame's mesh selection, reused across frames */
export interface MeshSelection {
	buckets: MeshBucket[];
	/** rows drawn as boxes (geometry pending or not converted) */
	boxes: number[];
	/** whether it draws emitters' particles, which move with the clock while the view holds still */
	particles: boolean;
}

/** camera inputs */
export interface MeshView {
	eye: Vec3;
	planes: readonly Plane[];
	pixelFactor: number;
	viewportHeight: number;
	/** cull instances smaller than this, px */
	minPixels: number;
	/** mip levels coarser than needed to stream material textures at (0 for full detail; each halves their size) */
	textureBias: number;
	/** select draws of materials in the unsupported look; off skips them as if their chains lacked them */
	unsupportedMaterials: boolean;
	/** select `DrawRole.Unsupported` stand-ins; off skips them likewise */
	missingContent: boolean;
	/** instances outside the view but in this volume are selected as shadow casters; `null` for none */
	casters: CasterVolume | null;
	/** the shadow layers instances are grouped by; `null` without shadows */
	shadowLayers: ShadowLayerVolumes | null;
	/** the clock and camera axes particles are placed by */
	particles: ParticleView;
}

/** what the selector reads */
export interface MeshSelectorInit {
	/** LOD-chain templates */
	chains: readonly Chain[];
	/** the geometry table */
	geometries: readonly GeometryEntry[];
	/** by material id, from `materialLooks` */
	looks: readonly MaterialLook[];
	stream: StreamManager;
	textures: TextureStore;
	/** writes the rows of emitters' particles */
	particles: ParticleField;
}

/** priority multiplier for shadow casters outside the view */
const CASTER_PRIORITY = 0.1;
/** shadow casters outside the view smaller than this are culled, px (as if on screen) */
const CASTER_MIN_PIXELS = 16;

/** selects LODs and buckets instances */
export class MeshSelector {
	readonly selection: MeshSelection = { buckets: [], boxes: [], particles: false };
	#chains: readonly Chain[];
	#geometries: readonly GeometryEntry[];
	#stream: StreamManager;
	#textures: TextureRequests;
	#particles: ParticleField;
	#buckets: MeshBuckets;
	#frame = 0;
	/** per geometry: the frame {@link #geometryReady} last looked it up */
	#checkedFrame: Int32Array;
	/** per geometry: whether it was resident that frame */
	#ready: Uint8Array;
	/** per geometry: the highest priority it was wanted with that frame */
	#wanted: Float64Array;
	#planes = new Float64Array(4 * 5);
	#casterPlanes = new Float64Array(4 * 5);
	#pending: ChainSlot[] = [];

	/** @param init tables and residency */
	constructor(init: MeshSelectorInit) {
		this.#chains = init.chains;
		this.#geometries = init.geometries;
		this.#stream = init.stream;
		this.#textures = new TextureRequests(init.stream, init.textures);
		this.#particles = init.particles;
		this.#buckets = new MeshBuckets(init);
		const count = init.geometries.length;
		this.#checkedFrame = new Int32Array(count).fill(-1);
		this.#ready = new Uint8Array(count);
		this.#wanted = new Float64Array(count);
	}

	/**
	 * @param ranges the instance ranges the tree traversal selected
	 * @param view camera inputs
	 * @returns buckets and box fallbacks (the same object every frame)
	 */
	run(ranges: readonly InstanceRange[], view: MeshView): MeshSelection {
		const frame = ++this.#frame;
		const selection = this.selection;
		const buckets = selection.buckets;
		const boxes = selection.boxes;
		buckets.length = 0;
		boxes.length = 0;
		selection.particles = false;
		const { eye, pixelFactor, viewportHeight, minPixels, casters, shadowLayers } = view;
		const planes = this.#planes;
		const planeFloats = Math.min(view.planes.length * 4, planes.length);
		for (let p = 0; p < planeFloats; p++) {
			planes[p] = view.planes[p >> 2][p & 3];
		}
		const casterPlanes = this.#casterPlanes;
		let casterFloats = 0;
		let casterDistance = 0;
		if (casters !== null) {
			casterFloats = Math.min(casters.planes.length * 4, casterPlanes.length);
			for (let p = 0; p < casterFloats; p++) {
				casterPlanes[p] = casters.planes[p >> 2][p & 3];
			}
			casterDistance = casters.distance;
		}
		const pending = this.#pending;

		for (const { item, first, count } of ranges) {
			const instances = item.resident;
			if (instances?.kind !== 'instances') {
				continue;
			}
			const f32 = instances.rowsF32;
			const cull = instances.cull;
			const ox = instances.origin[0] - eye[0];
			const oy = instances.origin[1] - eye[1];
			const oz = instances.origin[2] - eye[2];
			const runs = instances.runs;
			const end = first + count;
			for (let r = firstRunAt(runs, first); r < runs.length; r += 3) {
				const runFirst = runs[r + 1];
				const runEnd = runFirst + runs[r + 2];
				if (runFirst >= end) {
					break;
				}
				if (runEnd <= first) {
					continue;
				}
				const slots = this.#buckets.slots(runs[r]);
				const box = this.#buckets.drawsBox(runs[r]);
				// effect distance bands measure from the effect's origin, in the instance's frame
				const origin = this.#chains[runs[r]].distanceOrigin;
				const last = Math.min(end, runEnd);
				for (let i = Math.max(first, runFirst); i < last; i++) {
					const at = i * ROW_WORDS;
					const x = ox + f32[at + 12];
					const y = oy + f32[at + 13];
					const z = oz + f32[at + 14];
					const radius = cull[i * CULL_FLOATS];
					const distance = Math.max(Math.sqrt(x * x + y * y + z * z), 0.1);
					if ((radius * pixelFactor) / distance < minPixels) {
						continue;
					}
					let castOnly = false;
					if (!sphereInPlanes(planes, planeFloats, x, y, z, radius)) {
						if (
							casterFloats === 0 ||
							(radius * pixelFactor) / distance < CASTER_MIN_PIXELS ||
							distance - radius > casterDistance ||
							!sphereInPlanes(casterPlanes, casterFloats, x, y, z, radius)
						) {
							continue;
						}
						castOnly = true;
					}
					// Unity's LODGroup metric: the object's size relative to the screen height
					const relative = (2 * cull[i * CULL_FLOATS + 1] * pixelFactor) / (distance * viewportHeight);
					let squared = relative * relative;
					if (origin !== null) {
						// rows hold the transform's top three rows, row-major, translation relative to the block
						const [px, py, pz] = origin;
						const dx = ox + f32[at] * px + f32[at + 1] * py + f32[at + 2] * pz + f32[at + 3];
						const dy = oy + f32[at + 4] * px + f32[at + 5] * py + f32[at + 6] * pz + f32[at + 7];
						const dz = oz + f32[at + 8] * px + f32[at + 9] * py + f32[at + 10] * pz + f32[at + 11];
						squared = dx * dx + dy * dy + dz * dz;
					}
					const priority = relative * viewportHeight * (castOnly ? CASTER_PRIORITY : 1);

					let pendingCount = 0;
					let ready = true;
					let lod = -1;
					for (let s = 0; s < slots.length; s++) {
						const slot = slots[s];
						if (slotHidden(slot, view) || !(squared > slot.minSquared && squared <= slot.maxSquared)) {
							continue;
						}
						lod = slot.lod;
						if (castOnly && !slot.castsShadows) {
							continue;
						}
						if (this.#geometryReady(slot.geometry, priority, frame)) {
							pending[pendingCount++] = slot;
						} else {
							ready = false;
						}
					}
					if (lod < 0) {
						continue;
					}
					const row = instances.alloc.start + i;
					if (!ready) {
						pendingCount = this.#residentLod(slots, lod, { castOnly, view });
						if (pendingCount === 0) {
							if (box && !castOnly) {
								boxes.push(row);
							}
							continue;
						}
					}
					const group =
						shadowLayers === null ? SHADOW_LAYERS : firstShadowLayer(shadowLayers, x, y, z, radius);
					// the sign of the transform's determinant (its rows are the matrix rows)
					const mirrored =
						f32[at] * (f32[at + 5] * f32[at + 10] - f32[at + 6] * f32[at + 9]) -
							f32[at + 1] * (f32[at + 4] * f32[at + 10] - f32[at + 6] * f32[at + 8]) +
							f32[at + 2] * (f32[at + 4] * f32[at + 9] - f32[at + 5] * f32[at + 8]) <
						0
							? 1
							: 0;
					for (let p = 0; p < pendingCount; p++) {
						const slot = pending[p];
						const cast = castOnly || slot.shadowOnly;
						const bucket =
							slot.buckets[bucketIndex(mirrored, cast)] ?? this.#buckets.bucketOf(slot, mirrored, cast);
						if (bucket.frame !== frame) {
							bucket.frame = frame;
							for (const rows of bucket.rows) {
								rows.length = 0;
							}
							bucket.pixels = 0;
							bucket.nearest = Infinity;
							buckets.push(bucket);
						}
						if (slot.particles === null) {
							bucket.rows[group].push(row);
						} else {
							const particles = this.#particles.rows(instances, i, slot.particles, frame, view.particles);
							selection.particles = true;
							for (const particle of particles) {
								bucket.rows[group].push(particle);
							}
						}
						if (priority > bucket.pixels) {
							bucket.pixels = priority;
						}
						if (distance - radius < bucket.nearest) {
							bucket.nearest = distance - radius;
						}
					}
				}
			}
		}

		const texturePixels = 2 ** -view.textureBias;
		for (const bucket of buckets) {
			const look = bucket.look;
			if (bucket.castOnly) {
				// a shadow needs only the texture holding the alpha it's cut out by
				const alpha = look.queue === 'cutout' ? alphaTextureOf(look) : -1;
				if (alpha >= 0) {
					this.#textures.forPixels(
						alpha,
						bucket.pixels * texturePixels,
						look.uvScales[look.textures.indexOf(alpha)],
					);
				}
				continue;
			}
			for (let i = 0; i < look.textures.length; i++) {
				if (look.textures[i] >= 0) {
					this.#textures.forPixels(look.textures[i], bucket.pixels * texturePixels, look.uvScales[i]);
				}
			}
			if (look.volumeTexture >= 0) {
				this.#textures.whole(look.volumeTexture, '3d', bucket.pixels);
			}
		}
		if (frame % BUCKET_LIFETIME === 0) {
			this.#buckets.prune(frame);
		}
		return selection;
	}

	/**
	 * wants a geometry at `priority` and reports whether it's resident. residency can't change before the
	 * stream update, so each geometry is asked about at most once per frame and priority increase.
	 */
	#geometryReady(geometry: number, priority: number, frame: number): boolean {
		if (this.#checkedFrame[geometry] !== frame) {
			this.#checkedFrame[geometry] = frame;
			this.#wanted[geometry] = -Infinity;
			this.#ready[geometry] = 0;
		}
		if (priority > this.#wanted[geometry]) {
			this.#wanted[geometry] = priority;
			const entry = this.#geometries[geometry];
			this.#ready[geometry] =
				entry?.status === 'ready' && this.#stream.want(entry.blob, priority) !== null ? 1 : 0;
		}
		return this.#ready[geometry] === 1;
	}

	/**
	 * finds a stand-in for an instance whose wanted LOD is still streaming: the nearest LOD whose geometry is
	 * all resident, coarser first on ties because far LODs are smaller and more often loaded. usually that's
	 * the LOD drawn before the switch, so the instance keeps its shape instead of dropping to its box.
	 * stand-ins are kept in use but not requested, so they don't add to the streaming queue.
	 *
	 * @param filter `castOnly` when only the shadow-casting slots are wanted, and the `view` whose options hide
	 *   slots
	 * @returns how many of the stand-in's slots were written to `#pending` (0 when no LOD is resident)
	 */
	#residentLod(
		slots: readonly ChainSlot[],
		wanted: number,
		{ castOnly, view }: { castOnly: boolean; view: MeshView },
	): number {
		let maxLod = 0;
		for (const slot of slots) {
			maxLod = Math.max(maxLod, slot.lod);
		}
		const pending = this.#pending;
		for (let step = 1; step <= Math.max(wanted, maxLod - wanted); step++) {
			for (let side = 0; side < 2; side++) {
				const lod = side === 0 ? wanted + step : wanted - step;
				if (lod < 0 || lod > maxLod) {
					continue;
				}
				let count = 0;
				let resident = true;
				for (const slot of slots) {
					if (slot.lod !== lod || (castOnly && !slot.castsShadows) || slotHidden(slot, view)) {
						continue;
					}
					if (!this.#geometryResident(slot.geometry)) {
						resident = false;
						break;
					}
					pending[count++] = slot;
				}
				if (resident && count > 0) {
					for (let p = 0; p < count; p++) {
						this.#keepGeometry(pending[p].geometry);
					}
					return count;
				}
			}
		}
		return 0;
	}

	/** whether a geometry is resident, without requesting it or marking it used */
	#geometryResident(geometry: number): boolean {
		const entry = this.#geometries[geometry];
		return entry?.status === 'ready' && this.#stream.isReady(entry.blob);
	}

	/** marks a resident geometry used this frame, so it isn't evicted */
	#keepGeometry(geometry: number): void {
		const entry = this.#geometries[geometry];
		if (entry?.status === 'ready') {
			this.#stream.markUsed(entry.blob);
		}
	}
}
