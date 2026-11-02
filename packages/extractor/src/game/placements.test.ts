import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Aabb } from '@endfield-noclip/formats/unity/values';

import { boxDistance, describeAlternatives, parsePlacementKinds } from './placements.ts';

test('boxDistance is 0 inside the box and the gap to its nearest face or corner outside', () => {
	const box: Aabb = { center: [0, 0, 0], extents: [2, 1, 1] };
	assert.equal(boxDistance([1, 0.5, -0.5], box), 0);
	assert.equal(boxDistance([5, 0, 0], box), 3);
	assert.equal(boxDistance([5, 5, 0], box), 5);
});

test('describeAlternatives writes requirements as control=values', () => {
	assert.equal(describeAlternatives([[]]), 'always');
	assert.equal(describeAlternatives([]), 'never');
	assert.equal(
		describeAlternatives([
			[
				{ control: 'sceneState:2', mask: 2 },
				{ control: 'area:7', mask: 2 },
			],
			[{ control: 'quest:q', mask: 0b101101 }],
		]),
		'sceneState:2=1 & area:7=1 | quest:q=0/2/3/5',
	);
	// a requirement-free alternative makes the whole expression hold
	assert.equal(describeAlternatives([[{ control: 'script:1', mask: 2 }], []]), 'always');
});

test('parsePlacementKinds rejects unknown kinds', () => {
	assert.deepEqual([...parsePlacementKinds('effect, model,effect')], ['effect', 'model']);
	assert.throws(() => parsePlacementKinds('effects'), /unknown kind effects/);
});
