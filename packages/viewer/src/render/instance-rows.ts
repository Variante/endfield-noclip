/**
 * the GPU layout of instance rows, shared by the decode worker (which builds them) and the instance renderer
 * (whose WGSL `InstanceRow` mirrors it).
 *
 * @module
 */

import {
	type Chain,
	ChainFlags,
	type InstanceBlock,
	SPIN_FLOATS,
} from '@endfield-noclip/package-format/instances';

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

/** f32 per spinning row in {@link RowSpins.base}: its stored transform (12) and bounds centre (3) */
export const SPIN_BASE_FLOATS = 15;

/** a block's spinning rows, which {@link turnRows} turns by the clock */
export interface RowSpins {
	/** the rows, ascending */
	rows: Uint32Array<ArrayBuffer>;
	/** `SPIN_FLOATS` per row, as the package stores them: pivot (relative to the block origin), axis, speed */
	values: Float32Array<ArrayBuffer>;
	/** {@link SPIN_BASE_FLOATS} per row: what the rows hold at time 0 */
	base: Float32Array<ArrayBuffer>;
}

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
	/** the block's spinning rows, or `null` when every row holds still */
	spins: RowSpins | null;
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
	let spins: RowSpins | null = null;
	if (block.spins.rows.length > 0) {
		const spinRows = new Uint32Array(block.spins.rows);
		const base = new Float32Array(spinRows.length * SPIN_BASE_FLOATS);
		for (let s = 0; s < spinRows.length; s++) {
			const at = spinRows[s] * ROW_WORDS;
			base.set(f32.subarray(at, at + SPIN_BASE_FLOATS), s * SPIN_BASE_FLOATS);
		}
		spins = { rows: spinRows, values: new Float32Array(block.spins.values), base };
	}
	return {
		count,
		origin: block.origin,
		rows,
		cull,
		runs: new Uint32Array(runs),
		placements: new Float32Array(values),
		spins,
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

/**
 * turns a block's spinning rows to where they are at `time`: each row's transform and bounds centre are its
 * stored ones turned `speed · time` radians about its axis through its pivot. the half extents stay the
 * stored ones, so a row's bounding sphere (centre, |extents|) still holds it
 *
 * @param rows the block's rows, as f32; the spinning rows' transform and centre words are overwritten
 * @param spins the block's spinning rows
 * @param time seconds of the viewer's clock
 * @returns the first row and the end of the rows written
 */
export const turnRows = (rows: Float32Array, spins: RowSpins, time: number): [first: number, end: number] => {
	const { rows: spinRows, values, base } = spins;
	for (let s = 0; s < spinRows.length; s++) {
		const v = s * SPIN_FLOATS;
		const px = values[v];
		const py = values[v + 1];
		const pz = values[v + 2];
		const ax = values[v + 3];
		const ay = values[v + 4];
		const az = values[v + 5];
		const angle = values[v + 6] * time;
		// Rodrigues' rotation, as Unity's Quaternion.AngleAxis turns: R = cos·I + sin·[a]× + (1 − cos)·aaᵀ
		const c = Math.cos(angle);
		const sn = Math.sin(angle);
		const k = 1 - c;
		const r = [
			c + k * ax * ax,
			k * ax * ay - sn * az,
			k * ax * az + sn * ay,
			k * ay * ax + sn * az,
			c + k * ay * ay,
			k * ay * az - sn * ax,
			k * az * ax - sn * ay,
			k * az * ay + sn * ax,
			c + k * az * az,
		];
		const b = s * SPIN_BASE_FLOATS;
		const at = spinRows[s] * ROW_WORDS;
		const pivot = [px, py, pz];
		for (let i = 0; i < 3; i++) {
			for (let j = 0; j < 3; j++) {
				rows[at + i * 4 + j] =
					r[i * 3] * base[b + j] + r[i * 3 + 1] * base[b + 4 + j] + r[i * 3 + 2] * base[b + 8 + j];
			}
			let t = pivot[i];
			let centre = pivot[i];
			for (let j = 0; j < 3; j++) {
				t += r[i * 3 + j] * (base[b + j * 4 + 3] - pivot[j]);
				centre += r[i * 3 + j] * (base[b + 12 + j] - pivot[j]);
			}
			rows[at + i * 4 + 3] = t;
			rows[at + 12 + i] = centre;
		}
	}
	return [spinRows[0], spinRows[spinRows.length - 1] + 1];
};
