import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ShaderEntry } from '@endfield-noclip/package-format/materials';

import { describeMaterial } from './material-describe.ts';
import type { MaterialValues } from './material-values.ts';

/** a shader entry declaring only the overrides' properties */
const shaderEntry = (
	overrides: Partial<ShaderEntry> & Pick<ShaderEntry, 'name' | 'family'>,
): ShaderEntry => ({
	floats: {},
	colors: {},
	vectors: {},
	textures: {},
	normalMaps: [],
	...overrides,
});

/** an opaque material with no overrides */
const values = (overrides: Partial<MaterialValues> = {}): MaterialValues => ({
	shader: 0,
	keywords: [],
	renderQueue: 2000,
	blend: 'opaque',
	blendFactors: null,
	alphaClipThreshold: null,
	cull: 'back',
	zWrite: true,
	baseTextureMapCount: null,
	slots: {},
	floats: {},
	colors: {},
	vectors: {},
	...overrides,
});

describe('matte paintings', () => {
	it('fold the alpha scale into the threshold and take the tint times its intensity', () => {
		const shader = shaderEntry({
			name: 'HGRP/MattePainting',
			family: 'mattePainting',
			floats: { _TintColorIntensity: 1, _TintColorAlpha: 1, _ExpThreshold: 1, _ExpIntensity: 0 },
			colors: { _TintColor: [1, 1, 1, 1] },
			textures: { _MainTex: 'white' },
		});
		const surface = describeMaterial(
			values({
				keywords: ['_ALPHATEST_ON'],
				blend: 'alphaTest',
				alphaClipThreshold: 1,
				slots: { _MainTex: { texture: 7, uv: 0, scale: [1, 1], offset: [0, 0] } },
				floats: { _TintColorAlpha: 10, _TintColorIntensity: 2, _ExpIntensity: 4 },
				colors: { _TintColor: [1, 1, 1, 0.5] },
			}),
			shader,
		);
		assert.deepEqual(surface, {
			kind: 'mattePainting',
			texture: { texture: 7, uv: 0, scale: [1, 1], offset: [0, 0] },
			color: [2, 2, 2],
			alphaClip: 0.2,
			highlight: { threshold: 1, intensity: 4 },
			ignorePostExposure: 1,
		});
	});
});
