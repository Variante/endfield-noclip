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

describe('erosion', () => {
	it('tiles each map by its own property, linearizes the base colour and keeps HDR colours as stored', () => {
		const shader = shaderEntry({
			name: 'HGRP/Erosion',
			family: 'erosion',
			floats: {
				_BaseNormalTilling: 1,
				_DetailNormalTilling: 1,
				_NoisePatternMapTilling: 1,
				_FlowNormalSpeed: 1,
			},
			colors: { _BaseColor: [1, 1, 1, 1], _FlowBottomColor: [1, 1, 1, 1] },
		});
		const slot = (texture: number) => ({
			texture,
			uv: 1,
			scale: [9, 9] as [number, number],
			offset: [0, 0] as [number, number],
		});
		const surface = describeMaterial(
			values({
				slots: {
					_BaseNormalMap: slot(1),
					_MetalMixMap: slot(2),
					_FlowRampMap: slot(3),
					_DetailNormalMap: slot(4),
					_NoisePatternMap: slot(5),
				},
				floats: { _DetailNormalTilling: 5, _NoisePatternMapTilling: 3 },
				colors: { _BaseColor: [0.5, 0.5, 0.5, 1], _FlowBottomColor: [4, 4, 4, 1] },
			}),
			shader,
		);
		assert.equal(surface.kind, 'erosion');
		if (surface.kind !== 'erosion') {
			return;
		}
		assert.deepEqual(surface.textures, {
			baseNormal: { texture: 1, tiling: 1 },
			metalMix: { texture: 2, tiling: 1 },
			flowRamp: 3,
			detailNormal: { texture: 4, tiling: 5 },
			noisePattern: { texture: 5, tiling: 3 },
		});
		assert.ok(Math.abs(surface.baseColor[0] - 0.214) < 1e-3);
		assert.deepEqual(surface.flow.bottom, [4, 4, 4]);
		assert.equal(surface.flow.scroll, 0.05);
	});
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
