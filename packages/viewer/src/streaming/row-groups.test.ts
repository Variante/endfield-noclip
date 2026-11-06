import assert from 'node:assert/strict';
import { it } from 'node:test';

import { CULL_FLOATS, ROW_WORDS } from '../content/instance-rows.ts';

import {
	GROUP_FLOATS,
	GROUP_ROWS,
	GroupFloat,
	buildRowGroups,
	chainReach,
	mirroredRows,
} from './row-groups.ts';

/** rows at the given bounds centres, each with a bounding radius and LODGroup size */
const rowsAt = (centers: [number, number, number][], radius: number, size: number) => {
	const rowsF32 = new Float32Array(centers.length * ROW_WORDS);
	const cull = new Float32Array(centers.length * CULL_FLOATS);
	centers.forEach(([x, y, z], i) => {
		rowsF32.set([x, y, z], i * ROW_WORDS + 12);
		cull[i * CULL_FLOATS] = radius;
		cull[i * CULL_FLOATS + 1] = size;
	});
	return { rowsF32, cull };
};

it('bounds each group of rows and its farthest LOD', () => {
	const centers = Array.from({ length: GROUP_ROWS + 2 }, (_, i): [number, number, number] => [i, 0, 0]);
	const { rowsF32, cull } = rowsAt(centers, 1, 2);
	// chain 0 covers the first group, chain 1 (never culled by size) the two rows of the second
	const runs = new Uint32Array([0, 0, GROUP_ROWS, 1, GROUP_ROWS, 2]);
	const groups = buildRowGroups({ rowsF32, cull, runs, moving: null }, (chain) =>
		chain === 0 ? chainReach(0.01, false) : chainReach(-0.0001, false),
	);
	assert.equal(groups.length, 2 * GROUP_FLOATS);
	const half = (GROUP_ROWS - 1) / 2;
	assert.equal(groups[GroupFloat.center], half);
	assert.ok(Math.abs(groups[GroupFloat.centersRadius] - half) < 0.02);
	assert.ok(Math.abs(groups[GroupFloat.radius] - (half + 1)) < 0.02);
	assert.equal(groups[GroupFloat.rowRadius], 1);
	// 2 / √0.01 per metre of size, times the size 2
	assert.ok(Math.abs(groups[GroupFloat.reach] - 40) < 1e-4);
	assert.equal(groups[GROUP_FLOATS + GroupFloat.reach], Infinity);
});

it('never rejects a group holding a moving row', () => {
	const { rowsF32, cull } = rowsAt(
		[
			[0, 0, 0],
			[1, 0, 0],
		],
		1,
		1,
	);
	const groups = buildRowGroups({ rowsF32, cull, runs: new Uint32Array([0, 0, 2]), moving: [1] }, () =>
		chainReach(0.01, false),
	);
	assert.equal(groups[GroupFloat.radius], Infinity);
	assert.equal(groups[GroupFloat.centersRadius], Infinity);
});

it('gives chains without drawn slots no reach, and distance-measured chains every reach', () => {
	assert.equal(chainReach(null, false), 0);
	assert.equal(chainReach(0.01, true), Infinity);
});

it('marks the rows whose transform flips handedness', () => {
	const rowsF32 = new Float32Array(2 * ROW_WORDS);
	// identity, then a mirror across x
	rowsF32.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], 0);
	rowsF32.set([-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], ROW_WORDS);
	assert.deepEqual([...mirroredRows(rowsF32, 2)], [0, 1]);
});
