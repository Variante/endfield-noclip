/**
 * the GPU layout of instance rows, shared by the decode worker (which builds them) and the instance renderer
 * (whose WGSL `InstanceRow` mirrors it).
 *
 * @module
 */

import { type Chain, ChainFlags, type InstanceBlock } from '@endfield-noclip/package-format/instances';

/** 32-bit words per row: transform (12), bounds centre + block word (4), half extents + info (4) */
export const ROW_WORDS = 20;

/**
 * bits of a row's block word that hold its block slot (`row_block` in frame.wgsl); the bits above hold its
 * decal placement's index in its block plus 1, or 0 for a row without one (`row_placement`)
 */
export const BLOCK_SLOT_BITS = 14;

/** block slots the block word can name */
export const BLOCK_SLOTS = 1 << BLOCK_SLOT_BITS;

/** bytes per row */
export const ROW_BYTES = ROW_WORDS * 4;

/** f32 per row in {@link InstanceRows.cull}: bounding radius, largest half extent */
export const CULL_FLOATS = 2;

/** what a row draws as, its info word; tiers 0–2 are HLOD tiers */
export const RowKind = {
	Hlod0: 0,
	Hlod1: 1,
	Hlod2: 2,
	Detail: 3,
	Global: 4,
} as const;

export type RowKind = (typeof RowKind)[keyof typeof RowKind];

/**
 * a row's info word: its {@link RowKind} in bits 0–2, {@link ROW_COLORED} in bit 3, then the texture sheet
 * tile its mesh's UVs are remapped into (`sheet_uv` in frame.wgsl): tiles across − 1 in bits 4–9, down − 1 in
 * bits 10–15, the tile in bits 16–27, and which UV sets take it (bit 28 UV0, bit 29 UV1). a 1×1 sheet leaves
 * the UVs as they are. bits 30–31 hold the row's {@link RowBillboard}
 *
 * @param kind the row's kind
 * @param tiles tiles across and down, 1–64 each
 * @param tile the tile, counted from the sheet's top-left along its rows
 * @param uvChannels bit 0 for UV0, bit 1 for UV1
 * @returns the info word
 */
export const rowInfo = (
	kind: RowKind,
	tiles: readonly [number, number],
	tile: number,
	uvChannels: number,
): number =>
	(kind |
		((tiles[0] - 1) << 4) |
		((tiles[1] - 1) << 10) |
		((tile & 0xfff) << 16) |
		((uvChannels & 3) << 28)) >>>
	0;

/**
 * info bit of a row whose last half-extent word holds a colour instead (RGBA8, `instance_color` in
 * frame.wgsl) that multiplies the mesh's vertex colours. only particle rows set it: their extents are equal,
 * so the other two keep the size
 */
export const ROW_COLORED = 1 << 3;

/**
 * how a row turns towards the camera (`row_basis` in frame.wgsl), in bits 30–31 of its info word: its
 * transform's rotation is relative to the camera's ({@link ChainFlags.BillboardFacing}), or to the camera's
 * heading about the vertical ({@link ChainFlags.BillboardUpright})
 */
export const RowBillboard = {
	None: 0,
	Facing: 1,
	Upright: 2,
} as const;

export type RowBillboard = (typeof RowBillboard)[keyof typeof RowBillboard];

/**
 * marks the rows of billboard chains in their info words, in place, by the block's chain runs
 *
 * @param built rows from {@link buildInstanceRows}; their info words are modified
 * @param chains the package's chains
 */
export const markBillboardRows = (built: InstanceRows, chains: readonly Chain[]): void => {
	const { runs, rows } = built;
	for (let r = 0; r < runs.length; r += 3) {
		const flags = chains[runs[r]]?.flags ?? 0;
		let billboard: RowBillboard = RowBillboard.None;
		if (flags & ChainFlags.BillboardFacing) {
			billboard = RowBillboard.Facing;
		} else if (flags & ChainFlags.BillboardUpright) {
			billboard = RowBillboard.Upright;
		}
		if (billboard === RowBillboard.None) {
			continue;
		}
		for (let i = runs[r + 1], end = i + runs[r + 2]; i < end; i++) {
			const at = i * ROW_WORDS + 19;
			rows[at] = ((rows[at] & ~(3 << 30)) | (billboard << 30)) >>> 0;
		}
	}
};

/**
 * @param rgba linear colour and alpha, 0–1
 * @returns them as the RGBA8 word of a {@link ROW_COLORED} row
 */
export const packRowColor = (rgba: ArrayLike<number>): number => {
	let word = 0;
	for (let i = 0; i < 4; i++) {
		word |= Math.round(Math.min(Math.max(rgba[i], 0), 1) * 255) << (i * 8);
	}
	return word >>> 0;
};

/** a span of rows sharing a tier, as listed by the tree's HLOD refs */
export interface TierSpan {
	first: number;
	count: number;
	tier: number;
}

/** what an instance block's rows are: one kind for every row, or the tier spans of an HLOD block */
export type RowKinds = RowKind | readonly TierSpan[];

/** an instance block laid out for the GPU */
export interface InstanceRows {
	count: number;
	origin: [x: number, y: number, z: number];
	/** `count × ROW_WORDS` words */
	rows: Uint32Array<ArrayBuffer>;
	/** `count × CULL_FLOATS` floats for CPU-side culling and LOD selection */
	cull: Float32Array<ArrayBuffer>;
	/** (chain, first, count) triples of equal-chain runs, for per-template instancing */
	runs: Uint32Array<ArrayBuffer>;
	/** the block's rect decal placements, `DECAL_PLACEMENT_FLOATS` each, in the order rows index them */
	placements: Float32Array<ArrayBuffer>;
}

/**
 * row: f32×12 transform rows (relative to the block origin), f32×3 bounds centre (relative), u32 block word
 * ({@link BLOCK_SLOT_BITS}), f32×3 half extents, u32 info (the row's {@link RowKind}; see {@link rowInfo} for
 * the rest of the word).
 *
 * the block slot is left 0; {@link assignBlockSlot} sets it once the block gets a slot.
 *
 * @param block decoded block
 * @param kinds the rows' kinds; rows outside every tier span become tier 0
 * @returns rows, cull data, chain runs and decal placements
 * @throws {RangeError} if the block has more decal placements than a block word can index
 */
export const buildInstanceRows = (block: InstanceBlock, kinds: RowKinds): InstanceRows => {
	const count = block.chains.length;
	const rows = new Uint32Array(count * ROW_WORDS);
	const f32 = new Float32Array(rows.buffer);
	const cull = new Float32Array(count * CULL_FLOATS);
	const rowKinds = new Uint8Array(count);
	if (typeof kinds === 'number') {
		rowKinds.fill(kinds);
	} else {
		for (const span of kinds) {
			rowKinds.fill(span.tier, span.first, span.first + span.count);
		}
	}
	for (let i = 0; i < count; i++) {
		const at = i * ROW_WORDS;
		const ex = block.bounds[i * 6 + 3];
		const ey = block.bounds[i * 6 + 4];
		const ez = block.bounds[i * 6 + 5];
		f32.set(block.transforms.subarray(i * 12, i * 12 + 12), at);
		f32[at + 12] = block.bounds[i * 6];
		f32[at + 13] = block.bounds[i * 6 + 1];
		f32[at + 14] = block.bounds[i * 6 + 2];
		f32[at + 16] = ex;
		f32[at + 17] = ey;
		f32[at + 18] = ez;
		rows[at + 19] = rowKinds[i];
		// from the f32-rounded extents, as the GPU sees them
		const fx = f32[at + 16];
		const fy = f32[at + 17];
		const fz = f32[at + 18];
		cull[i * CULL_FLOATS] = Math.sqrt(fx * fx + fy * fy + fz * fz);
		cull[i * CULL_FLOATS + 1] = Math.max(fx, fy, fz);
	}
	const { rows: decalRows, values } = block.decalPlacements;
	if (decalRows.length >= 2 ** (32 - BLOCK_SLOT_BITS)) {
		throw new RangeError(
			`an instance block has ${decalRows.length} decal placements, more than rows can index`,
		);
	}
	for (let p = 0; p < decalRows.length; p++) {
		rows[decalRows[p] * ROW_WORDS + 15] = ((p + 1) << BLOCK_SLOT_BITS) >>> 0;
	}

	const runs: number[] = [];
	for (let i = 0; i < count;) {
		const chain = block.chains[i];
		let end = i + 1;
		while (end < count && block.chains[end] === chain) {
			end++;
		}
		runs.push(chain, i, end - i);
		i = end;
	}
	return {
		count,
		origin: block.origin,
		rows,
		cull,
		runs: new Uint32Array(runs),
		placements: new Float32Array(values),
	};
};

/**
 * sets the block slot of every row, keeping its placement index.
 *
 * @param rows rows from {@link buildInstanceRows}; modified in place
 * @param slot index into the per-frame block table, below {@link BLOCK_SLOTS}
 */
export const assignBlockSlot = (rows: Uint32Array, slot: number): void => {
	const keep = ~(BLOCK_SLOTS - 1);
	for (let at = 15; at < rows.length; at += ROW_WORDS) {
		rows[at] = ((rows[at] & keep) | slot) >>> 0;
	}
};
