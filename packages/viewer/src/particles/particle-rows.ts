import {
	ParticleAlignment,
	ParticleRenderMode,
	type ParticleSystemInfo,
	type ParticlesTable,
} from '@endfield-noclip/package-format/particles';

import {
	ROW_WORDS,
	RowBillboard,
	RowKind,
	RowWord,
	packRowColor,
	packRowCustom,
	rowSheet,
} from '../content/instance-rows.ts';
import type { RangeAllocation } from '../gfx/range-allocator.ts';
import type { Vec3 } from '../scene/camera.ts';
import type { ResidentInstances } from '../streaming/stream-manager.ts';

import { hash2, hashText } from './random.ts';
import { MAX_PARTICLES, PARTICLE_FLOATS, ParticleFloat, ParticleSimulation } from './simulation.ts';
import { normalize, rotate, times3Columns, turnFromZ, velocityBasis } from './vector-math.ts';

/** the camera inputs particle rows depend on */
export interface ParticleView {
	/** seconds of the viewer's clock */
	time: number;
	/** the camera's position (Unity world, f64), which stretched particles turn their width by */
	eye: Vec3;
	/** the viewport's width per metre of view depth, which quads' on-screen size limits are fractions of */
	widthPerDepth: number;
	/** the camera's right, up and forward axes (Unity frame), which view-aligned particles turn with */
	right: Vec3;
	up: Vec3;
	forward: Vec3;
}

/**
 * turns a vector in a row's frame as `row_basis` (frame.wgsl) turns the row's axes for its billboard kind
 *
 * @param billboard the row's billboard kind
 * @param view the camera's axes
 * @param v the vector in the row's frame
 * @returns it in the world's
 */
export const turnedByBillboard = (
	billboard: RowBillboard,
	view: ParticleView,
	v: readonly number[],
): Vec3 => {
	let basis: readonly Vec3[];
	switch (billboard) {
		case RowBillboard.Facing: {
			basis = [view.right, view.up, view.forward];
			break;
		}
		case RowBillboard.Upright: {
			// level and defined even looking straight down; Unity's forward is right × up
			const right = normalize([view.right[0], 0, view.right[2]]);
			basis = [right, [0, 1, 0], [-right[2], 0, right[0]]];
			break;
		}
		default: {
			return [v[0], v[1], v[2]];
		}
	}
	const row = (r: number) => basis[0][r] * v[0] + basis[1][r] * v[1] + basis[2][r] * v[2];
	return [row(0), row(1), row(2)];
};

/**
 * holds a quad's larger side between its on-screen limits, as the engine does before building quads
 *
 * @param sizes the quad's sizes along its x, y and z, m
 * @param limits the smallest and largest it may be, as fractions of the viewport's width at its depth
 * @param view the camera
 * @param at the particle's world position
 * @returns the sizes scaled together to fit. behind the camera (or on its plane) they're zero when the
 *   minimum is above 0 and unchanged when it's 0
 */
export const screenLimited = (
	sizes: readonly number[],
	limits: { min: number; max: number },
	view: ParticleView,
	at: Vec3,
): number[] => {
	const f = view.forward;
	const depth = (at[0] - view.eye[0]) * f[0] + (at[1] - view.eye[1]) * f[1] + (at[2] - view.eye[2]) * f[2];
	const half = 0.5 * Math.max(sizes[0], sizes[1], 1e-6);
	// the game's tests, signs included: behind the camera the minimum's bound turns negative, which hides the
	// quad only when the minimum is above 0, and the maximum's negative bound is ignored, so with no minimum the
	// quad keeps its whole size there
	const width = view.widthPerDepth * depth;
	const low = limits.min * width;
	const high = limits.max * width;
	let held = low >= 0 ? Math.max(half, 0.5 * low) : 0;
	if (high >= 0) {
		held = Math.min(held, 0.5 * high);
	}
	const ratio = held / half;
	return [sizes[0] * ratio, sizes[1] * ratio, sizes[2]];
};

/** one emitter's particles: its rows in the instance buffer and its clock */
interface Emitter {
	simulation: ParticleSimulation;
	rows: RangeAllocation;
	/** the viewer time the emitter was first drawn, which non-looping systems start from */
	start: number;
	/** the frame its rows were last written */
	frame: number;
	/** global indices of the rows holding live particles */
	live: number[];
}

/** what {@link ParticleField} needs of the instance buffer */
export interface ParticleRowStore {
	allocateRows(count: number): RangeAllocation | null;
	freeRows(alloc: RangeAllocation): void;
	writeRows(start: number, rows: Uint32Array<ArrayBuffer>, count: number): void;
}

/**
 * the particles of every drawn emitter, as instance rows. an emitter is an instance row whose draw names a
 * particle system: its transform is the system's frame, and its particles' rows use its block's origin
 */
export class ParticleField {
	readonly #systems: readonly ParticleSystemInfo[];
	/** each system's seed salt, the same for entries differing only in their mesh */
	readonly #salts: number[];
	readonly #store: ParticleRowStore;
	readonly #emitters = new Map<ResidentInstances, Map<number, Emitter>>();
	readonly #scratch = new Float32Array(MAX_PARTICLES * PARTICLE_FLOATS);
	readonly #rows = new Uint32Array(MAX_PARTICLES * ROW_WORDS);
	readonly #rowsF32 = new Float32Array(this.#rows.buffer);

	/**
	 * @param table the package's particle systems
	 * @param store the instance buffer the rows go to
	 */
	constructor(table: ParticlesTable, store: ParticleRowStore) {
		this.#systems = table.systems;
		this.#salts = table.systems.map((system) => hashText(JSON.stringify({ ...system, mesh: 0 })));
		this.#store = store;
	}

	/**
	 * writes an emitter's live particles for this frame, once per frame however many draws ask.
	 *
	 * @param instances the emitter's block
	 * @param row the emitter's row in the block
	 * @param system the particles-table entry its draw names
	 * @param frame the frame number
	 * @param view the clock and camera
	 * @returns the global row indices of its live particles (valid until the next frame)
	 */
	rows(
		instances: ResidentInstances,
		row: number,
		system: number,
		frame: number,
		view: ParticleView,
	): readonly number[] {
		const emitters = this.#emitters.getOrInsertComputed(instances, () => new Map());
		// one emitter per row and system: a renderer's meshes are separate rows
		const key = row * this.#systems.length + system;
		let emitter = emitters.get(key);
		if (emitter === undefined) {
			const info = this.#systems[system];
			if (info === undefined) {
				return [];
			}
			const f32 = instances.rowsF32;
			const at = row * ROW_WORDS;
			// emitters of one renderer's meshes share their place, so they share their particles' random values
			const seed = hash2(
				hash2(this.#salts[system], hashText(`${f32[at + 3]},${f32[at + 7]},${f32[at + 11]}`)),
				0,
			);
			const simulation = new ParticleSimulation(info, seed);
			const rows = this.#store.allocateRows(Math.max(Math.min(simulation.liveBound, MAX_PARTICLES), 1));
			if (rows === null) {
				return [];
			}
			emitter = {
				simulation,
				rows,
				start: view.time,
				frame: -1,
				live: [],
			};
			emitters.set(key, emitter);
		}
		if (emitter.frame !== frame) {
			emitter.frame = frame;
			this.#write(instances, row, emitter, view);
		}
		return emitter.live;
	}

	/** forgets a released block's emitters and frees their rows */
	release(instances: ResidentInstances): void {
		const emitters = this.#emitters.get(instances);
		if (emitters === undefined) {
			return;
		}
		for (const emitter of emitters.values()) {
			this.#store.freeRows(emitter.rows);
		}
		this.#emitters.delete(instances);
	}

	#write(instances: ResidentInstances, row: number, emitter: Emitter, view: ParticleView): void {
		const simulation = emitter.simulation;
		const info = simulation.info;
		const f32 = instances.rowsF32;
		const at = row * ROW_WORDS;
		// the emitter's rows3x4 matrix, translation relative to the block origin
		const m = f32.subarray(at, at + 12);
		const columns: Vec3[] = [
			[m[0], m[4], m[8]],
			[m[1], m[5], m[9]],
			[m[2], m[6], m[10]],
		];
		const scales = columns.map((column) => Math.hypot(column[0], column[1], column[2]));
		// the inverse of a rotation times a scale: project onto each column, divided by its squared length
		const along = (i: number, d: Vec3): number =>
			(columns[i][0] * d[0] + columns[i][1] * d[1] + columns[i][2] * d[2]) /
			Math.max(scales[i] * scales[i], 1e-12);
		const local = (direction: Vec3): Vec3 => [along(0, direction), along(1, direction), along(2, direction)];
		const elapsed = (view.time - emitter.start) * info.simulationSpeed;
		const time = info.looping ? elapsed + simulation.settleTime : elapsed;
		const scratch = this.#scratch;
		const count = simulation.evaluate(
			time,
			local([0, -1, 0]),
			local,
			scratch.subarray(0, Math.min(emitter.rows.count, MAX_PARTICLES) * PARTICLE_FLOATS),
		);
		const out = this.#rowsF32;
		const words = this.#rows;
		const block = instances.blockSlot;
		const sheet = info.textureSheet;
		// the transform's scale always moves the particles, and sizes them unless the system says otherwise
		const sizing = info.sizedByScale ? scales : [1, 1, 1];
		const toWorld = (v: ArrayLike<number>): Vec3 => [
			m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
			m[4] * v[0] + m[5] * v[1] + m[6] * v[2],
			m[8] * v[0] + m[9] * v[1] + m[10] * v[2],
		];
		// the frame quads turn in, by render mode: the camera's or its heading's (which `row_basis` turns them in
		// on the GPU, as billboard chains are), or lying flat facing up. billboards take their render alignment:
		// the camera's (View), the world's axes or the emitter's
		let frame: Vec3[] | null = null;
		let billboard: RowBillboard = RowBillboard.None;
		switch (info.renderMode) {
			case ParticleRenderMode.Billboard: {
				switch (info.alignment) {
					case ParticleAlignment.View: {
						billboard = RowBillboard.Facing;
						break;
					}
					case ParticleAlignment.World: {
						break;
					}
					case ParticleAlignment.Local:
					case ParticleAlignment.Velocity: {
						frame = columns.map(normalize);
						break;
					}
				}
				break;
			}
			case ParticleRenderMode.Vertical: {
				billboard = RowBillboard.Upright;
				break;
			}
			case ParticleRenderMode.Mesh: {
				if (info.alignment === ParticleAlignment.View) {
					billboard = RowBillboard.Facing;
				}
				break;
			}
			case ParticleRenderMode.Horizontal: {
				frame = [
					[1, 0, 0],
					[0, 0, 1],
					[0, -1, 0],
				];
				break;
			}
		}
		emitter.live.length = 0;
		for (let i = 0; i < count; i++) {
			const base = i * PARTICLE_FLOATS;
			const p = scratch.subarray(base + ParticleFloat.position, base + ParticleFloat.position + 3);
			const q = scratch.subarray(base + ParticleFloat.rotation, base + ParticleFloat.rotation + 4);
			const s = scratch.subarray(base + ParticleFloat.size, base + ParticleFloat.size + 3);
			const offset = toWorld(p);
			const center: Vec3 = [offset[0] + m[3], offset[1] + m[7], offset[2] + m[11]];
			// the rotation's axes, then the frame they turn in: the emitter's (local, or turned onto the velocity),
			// the world's, or the camera's
			let axes: Vec3[] = [rotate(q, [1, 0, 0]), rotate(q, [0, 1, 0]), rotate(q, [0, 0, 1])];
			if (info.alignment === ParticleAlignment.Velocity && info.renderMode !== ParticleRenderMode.Mesh) {
				const onto = turnFromZ(
					scratch.subarray(base + ParticleFloat.velocity, base + ParticleFloat.velocity + 3),
				);
				axes = axes.map((axis) => rotate(onto, axis));
			}
			let sizes = [s[0] * sizing[0], s[1] * sizing[1], s[2] * sizing[2]];
			// a stretched quad's length comes from its size before the on-screen limits
			const lengthSize = sizes[1];
			if (info.screenSize !== null) {
				sizes = screenLimited(sizes, info.screenSize, view, [
					instances.origin[0] + center[0],
					instances.origin[1] + center[1],
					instances.origin[2] + center[2],
				]);
			}
			const turn = (basis: readonly Vec3[]) => {
				axes = axes.map((axis) => [
					basis[0][0] * axis[0] + basis[1][0] * axis[1] + basis[2][0] * axis[2],
					basis[0][1] * axis[0] + basis[1][1] * axis[1] + basis[2][1] * axis[2],
					basis[0][2] * axis[0] + basis[1][2] * axis[1] + basis[2][2] * axis[2],
				]);
			};
			if (info.renderMode === ParticleRenderMode.Stretched) {
				// a streak from the particle back along its velocity, lengthened by the length scale and the speed.
				// its width runs across the velocity as seen from the camera's position, flattened onto the view
				// plane, so turning the camera in place leaves it be
				const velocity = toWorld(
					scratch.subarray(base + ParticleFloat.velocity, base + ParticleFloat.velocity + 3),
				);
				const speed = Math.hypot(...velocity);
				// a still particle has no streak, and the game draws nothing for it
				const streak: Vec3 =
					speed > 1e-15 ? [velocity[0] / speed, velocity[1] / speed, velocity[2] / speed] : view.up;
				const f = view.forward;
				const sight: Vec3 = [
					instances.origin[0] + center[0] - view.eye[0],
					instances.origin[1] + center[1] - view.eye[1],
					instances.origin[2] + center[2] - view.eye[2],
				];
				const across: Vec3 = [
					streak[1] * sight[2] - streak[2] * sight[1],
					streak[2] * sight[0] - streak[0] * sight[2],
					streak[0] * sight[1] - streak[1] * sight[0],
				];
				const ahead = across[0] * f[0] + across[1] * f[1] + across[2] * f[2];
				const flat: Vec3 = [across[0] - f[0] * ahead, across[1] - f[1] * ahead, across[2] - f[2] * ahead];
				// one moving along the line of sight has no width, so the game draws nothing for it either
				const flatLength = Math.hypot(...flat);
				const right: Vec3 = flatLength > 1e-15 ? normalize(flat) : view.right;
				// the face's own normal, which the effect shaders' Fresnel fades by, turned so the quad's -z normal
				// faces the camera
				let face = normalize([
					right[1] * streak[2] - right[2] * streak[1],
					right[2] * streak[0] - right[0] * streak[2],
					right[0] * streak[1] - right[1] * streak[0],
				]);
				if (face[0] * sight[0] + face[1] * sight[1] + face[2] * sight[2] < 0) {
					face = [-face[0], -face[1], -face[2]];
				}
				axes = [right, streak, face];
				const stretch = info.stretch ?? { lengthScale: 1, velocityScale: 0 };
				const drawn = speed > 1e-15 && flatLength > 1e-15;
				const length = drawn ? lengthSize * stretch.lengthScale + speed * stretch.velocityScale : 0;
				sizes = drawn ? [sizes[0], length, sizes[2]] : [0, 0, 0];
				// the unit quad is centred, and the particle sits at the streak's head. the game's pivot moves the
				// head along the velocity by its y times the size before the limits, and the whole streak across by
				// its x times half the width
				for (let r = 0; r < 3; r++) {
					center[r] +=
						streak[r] * (info.pivot[1] * lengthSize - length * 0.5) +
						right[r] * info.pivot[0] * sizes[0] * 0.5;
				}
			} else if (info.renderMode !== ParticleRenderMode.Mesh) {
				if (frame !== null) {
					turn(frame);
				}
			} else {
				switch (info.alignment) {
					case ParticleAlignment.Local: {
						axes = axes.map(toWorld);
						sizes = info.sizedByScale
							? [s[0], s[1], s[2]]
							: [s[0] / scales[0], s[1] / scales[1], s[2] / scales[2]];
						break;
					}
					case ParticleAlignment.Velocity: {
						// the game's look rotation along the world velocity, rolled level by the world's up, with the
						// emitter's scale applied along its axes
						const basis = velocityBasis(
							toWorld(scratch.subarray(base + ParticleFloat.velocity, base + ParticleFloat.velocity + 3)),
						);
						axes = axes.map((axis) =>
							times3Columns(basis, [axis[0] * sizing[0], axis[1] * sizing[1], axis[2] * sizing[2]]),
						);
						sizes = [s[0], s[1], s[2]];
						break;
					}
					case ParticleAlignment.View: {
						// the GPU turns it with the camera
						break;
					}
					case ParticleAlignment.World: {
						break;
					}
				}
			}
			if (info.renderMode !== ParticleRenderMode.Stretched && info.pivot.some((value) => value !== 0)) {
				// the pivot moves the mesh in its turned and sized frame, the one it's drawn in: for camera-facing
				// rows that frame is turned on the GPU, so turn the offset with it here
				const inFrame = [0, 1, 2].map((r) =>
					axes.reduce((sum, axis, k) => sum + axis[r] * sizes[k] * info.pivot[k], 0),
				);
				const shift = turnedByBillboard(billboard, view, inFrame);
				for (let r = 0; r < 3; r++) {
					center[r] += shift[r];
				}
			}
			const o = i * ROW_WORDS;
			for (let r = 0; r < 3; r++) {
				out[o + r * 4] = axes[0][r] * sizes[0];
				out[o + r * 4 + 1] = axes[1][r] * sizes[1];
				out[o + r * 4 + 2] = axes[2][r] * sizes[2];
				out[o + r * 4 + 3] = center[r];
			}
			const extent = Math.max(...axes.map((axis, k) => Math.hypot(...axis) * sizes[k]));
			out.set(center, o + 12);
			words[o + RowWord.block] = block;
			out.fill(extent, o + RowWord.extent, o + RowWord.extent + 3);
			words[o + RowWord.info] = (RowKind.Detail | (billboard << 30)) >>> 0;
			words[o + RowWord.sheet] =
				sheet === null ? 0 : rowSheet(sheet.tiles, scratch[base + ParticleFloat.tile], sheet.uvChannels);
			words[o + RowWord.color] = packRowColor(
				scratch.subarray(base + ParticleFloat.color, base + ParticleFloat.color + 4),
			);
			const [xy, zw] = packRowCustom(
				scratch.subarray(base + ParticleFloat.custom, base + ParticleFloat.custom + 4),
			);
			words[o + RowWord.custom] = xy;
			words[o + RowWord.custom + 1] = zw;
			emitter.live.push(emitter.rows.start + i);
		}
		if (count > 0) {
			this.#store.writeRows(emitter.rows.start, words, count);
		}
	}
}
