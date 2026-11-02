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
