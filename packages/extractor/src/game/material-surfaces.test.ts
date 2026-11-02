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

describe('dithered effects', () => {
	const shader = shaderEntry({
		name: 'HGRP/Effect/VFXDitherAlpha',
		family: 'vfxDitherAlpha',
		floats: {
			_UseLighting: 1,
			_TintColorIntensity: 1,
			_Roughness: 0.5,
			_NormalScale: 1,
			_TintColorAlpha: 1,
			_DitherAlphaExp: 1,
			_DitherTilling: 1,
			_DitherAlphaMode: 0,
		},
		colors: { _TintColor: [1, 1, 1, 1], _MainTex2Color: [1, 1, 1, 1] },
		textures: { _MainTex: 'white', _MainTex2: 'white', _NormalMap: 'bump' },
	});

	it('shade as lit surfaces from the tinted main texture and their normal map, masked by a second texture', () => {
		const rock = (overrides: Partial<MaterialValues>) =>
			describeMaterial(
				values({
					keywords: ['_NORMAL_MAP', '_USE_MAIN2'],
					blend: 'alphaTest',
					alphaClipThreshold: 0.5,
					slots: {
						_MainTex: { texture: 3, uv: 0, scale: [4, 4], offset: [0, 0] },
						_MainTex2: { texture: 4, uv: 0, scale: [1, 1], offset: [0, 0] },
						_NormalMap: { texture: 5, uv: 0, scale: [1, 1], offset: [0, 0] },
					},
					floats: { _UseMainTex2AsAlpha: 1, _TintColorIntensity: 10, _NormalScale: 1.5, _Roughness: 1 },
					colors: { _TintColor: [1, 0.5, 0, 1] },
					...overrides,
				}),
				shader,
			);
		const surface = rock({});
		assert.equal(surface.kind, 'dithered');
		if (surface.kind !== 'dithered') {
			return;
		}
		assert.equal(surface.baseMap?.texture, 3);
		assert.equal(surface.normalMap?.texture, 5);
		// with the second texture's mask, the main texture's alpha isn't dithered
		assert.equal(surface.dither, null);
		assert.deepEqual(
			surface.color.map((c) => Math.round(c * 1000) / 1000),
			[10, 2.14, 0],
		);
		assert.deepEqual(surface.lighting, { roughness: 1, metallic: 0, normalScale: 1.5 });
		// a second texture's colour isn't drawn; a dissolve makes it an effect
		assert.equal(rock({ floats: { _UseMainTex2AsAlpha: 0 } }).kind, 'unsupported');
		assert.notEqual(rock({ keywords: ['_USE_DISSOLVE'] }).kind, 'dithered');
	});

	it('dither by the scaled alpha of their main texture, or its red alone when unlit', () => {
		const spot = (floats: Record<string, number>) =>
			describeMaterial(
				values({
					blend: 'alphaTest',
					alphaClipThreshold: 0.5,
					slots: { _MainTex: { texture: 6, uv: 0, scale: [2, 2], offset: [0, 0] } },
					floats: { _UseLighting: 0, ...floats },
					colors: { _TintColor: [0.5, 0.5, 0.5, 0.5] },
				}),
				shader,
			);
		const plain = spot({ _TintColorAlpha: 1.5 });
		const mask = spot({ _UseMainTexAsAlpha: 1, _DitherAlphaExp: 14, _DitherTilling: 0.1 });
		const edged = spot({ _DitherAlphaMode: 1 });
		assert.ok(plain.kind === 'dithered' && mask.kind === 'dithered' && edged.kind === 'dithered');
		assert.deepEqual(
			{ ...plain.dither, texture: plain.dither?.texture.texture },
			{ texture: 6, redAlpha: false, alphaScale: 0.75, exponent: 1, tiling: 1 },
		);
		assert.equal(plain.lighting, null);
		assert.equal(mask.baseMap, null);
		assert.deepEqual(
			{ ...mask.dither, texture: mask.dither?.texture.texture },
			{ texture: 6, redAlpha: true, alphaScale: 0.5, exponent: 14, tiling: 0.1 },
		);
		// the edge mode isn't drawn
		assert.equal(edged.dither, null);
	});
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
