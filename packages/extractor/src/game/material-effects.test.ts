import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ShaderEntry, ShaderFamily, TextureSlot } from '@endfield-noclip/package-format/materials';
import type { MaterialSurface } from '@endfield-noclip/package-format/surfaces';

import { describeMaterial } from './material-describe.ts';
import type { MaterialValues } from './material-values.ts';

const shader = (name: string, family: ShaderFamily, overrides: Partial<ShaderEntry> = {}): ShaderEntry => ({
	name,
	family,
	floats: {},
	colors: {},
	vectors: {},
	textures: {},
	normalMaps: [],
	...overrides,
});

const slot = (texture: number, scale: [number, number] = [1, 1]): TextureSlot => ({
	texture,
	uv: 0,
	scale,
	offset: [0, 0],
});

/** a premultiplied effect material with no overrides */
const material = (overrides: Partial<MaterialValues>): MaterialValues => ({
	shader: 0,
	keywords: [],
	renderQueue: 3000,
	blend: 'premultiplied',
	blendFactors: [1, 10],
	alphaClipThreshold: null,
	cull: 'back',
	zWrite: false,
	baseTextureMapCount: null,
	slots: {},
	floats: {},
	colors: {},
	vectors: {},
	...overrides,
});

/** the surface, failing the test unless it's of `kind` */
const ofKind = <K extends MaterialSurface['kind']>(
	surface: MaterialSurface,
	kind: K,
): Extract<MaterialSurface, { kind: K }> => {
	if (surface.kind !== kind) {
		throw new Error(`expected ${kind}, got ${JSON.stringify(surface)}`);
	}
	return surface as Extract<MaterialSurface, { kind: K }>;
};

describe('mist', () => {
	it('draws additive cards with HDR colours as stored, and equal fade ends as a step', () => {
		const card = ofKind(
			describeMaterial(
				material({
					blend: 'additive',
					keywords: ['_USE_SOFTBLEND'],
					slots: { _MainTex: slot(1), _NoiseTex: slot(2) },
					floats: {
						_BaseAlphaIntensity: 2,
						_DistanceFadeStart: 0.001,
						_DistanceFadeEnd: 0.001,
						_NearCameraFadeDistanceStart: 3000,
						_NearCameraFadeDistanceEnd: 2500,
						_SoftDistance: 12,
					},
					// Suiming's cave-exit card (`M_fog_indie_dg016_001`)
					colors: { _BaseColor: [16.07, 19.84, 29.89, 1], _IndirectColor: [0.5, 0.25, 2, 1] },
				}),
				shader('HGRP/FogSimple', 'fogSimple'),
			),
			'mistCard',
		);
		assert.equal(card.baseAlphaIntensity, 2);
		assert.deepEqual(card.color, [16.07, 19.84, 29.89, 1]);
		assert.deepEqual([card.indirectColor, card.additive], [[0.5, 0.25, 2], true]);
		assert.deepEqual(
			card.distanceFade.map((v) => Number(v.toFixed(4))),
			[0.001, 0.0011],
		);
		assert.deepEqual(card.nearFade, [3000, 2500]);
		assert.equal(card.softDistance, 12);
		const other = describeMaterial(
			material({ keywords: ['_USE_SOMETHING_ELSE'], slots: { _MainTex: slot(1), _NoiseTex: slot(2) } }),
			shader('HGRP/FogSimple', 'fogSimple'),
		);
		assert.deepEqual(other, { kind: 'unsupported', reason: 'keywords _USE_SOMETHING_ELSE' });
	});

	it('draws walk-in boxes without the close-up fade, and their 3D noise only with its keyword', () => {
		const box = (overrides: Partial<MaterialValues>) =>
			ofKind(
				describeMaterial(
					material({ blend: 'additive', slots: { _NoiseTex3D: slot(3) }, ...overrides }),
					shader('HGRP/Effect/VFXFakeVolumeFog', 'vfxFakeVolumeFog'),
				),
				'mistVolume',
			);
		const walkIn = box({ floats: { _canWalkIn: 1, _NearFadeDistance: 5, _FogDensity: 4 } });
		assert.deepEqual([walkIn.density, walkIn.nearFade, walkIn.noise], [4, 0, null]);
		const noisy = box({
			keywords: ['_USE_NOISE3D'],
			floats: { _NoiseIntensity: 0, _NoiseFarIntensity: -0.3, _NoiseFar: 2, _NoiseUVWSpeed1: 0.5 },
			vectors: { _NoiseTexTilling1: [0.02, 0.02, 0.02, 1], _NoiseUVWDir1: [1, 0, -1, 0] },
		});
		assert.deepEqual(noisy.noise, {
			texture: 3,
			tiling: [0.02, 0.02, 0.02],
			world: 1,
			flow: [0.5, 0, -0.5],
			nearIntensity: 0,
			farIntensity: -0.3,
			farPerMetre: 0.05,
		});
		assert.equal(
			describeMaterial(material({}), shader('HGRP/Effect/VFXFakeVolumeFog', 'vfxFakeVolumeFog')).kind,
			'unsupported',
		);
	});
});

describe('light beams', () => {
	const beamShader = shader('Hidden/VLB_HGRP_SinglePass', 'volumetricBeam', {
		floats: { _BlendMode: 1, _BlendSrcFactor: 1, _BlendDstFactor: 1, _FresnelPow: 1 },
		colors: { _ColorFlat: [1, 1, 1, 1] },
		vectors: { _ConeParams0: [0, 0, 0, 0], _ConeParams1: [0, 0, 0, 0], _DistanceFallOff: [0, 0, 0, 0] },
	});
	// dung02_dg005's `VLB_5006340546849160366`, one of the Wuling rift's two great beams
	const riftBeam = (overrides: Partial<MaterialValues> = {}) =>
		describeMaterial(
			material({
				keywords: ['VLB_DEPTH_BLEND'],
				blend: 'alphaBlend',
				blendFactors: [5, 10],
				floats: {
					_AlphaInside: 0.15,
					_AlphaOutside: 0.15,
					_AttenuationLerpLinearQuad: 1,
					_DepthBlendDistance: 22,
					_DistanceFadeStart: 256,
					_DistanceFadeEnd: 200,
					_DistanceFadeStartSecond: 0,
					_DistanceFadeEndSecond: 0,
					_FresnelPow: 2,
				},
				colors: { _ColorFlat: [0.45, 0.5875, 1, 1] },
				vectors: {
					_ConeParams0: [1, 1.00087571, 0.99999994, 0.0002919],
					_ConeParams1: [0, 0, 1, 0],
					_DistanceFallOff: [1, 3, 3, 0],
				},
				...overrides,
			}),
			beamShader,
		);

	it('reads an additive beam: its cone, falloff, linear colour and a step for equal fade ends', () => {
		const beam = ofKind(riftBeam(), 'lightBeam');
		assert.equal(beam.additive, true);
		assert.deepEqual(beam.falloff, [1, 3, 3, 0]);
		assert.equal(beam.cone[1], 1.00087571);
		assert.equal(beam.depthBlend, 22);
		assert.deepEqual([beam.alphaInside, beam.alphaOutside], [0.15, 0.15]);
		// `_ColorFlat` is an LDR colour: decoded to linear
		assert.ok(Math.abs(beam.color[0] - 0.1708) < 1e-3);
		assert.ok(beam.distanceFadeSecond[1] > beam.distanceFadeSecond[0]);
		assert.equal(beam.unfogged, true);
	});

	it('keeps a beam without depth blending, or alpha-blended under fog, to its own settings', () => {
		assert.equal(ofKind(riftBeam({ keywords: ['VLB_NOISE_3D'] }), 'lightBeam').depthBlend, 0);
		const fogged = ofKind(
			riftBeam({
				keywords: ['VLB_DEPTH_BLEND', 'VLB_USE_FOG'],
				floats: { _BlendMode: 0, _BlendSrcFactor: 5, _BlendDstFactor: 10 },
			}),
			'lightBeam',
		);
		assert.deepEqual([fogged.unfogged, fogged.additive], [false, false]);
	});

	it('marks blending the game pairs with neither mode unsupported', () => {
		const odd = riftBeam({ floats: { _BlendMode: 1, _BlendSrcFactor: 5, _BlendDstFactor: 10 } });
		assert.equal(odd.kind, 'unsupported');
	});
});
