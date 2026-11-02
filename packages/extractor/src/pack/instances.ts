import type { Aabb } from '@endfield-noclip/formats/unity/values';
import {
	DECAL_PLACEMENT_FLOATS,
	type InstanceBlock,
	InstanceBlockFlags,
} from '@endfield-noclip/package-format/instances';

/** one placed instance, in world space */
export interface InstanceInput {
	chain: number;
	/** 4×4 column-major object-to-world matrix */
	matrix: Float32Array;
	/** world AABB */
	bounds: Aabb;
	entityId: number;
	/** a rect decal's placement, {@link DECAL_PLACEMENT_FLOATS} floats; absent on other rows */
	decalPlacement?: readonly number[];
}

/** growable struct-of-arrays rows, encoded into an {@link InstanceBlock} at the end */
export class InstanceBlockBuilder {
	readonly #chains: number[] = [];
	readonly #groups: number[] = [];
	readonly #matrices: number[] = [];
	readonly #bounds: number[] = [];
	readonly #entityIds: number[] = [];
	/** by insertion index, the decal rows' placements */
	readonly #placements = new Map<number, readonly number[]>();

	/** number of rows */
	get length(): number {
		return this.#chains.length;
	}

	/**
	 * appends a row
	 *
	 * @param row the instance
	 * @param group extra sort key applied before the chain (e.g. the node of an HLOD row); 0 when unused
	 * @returns the row's insertion index
	 * @throws {RangeError} if a decal placement isn't {@link DECAL_PLACEMENT_FLOATS} floats
	 */
	add(row: InstanceInput, group: number): number {
		const m = row.matrix;
		// top three rows of the column-major matrix, row-major; translation made relative later
		this.#matrices.push(m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13], m[2], m[6], m[10], m[14]);
		const { center, extents } = row.bounds;
		this.#bounds.push(center[0], center[1], center[2], extents[0], extents[1], extents[2]);
		this.#chains.push(row.chain);
		this.#groups.push(group);
		this.#entityIds.push(row.entityId);
		if (row.decalPlacement !== undefined) {
			if (row.decalPlacement.length !== DECAL_PLACEMENT_FLOATS) {
				throw new RangeError(`a decal placement is ${DECAL_PLACEMENT_FLOATS} floats`);
			}
			this.#placements.set(this.#chains.length - 1, row.decalPlacement);
		}
		return this.#chains.length - 1;
	}

	/**
	 * encodes the rows sorted by (group, chain), insertion order breaking ties
	 *
	 * @param origin world position translations and bounds centres are made relative to
	 * @returns the block, and per output row its insertion index
	 */
	toBlock(origin: [x: number, y: number, z: number]): { block: InstanceBlock; order: Uint32Array } {
		const count = this.#chains.length;
		const order = Uint32Array.from({ length: count }, (_, i) => i).toSorted(
			(a, b) => this.#groups[a] - this.#groups[b] || this.#chains[a] - this.#chains[b] || a - b,
		);
		const chains = new Uint32Array(count);
		const transforms = new Float32Array(count * 12);
		const bounds = new Float32Array(count * 6);
		const entityIds = new Uint32Array(count);
		const decalRows = new Uint32Array(this.#placements.size);
		const placements = new Float32Array(this.#placements.size * DECAL_PLACEMENT_FLOATS);
		let decals = 0;
		for (let out = 0; out < count; out++) {
			const i = order[out];
			chains[out] = this.#chains[i];
			entityIds[out] = this.#entityIds[i];
			for (let k = 0; k < 12; k++) {
				transforms[out * 12 + k] = this.#matrices[i * 12 + k];
			}
			transforms[out * 12 + 3] -= origin[0];
			transforms[out * 12 + 7] -= origin[1];
			transforms[out * 12 + 11] -= origin[2];
			for (let k = 0; k < 6; k++) {
				bounds[out * 6 + k] = this.#bounds[i * 6 + k];
			}
			bounds[out * 6] -= origin[0];
			bounds[out * 6 + 1] -= origin[1];
			bounds[out * 6 + 2] -= origin[2];
			const placement = this.#placements.get(i);
			if (placement !== undefined) {
				decalRows[decals] = out;
				placements.set(placement, decals * DECAL_PLACEMENT_FLOATS);
				decals++;
			}
		}
		return {
			block: {
				flags: InstanceBlockFlags.SortedByChain,
				origin,
				chains,
				transforms,
				bounds,
				entityIds,
				decalPlacements: { rows: decalRows, values: placements },
			},
			order,
		};
	}

	/**
	 * @param order output order from {@link InstanceBlockBuilder.toBlock}
	 * @returns the group key of each output row
	 */
	groupsInOrder(order: Uint32Array): number[] {
		return Array.from(order, (i) => this.#groups[i]);
	}
}
