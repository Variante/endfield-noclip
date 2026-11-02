/**
 * the current fill of each gameplay water volume, moving towards a picked level at that level's speed as the
 * game's scripts move it, and the instance rows of the interactives floating on each volume, kept at the same
 * height above its surface as packed (see docs/viewer/water.md "water volumes").
 *
 * @module
 */

import type { WaterVolumeEntry } from '@endfield-noclip/package-format/water';

import type { ResidentInstances } from '../streaming/stream-manager.ts';

import { ROW_WORDS } from './instance-rows.ts';

/** a floating row of a resident block */
interface FloatingRow {
	resident: ResidentInstances;
	row: number;
	volume: number;
	/** the row's packed translation y and bounds centre y, relative to its block origin */
	ty: number;
	cy: number;
	/** the offset last written */
	applied: number;
}

/** what a volume shows: its fill now and the fill it's moving to */
export interface WaterVolumeState {
	entry: WaterVolumeEntry;
	/** 0–1 of `heightMax` */
	current: number;
	target: number;
}

/** water volume fills and the rows floating on them */
export class WaterLevels {
	#volumes: WaterVolumeEntry[] = [];
	#current = new Float64Array(0);
	#target = new Float64Array(0);
	/** metres per second towards {@link #target} */
	#speed = new Float64Array(0);
	/** metres above the packed surface, per volume, for the water renderer */
	#offsets = new Float32Array(0);
	/** by instance-block blob, its floating rows and their volumes */
	#floaters = new Map<number, { row: number; volume: number }[]>();
	#rows = new Map<ResidentInstances, FloatingRow[]>();

	/** @param volumes the package's water volumes, all at their authored fill */
	setVolumes(volumes: readonly WaterVolumeEntry[]): void {
		this.#volumes = [...volumes];
		this.#current = Float64Array.from(volumes, (volume) => volume.initial);
		this.#target = Float64Array.from(this.#current);
		this.#speed = Float64Array.from(volumes, (volume) => volume.fillSpeed);
		this.#offsets = new Float32Array(volumes.length);
		this.#floaters.clear();
		for (const [i, volume] of volumes.entries()) {
			for (const { blob, row } of volume.floaters) {
				this.#floaters.getOrInsertComputed(blob, () => []).push({ row, volume: i });
			}
		}
		this.#rows.clear();
	}

	/** @returns every volume's fill and target */
	get states(): WaterVolumeState[] {
		return this.#volumes.map((entry, i) => ({ entry, current: this.#current[i], target: this.#target[i] }));
	}

	/** @returns per volume, metres its surface sits above where it was packed */
	get offsets(): Float32Array {
		return this.#offsets;
	}

	/**
	 * starts moving a volume towards one of its levels, at that level's speed
	 *
	 * @param index the volume
	 * @param fraction the level's fill
	 * @param instant whether to jump there
	 */
	setTarget(index: number, fraction: number, instant: boolean): void {
		const volume = this.#volumes[index];
		if (volume === undefined) {
			return;
		}
		const level = volume.levels.find((entry) => entry.fraction === fraction);
		this.#target[index] = fraction;
		this.#speed[index] = level?.speed ?? volume.fillSpeed;
		if (instant) {
			this.#current[index] = fraction;
		}
	}

	/** puts every volume back at its authored fill */
	reset(): void {
		for (const [i, volume] of this.#volumes.entries()) {
			this.#current[i] = volume.initial;
			this.#target[i] = volume.initial;
		}
	}

	/**
	 * moves the volumes by a frame, linearly at their speed (the game eases the last metres in)
	 *
	 * @param dt seconds
	 * @param rate how many times faster than the game to move
	 * @returns whether any surface moved
	 */
	update(dt: number, rate: number): boolean {
		let moved = false;
		const offsets = this.#offsets;
		for (const [i, volume] of this.#volumes.entries()) {
			const current = this.#current[i];
			const target = this.#target[i];
			if (current !== target) {
				const step = volume.heightMax > 0 ? (this.#speed[i] * dt * rate) / volume.heightMax : 1;
				this.#current[i] =
					target > current ? Math.min(target, current + step) : Math.max(target, current - step);
			}
			const offset = (this.#current[i] - volume.initial) * volume.heightMax;
			if (offset !== offsets[i]) {
				offsets[i] = offset;
				moved = true;
			}
		}
		return moved;
	}

	/**
	 * remembers a block's floating rows, if any
	 *
	 * @param resident a block just uploaded
	 * @param blob its blob-table index
	 */
	track(resident: ResidentInstances, blob: number): void {
		const floaters = this.#floaters.get(blob);
		if (floaters === undefined) {
			return;
		}
		const f32 = resident.rowsF32;
		this.#rows.set(
			resident,
			floaters.map(({ row, volume }) => {
				const at = row * ROW_WORDS;
				return { resident, row, volume, ty: f32[at + 7], cy: f32[at + 13], applied: 0 };
			}),
		);
	}

	/** @param resident a block being released */
	untrack(resident: ResidentInstances): void {
		this.#rows.delete(resident);
	}

	/**
	 * moves floating rows to their volume's surface, in the CPU copy the selection culls with and on the GPU
	 *
	 * @param write uploads one row of a resident block
	 */
	applyFloaters(write: (resident: ResidentInstances, row: number) => void): void {
		const offsets = this.#offsets;
		for (const rows of this.#rows.values()) {
			for (const floating of rows) {
				const offset = offsets[floating.volume];
				if (offset === floating.applied) {
					continue;
				}
				const at = floating.row * ROW_WORDS;
				const f32 = floating.resident.rowsF32;
				f32[at + 7] = floating.ty + offset;
				f32[at + 13] = floating.cy + offset;
				floating.applied = offset;
				write(floating.resident, floating.row);
			}
		}
	}
}
