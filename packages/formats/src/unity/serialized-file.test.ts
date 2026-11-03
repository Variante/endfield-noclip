import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isTransformClass, UnityClass } from './serialized-file.ts';

test('the RectTransform of a UI GameObject counts as its transform', () => {
	assert.ok(isTransformClass(UnityClass.Transform));
	assert.ok(isTransformClass(UnityClass.RectTransform));
	assert.ok(!isTransformClass(UnityClass.MeshFilter));
});
