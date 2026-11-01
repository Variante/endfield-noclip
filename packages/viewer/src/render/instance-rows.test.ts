import assert from 'node:assert/strict';
import { it } from 'node:test';

import { type Chain, ChainFlags } from '@endfield-noclip/package-format/instances';

import { buildInstanceRows, markBillboardRows, ROW_WORDS, RowBillboard, RowKind } from './instance-rows.ts';

it('marks the rows of billboard chains, keeping the rest of their info words', () => {
	const chain = (flags: number): Chain => ({ lodCount: 1, flags, draws: [] });
	const chains = [chain(0), chain(ChainFlags.BillboardFacing), chain(ChainFlags.BillboardUpright)];
	const rows = buildInstanceRows(
		{
			flags: 0,
			origin: [0, 0, 0],
			chains: new Uint32Array([0, 1, 1, 2]),
			transforms: new Float32Array(4 * 12),
			bounds: new Float32Array(4 * 6),
			entityIds: new Uint32Array(4),
		},
		RowKind.Detail,
	);
	markBillboardRows(rows, chains);
	const info = Array.from({ length: 4 }, (_, i) => rows.rows[i * ROW_WORDS + 19]);
	assert.deepEqual(
		info.map((word) => word >>> 30),
		[RowBillboard.None, RowBillboard.Facing, RowBillboard.Facing, RowBillboard.Upright],
	);
	assert.ok(info.every((word) => (word & 7) === RowKind.Detail));
});
