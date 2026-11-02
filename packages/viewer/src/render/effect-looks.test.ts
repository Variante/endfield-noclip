import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ReadyMaterial } from '@endfield-noclip/package-format/materials';
import type {
	EffectSoftBody,
	EffectStackSurface,
	EffectTexture,
	LightBeamSurface,
	LitDecalSurface,
	MistCardSurface,
	MistVolumeSurface,
	RefractSurface,
	StackLayer,
	WaterSheetSurface,
} from '@endfield-noclip/package-format/surfaces';

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
	VertexMotion,
	WaterSheetFlags,
	WaterSheetRow,
} from './effect-looks.ts';
import { LookFlags, materialLooks } from './materials.ts';

/** a ready material drawing `surface` */
const described = (
	id: number,
	surface: ReadyMaterial['surface'],
	cull: ReadyMaterial['cull'] = 'back',
): ReadyMaterial => ({ id, status: 'ready', cull, surface });

const texture = (id: number, overrides: Partial<EffectTexture> = {}): EffectTexture => ({
	texture: id,
	scale: [1, 1],
	offset: [0, 0],
	scroll: [0, 0],
	rotation: [1, 0],
	...overrides,
});

const layer = (id: number, role: StackLayer['role'], overrides: Partial<StackLayer> = {}): StackLayer => ({
	...texture(id),
	role,
	redAlpha: false,
	source: 'uv0',
	disturbShare: 0,
	...overrides,
});

/** a VFXBaseV2 stack with a main texture and nothing optional */
const stack = (overrides: Partial<EffectStackSurface> = {}): EffectStackSurface => ({
	kind: 'effectStack',
	variant: 'base',
	layers: [layer(1, 'main'), null, null, null, null, null, null],
	tint: [1, 1, 1, 1],
	blendTint: [1, 1, 1, 0],
	disturb: [0, 0, 0, 0],
	disturbBias: 0,
	distorted: false,
	weight: { disturb: 0, dissolve: 0, used: false },
	dissolve: { on: false, threshold: -1.01, sharpness: 1, edgeWidth: 0, edgeColor: [0, 0, 0] },
	masked: false,
	fresnel: null,
	soft: null,
	ignorePostExposure: 1,
	vertexColor: true,
	near: { on: false, range: [0, 1, 1e5, 2e5] },
	brighten: { threshold: 1, intensity: 0 },
	decalFade: null,
	alphaPower: 1,
	offset: null,
	softBody: null,
	lighting: null,
	unfogged: true,
	blendMode: 0,
	screenUv: { byDepth: true, heightAsV: false },
	stencil: null,
	...overrides,
});

test('a texture stack packs each layer’s role, red alpha, source and distortion share into its slot bits', () => {
	const [look] = materialLooks({
		entries: [
			described(
				0,
				stack({
					layers: [
						layer(1, 'main', { source: null }),
						layer(2, 'disturb1', { source: 'polar', scale: [3, 0.5] }),
						null,
						null,
						layer(4, 'mask', { redAlpha: true, disturbShare: 0.25, scroll: [0, -0.1], rotation: [0, 1] }),
						null,
						null,
					],
					tint: [2, 0.5, 1, 0.4],
					soft: { distance: 4, bias: 0 },
				}),
			),
		],
	});
	assert.deepEqual(
		[look.transparent, look.castsShadows, look.cull, look.flags],
		[true, false, 'back', LookFlags.Effect],
	);
	assert.deepEqual(look.textures, [1, 2, -1, -1, 4, -1, -1]);
	assert.deepEqual(
		[...look.params.subarray(EffectRow.slotBits, EffectRow.slotBits + 5)],
		[
			EffectRole.Main + SLOT_NO_BASE,
			EffectRole.Disturb1 + SlotSource.Polar * 32,
			ROLE_NONE,
			ROLE_NONE,
			// a quarter of the distortion, in 1/1024ths above the low byte
			EffectRole.Mask + 16 + 256 * 256,
		],
	);
	assert.deepEqual([...look.params.subarray(EffectRow.uv + 4, EffectRow.uv + 8)], [3, 0.5, 0, 0]);
	assert.deepEqual(
		[...look.params.subarray(EffectRow.anim + 16, EffectRow.anim + 20)],
		[0, -0.1, 0, 1].map(Math.fround),
	);
	assert.deepEqual(
		[...look.params.subarray(EffectRow.tint, EffectRow.tint + 4)],
		[2, 0.5, 1, 0.4].map(Math.fround),
	);
	assert.equal(look.params[EffectRow.soft], 4);
	assert.deepEqual(
		[...look.params.subarray(EffectRow.unfogged, EffectRow.unfogged + 4)],
		[1, EffectKind.Stack, 0, 1],
	);
});

test('a stack decal is a box drawn by its back faces with its fades; a multiplying stack draws over the scene', () => {
	const [decal, multiply] = materialLooks({
		entries: [
			described(
				0,
				stack({
					variant: 'decal',
					decalFade: { edge: [0.1, 0.2], width: 0.3, height: 2, heightOffset: 0.5, angle: 5 },
					weight: { disturb: 0.5, dissolve: 0.5, used: true },
				}),
			),
			described(1, stack({ blendMode: 2 })),
		],
	});
	assert.deepEqual([decal.cull, decal.flags], ['front', LookFlags.Effect | LookFlags.EffectDecal]);
	assert.deepEqual(
		[...decal.params.subarray(EffectRow.decalFade, EffectRow.decalFade + 4)],
		[0.1, 0.2, 0.3, 2].map(Math.fround),
	);
	assert.deepEqual([...decal.params.subarray(EffectRow.decal, EffectRow.decal + 4)], [0.5, 5, 0, 1]);
	assert.deepEqual([...decal.params.subarray(EffectRow.weight + 1, EffectRow.weight + 4)], [0.5, 0.5, 1]);
	assert.equal(multiply.screen, 'multiply');
	assert.equal(multiply.params[EffectRow.unfogged + 2], 2);
});

test('a stack’s vertex offset takes the offset slot and rows, and its stencil is tested under reversed-Z', () => {
	const [moved, portal, mask] = materialLooks({
		entries: [
			described(
				0,
				stack({
					offset: {
						texture: texture(2, { scale: [1, 0.5], scroll: [0, 0.2] }),
						uv1: true,
						direction: [0, 1, 0],
						space: 1,
						intensity: 0.5,
						bias: 0,
						vertexAlphaWeight: 0,
						cameraPull: 0,
					},
					alphaPower: 3,
				}),
			),
			described(
				1,
				stack({
					stencil: {
						compare: 'equal',
						replace: false,
						reference: 3,
						readMask: 255,
						writeMask: 255,
						depthCompare: 'less-equal',
					},
				}),
			),
			described(2, {
				kind: 'stencilMask',
				stencil: {
					compare: 'always',
					replace: true,
					reference: 3,
					readMask: 255,
					writeMask: 255,
					depthCompare: 'less-equal',
				},
			}),
		],
	});
	assert.equal(moved.textures[OFFSET_SLOT], 2);
	// the fragment stage skips the slot
	assert.equal(moved.params[EffectRow.slotBits + OFFSET_SLOT], ROLE_NONE);
	assert.deepEqual(
		[...moved.params.subarray(EffectRow.uv + OFFSET_SLOT * 4, EffectRow.uv + OFFSET_SLOT * 4 + 4)],
		[1, 0.5, 0, 0],
	);
	assert.deepEqual([...moved.params.subarray(EffectRow.offsetDir, EffectRow.offsetDir + 4)], [0, 1, 0, 1]);
	assert.equal(moved.params[EffectRow.offset], 0.5);
	assert.deepEqual([...moved.params.subarray(EffectRow.offsetMode, EffectRow.offsetMode + 2)], [1, 1]);
	assert.equal(moved.params[EffectRow.decal + 3], 3);
	assert.deepEqual(
		[portal.stencil?.compare, portal.stencil?.depthCompare, portal.stencil?.maskOnly],
		['equal', 'greater-equal', false],
	);
	assert.deepEqual([mask.transparent, mask.castsShadows, mask.stencil?.maskOnly], [false, false, true]);
});

test('a soft body takes the offset slot for its position texture, with its playback and bounds in the offset rows', () => {
	// map01's Aurelyne blob (`M_erosionmud_core`): 100 frames played at 70 fps, five times over, from HDR offsets
	const body = {
		texture: 3,
		min: [0, 0, 0],
		range: [1, 1, 1],
		frameCount: 100,
		cycleRate: (70 / 99.99) * 5,
		cycleStart: 2,
		fixedFrame: null,
		uScale: 1,
		vScale: 1,
		cameraPull: 0,
	} satisfies EffectSoftBody;
	const [playing, still] = materialLooks({
		entries: [
			described(0, stack({ softBody: body })),
			described(1, stack({ softBody: { ...body, fixedFrame: 49 } })),
		],
	});
	assert.equal(playing.textures[OFFSET_SLOT], 3);
	assert.equal(playing.params[EffectRow.slotBits + OFFSET_SLOT], ROLE_NONE);
	assert.equal(playing.params[EffectRow.offsetMode], VertexMotion.SoftBody);
	assert.deepEqual(
		[...playing.params.subarray(EffectRow.offsetDir, EffectRow.offsetDir + 4)],
		[0, 0, 0, 100],
	);
	assert.deepEqual([...playing.params.subarray(EffectRow.offset, EffectRow.offset + 4)], [1, 1, 1, 0]);
	// the phase starts the cycle at `cycleStart`
	const anim = EffectRow.anim + OFFSET_SLOT * 4;
	assert.deepEqual(
		[...playing.params.subarray(anim, anim + 2)],
		[body.cycleRate, -2 * body.cycleRate].map(Math.fround),
	);
	// a fixed frame stands still in the middle of its row
	assert.deepEqual([...still.params.subarray(anim, anim + 2)], [0, Math.fround(0.495)]);
});

test('a lit decal draws its maps through the placement or the PBR map’s own transform, and relights without albedo', () => {
	const decal: LitDecalSurface = {
		kind: 'litDecal',
		base: 1,
		opacity: 0.5,
		pbr: { texture: 2, ownTransform: null },
		relight: false,
		roughness: [0.4, 1],
		normalScale: 1,
		angleFade: 2,
		writesNormal: false,
		writesRoughness: true,
		writesMetallic: false,
		writesOcclusion: false,
		blendSceneNormal: 0,
		metallic: 0,
		occlusionStrength: 1,
		pbrBase: false,
		metallicChannel: 0,
		occlusionChannel: 0,
		affectNormal: 0,
		waterFlow: null,
		emission: { color: [1, 1, 1], channel: 3, albedoAffect: 0, ignorePostExposure: 1 },
	};
	const [look, water] = materialLooks({
		entries: [
			described(0, decal),
			described(1, {
				...decal,
				relight: true,
				pbr: { texture: 3, ownTransform: [0.1, 0.2, 0, 0] },
				waterFlow: {
					normalScale: 0.4,
					roughness: 0.13,
					normalFactor: 0.01,
					movement: [0.02, 0.05, 1, 1],
					levelFade: 0.1,
				},
				emission: null,
			}),
		],
	});
	assert.deepEqual(
		[look.flags, look.cull, look.relight],
		[LookFlags.Effect | LookFlags.EffectDecal, 'front', false],
	);
	assert.deepEqual(look.textures.slice(0, 2), [1, 2]);
	// the placement's colour and UV transform are the row's: the look holds the opacity, and that the PBR map
	// takes the placement's transform
	assert.deepEqual([...look.params.subarray(EffectRow.tint, EffectRow.tint + 4)], [1, 1, 1, 0.5]);
	assert.equal(look.params[DecalLitRow.pbrPlaced], 1);
	assert.equal(look.params[DecalLitRow.surface + 3], 2);
	assert.deepEqual([...look.params.subarray(DecalLitRow.writes, DecalLitRow.writes + 2)], [0, 1]);
	assert.deepEqual([...look.params.subarray(DecalLitRow.emissive, DecalLitRow.emissive + 4)], [1, 1, 1, 1]);
	assert.deepEqual(
		[...look.params.subarray(DecalLitRow.emissiveMask, DecalLitRow.emissiveMask + 3)],
		[3, 0, 1],
	);
	assert.equal(look.params[EffectRow.unfogged + 1], EffectKind.LitDecal);
	assert.equal(water.relight, true);
	assert.equal(water.params[DecalLitRow.pbrPlaced], 0);
	assert.deepEqual(
		[...water.params.subarray(EffectRow.uv + 4, EffectRow.uv + 6)].map((v) => Math.round(v * 1000) / 1000),
		[0.1, 0.2],
	);
	assert.deepEqual(
		[...water.params.subarray(DecalLitRow.water, DecalLitRow.water + 4)].map(
			(v) => Math.round(v * 1000) / 1000,
		),
		[1, 0.4, 0.13, 0.01],
	);
});

test('a refraction draws over the composited scene, its mask red as alpha, with its colour offsets', () => {
	const refract: RefractSurface = {
		kind: 'refract',
		refraction: texture(2, { scroll: [0, 0.1] }),
		refractionPolar: false,
		mask: { texture: texture(1, { rotation: [-1, 0] }), polar: true, redAlpha: true },
		direction: [1, 1],
		strength: 1,
		bias: 0,
		isNormal: false,
		maskUsesRefraction: 0,
		colorOffsets: {
			offset: [0, 0.01],
			secondShare: -0.89,
			intensity: 1,
			main: [1, 0, 0],
			first: [0, 1, 0],
			mainAsMask: 0,
			second: null,
		},
		dissolve: { texture: texture(3), threshold: -0.2, sharpness: 2, affectsAlpha: 0.5 },
		softDistance: 2.42,
		near: { on: false, range: [0, 1, 1e5, 2e5] },
	};
	const [look] = materialLooks({ entries: [described(0, refract, 'none')] });
	assert.deepEqual([look.screen, look.transparent], ['refract', true]);
	assert.deepEqual(look.textures, [2, 1, 3, -1, -1, -1, -1]);
	assert.equal(look.params[EffectRow.slotBits + 2], SlotSource.Uv0 * 32);
	assert.deepEqual(
		[...look.params.subarray(RefractRow.dissolve, RefractRow.dissolve + 4)].map(
			(v) => Math.round(v * 100) / 100,
		),
		[-0.2, 2, 0.5, 1],
	);
	assert.deepEqual(
		[...look.params.subarray(EffectRow.slotBits, EffectRow.slotBits + 2)],
		[SlotSource.Uv0 * 32, SlotSource.Polar * 32 + 16],
	);
	assert.deepEqual([...look.params.subarray(RefractRow.refract, RefractRow.refract + 4)], [1, 1, 1, 0]);
	assert.deepEqual([...look.params.subarray(RefractRow.refract2, RefractRow.refract2 + 4)], [0, 0, 1, 0]);
	assert.equal(look.params[EffectRow.anim + 4 + 2], -1);
	assert.deepEqual([...look.params.subarray(RefractRow.rbMain, RefractRow.rbMain + 4)], [1, 0, 0, 1]);
	assert.deepEqual([...look.params.subarray(RefractRow.rbFirst, RefractRow.rbFirst + 4)], [0, 1, 0, 0]);
	assert.equal(look.params[RefractRow.rbSecond + 3], 0);
	assert.ok(Math.abs(look.params[EffectRow.soft] - 2.42) < 1e-6);
	assert.equal(look.params[EffectRow.unfogged + 1], EffectKind.Refract);
});

test('a water sheet lays out its frames, motion vectors and normals, and keeps its own rows', () => {
	const sheet: WaterSheetSurface = {
		kind: 'waterSheet',
		tint: [0.5, 0.25, 2, 2],
		textures: {
			main: null,
			disturb: null,
			mask: texture(2, { scale: [2, 3] }),
			dissolve: null,
			sequence: texture(5),
			sequenceMotion: texture(6),
			normals: { texture: texture(7), flipbook: true, scale: 0.3 },
		},
		disturbNormal: false,
		mainAsAlpha: true,
		maskAsAlpha: true,
		vertexOpacity: false,
		fresnelOpacity: false,
		vertexColor: true,
		blendMode: 0,
		useLighting: 1,
		randomUv: 0,
		disturbBias: 0,
		disturb: [0, 0],
		disturbUse: [0, 0, 0, 0],
		dissolve: { on: false, threshold: -1.01, sharpness: 1, edgeWidth: 0, edgeColor: [0, 0, 0] },
		sequence: {
			columns: 8,
			rows: 4,
			framesPerSecond: 40,
			randomStartByPosition: 0,
			motionStrength: 0,
			opacityScale: 1,
			opacityThreshold: 0,
			colorThreshold: 0,
			tint: [1, 1, 1],
		},
		roughness: 0.6,
		specular: 1,
		directSpecular: 1,
		fresnel: 0,
		subsurface: [1, 1, 1, 1],
		indirectSaturation: 1,
		soft: { distance: 3, bias: 0 },
		ignorePostExposure: 1,
		near: { on: false, range: [0, 1, 1e5, 2e5] },
	};
	const [look] = materialLooks({ entries: [described(0, sheet)] });
	assert.equal(look.flags, LookFlags.Effect);
	// main (white default), mask, flipbook colour and motion, normals in slot 6
	assert.deepEqual(look.textures, [-1, -1, 2, -1, 5, 6, 7]);
	assert.deepEqual([...look.params.subarray(EffectRow.tint, EffectRow.tint + 4)], [0.5, 0.25, 2, 2]);
	assert.equal(
		look.params[WaterSheetRow.flags],
		WaterSheetFlags.Mask |
			WaterSheetFlags.Sequence |
			WaterSheetFlags.SequenceMotion |
			WaterSheetFlags.SequenceNormal |
			WaterSheetFlags.MainAsAlpha |
			WaterSheetFlags.MaskAsAlpha |
			WaterSheetFlags.VertexColor,
	);
	assert.deepEqual([...look.params.subarray(WaterSheetRow.sequence, WaterSheetRow.sequence + 3)], [8, 4, 40]);
	assert.ok(Math.abs(look.params[WaterSheetRow.sequenceTint + 3] - 0.3) < 1e-6);
	assert.equal(look.params[EffectRow.unfogged + 1], EffectKind.WaterSheet);
	// the vertex offset stays off, since its switch shares the last rows
	assert.equal(look.params[EffectRow.offsetMode], 0);
	assert.equal(look.params[EffectRow.soft], 3);
});

test('mist: cards and boxes draw in the mist rows; boxes by their back faces, with their noise as the volume texture', () => {
	const card: MistCardSurface = {
		kind: 'mistCard',
		main: { texture: 1, uv: 0, scale: [1, 1], offset: [0, 0] },
		noise: { texture: 2, uv: 0, scale: [1, 1], offset: [0, 0] },
		color: [16.07, 19.84, 29.89, 1],
		baseAlphaIntensity: 2,
		noiseIntensity: 0,
		useWind: 0,
		wind: { noiseIntensity: 0, noiseContrast: 0, scale: [1, 1], speed: 0, direction: [1, 0] },
		lit: false,
		lightFactor: 0,
		indirectColor: [0.5, 0.25, 2],
		additive: true,
		distanceFade: [0.001, 0.0011],
		nearFade: [3000, 2500],
		topFade: { contrast: 1, offset: 0 },
		softDistance: 12,
	};
	const box: MistVolumeSurface = {
		kind: 'mistVolume',
		color: [1, 1, 1, 1],
		exponent: 1,
		density: 4,
		edgeFade: 1,
		nearFade: 0,
		height: { offset: 0, falloff: 0, verticalFalloff: [0, 0] },
		intensityFadeDistance: 1e5,
		intensityFadeFromCentre: 0,
		depth: [0, 0],
		ignorePostExposure: 1,
		noise: {
			texture: 3,
			tiling: [0.02, 0.02, 0.02],
			world: 1,
			flow: [0.5, 0, -0.5],
			nearIntensity: 0,
			farIntensity: -0.3,
			farPerMetre: 0.05,
		},
	};
	const [cardLook, boxLook, plainLook] = materialLooks({
		entries: [described(0, card), described(1, box), described(2, { ...box, noise: null })],
	});
	assert.equal(cardLook.flags, LookFlags.Effect | LookFlags.EffectMist);
	assert.deepEqual(cardLook.textures.slice(0, 2), [1, 2]);
	assert.equal(cardLook.params[MistRow.card], 2);
	assert.deepEqual(
		Array.from(cardLook.params.subarray(MistRow.color, MistRow.color + 4), (v) => Number(v.toFixed(2))),
		[16.07, 19.84, 29.89, 1],
	);
	assert.deepEqual([...cardLook.params.subarray(MistRow.indirect, MistRow.indirect + 4)], [0.5, 0.25, 2, 1]);
	assert.deepEqual(
		Array.from(cardLook.params.subarray(MistRow.fade, MistRow.fade + 4), (v) => Number(v.toFixed(4))),
		[0.001, 0.0011, 3000, 2500],
	);
	assert.equal(cardLook.params[MistRow.top + 2], 12);
	assert.equal(boxLook.flags, LookFlags.Effect | LookFlags.EffectMist | LookFlags.EffectDecal);
	assert.equal(boxLook.cull, 'front');
	assert.deepEqual([boxLook.params[MistRow.volume + 1], boxLook.params[MistRow.volume + 3]], [4, 0]);
	assert.equal(boxLook.volumeTexture, 3);
	assert.deepEqual(
		[...boxLook.params.subarray(MistRow.volumeNoiseFlow, MistRow.volumeNoiseFlow + 3)],
		[0.5, 0, -0.5],
	);
	assert.deepEqual(
		Array.from(boxLook.params.subarray(MistRow.volumeNoiseMix, MistRow.volumeNoiseMix + 4), (v) =>
			Number(v.toFixed(4)),
		),
		[0, -0.3, 0.05, 1],
	);
	assert.deepEqual([plainLook.volumeTexture, plainLook.params[MistRow.volumeNoiseMix + 3]], [-1, 0]);
});

test('a light beam is a shadowless effect with its cone, falloff and colour in the beam rows', () => {
	// dung02_dg005's `VLB_5006340546849160366`, one of the Wuling rift's two great beams
	const beam: LightBeamSurface = {
		kind: 'lightBeam',
		color: [0.1708, 0.3, 1, 1],
		cone: [1, 1.00087571, 0.99999994, 0.0002919],
		direction: [0, 0, 1, 0],
		falloff: [1, 3, 3, 0],
		alphaInside: 0.15,
		alphaOutside: 0.15,
		attenuationLerp: 1,
		fresnelPower: 2,
		glareFrontal: 0.5,
		glareBehind: 0.5,
		apexOffset: 0,
		additive: true,
		distanceFade: [256, 200],
		distanceFadeSecond: [0, 0.0001],
		cameraClipping: 0.5,
		depthBlend: 22,
		depthBlendCapOff: 0,
		useClippingPlane: 0,
		clippingPlane: [0, 1, 0, 0],
		tilt: [0, 0],
		clippingPlaneTransition: 1,
		unfogged: true,
	};
	const [look, fogged] = materialLooks({
		entries: [described(0, beam), described(1, { ...beam, additive: false, unfogged: false })],
	});
	assert.deepEqual(
		[look.unsupported, look.transparent, look.castsShadows, look.cull],
		[false, true, false, 'back'],
	);
	assert.notEqual(look.flags & LookFlags.Effect, 0);
	assert.equal(look.params[EffectRow.unfogged + 1], EffectKind.Beam);
	assert.deepEqual([look.params[EffectRow.unfogged + 2], look.params[BeamRow.glare + 3]], [1, 1]);
	assert.deepEqual([...look.params.subarray(BeamRow.falloff, BeamRow.falloff + 4)], [1, 3, 3, 0]);
	assert.ok(Math.abs(look.params[BeamRow.cone + 1] - 1.00087571) < 1e-6);
	assert.equal(look.params[BeamRow.clip + 1], 22);
	assert.deepEqual([fogged.params[EffectRow.unfogged], fogged.params[EffectRow.unfogged + 2]], [0, 0]);
});
