import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { turnFromZ, velocityBasis } from './vector-math.ts';

describe('turnFromZ', () => {
	const rotateZ = (q: number[]): number[] => {
		// +z rotated by q
		const [x, y, z, w] = q;
		return [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)];
	};

	it('turns +z onto a direction, and leaves it for a zero or +z vector', () => {
		for (const to of [
			[0, 1, 0],
			[1, 1, 1],
			[0.3, -2, -0.5],
			[0, 0, -4],
		]) {
			const length = Math.hypot(to[0], to[1], to[2]);
			const turned = rotateZ(turnFromZ(to));
			for (let axis = 0; axis < 3; axis++) {
				assert.ok(Math.abs(turned[axis] - to[axis] / length) < 1e-6, `${to.join()} → ${turned.join()}`);
			}
		}
		assert.deepEqual(turnFromZ([0, 0, 0]), [0, 0, 0, 1]);
		assert.deepEqual(
			turnFromZ([0, 0, 2]).map((value) => value + 0),
			[0, 0, 0, 1],
		);
	});
});

describe('velocityBasis', () => {
	it('points forward along the velocity with its right level', () => {
		const [right, up, forward] = velocityBasis([3, 4, 0]);
		assert.deepEqual(forward, [0.6, 0.8, 0]);
		assert.ok(Math.abs(right[1]) < 1e-12);
		assert.ok(up[1] > 0);
		// straight up, right falls back to the world's +x; a still particle faces +z
		assert.deepEqual(velocityBasis([0, 2, 0])[0], [1, 0, 0]);
		assert.deepEqual(
			velocityBasis([0, 0, 0]).map((axis) => axis.map((value) => value + 0)),
			[
				[1, 0, 0],
				[0, 1, 0],
				[0, 0, 1],
			],
		);
	});
});
