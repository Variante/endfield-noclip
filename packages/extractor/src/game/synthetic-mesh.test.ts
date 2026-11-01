import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { syntheticMesh } from './synthetic-mesh.ts';

describe('syntheticMesh', () => {
	it('makes a closed unit cube with outward face normals', () => {
		const cube = syntheticMesh('cube');
		assert.equal(cube.vertexCount, 24);
		assert.equal(cube.indices.length, 36);
		const { positions, normals } = cube;
		assert.ok(normals !== null);
		for (let v = 0; v < cube.vertexCount; v++) {
			for (let axis = 0; axis < 3; axis++) {
				assert.equal(Math.abs(positions[v * 3 + axis]), 0.5);
			}
			// the normal points along the axis the vertex's face lies on
			const face: number | undefined = [0, 1, 2].find((a) => normals[v * 3 + a] !== 0);
			assert.ok(face !== undefined);
			assert.equal(Math.sign(positions[v * 3 + face]), normals[v * 3 + face]);
		}
		// every triangle faces out (Unity winds front faces clockwise in its left-handed frame)
		for (let t = 0; t < cube.indices.length; t += 3) {
			const [a, b, c] = [cube.indices[t], cube.indices[t + 1], cube.indices[t + 2]].map((i) =>
				Array.from(positions.subarray(i * 3, i * 3 + 3)),
			);
			const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
			const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
			const cross = [
				ab[1] * ac[2] - ab[2] * ac[1],
				ab[2] * ac[0] - ab[0] * ac[2],
				ab[0] * ac[1] - ab[1] * ac[0],
			];
			const n: number[] = Array.from(normals.subarray(cube.indices[t] * 3, cube.indices[t] * 3 + 3));
			// seen from outside, a clockwise triangle's edge cross product points inward
			assert.ok(cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2] < 0);
		}
	});
});
