import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	DECAL_COLOR_PROPERTY,
	DECAL_UV_PROPERTY,
	type ReadyMaterial,
	type ShaderEntry,
	type TextureSlot,
} from '@endfield-noclip/package-format/materials';

import {
	BeamRow,
	DecalLitRow,
	EffectKind,
	EffectRole,
	EffectRow,
	MistRow,
	OFFSET_SLOT,
	RefractRow,
	ROLE_NONE,
	SLOT_NO_BASE,
	SlotSource,
	WaterSheetFlags,
	WaterSheetRow,
} from './effect-looks.ts';
import { LookFlags, materialLooks } from './materials.ts';

const shader = (name: string): ShaderEntry => ({
	name,
	family: 'vfxBase',
	floats: {},
	colors: {},
	vectors: {},
	textures: {},
	normalMaps: [],
});

const slot = (texture: number, scale: [number, number] = [1, 1]): TextureSlot => ({
	texture,
	uv: 0,
	scale,
	offset: [0, 0],
});

const material = (overrides: Partial<ReadyMaterial>): ReadyMaterial => ({
	id: 0,
	status: 'ready',
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

test('a VFXDecal is a transparent, shadowless box drawn by its back faces, its disturb textures ahead of the rest', () => {
	const [look] = materialLooks({
		shaders: [shader('HGRP/Effect/VFXDecal')],
		entries: [
			material({
				keywords: ['_USE_MASK', '_USE_DISTURB', '_USE_NORMALBLEND'],
				slots: {
					_MainTex: slot(1),
					_MaskTex: slot(2),
					_DisturbTex1: slot(3),
					_DisturbTex2: slot(4),
					_BlendTex: slot(5, [2, 2]),
				},
				floats: {
					_TintColorAlpha: 0.5,
					_MaskTexUseDisturb: 0.25,
					_UseMaskTexAsAlpha: 1,
					_AngleBlendFallOff: 5,
				},
				colors: { _DecalBaseColor: [2, 0.5, 1, 0.8] },
			}),
		],
	});
	assert.equal(look.drawn, true);
	assert.equal(look.transparent, true);
	assert.equal(look.castsShadows, false);
	assert.equal(look.cull, 'front');
	assert.equal(look.flags, LookFlags.Effect | LookFlags.EffectDecal);
	// main, disturb 1, mask; disturb 2 and blend lack their keywords, and there's no weight texture
	assert.deepEqual(look.textures, [1, 3, -1, -1, 2, -1, -1]);
	const bits = [...look.params.subarray(EffectRow.slotBits, EffectRow.slotBits + 5)];
	assert.deepEqual(bits, [
		EffectRole.Main,
		EffectRole.Disturb1,
		ROLE_NONE,
		ROLE_NONE,
		// a quarter of the distortion, in 1/1024ths above the low byte
		EffectRole.Mask + 16 + 256 * 256,
	]);
	// the HDR base colour as stored, its alpha times `_TintColorAlpha`
	assert.deepEqual(
		[...look.params.subarray(EffectRow.tint, EffectRow.tint + 4)],
		[2, 0.5, 1, 0.4000000059604645],
	);
	assert.equal(look.params[EffectRow.decal + 1], 5);
});

test('a lit decal placement draws its base and PBR maps through its UV transform, writing what its masks allow', () => {
	const placement = {
		colors: { [DECAL_COLOR_PROPERTY]: [0.3, 0.6, 0.25, 0.9] as [number, number, number, number] },
		vectors: { [DECAL_UV_PROPERTY]: [1, 0.5, 0, 0.25] as [number, number, number, number] },
	};
	const floats = {
		_ColorMask2: 2,
		_ColorMask3: 14,
		_DecalOpacity: 0.5,
		_AngleBlendFallOff: 2,
		_RoughnessMin: 0.4,
	};
	const [look, roughnessOnly, unplaced, waterFlow, sludge, bare] = materialLooks({
		shaders: [shader('HGRP/DecalLit')],
		entries: [
			material({
				id: 0,
				keywords: ['_COMPLETE_PBR', '_NORMAL_ANGLE_BLEND'],
				slots: { _BaseColorMap: slot(1), _SampleTex1: slot(2) },
				floats,
				...placement,
			}),
			material({
				id: 1,
				slots: { _BaseColorMap: slot(1), _SampleTex1: slot(2) },
				floats: { ...floats, _ColorMask3: 0 },
				...placement,
			}),
			material({ id: 2, slots: { _BaseColorMap: slot(1) }, floats }),
			material({
				id: 3,
				keywords: ['_BLEND_WATER_FLOW'],
				slots: { _BaseColorMap: slot(1), _WaterNormalTex: slot(3, [0.1, 0.2]) },
				floats: {
					...floats,
					_ColorMask2: 14,
					_ColorMask3: 0,
					_WaterNormalScale: 0.4,
					_WaterRoughness: 0.13,
					_NormalFactor: 0.01,
					_AngleBlendFallOff2: 0.1,
				},
				vectors: { ...placement.vectors, _UVMovement: [0.02, 0.05, 1, 1] },
				colors: placement.colors,
			}),
			material({
				id: 4,
				keywords: ['_BLEND_SLUDGE_EROSION'],
				slots: { _BaseColorMap: slot(1) },
				floats,
				...placement,
			}),
			// writes no albedo, and has no map to change the surface with
			material({
				id: 5,
				slots: { _BaseColorMap: slot(1) },
				floats: { ...floats, _ColorMask3: 0 },
				...placement,
			}),
		],
	});
	assert.equal(look.flags, LookFlags.Effect | LookFlags.EffectDecal);
	assert.equal(look.cull, 'front');
	assert.deepEqual(look.textures.slice(0, 2), [1, 2]);
	assert.deepEqual(
		[...look.params.subarray(EffectRow.uv, EffectRow.uv + 8)],
		[1, 0.5, 0, 0.25, 1, 0.5, 0, 0.25],
	);
	// the placement's colour as stored, its alpha times the opacity
	assert.deepEqual(
		[...look.params.subarray(EffectRow.tint, EffectRow.tint + 4)].map((v) => Math.round(v * 1000) / 1000),
		[0.3, 0.6, 0.25, 0.45],
	);
	assert.equal(look.params[DecalLitRow.surface + 3], 2);
	// roughness only: `_ColorMask2` 2 is blue
	assert.deepEqual([...look.params.subarray(DecalLitRow.writes, DecalLitRow.writes + 2)], [0, 1]);
	assert.equal(look.params[EffectRow.unfogged + 1], EffectKind.LitDecal);
	assert.equal(look.relight, false);
	// writing no albedo, it relights the surface beneath
	assert.equal(roughnessOnly.drawn, true);
	assert.equal(roughnessOnly.relight, true);
	// the water flow relights it with its world-projected normal map, its `_ST` scale per metre
	assert.equal(waterFlow.relight, true);
	assert.deepEqual(waterFlow.textures.slice(0, 2), [1, 3]);
	assert.deepEqual(
		[...waterFlow.params.subarray(EffectRow.uv + 4, EffectRow.uv + 6)].map(
			(v) => Math.round(v * 1000) / 1000,
		),
		[0.1, 0.2],
	);
	assert.deepEqual([...waterFlow.params.subarray(DecalLitRow.writes, DecalLitRow.writes + 2)], [1, 1]);
	assert.deepEqual(
		[...waterFlow.params.subarray(DecalLitRow.water, DecalLitRow.water + 4)].map(
			(v) => Math.round(v * 1000) / 1000,
		),
		[1, 0.4, 0.13, 0.01],
	);
	assert.deepEqual(
		[...waterFlow.params.subarray(DecalLitRow.flow, DecalLitRow.flow + 4)].map(
			(v) => Math.round(v * 1000) / 1000,
		),
		[0.02, 0.05, 1, 1],
	);
	// without a placement or with a variant the viewer lacks it's unsupported; with nothing to change it isn't
	// drawn
	assert.equal(unplaced.unsupported, true);
	assert.equal(sludge.unsupported, true);
	assert.equal(bare.drawn, false);
	assert.equal(bare.unsupported, false);
});

test('an emissive lit decal glows by its PBR map channel, and decal variants the viewer lacks show as unsupported', () => {
	// the real shader's family and defaults, and the opaque blend state the packer reads off decal materials
	const decalShader: ShaderEntry = {
		...shader('HGRP/DecalLit'),
		family: 'decal',
		floats: { _EmissiveChannel: 0, _AlbedoAffectEmissive: 1, _IgnorePostExposure: 1 },
		colors: { _EmissiveColor: [1, 1, 1, 1] },
	};
	const placed = {
		renderQueue: 2000,
		blend: 'opaque' as const,
		slots: { _BaseColorMap: slot(1), _SampleTex1: slot(2) },
		colors: { [DECAL_COLOR_PROPERTY]: [0.23, 0.3, 0.69, 0.88] as [number, number, number, number] },
		vectors: { [DECAL_UV_PROPERTY]: [1, 1, 1, 1] as [number, number, number, number] },
	};
	// Deep Dale Street's purple glow decals (dung02_rdg008)
	const [emissive, sludge] = materialLooks({
		shaders: [decalShader],
		entries: [
			material({
				id: 0,
				keywords: ['_BLEND_EMISSIVE', '_COMPLETE_PBR', '_NORMAL_ANGLE_BLEND'],
				floats: {
					_AffectNormal: 1,
					_AlbedoAffectEmissive: 0,
					_BlendEmissive: 1,
					_ColorMask2: 14,
					_ColorMask3: 14,
					_EmissiveChannel: 3,
					_RoughnessMin: 0.656,
				},
				...placed,
			}),
			material({ id: 1, keywords: ['_BLEND_SLUDGE_EROSION'], floats: { _ColorMask3: 14 }, ...placed }),
		],
	});
	assert.equal(emissive.unsupported, false);
	assert.equal(emissive.transparent, true);
	assert.equal(emissive.relight, false);
	assert.deepEqual(
		[...emissive.params.subarray(DecalLitRow.emissive, DecalLitRow.emissive + 4)],
		[1, 1, 1, 1],
	);
	// `_SampleTex1`'s alpha, times the albedo, ignoring the post exposure
	assert.deepEqual(
		[...emissive.params.subarray(DecalLitRow.emissiveMask, DecalLitRow.emissiveMask + 3)],
		[3, 0, 1],
	);
	// an undrawn variant must not fall through to the opaque path, which draws its projection box as a solid
	assert.equal(sludge.unsupported, true);
});

test('a VFXBaseV2 sample texture takes its role from its weights and the _ST of that role', () => {
	const [look] = materialLooks({
		shaders: [shader('HGRP/Effect/VFXBaseV2')],
		entries: [
			material({
				keywords: ['_SAMPLE_TEX0', '_SAMPLE_TEX1', '_USE_SOFTBLEND'],
				slots: {
					_MainTex: slot(1),
					_SampleTex0: slot(2),
					_DisturbTex1: slot(2, [3, 0.5]),
					_SampleTex1: slot(4),
					_BlendTex: slot(4, [0.3, 2]),
				},
				floats: { _SampleTex0UseWeight0: 1, _SampleTex1UseWeight4: 1, _SoftDistance: 4 },
				vectors: { _SampleTex1UVRotateMat: [0, 1, -1, 0], _SampleTex1UVSpeed: [0, -0.1, 0, 0] },
			}),
		],
	});
	assert.equal(look.flags, LookFlags.Effect);
	assert.equal(look.cull, 'back');
	assert.deepEqual(look.textures.slice(0, 3), [1, 2, 4]);
	assert.deepEqual(
		[...look.params.subarray(EffectRow.uv + 4, EffectRow.uv + 12)],
		[3, 0.5, 0, 0, 0.30000001192092896, 2, 0, 0],
	);
	assert.deepEqual(
		[...look.params.subarray(EffectRow.anim + 8, EffectRow.anim + 12)],
		[0, -0.10000000149011612, 0, 1],
	);
	assert.deepEqual(
		[...look.params.subarray(EffectRow.slotBits, EffectRow.slotBits + 3)],
		[EffectRole.Main, EffectRole.Disturb1, EffectRole.Blend],
	);
	assert.equal(look.params[EffectRow.soft], 4);
});

test('effects with features the viewer lacks, or additive blending, show as unsupported', () => {
	const looks = materialLooks({
		shaders: [shader('HGRP/Effect/VFXBaseV2')],
		entries: [
			material({
				id: 0,
				keywords: ['_USE_VERTOFFSET'],
				slots: { _MainTex: slot(1) },
				floats: { _InParticle: 0 },
			}),
			material({ id: 1, blend: 'additive', slots: { _MainTex: slot(1) } }),
			material({ id: 2, slots: {} }),
			material({
				id: 3,
				keywords: ['_USE_BRIGHT'],
				slots: { _MainTex: slot(1) },
				floats: { _BrightType: 1 },
			}),
			material({
				id: 4,
				keywords: ['_USE_BRIGHT'],
				slots: { _MainTex: slot(1) },
				vectors: { _BrightCenter: [10, 0, 5, 1] },
			}),
		],
	});
	assert.deepEqual(
		looks.map((look) => look.unsupported),
		[true, true, true, true, true],
	);
});

test('effects without _USE_FOG are marked to stay out of the fog', () => {
	const looks = materialLooks({
		shaders: [shader('HGRP/Effect/VFXBaseV2'), shader('HGRP/Effect/VFXDecal')],
		entries: [
			material({ id: 0, shader: 0, slots: { _MainTex: slot(1) } }),
			material({ id: 1, shader: 0, keywords: ['_USE_FOG'], slots: { _MainTex: slot(1) } }),
			material({ id: 2, shader: 1, slots: { _MainTex: slot(1) } }),
			material({ id: 3, shader: 1, keywords: ['_USE_FOG'], slots: { _MainTex: slot(1) } }),
		],
	});
	assert.deepEqual(
		looks.map((look) => look.params[EffectRow.unfogged]),
		[1, 0, 1, 0],
	);
});

test('effect slots start from polar UVs where the material computes them, and from zero where it does not', () => {
	const looks = materialLooks({
		shaders: [shader('HGRP/Effect/VFXBaseV2'), shader('HGRP/Effect/VFXDecal')],
		entries: [
			material({
				id: 0,
				keywords: ['_SAMPLE_TEX0', '_USE_POLARUV', '_USE_SCREENUV'],
				slots: { _MainTex: slot(1), _SampleTex0: slot(2) },
				floats: { _UsePolarUV: 1, _SampleTex0UseWeight0: 1 },
				vectors: { _SampleTex0UVWeights: [0, 0, 1, 0], _MainTexUVWeights: [0, 0, 0, 1] },
			}),
			material({
				id: 1,
				shader: 1,
				keywords: ['_USE_MASK', '_USE_WEIGHT', '_USE_POLARUV'],
				slots: { _MainTex: slot(1), _MaskTex: slot(2), _WeightTex: slot(3) },
				floats: {
					_UsePolarUV: 1,
					_MaskSwitchUV: 2,
					_WeightSwitchUV: 1,
					_WeightTexIntensity: 0.5,
					_DissolveUseWeight: 1,
				},
			}),
		],
	});
	const bits = (look: (typeof looks)[number], index: number) => look.params[EffectRow.slotBits + index];
	// screen UVs without `_UseScreenUV` aren't computed
	assert.equal(bits(looks[0], 0), EffectRole.Main + SLOT_NO_BASE);
	assert.equal(bits(looks[0], 1), EffectRole.Disturb1 + SlotSource.Polar * 32);
	// the decal's mask reads polar UVs; its weight's screen switch falls back to the box
	assert.equal(bits(looks[1], 4), EffectRole.Mask + SlotSource.Polar * 32);
	assert.equal(bits(looks[1], 3), EffectRole.Weight);
	assert.deepEqual([...looks[1].params.subarray(EffectRow.weight + 1, EffectRow.weight + 4)], [0.5, 0.5, 1]);
});

test('a VFXBaseV2 sixth sample texture takes the vertex offset slot and the first sample texture speed', () => {
	const [look] = materialLooks({
		shaders: [shader('HGRP/Effect/VFXBaseV2')],
		entries: [
			material({
				keywords: ['_SAMPLE_TEX5'],
				slots: { _MainTex: slot(1), _SampleTex5: slot(2), _DissolveTex: slot(3, [2, 3]) },
				floats: { _SampleTex5UseWeight5: 1 },
				vectors: { _SampleTex0UVSpeed: [0, -1, 0, 0], _SampleTex5UVSpeed: [5, 5, 0, 0] },
			}),
		],
	});
	assert.equal(look.textures[OFFSET_SLOT], 2);
	assert.equal(look.params[EffectRow.slotBits + OFFSET_SLOT], EffectRole.Dissolve);
	assert.deepEqual(
		[...look.params.subarray(EffectRow.uv + OFFSET_SLOT * 4, EffectRow.uv + OFFSET_SLOT * 4 + 2)],
		[2, 3],
	);
	assert.deepEqual(
		[...look.params.subarray(EffectRow.anim + OFFSET_SLOT * 4, EffectRow.anim + OFFSET_SLOT * 4 + 2)],
		[0, -1],
	);
});

test('a VFXBaseV2 adds its light under _BlendMode 1, the shader default, and multiplies the scene under 2', () => {
	const additive = { ...shader('HGRP/Effect/VFXBaseV2'), floats: { _BlendMode: 1 } };
	// the flash under the rift's ripples (`M_fxmap_dung02_dg005_boss_semicircle_ripple_01_1109`): `Blend DstColor Zero`
	const multiply: Pick<ReadyMaterial, 'blend' | 'blendFactors'> = { blend: 'custom', blendFactors: [2, 0] };
	const looks = materialLooks({
		shaders: [additive],
		entries: [
			material({ id: 0, slots: { _MainTex: slot(1) } }),
			material({ id: 1, slots: { _MainTex: slot(1) }, floats: { _BlendMode: 0 } }),
			material({ id: 2, slots: { _MainTex: slot(1) }, floats: { _BlendMode: 2 } }),
			material({ id: 3, ...multiply, slots: { _MainTex: slot(1) }, floats: { _BlendMode: 2 } }),
			material({ id: 4, ...multiply, slots: { _MainTex: slot(1) }, floats: { _BlendMode: 0 } }),
		],
	});
	assert.equal(looks[0].params[EffectRow.unfogged + 2], 1);
	assert.equal(looks[0].screen, null);
	assert.equal(looks[1].params[EffectRow.unfogged + 2], 0);
	// a multiplying layer needs the multiplying blend state, and the reverse
	assert.equal(looks[2].unsupported, true);
	assert.equal(looks[3].screen, 'multiply');
	assert.equal(looks[3].params[EffectRow.unfogged + 2], 2);
	assert.equal(looks[4].unsupported, true);
});

test('an unlit VFXDitherAlpha with a dissolve, distortion and polar UVs draws its texture stack, fogged', () => {
	// the rift's ripple walls (`M_fxmap_dung02_dg005_boss_semicircle_ripple_01_1102_01`)
	const dither: ShaderEntry = {
		...shader('HGRP/Effect/VFXDitherAlpha'),
		family: 'vfxDitherAlpha',
		floats: { _MainTexUseDisturb: 1, _DissolveTexUseDisturb: 1, _UseMainTexAsAlpha: 1, _InParticle: 1 },
		textures: { _MainTex: 'white', _DisturbTex1: 'white', _DissolveTex: 'white' },
	};
	const [ripple, solid, lit] = materialLooks({
		shaders: [dither],
		entries: [
			material({
				id: 0,
				blend: 'alphaTest',
				blendFactors: null,
				cull: 'front',
				keywords: ['_USE_DISSOLVE', '_USE_DISTURB', '_USE_POLARUV', '_USE_SCREENUV'],
				slots: { _MainTex: slot(1, [2, 1]), _DisturbTex1: slot(2, [0.5, 10]), _DissolveTex: slot(3, [2, 5]) },
				floats: {
					_DisturbUIntensity1: 0.15,
					_DisturbVIntensity1: 0.15,
					_UsePolarUV: 1,
					_UseNearCameraFade: 1,
					_NearCameraFadeDistanceStart2: 1000,
					_NearCameraFadeDistanceEnd2: 500,
				},
				colors: { _TintColor: [0.5, 0.5, 1, 1] },
				vectors: { _DisturbUVSpeed1: [0, 0.05, 0, 0], _DissolveUVWeights: [0, 0, 1, 0] },
			}),
			material({ id: 1, blend: 'alphaTest', slots: { _MainTex: slot(1) } }),
			material({ id: 2, blend: 'alphaTest', keywords: ['_USE_DISSOLVE'], floats: { _UseLighting: 1 } }),
		],
	});
	assert.equal(ripple.flags, LookFlags.Effect);
	assert.equal(ripple.screen, null);
	assert.equal(ripple.cull, 'front');
	assert.deepEqual(ripple.textures, [1, 2, 3, -1, -1, -1, -1]);
	assert.deepEqual(
		[...ripple.params.subarray(EffectRow.slotBits, EffectRow.slotBits + 3)],
		[
			// the main texture's red is its alpha, and it takes all of the distortion
			EffectRole.Main + 16 + 1024 * 256,
			EffectRole.Disturb1,
			// the dissolve starts from polar UVs
			EffectRole.Dissolve + 1024 * 256 + SlotSource.Polar * 32,
		],
	);
	assert.equal(ripple.params[EffectRow.dissolve + 3], 1);
	assert.equal(ripple.params[EffectRow.misc + 3], 1);
	assert.equal(ripple.params[EffectRow.anim + 4 + 1], Math.fround(0.05));
	// a G-buffer surface, so fogged
	assert.equal(ripple.params[EffectRow.unfogged], 0);
	assert.deepEqual([...ripple.params.subarray(EffectRow.near + 2, EffectRow.near + 4)], [1000, 500]);
	// without those keywords it stays on the opaque path; lit ones aren't drawn this way
	assert.equal((solid.flags & LookFlags.Effect) !== 0, false);
	assert.equal(lit.unsupported, true);
});

test('a VFXDitherAlpha mask scales only the tested alpha, by its red, and is drawn only in that mode', () => {
	// the rift's outer ring (`M_fxmap_map_lv008_boss_semicircle_01_fj_08`)
	const dither: ShaderEntry = {
		...shader('HGRP/Effect/VFXDitherAlpha'),
		family: 'vfxDitherAlpha',
		floats: { _UseMaskTexAsAlpha: 1, _MaskTexUseDisturb: 1, _UseMainTexAsAlpha: 1 },
		textures: { _MainTex: 'white', _MaskTex: 'white' },
	};
	const ring = {
		blend: 'alphaTest',
		blendFactors: null,
		keywords: ['_USE_MASK'],
		slots: { _MainTex: slot(1), _MaskTex: { ...slot(1), offset: [1, 0] } },
		floats: { _MaskTexUseDisturb: 0, _TintColorAlpha: 0.5 },
		colors: { _TintColor: [0.35, 0.32, 1, 1] },
	} satisfies Partial<ReadyMaterial>;
	const [masked, tinting] = materialLooks({
		shaders: [dither],
		entries: [
			material({ id: 0, ...ring }),
			material({ id: 1, ...ring, floats: { ...ring.floats, _UseMaskTexAsAlpha: 0 } }),
		],
	});
	assert.equal(masked.flags, LookFlags.Effect);
	assert.deepEqual(masked.textures, [1, -1, -1, 1, -1, -1, -1]);
	assert.equal(masked.params[EffectRow.slotBits + 3], EffectRole.Mask + 16);
	assert.deepEqual([...masked.params.subarray(EffectRow.uv + 12, EffectRow.uv + 16)], [1, 1, 1, 0]);
	assert.equal(masked.params[EffectRow.dissolveColor + 3], 1);
	assert.equal(masked.params[EffectRow.tint + 3], 0.5);
	// the stack's mask would tint by the mask's colour, which the game's colour pass doesn't
	assert.equal(tinting.unsupported, true);
});

test('a VFXDitherAlpha stack look raises its alpha to `_DitherAlphaExp`; other stack looks keep it', () => {
	// the rift's red sky ring (`M_fxmap_dung02_dg005_boss_semicircle_sky_02_fj_03`)
	const dither: ShaderEntry = {
		...shader('HGRP/Effect/VFXDitherAlpha'),
		family: 'vfxDitherAlpha',
		floats: { _UseMaskTexAsAlpha: 1, _UseMainTexAsAlpha: 1, _DitherAlphaExp: 1 },
		textures: { _MainTex: 'white', _DisturbTex1: 'white', _DissolveTex: 'white', _MaskTex: 'white' },
	};
	const [ring, base] = materialLooks({
		shaders: [dither, shader('HGRP/Effect/VFXBaseV2')],
		entries: [
			material({
				id: 0,
				blend: 'alphaTest',
				blendFactors: null,
				keywords: ['_USE_DISSOLVE', '_USE_DISTURB', '_USE_MASK', '_USE_POLARUV', '_USE_SCREENUV'],
				slots: { _MainTex: slot(1), _DisturbTex1: slot(2), _DissolveTex: slot(3) },
				floats: { _UsePolarUV: 1, _DitherAlphaExp: 3 },
			}),
			material({ id: 1, shader: 1, slots: { _MainTex: slot(1) } }),
		],
	});
	assert.equal(ring.flags, LookFlags.Effect);
	// no mask texture: the shader's default white
	assert.deepEqual(ring.textures, [1, 2, 3, -1, -1, -1, -1]);
	assert.equal(ring.params[EffectRow.decal + 3], 3);
	assert.equal(base.params[EffectRow.decal + 3], 1);
});

test('a VFXDitherAlpha stack look moves its vertices by its offset texture outside particle mode', () => {
	// the rift's escaping trails (`M_fxmap_dung02_dg005_boss_semicircle_escapism_trail_01_1101`)
	const dither: ShaderEntry = {
		...shader('HGRP/Effect/VFXDitherAlpha'),
		family: 'vfxDitherAlpha',
		floats: { _UseMainTexAsAlpha: 1, _InParticle: 1 },
		textures: { _MainTex: 'white', _DisturbTex1: 'white', _DissolveTex: 'white', _OffsetTex: 'white' },
	};
	const trail = {
		blend: 'alphaTest',
		blendFactors: null,
		keywords: ['_USE_DISSOLVE', '_USE_DISTURB', '_USE_VERTOFFSET'],
		slots: { _MainTex: slot(1, [2.5, 1]), _DisturbTex1: slot(2), _DissolveTex: slot(3), _OffsetTex: slot(4) },
		floats: {
			_InParticle: 0,
			_OffsetIntensity: -0.5,
			_OffsetSwitchDir: 2,
			// VFXBaseV2's own; the dither shader doesn't read them
			_UseVertexColorAlphaAsVertOffsetWeight: 1,
			_VertCameraOffset: 3,
		},
		vectors: { _OffsetSpeed: [0.005, -0.05, 0, 0] },
	} satisfies Partial<ReadyMaterial>;
	const [moved, particle, alone] = materialLooks({
		shaders: [dither],
		entries: [
			material({ id: 0, ...trail }),
			material({ id: 1, ...trail, floats: { ...trail.floats, _InParticle: 1 } }),
			material({ id: 2, ...trail, keywords: ['_USE_VERTOFFSET'] }),
		],
	});
	assert.equal(moved.flags, LookFlags.Effect);
	assert.deepEqual(moved.textures, [1, 2, 3, -1, -1, -1, 4]);
	assert.equal(moved.params[EffectRow.slotBits + OFFSET_SLOT], ROLE_NONE);
	assert.deepEqual(
		Array.from(
			moved.params.subarray(EffectRow.anim + OFFSET_SLOT * 4, EffectRow.anim + OFFSET_SLOT * 4 + 2),
			(v) => Number(v.toFixed(4)),
		),
		[0.005, -0.05],
	);
	assert.deepEqual([...moved.params.subarray(EffectRow.offsetDir, EffectRow.offsetDir + 4)], [0, 0, 0, 2]);
	assert.deepEqual([...moved.params.subarray(EffectRow.offset, EffectRow.offset + 4)], [-0.5, 0, 0, 0]);
	assert.deepEqual([...moved.params.subarray(EffectRow.offsetMode, EffectRow.offsetMode + 2)], [1, 0]);
	// particle mode cancels the offset, so the look draws without it
	assert.equal(particle.flags, LookFlags.Effect);
	assert.equal(particle.params[EffectRow.offsetMode], 0);
	// a vertex offset alone doesn't move a material onto the stack
	assert.equal((alone.flags & LookFlags.Effect) !== 0, false);
});

test('a VFXRefract samples the scene behind at an offset by its texture and is masked by its mask red', () => {
	// the rift's ground ripple (`M_fxmap_dung02_dg005_boss_semicircle_ripple_01_ground_1101`)
	const refract: ShaderEntry = {
		...shader('HGRP/Effect/VFXRefract'),
		family: 'vfxRefract',
		floats: { _RefractIsNormal: 1, _UseMaskTexAsAlpha: 1, _Intensity: 1 },
		vectors: { _RefractDir: [1, 1, 0, 0] },
	};
	const [ground, dissolve] = materialLooks({
		shaders: [refract],
		entries: [
			material({
				id: 0,
				blend: 'alphaBlend',
				blendFactors: [5, 10],
				cull: 'none',
				keywords: ['_USE_MASK', '_USE_POLARUV'],
				slots: { _MaskTex: slot(1, [3, 1]), _RefractTex: slot(2, [2, 1]) },
				floats: { _Intensity: 0.5, _TintColorAlpha: 2, _RefractIsNormal: 0, _MaskTexUVRotate: 180 },
				vectors: { _RefractUVSpeed: [0, 0.1, 0, 1] },
			}),
			material({ id: 1, blend: 'alphaBlend', keywords: ['_USE_DISSOLVE'], slots: { _RefractTex: slot(2) } }),
		],
	});
	assert.equal(ground.screen, 'refract');
	assert.equal(ground.transparent, true);
	assert.deepEqual(ground.textures, [2, 1, -1, -1, -1, -1, -1]);
	// the switches pick UV0
	assert.deepEqual(
		[...ground.params.subarray(EffectRow.slotBits, EffectRow.slotBits + 2)],
		[SlotSource.Uv0 * 32, SlotSource.Uv0 * 32 + 16],
	);
	assert.deepEqual([...ground.params.subarray(RefractRow.refract, RefractRow.refract + 4)], [1, 1, 1, 0]);
	assert.deepEqual([...ground.params.subarray(RefractRow.refract2, RefractRow.refract2 + 4)], [0, 0, 1, 0]);
	assert.equal(ground.params[EffectRow.anim + 1], 0.10000000149011612);
	// half a turn: cos −1
	assert.equal(ground.params[EffectRow.anim + 4 + 2], -1);
	assert.equal(ground.params[EffectRow.unfogged + 1], EffectKind.Refract);
	assert.equal(dissolve.unsupported, true);
	// no soft blend or colour offsets
	assert.equal(ground.params[EffectRow.soft], 0);
	assert.equal(ground.params[RefractRow.rbMain + 3], 0);
});

test('a VFXRefract splits colours along its offset and fades in front of the scene', () => {
	// the Deep Dale Street fog walls' heat haze (`M_fxmap_map02_lv008_fogwall_01_09`)
	const refract: ShaderEntry = {
		...shader('HGRP/Effect/VFXRefract'),
		family: 'vfxRefract',
		floats: { _RefractIsNormal: 1, _UseMaskTexAsAlpha: 1, _Intensity: 1, _RBIntensity: 1, _GOffset: -1 },
		colors: {
			_RBMainColorMask: [1, 0, 0, 1],
			_RBOffsetColorMask: [0, 1, 1, 1],
			_RBOffset1ColorMask: [0, 1, 0, 1],
			_RBOffset2ColorMask: [0, 0, 1, 1],
		},
		vectors: { _RefractDir: [1, 1, 0, 0], _RBOffset: [0, 0, 0, 0] },
	};
	const keywords = ['_USE_MASK', '_USE_RBOFFSET', '_USE_RGBOFFSET', '_USE_SOFTBLEND'];
	const [haze, twoSamples] = materialLooks({
		shaders: [refract],
		entries: [0, 1].map((id) =>
			material({
				id,
				blend: 'alphaBlend',
				blendFactors: [5, 10],
				cull: 'none',
				keywords: id === 0 ? keywords : ['_USE_RBOFFSET'],
				slots: { _MaskTex: slot(1), _RefractTex: slot(2) },
				floats: { _GOffset: -0.89, _Intensity: 0.109, _TintColorAlpha: 0.39, _SoftDistance: 2.42 },
				vectors: { _RBOffset: [0, 9.31, 0, 0] },
			}),
		),
	});
	assert.equal(haze.unsupported, false);
	assert.equal(haze.screen, 'refract');
	const rb = [...haze.params.subarray(RefractRow.rb, RefractRow.rb + 4)];
	assert.equal(rb[0], 0);
	assert.ok(Math.abs(rb[1] - 9.31 * 0.01 * 0.109) < 1e-6);
	assert.ok(Math.abs(rb[2] + 0.89) < 1e-6);
	assert.equal(rb[3], 1);
	assert.deepEqual([...haze.params.subarray(RefractRow.rbMain, RefractRow.rbMain + 4)], [1, 0, 0, 1]);
	assert.deepEqual([...haze.params.subarray(RefractRow.rbFirst, RefractRow.rbFirst + 4)], [0, 1, 0, 0]);
	assert.deepEqual([...haze.params.subarray(RefractRow.rbSecond, RefractRow.rbSecond + 4)], [0, 0, 1, 1]);
	assert.ok(Math.abs(haze.params[EffectRow.soft] - 2.42) < 1e-6);
	// one further sample: its own mask, no second
	assert.deepEqual([...twoSamples.params.subarray(RefractRow.rbFirst, RefractRow.rbFirst + 3)], [0, 1, 1]);
	assert.equal(twoSamples.params[RefractRow.rbSecond + 3], 0);
	assert.equal(twoSamples.params[EffectRow.soft], 0);
});

test('a VFXBaseV2 without a main texture draws with its shader default only when that is white', () => {
	const looks = materialLooks({
		shaders: [
			{ ...shader('HGRP/Effect/VFXBaseV2'), textures: { _MainTex: 'white' } },
			{ ...shader('HGRP/Effect/VFXBaseV2'), textures: { _MainTex: 'black' } },
		],
		entries: [
			material({
				id: 0,
				shader: 0,
				keywords: ['_SAMPLE_TEX0'],
				slots: { _SampleTex0: slot(2) },
				floats: { _SampleTex0UseWeight3: 1 },
			}),
			material({ id: 1, shader: 1 }),
		],
	});
	assert.deepEqual(
		looks.map((look) => look.unsupported),
		[false, true],
	);
	// slot 0 binds white; the mask still applies
	assert.deepEqual(looks[0].textures.slice(0, 2), [-1, 2]);
});

test('a VFXBaseV2 sample texture switched on without a texture samples its shader default', () => {
	// the white talosite's shards (`M_fx_l_map02_lv008_starcollection_08`): a mask switched on with no mask
	// texture bound, whose white default keeps them; a black default leaves the slot unsampled
	const looks = materialLooks({
		shaders: [
			{ ...shader('HGRP/Effect/VFXBaseV2'), textures: { _MainTex: 'white', _SampleTex0: 'white' } },
			{ ...shader('HGRP/Effect/VFXBaseV2'), textures: { _MainTex: 'white', _SampleTex0: 'black' } },
		],
		entries: [0, 1].map((id) =>
			material({
				id,
				shader: id,
				keywords: ['_SAMPLE_TEX0'],
				slots: { _MainTex: slot(1) },
				floats: { _SampleTex0UseWeight3: 1, _UseSampleTex0AsAlpha: 1, _UseMask: 1 },
			}),
		),
	});
	assert.deepEqual(
		looks.map((look) => look.params[EffectRow.slotBits + 1]),
		[EffectRole.Mask + 16, ROLE_NONE],
	);
	assert.deepEqual(looks[0].textures.slice(0, 2), [1, -1]);
});

test('a VFXBaseV2 draws when its vertex offset is cancelled by particle mode and its glow follows the player', () => {
	const [look] = materialLooks({
		shaders: [shader('HGRP/Effect/VFXBaseV2')],
		entries: [
			material({
				keywords: ['_USE_BRIGHT', '_USE_VERTOFFSET'],
				slots: { _MainTex: slot(1) },
				floats: { _InParticle: 1, _OffsetIntensity: 0.5 },
				colors: { _BrightColor: [0, 2.6, 2.2, 0] },
			}),
		],
	});
	assert.equal(look.drawn, true);
	assert.equal(look.flags, LookFlags.Effect);
	assert.equal(look.params[EffectRow.offsetMode], 0);
});

test('a VFXBaseV2 vertex offset outside particle mode samples its texture in the offset slot', () => {
	const [look] = materialLooks({
		shaders: [shader('HGRP/Effect/VFXBaseV2')],
		entries: [
			material({
				keywords: ['_USE_VERTOFFSET'],
				slots: { _MainTex: slot(1), _OffsetTex: slot(2, [1, 0.5]) },
				floats: { _InParticle: 0, _OffsetIntensity: 0.5, _OffsetSwitchDir: 1, _OffsetUVSet: 1 },
				vectors: { _OffsetDir: [0, 1, 0, 0], _OffsetSpeed: [0, 0.2, 0, 0] },
			}),
		],
	});
	assert.equal(look.drawn, true);
	assert.equal(look.textures[OFFSET_SLOT], 2);
	// the fragment stage skips the slot
	assert.equal(look.params[EffectRow.slotBits + OFFSET_SLOT], ROLE_NONE);
	assert.deepEqual(
		[...look.params.subarray(EffectRow.uv + OFFSET_SLOT * 4, EffectRow.uv + OFFSET_SLOT * 4 + 4)],
		[1, 0.5, 0, 0],
	);
	assert.deepEqual(
		Array.from(
			look.params.subarray(EffectRow.anim + OFFSET_SLOT * 4, EffectRow.anim + OFFSET_SLOT * 4 + 2),
			(v) => Number(v.toFixed(4)),
		),
		[0, 0.2],
	);
	assert.deepEqual([...look.params.subarray(EffectRow.offsetDir, EffectRow.offsetDir + 4)], [0, 1, 0, 1]);
	assert.equal(look.params[EffectRow.offset], 0.5);
	assert.deepEqual([...look.params.subarray(EffectRow.offsetMode, EffectRow.offsetMode + 2)], [1, 1]);
});

test('mist: additive FogSimple cards and walk-in fog boxes draw; equal fade ends become a step', () => {
	const looks = materialLooks({
		shaders: [shader('HGRP/FogSimple'), shader('HGRP/Effect/VFXFakeVolumeFog')],
		entries: [
			material({
				id: 0,
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
			material({
				id: 1,
				shader: 1,
				blend: 'additive',
				keywords: ['_USE_NOISE3D'],
				slots: { _NoiseTex3D: slot(3) },
				floats: { _canWalkIn: 1, _NearFadeDistance: 5, _FogDensity: 4 },
			}),
			material({
				id: 2,
				keywords: ['_USE_SOMETHING_ELSE'],
				slots: { _MainTex: slot(1), _NoiseTex: slot(2) },
			}),
		],
	});
	const [card, box] = looks;
	assert.equal(card.flags, LookFlags.Effect | LookFlags.EffectMist);
	assert.deepEqual(card.textures.slice(0, 2), [1, 2]);
	assert.equal(card.params[MistRow.card], 2);
	// both colours are [HDR], authored linear: as stored, not gamma-decoded
	assert.deepEqual(
		Array.from(card.params.subarray(MistRow.color, MistRow.color + 4), (v) => Number(v.toFixed(2))),
		[16.07, 19.84, 29.89, 1],
	);
	assert.deepEqual([...card.params.subarray(MistRow.indirect, MistRow.indirect + 4)], [0.5, 0.25, 2, 1]);
	assert.deepEqual(
		Array.from(card.params.subarray(MistRow.fade, MistRow.fade + 4), (v) => Number(v.toFixed(4))),
		[0.001, 0.0011, 3000, 2500],
	);
	assert.equal(card.params[MistRow.top + 2], 12);
	assert.equal(box.flags, LookFlags.Effect | LookFlags.EffectMist | LookFlags.EffectDecal);
	assert.equal(box.cull, 'front');
	assert.equal(box.params[MistRow.volume + 1], 4);
	// walk-in boxes skip the close-up fade
	assert.equal(box.params[MistRow.volume + 3], 0);
	assert.equal(looks[2].unsupported, true);
});

test('a fog box with _USE_NOISE3D samples its 3D noise with the far intensity and scroll it sets', () => {
	const looks = materialLooks({
		shaders: [shader('HGRP/Effect/VFXFakeVolumeFog')],
		entries: [
			material({
				blend: 'additive',
				keywords: ['_USE_NOISE3D'],
				slots: { _NoiseTex3D: slot(3) },
				floats: { _NoiseIntensity: 0, _NoiseFarIntensity: -0.3, _NoiseFar: 2, _NoiseUVWSpeed1: 0.5 },
				vectors: { _NoiseTexTilling1: [0.02, 0.02, 0.02, 1], _NoiseUVWDir1: [1, 0, -1, 0] },
			}),
			material({ id: 1, blend: 'additive', slots: { _NoiseTex3D: slot(3) } }),
		],
	});
	const [noisy, plain] = looks;
	assert.equal(noisy.volumeTexture, 3);
	assert.deepEqual(
		Array.from(noisy.params.subarray(MistRow.volumeNoise, MistRow.volumeNoise + 4), (v) =>
			Number(v.toFixed(4)),
		),
		[0.02, 0.02, 0.02, 1],
	);
	assert.deepEqual(
		[...noisy.params.subarray(MistRow.volumeNoiseFlow, MistRow.volumeNoiseFlow + 3)],
		[0.5, 0, -0.5],
	);
	assert.deepEqual(
		Array.from(noisy.params.subarray(MistRow.volumeNoiseMix, MistRow.volumeNoiseMix + 4), (v) =>
			Number(v.toFixed(4)),
		),
		[0, -0.3, 0.05, 1],
	);
	// without the keyword the noise texture isn't sampled
	assert.equal(plain.volumeTexture, -1);
	assert.equal(plain.params[MistRow.volumeNoiseMix + 3], 0);
});

test('a VFXWater flipbook sheet lays out its frames, motion vectors and normals and keeps its own rows', () => {
	const looks = materialLooks({
		// without a main texture the sheet samples the shader's white default
		shaders: [{ ...shader('HGRP/Effect/VFXWater'), textures: { _MainTex: 'white' } }],
		entries: [
			material({
				keywords: [
					'_SUBSURFACE',
					'_USE_MASK',
					'_USE_SEQUENCE_FRAME',
					'_USE_SEQUENCE_FRAME_MV',
					'_USE_SEQUENCE_FRAME_NORMAL',
					'_USE_SOFTBLEND',
				],
				slots: {
					_MaskTex: slot(2, [2, 3]),
					_SequenceBaseColorMap: slot(5, [4, 4]),
					_SequenceMotionVectorMap: slot(6),
					_SequenceNormalMap: slot(7),
				},
				floats: {
					_TintColorAlpha: 2,
					_PlaybackSpeed: 40,
					_FrameNormalScale: 0.3,
					_SoftDistance: 3,
					_Roughness: 0.6,
				},
				colors: { _TintColor: [0.5, 0.25, 2, 1] },
				vectors: { _SequenceFrameSize: [8, 4, 0, 0] },
			}),
			material({ id: 1, keywords: ['VFX_WATER_REFRACT'] }),
		],
	});
	const [sheet, refract] = looks;
	assert.equal(sheet.drawn, true);
	assert.equal(sheet.flags, LookFlags.Effect);
	// main (white default), mask, flipbook colour and motion, normals in slot 6
	assert.deepEqual(sheet.textures, [-1, -1, 2, -1, 5, 6, 7]);
	// `_TintColor` is [HDR]: as stored, its alpha times `_TintColorAlpha`
	assert.deepEqual([...sheet.params.subarray(EffectRow.tint, EffectRow.tint + 4)], [0.5, 0.25, 2, 2]);
	// the flipbook's frames are sampled as they are, not through its `_ST`
	assert.deepEqual([...sheet.params.subarray(EffectRow.uv + 16, EffectRow.uv + 20)], [1, 1, 0, 0]);
	const flags = sheet.params[WaterSheetRow.flags];
	const expected =
		WaterSheetFlags.Mask |
		WaterSheetFlags.Sequence |
		WaterSheetFlags.SequenceMotion |
		WaterSheetFlags.SequenceNormal |
		WaterSheetFlags.MainAsAlpha |
		WaterSheetFlags.MaskAsAlpha |
		WaterSheetFlags.VertexColor;
	assert.equal(flags, expected);
	assert.deepEqual(
		[...sheet.params.subarray(WaterSheetRow.sequence, WaterSheetRow.sequence + 3)],
		[8, 4, 40],
	);
	assert.ok(Math.abs(sheet.params[WaterSheetRow.sequenceTint + 3] - 0.3) < 1e-6);
	assert.equal(sheet.params[EffectRow.unfogged + 1], EffectKind.WaterSheet);
	// the vertex offset stays off, since its switch shares the last rows
	assert.equal(sheet.params[EffectRow.offsetMode], 0);
	assert.equal(sheet.params[EffectRow.soft], 3);
	assert.equal(refract.unsupported, true);
});

const beamShader = (): ShaderEntry => ({
	...shader('Hidden/VLB_HGRP_SinglePass'),
	family: 'volumetricBeam',
	floats: { _BlendMode: 1, _BlendSrcFactor: 1, _BlendDstFactor: 1, _FresnelPow: 1 },
	colors: { _ColorFlat: [1, 1, 1, 1] },
	vectors: { _ConeParams0: [0, 0, 0, 0], _ConeParams1: [0, 0, 0, 0], _DistanceFallOff: [0, 0, 0, 0] },
});

// dung02_dg005's `VLB_5006340546849160366`, one of the Wuling rift's two great beams
const riftBeam = (overrides: Partial<ReadyMaterial> = {}): ReadyMaterial =>
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
	});

test('an additive light beam is a shadowless effect with its cone, falloff and colour in the beam rows', () => {
	const [look] = materialLooks({ shaders: [beamShader()], entries: [riftBeam()] });
	assert.equal(look.unsupported, false);
	assert.equal(look.transparent, true);
	assert.equal(look.castsShadows, false);
	assert.equal(look.cull, 'back');
	assert.notEqual(look.flags & LookFlags.Effect, 0);
	assert.equal(look.params[EffectRow.unfogged + 1], EffectKind.Beam);
	// additive
	assert.equal(look.params[EffectRow.unfogged + 2], 1);
	assert.equal(look.params[BeamRow.glare + 3], 1);
	assert.deepEqual([...look.params.subarray(BeamRow.falloff, BeamRow.falloff + 4)], [1, 3, 3, 0]);
	assert.ok(Math.abs(look.params[BeamRow.cone + 1] - 1.00087571) < 1e-6);
	assert.equal(look.params[BeamRow.clip + 1], 22);
	assert.deepEqual(
		[...look.params.subarray(BeamRow.alpha, BeamRow.alpha + 2)].map((x) => x.toFixed(2)),
		['0.15', '0.15'],
	);
	// `_ColorFlat` is an LDR colour: decoded to linear
	assert.ok(Math.abs(look.params[BeamRow.color] - 0.1708) < 1e-3);
	// equal second fade ends become a step at the start rather than a division by zero
	assert.ok(look.params[BeamRow.fade + 3] > look.params[BeamRow.fade + 2]);
});

test('a light beam without depth blending, or alpha-blended under fog, keeps its own settings', () => {
	const [plain, fogged] = materialLooks({
		shaders: [beamShader()],
		entries: [
			riftBeam({ keywords: ['VLB_NOISE_3D'] }),
			riftBeam({
				id: 1,
				keywords: ['VLB_DEPTH_BLEND', 'VLB_USE_FOG'],
				floats: { _BlendMode: 0, _BlendSrcFactor: 5, _BlendDstFactor: 10 },
			}),
		],
	});
	assert.equal(plain.params[BeamRow.clip + 1], 0);
	assert.equal(fogged.params[EffectRow.unfogged], 0);
	assert.equal(fogged.params[EffectRow.unfogged + 2], 0);
});

test('a light beam with blending the game pairs with neither mode is unsupported', () => {
	const [look] = materialLooks({
		shaders: [beamShader()],
		entries: [riftBeam({ floats: { _BlendMode: 1, _BlendSrcFactor: 5, _BlendDstFactor: 10 } })],
	});
	assert.equal(look.unsupported, true);
});
