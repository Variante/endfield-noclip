/**
 * bounds over groups of consecutive instance rows, so the mesh selection can reject a whole group before
 * testing its rows one by one. a block's rows are mostly in placement order, which keeps neighbours near one
 * another (on map02 a group of 32 has a median radius of 20 m), and dense views walk over 100k rows a frame,
 * most of them too small, too far for any LOD or out of view.
 *
 * @module
 */

import { CULL_FLOATS, ROW_WORDS } from '../content/instance-rows.ts';

/** rows per group; groups don't follow chain runs, so a group can hold rows of several chains */
export const GROUP_ROWS = 32;

/** f32 per group, laid out as {@link GroupFloat} names them */
export const GROUP_FLOATS = 8;

/** offsets into a group's floats */
export const GroupFloat = {
	/** the centre of the rows' bounds centres, relative to the block origin (3 floats) */
	center: 0,
	/** the farthest row centre from {@link center} */
	centersRadius: 3,
	/** the sphere around every row's bounding sphere */
	radius: 4,
	/** the largest row bounding-sphere radius */
	rowRadius: 5,
	/**
	 * the largest LOD reach of a row: beyond `reach · pixelFactor / viewportHeight` metres no LOD of it draws
	 * (`Infinity` when one always does)
	 */
	reach: 6,
} as const;

/** what {@link buildRowGroups} reads of a block */
export interface GroupedRows {
	/** the rows, {@link ROW_WORDS} each, as {@link InstanceRows.rows} lays them out */
	rowsF32: Float32Array;
	/** {@link CULL_FLOATS} per row */
	cull: Float32Array;
	/** (chain, first, count) runs */
	runs: Uint32Array;
	/** rows whose transform changes after the groups are built (spinning rows), ascending; never culled by group */
	moving: ArrayLike<number> | null;
}

/**
 * the farthest a chain's instances draw, as a factor of their LODGroup size: Unity's metric is `2 · size ·
 * pixelFactor / (distance · viewportHeight)`, and nothing draws once its square falls to the chain's lowest
 * `minSquared`.
 *
 * @param minSquared the lowest `minSquared` of the chain's drawn slots, or `null` when it has none
 * @param measuredByDistance the chain's bands are squared distances rather than screen sizes
 * @returns the reach per metre of size; `Infinity` when its instances never fall out by size
 */
export const chainReach = (minSquared: number | null, measuredByDistance: boolean): number => {
	if (minSquared === null) {
		return 0;
	}
	if (measuredByDistance || minSquared <= 0) {
		return Infinity;
	}
	return 2 / Math.sqrt(minSquared);
};

/**
 * @param rowsF32 a block's rows, {@link ROW_WORDS} each, starting with their transform's top three rows
 * @param count how many rows
 * @returns 1 per row whose transform mirrors it (a negative determinant), else 0; turning never changes it
 */
export const mirroredRows = (rowsF32: Float32Array, count: number): Uint8Array => {
	const mirrored = new Uint8Array(count);
	for (let i = 0; i < count; i++) {
		const at = i * ROW_WORDS;
		const f = rowsF32;
		const det =
			f[at] * (f[at + 5] * f[at + 10] - f[at + 6] * f[at + 9]) -
			f[at + 1] * (f[at + 4] * f[at + 10] - f[at + 6] * f[at + 8]) +
			f[at + 2] * (f[at + 4] * f[at + 9] - f[at + 5] * f[at + 8]);
		mirrored[i] = det < 0 ? 1 : 0;
	}
	return mirrored;
};

/**
 * @param rows the block's rows
 * @param reachOf a chain's reach per metre of size, from {@link chainReach}
 * @returns {@link GROUP_FLOATS} floats per group of {@link GROUP_ROWS} rows, the last group possibly shorter
 */
export const buildRowGroups = (rows: GroupedRows, reachOf: (chain: number) => number): Float32Array => {
	const { rowsF32: f32, cull, runs, moving } = rows;
	const count = cull.length / CULL_FLOATS;
	const groups = new Float32Array(Math.ceil(count / GROUP_ROWS) * GROUP_FLOATS);
	const reach = new Float64Array(count);
	for (let r = 0; r < runs.length; r += 3) {
		const perSize = reachOf(runs[r]);
		for (let i = runs[r + 1]; i < runs[r + 1] + runs[r + 2]; i++) {
			reach[i] = perSize * cull[i * CULL_FLOATS + 1];
		}
	}
	let next = 0;
	for (let g = 0; g * GROUP_ROWS < count; g++) {
		const first = g * GROUP_ROWS;
		const end = Math.min(count, first + GROUP_ROWS);
		let minX = Infinity;
		let minY = Infinity;
		let minZ = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		let maxZ = -Infinity;
		for (let i = first; i < end; i++) {
			const at = i * ROW_WORDS;
			minX = Math.min(minX, f32[at + 12]);
			minY = Math.min(minY, f32[at + 13]);
			minZ = Math.min(minZ, f32[at + 14]);
			maxX = Math.max(maxX, f32[at + 12]);
			maxY = Math.max(maxY, f32[at + 13]);
			maxZ = Math.max(maxZ, f32[at + 14]);
		}
		const cx = (minX + maxX) / 2;
		const cy = (minY + maxY) / 2;
		const cz = (minZ + maxZ) / 2;
		let centers = 0;
		let radius = 0;
		let rowRadius = 0;
		let groupReach = 0;
		for (let i = first; i < end; i++) {
			const at = i * ROW_WORDS;
			const d = Math.hypot(f32[at + 12] - cx, f32[at + 13] - cy, f32[at + 14] - cz);
			const r = cull[i * CULL_FLOATS];
			centers = Math.max(centers, d);
			radius = Math.max(radius, d + r);
			rowRadius = Math.max(rowRadius, r);
			groupReach = Math.max(groupReach, reach[i]);
		}
		// a moving row can be anywhere its turning takes it
		if (moving !== null) {
			while (next < moving.length && moving[next] < first) {
				next++;
			}
			if (next < moving.length && moving[next] < end) {
				centers = Infinity;
				radius = Infinity;
			}
		}
		const out = g * GROUP_FLOATS;
		groups[out + GroupFloat.center] = cx;
		groups[out + GroupFloat.center + 1] = cy;
		groups[out + GroupFloat.center + 2] = cz;
		// a centimetre more covers the centre's rounding to f32
		groups[out + GroupFloat.centersRadius] = centers + 0.01;
		groups[out + GroupFloat.radius] = radius + 0.01;
		groups[out + GroupFloat.rowRadius] = rowRadius;
		groups[out + GroupFloat.reach] = groupReach;
	}
	return groups;
};
