import assert from 'node:assert/strict';
import { test } from 'node:test';

import { proximityValues } from './proximity.ts';

test('a proximity control holds within its radius, measured in 3D', () => {
	// the blue talosite in Suiming, whose look changes within 15 m
	const talosite = { control: 'proximity:46300000058', position: [-94.6, 120, -1.5] as const, radius: 15 };
	const at = (eye: [number, number, number]) =>
		proximityValues([{ ...talosite, position: [...talosite.position] }], eye);
	assert.deepEqual(at([-97.2, 122.1, -4]), { 'proximity:46300000058': 1 });
	assert.deepEqual(at([-94.6, 120, 13.5]), { 'proximity:46300000058': 1 });
	// straight above by more than the radius
	assert.deepEqual(at([-94.6, 136, -1.5]), { 'proximity:46300000058': 0 });
});

test('a proximity control with several reaches holds within any of them', () => {
	// two of the spheres of the Jingyu Valley tree cave's trigger volume
	const control = 'proximity:volume:10100030016:80003';
	const reaches = [
		{ control, position: [-1072.7, 243, -1347.8] as [number, number, number], radius: 92.4 },
		{ control, position: [-1082.6, 243, -1406.1] as [number, number, number], radius: 77.8 },
	];
	// the second sphere only, then the first only, then neither
	assert.deepEqual(proximityValues(reaches, [-1045.9, 229.2, -1399.8]), { [control]: 1 });
	assert.deepEqual(proximityValues(reaches.toReversed(), [-1045.9, 229.2, -1399.8]), { [control]: 1 });
	assert.deepEqual(proximityValues(reaches, [-1072.7, 243, -1260]), { [control]: 1 });
	assert.deepEqual(proximityValues(reaches, [-900, 243, -1400]), { [control]: 0 });
});
