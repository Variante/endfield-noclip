import assert from 'node:assert/strict';
import { it } from 'node:test';

import { type Chain, ChainFlags, type InstanceBlock } from '@endfield-noclip/package-format/instances';

import {
	assignBlockSlot,
	BLOCK_SLOT_BITS,
	buildInstanceRows,
	markBillboardRows,
	ROW_WORDS,
	RowBillboard,
	RowKind,
} from './instance-rows.ts';

const block = (chains: number[], decalRows: number[] = []): InstanceBlock => ({
	flags: 0,
	origin: [0, 0, 0],
	chains: Uint32Array.from(chains),
	transforms: new Float32Array(chains.length * 12),
	bounds: new Float32Array(chains.length * 6),
	entityIds: new Uint32Array(chains.length),
	decalPlacements: {
		rows: Uint32Array.from(decalRows),
		values: Float32Array.from({ length: decalRows.length * 8 }, (_, i) => i),
	},
});

it('marks the rows of billboard chains, keeping the rest of their info words', () => {
	const chain = (flags: number): Chain => ({ lodCount: 1, flags, draws: [], distanceOrigin: null });
	const chains = [chain(0), chain(ChainFlags.BillboardFacing), chain(ChainFlags.BillboardUpright)];
	const rows = buildInstanceRows(block([0, 1, 1, 2]), RowKind.Detail);
	markBillboardRows(rows, chains);
	const info = Array.from({ length: 4 }, (_, i) => rows.rows[i * ROW_WORDS + 19]);
	assert.deepEqual(
		info.map((word) => word >>> 30),
		[RowBillboard.None, RowBillboard.Facing, RowBillboard.Facing, RowBillboard.Upright],
	);
	assert.ok(info.every((word) => (word & 7) === RowKind.Detail));
});

it('indexes decal rows’ placements from 1 above the block slot, which a slot assignment keeps', () => {
	const rows = buildInstanceRows(block([0, 0, 0, 0], [1, 3]), RowKind.Detail);
	assignBlockSlot(rows.rows, 5);
	const words = Array.from({ length: 4 }, (_, i) => rows.rows[i * ROW_WORDS + 15]);
	assert.deepEqual(
		words.map((word) => [word & ((1 << BLOCK_SLOT_BITS) - 1), word >>> BLOCK_SLOT_BITS]),
		[
			[5, 0],
			[5, 1],
			[5, 0],
			[5, 2],
		],
	);
	assert.deepEqual(
		[...rows.placements],
		Array.from({ length: 16 }, (_, i) => i),
	);
});
