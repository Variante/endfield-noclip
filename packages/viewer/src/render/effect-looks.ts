/**
 * the draw parameters of the scene effects `effect.wgsl` draws in the transparent pass:
 * `HGRP/Effect/VFXBaseV2` surfaces and `HGRP/Effect/VFXDecal` boxes ({@link EffectRow}),
 * `HGRP/Effect/VFXWater` waterfall sheets ({@link WaterSheetRow}), and the mist, `HGRP/FogSimple` cards and
 * `HGRP/Effect/VFXFakeVolumeFog` boxes ({@link MistRow}). what each draws is in `docs/game-data/effects.md`.
 *
 * VFXBaseV2 and VFXDecal combine textures by role ({@link EffectRole}): VFXBaseV2 gives each `_SampleTexN`
 * its role by its `_SampleTexNUseWeightK` properties, VFXDecal has one fixed texture per role. materials
 * using keywords outside each shader's drawn set get no effect look, as do additive VFXBaseV2 and VFXDecal
 * materials; `materials.ts` shows them as unsupported.
 *
 * @module
 */

import {
	DECAL_COLOR_PROPERTY,
	DECAL_UV_PROPERTY,
	type ReadyMaterial,
	type ShaderEntry,
	type TextureSlot,
} from '@endfield-noclip/package-format/materials';

import { linearRgb } from './color.ts';

/** a look's {@link EffectRow.slotBits} role value for a texture that isn't sampled */
export const ROLE_NONE = 7;

/** the roles a texture plays, as `effect.wgsl` numbers them */
export const EffectRole = {
	Disturb1: 0,
	Disturb2: 1,
	Weight: 2,
	Mask: 3,
	Blend: 4,
	Dissolve: 5,
	/** the base colour and alpha */
	Main: 6,
} as const;

/** float offsets of an effect look's parameters (`MaterialLook.params`); the shader reads them as vec4 rows */
export const EffectRow = {
	/** tint rgb (times its intensity), alpha */
	tint: 0,
	/** one UV transform per texture slot: scale, offset */
	uv: 4,
	/** per slot: UV scroll per second (xy), the UV rotation's cosine and sine */
	anim: 32,
	/**
	 * per slot: role, plus 8 when the slot's UVs take the distortion, plus 16 when its red channel is its
	 * alpha, plus 32 times its {@link SlotSource}, or {@link SLOT_NO_BASE}
	 */
	slotBits: 60,
	/** the blend layer's tint rgb (HDR), w = how strongly it covers */
	blendTint: 68,
	/** distortion per unit of the first and second disturb texture: u1, v1, u2, v2 */
	disturb: 72,
	/**
	 * `_Bi_Disturb`, the weight texture's strength on the distortion, on the dissolve, 1 when the weight is
	 * used
	 */
	weight: 76,
	/** dissolve threshold, edge sharpness, glowing edge width, 1 when dissolving */
	dissolve: 80,
	/** the dissolve edge's colour (HDR), 1 when a mask is used */
	dissolveColor: 84,
	/** Fresnel power, bias, flip, how much it affects opacity (0 without `_USE_FRESNEL`) */
	fresnel: 88,
	/**
	 * soft blend distance (0 without `_USE_SOFTBLEND`), soft blend bias, `_IgnorePostExposure`, 1 to use vertex
	 * colours
	 */
	soft: 92,
	/** near camera fade: start, end, second start, second end (view depth, m) */
	near: 96,
	/** 1 with the near camera fade, brightening threshold, brightening intensity, 1 with distortion */
	misc: 100,
	/** decals: edge fade across x, across z, the fades' width, height fade */
	decalFade: 104,
	/** decals: height fade offset, angle falloff (0: no angle fade), 0, 0 */
	decal: 108,
	/**
	 * VFXBaseV2 vertex offset: `_OffsetDir` xyz, then how it's read: 0 in object space, 1 in world space, 2
	 * along the vertex normal (`_OffsetSwitchDir`)
	 */
	offsetDir: 112,
	/**
	 * VFXBaseV2 vertex offset: `_OffsetIntensity`, `_Bi_Offset`, how much the vertex alpha weighs the offset,
	 * the most it pulls vertices towards the camera (`_VertCameraOffset`, m)
	 */
	offset: 116,
	/**
	 * VFXBaseV2: 1 when the vertex offset is on, 1 when the offset texture reads UV set 1, 1 when
	 * `_USE_LIGHTING` lights the colour, 1 when it lights it at the world's up rather than the surface normal
	 * (`_RotateNormalToWorldUp`)
	 */
	offsetMode: 120,
	/**
	 * 1 when the layer goes unfogged (its material lacks `_USE_FOG`, and the game draws effects after the fog),
	 * the {@link EffectKind}, 1 when a VFXBaseV2 layer adds its light rather than blending over (`_BlendMode`
	 * 1), then VFXBaseV2's screen UV options: 1 to scale by the object's view depth (`_ScreenUVUseDepth`), plus
	 * 2 to take v from the world height (`_UsePosYAsScreenV`)
	 */
	unfogged: 124,
} as const;

/**
 * the UVs a texture slot starts from: the mesh's UV sets, polar coordinates about the UV centre (VFXBaseV2:
 * UV0's; VFXDecal: the box's), or the screen position
 */
export const SlotSource = {
	Uv0: 0,
	Uv1: 1,
	Polar: 2,
	Screen: 3,
} as const;

export type SlotSource = (typeof SlotSource)[keyof typeof SlotSource];

/**
 * {@link EffectRow.slotBits} bit of a slot whose UVs start from zero, as the game's do when the source its
 * weights pick isn't computed (polar or screen UVs without their keyword and switch)
 */
export const SLOT_NO_BASE = 128;

/**
 * slots of a VFXBaseV2 look: the main texture, then `_SampleTex0`…; the sixth sample texture shares
 * {@link OFFSET_SLOT} with the vertex offset's, so a material can't have both
 */
const BASE_SLOTS = [
	'_MainTex',
	'_SampleTex0',
	'_SampleTex1',
	'_SampleTex2',
	'_SampleTex3',
	'_SampleTex4',
	'_SampleTex5',
];

/**
 * the VFXBaseV2 slot of `_OffsetTex`, which the vertex stage samples; its UV and scroll rows hold the
 * texture's `_ST` and `_OffsetSpeed`
 */
export const OFFSET_SLOT = 6;

/** the material property of the vertex offset's texture */
const OFFSET_TEXTURE = '_OffsetTex';

/** the property whose `_ST` a VFXBaseV2 sample texture uses, by role */
const ROLE_TEXTURES = ['_DisturbTex1', '_DisturbTex2', '_WeightTex', '_MaskTex', '_BlendTex', '_DissolveTex'];

/**
 * slots of a VFXDecal look: each texture's role, the keyword that enables it, and the properties of its UV
 * scroll, rotation (degrees), distortion switch and UV source switch (0 the box, 1 the screen, 2 polar),
 * where it has them. the shader runs through the slots in order, so the disturb textures come before the
 * weight and the textures they distort
 */
const DECAL_SLOTS = [
	{
		name: '_MainTex',
		role: EffectRole.Main,
		keyword: null,
		speed: '_MainTexUVSpeed',
		rotate: '_MainTexUVRotate',
		disturbed: '_MainTexUseDisturb',
		source: '_MainSwitchUV',
	},
	{
		name: '_DisturbTex1',
		role: EffectRole.Disturb1,
		keyword: '_USE_DISTURB',
		speed: '_DisturbUVSpeed1',
		rotate: null,
		disturbed: null,
		source: '_DisturbSwitchUV',
	},
	{
		name: '_DisturbTex2',
		role: EffectRole.Disturb2,
		keyword: '_USE_DISTURB_TEX2',
		speed: '_DisturbUVSpeed2',
		rotate: null,
		disturbed: null,
		source: '_DisturbSwitchUV',
	},
	{
		name: '_WeightTex',
		role: EffectRole.Weight,
		keyword: '_USE_WEIGHT',
		speed: null,
		rotate: null,
		disturbed: null,
		source: '_WeightSwitchUV',
	},
	{
		name: '_MaskTex',
		role: EffectRole.Mask,
		keyword: '_USE_MASK',
		speed: '_MaskTexUVSpeed',
		rotate: '_MaskTexUVRotate',
		disturbed: '_MaskTexUseDisturb',
		source: '_MaskSwitchUV',
	},
	{
		name: '_BlendTex',
		role: EffectRole.Blend,
		keyword: '_USE_BLEND',
		speed: '_BlendTexUVSpeed',
		rotate: '_BlendTexUVRotate',
		disturbed: '_BlendTexUseDisturb',
		source: '_BlendSwitchUV',
	},
	{
		name: '_DissolveTex',
		role: EffectRole.Dissolve,
		keyword: '_USE_DISSOLVE',
		speed: '_DissolveUVSpeed',
		rotate: '_DissolveUVRotate',
		disturbed: '_DissolveTexUseDisturb',
		source: '_DissolveSwitchUV',
	},
] as const;

/** keywords VFXBaseV2 and VFXDecal can have and still be drawn */
const BASE_KEYWORDS = new Set([
	'_USE_LIGHTING',
	'_SAMPLE_TEX0',
	'_SAMPLE_TEX1',
	'_SAMPLE_TEX2',
	'_SAMPLE_TEX3',
	'_SAMPLE_TEX4',
	'_USE_FOG',
	'_USE_SOFTBLEND',
	'_USE_FRESNEL',
	'_USE_POLARUV',
]);
const DECAL_KEYWORDS = new Set([
	'_USE_MASK',
	'_USE_BLEND',
	'_USE_DISSOLVE',
	'_USE_DISTURB',
	'_USE_DISTURB_TEX2',
	'_USE_WEIGHT',
	'_USE_NORMALBLEND',
	'_USE_FOG',
	'_USE_POLARUV',
	'_USE_SCREENUV',
]);

/** what an effect look puts in `MaterialLook` besides its parameters */
export interface EffectLook {
	/** texture id per slot, or -1 */
	textures: number[];
	/** largest UV scale per slot, for streaming */
	uvScales: number[];
	params: Float32Array;
}

/** a material's float and colour (or vector) properties: its own value, else the shader's default */
const readers = (entry: ReadyMaterial, shader: ShaderEntry) => ({
	float: (name: string, fallback: number): number => entry.floats[name] ?? shader.floats[name] ?? fallback,
	color: (name: string): [number, number, number, number] | undefined =>
		entry.colors[name] ?? shader.colors[name] ?? entry.vectors[name] ?? shader.vectors[name],
});

/** fills a slot's texture, UV transform, scroll and rotation, and role bits */
const setSlot = (
	look: EffectLook,
	i: number,
	slot: { texture: number; scale: number[]; offset: number[] },
	anim: { speed: number[]; cos: number; sin: number },
	bits: number,
): void => {
	look.textures[i] = slot.texture;
	look.uvScales[i] = Math.max(Math.abs(slot.scale[0]), Math.abs(slot.scale[1]), 1e-3);
	look.params.set([slot.scale[0], slot.scale[1], slot.offset[0], slot.offset[1]], EffectRow.uv + i * 4);
	look.params.set([anim.speed[0], anim.speed[1], anim.cos, anim.sin], EffectRow.anim + i * 4);
	look.params[EffectRow.slotBits + i] = bits;
};

/** an effect look with no textures */
const emptyEffect = (slots: number): EffectLook => {
	const params = new Float32Array(128);
	for (let i = 0; i < slots; i++) {
		params[EffectRow.slotBits + i] = ROLE_NONE;
		params.set([1, 1, 0, 0], EffectRow.uv + i * 4);
		params.set([0, 0, 1, 0], EffectRow.anim + i * 4);
	}
	return {
		textures: Array.from({ length: slots }, () => -1),
		uvScales: Array.from({ length: slots }, () => 1),
		params,
	};
};

/**
 * the rows of the blend layer, the distortion, the dissolve, the near camera fade and `_IgnorePostExposure`,
 * which every texture-stack look reads alike (VFXWater overwrites some of them)
 */
const setShared = (look: EffectLook, entry: ReadyMaterial, shader: ShaderEntry, intensity: number): void => {
	const { float, color } = readers(entry, shader);
	const params = look.params;
	params.set(color('_BlendTint') ?? [1, 1, 1, 0], EffectRow.blendTint);
	params.set(
		[
			float('_DisturbUIntensity1', 0),
			float('_DisturbVIntensity1', 0),
			float('_DisturbUIntensity2', 0),
			float('_DisturbVIntensity2', 0),
		],
		EffectRow.disturb,
	);
	// the dissolve threshold sweeps from below 0 to past 1 as the schedule goes from 0 to 1
	params.set(
		[
			float('_DissolveScheduleOffset', 0) * 2.02 - 1.01,
			float('_DissolveEdgeSharp', 1),
			float('_DissolveEmissiveEdge', 0),
		],
		EffectRow.dissolve,
	);
	const edge = color('_DissolveEmissiveColor') ?? [0, 0, 0, 0];
	params.set([edge[0] * intensity, edge[1] * intensity, edge[2] * intensity], EffectRow.dissolveColor);
	params.set(
		[
			float('_NearCameraFadeDistanceStart', 0),
			float('_NearCameraFadeDistanceEnd', 1),
			float('_NearCameraFadeDistanceStart2', 1e5),
			float('_NearCameraFadeDistanceEnd2', 2e5),
		],
		EffectRow.near,
	);
	params[EffectRow.misc] = float('_UseNearCameraFade', 0) !== 0 ? 1 : 0;
	params[EffectRow.soft + 2] = float('_IgnorePostExposure', 1);
};

/** whether a VFXBaseV2 material moves its vertices by the offset texture in {@link OFFSET_SLOT} */
const vertexOffsetDrawn = (entry: ReadyMaterial, shader: ShaderEntry): boolean =>
	entry.keywords.includes('_USE_VERTOFFSET') &&
	readers(entry, shader).float('_InParticle', 1) === 0 &&
	entry.slots[OFFSET_TEXTURE] !== undefined;

/** whether a VFXBaseV2 keyword outside {@link BASE_KEYWORDS} is drawn, or changes nothing in the viewer */
const baseKeywordDrawn = (keyword: string, entry: ReadyMaterial, shader: ShaderEntry): boolean => {
	const { float, color } = readers(entry, shader);
	switch (keyword) {
		case '_USE_VERTOFFSET': {
			// the game scales the offset by `1 − _InParticle`, so meshes left in particle mode don't move
			const slot = entry.slots[OFFSET_TEXTURE];
			return float('_InParticle', 1) !== 0 || (slot !== undefined && slot.uv <= 1);
		}
		case '_USE_BRIGHT': {
			// the radial glow and distortion around the player (no `_BrightCenter`) reach `_OuterRadius` metres,
			// and the viewer has no player
			return float('_BrightType', 0) === 0 && (color('_BrightCenter')?.[3] ?? 0) === 0;
		}
		case '_USE_SCREENUV': {
			// screen UVs relative to the object's pivot aren't drawn
			return float('_LocalPivortSpace', 0) === 0;
		}
		case '_SAMPLE_TEX5': {
			// the sixth sample texture takes the vertex offset's slot
			return !vertexOffsetDrawn(entry, shader);
		}
		default: {
			return false;
		}
	}
};

/**
 * @param entry a material of `HGRP/Effect/VFXBaseV2`
 * @param shader its shader
 * @returns its effect look, or `null` when it uses features that aren't drawn
 */
export const vfxBaseLook = (entry: ReadyMaterial, shader: ShaderEntry): EffectLook | null => {
	const { float, color } = readers(entry, shader);
	// the shader writes its alpha times `1 − _BlendMode`: 1 adds the premultiplied colour over what's behind, and
	// 2 is for multiplying blend states
	const blendMode = float('_BlendMode', 0);
	if (
		entry.blend !== 'premultiplied' ||
		(blendMode !== 0 && blendMode !== 1) ||
		entry.keywords.some((keyword) => !BASE_KEYWORDS.has(keyword) && !baseKeywordDrawn(keyword, entry, shader))
	) {
		return null;
	}
	const look = emptyEffect(7);
	const params = look.params;
	const intensity = float('_TintColorIntensity', 1);
	const tint = linearRgb(color('_TintColor') ?? [1, 1, 1, 1]);
	params.set(
		[
			tint[0] * intensity,
			tint[1] * intensity,
			tint[2] * intensity,
			(color('_TintColor')?.[3] ?? 1) * float('_TintColorAlpha', 1),
		],
		EffectRow.tint,
	);
	const animOf = (prefix: string) => {
		const speed = color(`${prefix}UVSpeed`) ?? [0, 0, 0, 0];
		// the shaders' UV rotations are pure rotations: (a, b) of the matrix's first column is (cos, sin)
		const rotation = color(`${prefix}UVRotateMat`) ?? [1, 0, 0, 1];
		return { speed: [speed[0], speed[1]], cos: rotation[0], sin: rotation[1] };
	};
	// polar and screen UVs are computed only with their keyword and switch, and are zero otherwise
	const computed = [
		true,
		true,
		entry.keywords.includes('_USE_POLARUV') && float('_UsePolarUV', 0) !== 0,
		entry.keywords.includes('_USE_SCREENUV') && float('_UseScreenUV', 0) !== 0,
	];
	// a slot's UVs are its weights times UV0, UV1, polar and screen UVs; materials set one weight
	const source = (prefix: string): number => {
		const weights = color(`${prefix}UVWeights`) ?? [1, 0, 0, 0];
		const largest = weights.indexOf(Math.max(...weights));
		return weights[largest] > 0 && computed[largest] ? largest * 32 : SLOT_NO_BASE;
	};
	BASE_SLOTS.forEach((name, i) => {
		const slot = entry.slots[name];
		if (slot === undefined || slot.uv > 1) {
			return;
		}
		if (i === 0) {
			const bits =
				EffectRole.Main +
				(float('_MainTexUseDisturb', 0) !== 0 ? 8 : 0) +
				(float('_UseMainTexAsAlpha', 0) !== 0 ? 16 : 0) +
				source('_MainTex');
			setSlot(look, i, slot, animOf('_MainTex'), bits);
			return;
		}
		const n = i - 1;
		if (!entry.keywords.includes(`_SAMPLE_TEX${n}`)) {
			return;
		}
		const role = ROLE_TEXTURES.findIndex((_, k) => float(`_SampleTex${n}UseWeight${k}`, 0) !== 0);
		if (role < 0) {
			return;
		}
		// the shader transforms a sample texture's UVs by the `_ST` of its role's texture property
		const transform = entry.slots[ROLE_TEXTURES[role]] ?? slot;
		const anim = animOf(`_SampleTex${n}`);
		let bits =
			role +
			(float(`_SampleTex${n}UseDisturb`, 0) !== 0 ? 8 : 0) +
			(float(`_UseSampleTex${n}AsAlpha`, 0) !== 0 ? 16 : 0);
		if (n === 5) {
			// the shader computes the sixth's UVs in its vertex stage, from the mesh's UV sets alone, and scrolls them
			// by the first's speed
			const weights = color('_SampleTex5UVWeights') ?? [1, 0, 0, 0];
			bits += weights[1] > weights[0] ? 32 : 0;
			anim.speed = animOf('_SampleTex0').speed;
		} else {
			bits += source(`_SampleTex${n}`);
		}
		setSlot(look, i, { ...transform, texture: slot.texture }, anim, bits);
	});
	// without a main texture the shader samples its default; slot 0 is always sampled, and an unset slot binds
	// white
	if (look.textures[0] < 0 && shader.textures['_MainTex'] !== 'white') {
		return null;
	}
	setShared(look, entry, shader, intensity);
	params[EffectRow.dissolve + 3] = float('_UseDissolve', 0) !== 0 ? 1 : 0;
	// as in the game, a mask or weight switched on without a texture in that role leaves nothing
	params[EffectRow.dissolveColor + 3] = float('_UseMask', 0) !== 0 ? 1 : 0;
	params.set(
		[
			float('_Bi_Disturb', 0),
			float('_WeightTexIntensity', 1) * float('_DisturbUseWeight', 0),
			float('_WeightTexIntensity', 1) * float('_DissolveUseWeight', 0),
			float('_UseWeightTex', 0) !== 0 ? 1 : 0,
		],
		EffectRow.weight,
	);
	if (entry.keywords.includes('_USE_FRESNEL')) {
		params.set(
			[
				float('_FresnelPower', 1),
				float('_FresnelBias', 0),
				float('_FresnelFlip', 0),
				float('_FresnelAffectOpacity', 0),
			],
			EffectRow.fresnel,
		);
	}
	if (entry.keywords.includes('_USE_SOFTBLEND')) {
		params[EffectRow.soft] = Math.max(float('_SoftDistance', 1), 1e-3);
		params[EffectRow.soft + 1] = float('_SoftBias', 0);
	}
	params[EffectRow.soft + 3] = float('_DisableVertColor', 0) !== 0 ? 0 : 1;
	params[EffectRow.unfogged] = entry.keywords.includes('_USE_FOG') ? 0 : 1;
	params[EffectRow.unfogged + 2] = blendMode;
	params[EffectRow.unfogged + 3] =
		(float('_ScreenUVUseDepth', 1) !== 0 ? 1 : 0) + (float('_UsePosYAsScreenV', 0) !== 0 ? 2 : 0);
	params[EffectRow.misc + 1] = float('_ExpThreshold', 1);
	params[EffectRow.misc + 2] = float('_ExpIntensity', 0);
	params[EffectRow.misc + 3] = float('_UseDisturb', 0) !== 0 ? 1 : 0;
	const offsetSlot = entry.slots[OFFSET_TEXTURE];
	if (
		entry.keywords.includes('_USE_VERTOFFSET') &&
		float('_InParticle', 1) === 0 &&
		offsetSlot !== undefined
	) {
		const speed = color('_OffsetSpeed') ?? [0, 0, 0, 0];
		// the vertex stage reads the scroll after the `_ST`, unscaled and unrotated
		setSlot(look, OFFSET_SLOT, offsetSlot, { speed: [speed[0], speed[1]], cos: 1, sin: 0 }, ROLE_NONE);
		const dir = color('_OffsetDir') ?? [0, 0, 0, 0];
		params.set([dir[0], dir[1], dir[2], float('_OffsetSwitchDir', 0)], EffectRow.offsetDir);
		params.set(
			[
				float('_OffsetIntensity', 0),
				float('_Bi_Offset', 0),
				float('_UseVertexColorAlphaAsVertOffsetWeight', 0),
				float('_VertCameraOffset', 0),
			],
			EffectRow.offset,
		);
		params.set([1, float('_OffsetUVSet', 0) !== 0 ? 1 : 0], EffectRow.offsetMode);
	}
	if (entry.keywords.includes('_USE_LIGHTING')) {
		params[EffectRow.offsetMode + 2] = 1;
		params[EffectRow.offsetMode + 3] = float('_RotateNormalToWorldUp', 0) !== 0 ? 1 : 0;
	}
	return look;
};

/**
 * @param entry a material of `HGRP/Effect/VFXDecal`
 * @param shader its shader
 * @returns its effect look, or `null` when it uses features that aren't drawn
 */
export const vfxDecalLook = (entry: ReadyMaterial, shader: ShaderEntry): EffectLook | null => {
	if (entry.blend !== 'premultiplied' || entry.keywords.some((keyword) => !DECAL_KEYWORDS.has(keyword))) {
		return null;
	}
	const { float, color } = readers(entry, shader);
	const look = emptyEffect(7);
	const params = look.params;
	const base = color('_DecalBaseColor') ?? [1, 1, 1, 1];
	params.set([base[0], base[1], base[2], base[3] * float('_TintColorAlpha', 1)], EffectRow.tint);
	// a texture's UV switch picks polar or screen UVs only where they're computed; the box's otherwise
	const sources = new Map<number, SlotSource>();
	if (entry.keywords.includes('_USE_SCREENUV') && float('_UseScreenUV', 0) !== 0) {
		sources.set(1, SlotSource.Screen);
	}
	if (entry.keywords.includes('_USE_POLARUV') && float('_UsePolarUV', 0) !== 0) {
		sources.set(2, SlotSource.Polar);
	}
	DECAL_SLOTS.forEach(({ name, role, keyword, speed: speedName, rotate, disturbed, source }, i) => {
		const slot = entry.slots[name];
		if (slot === undefined || slot.uv > 1 || (keyword !== null && !entry.keywords.includes(keyword))) {
			return;
		}
		const speed = (speedName !== null && color(speedName)) || [0, 0, 0, 0];
		// a rotation in degrees about the texture's centre
		const angle = rotate === null ? 0 : (float(rotate, 0) * Math.PI) / 180;
		const useDisturb = disturbed === null ? 0 : float(disturbed, 0);
		const asAlpha =
			(role === EffectRole.Main && float('_UseMainTexAsAlpha', 0) !== 0) ||
			(role === EffectRole.Mask && float('_UseMaskTexAsAlpha', 0) !== 0);
		// the shader applies the blend texture's `_ST` twice
		const transform =
			role === EffectRole.Blend
				? {
						...slot,
						scale: [slot.scale[0] * slot.scale[0], slot.scale[1] * slot.scale[1]],
						offset: [slot.offset[0] * (slot.scale[0] + 1), slot.offset[1] * (slot.scale[1] + 1)],
					}
				: slot;
		setSlot(
			look,
			i,
			transform,
			{ speed: [speed[0], speed[1]], cos: Math.cos(angle), sin: -Math.sin(angle) },
			role +
				(useDisturb !== 0 ? 8 : 0) +
				(asAlpha ? 16 : 0) +
				(sources.get(float(source, 0)) ?? SlotSource.Uv0) * 32,
		);
	});
	if (look.textures[0] < 0) {
		return null;
	}
	setShared(look, entry, shader, base[0]);
	params[EffectRow.dissolve + 3] = entry.keywords.includes('_USE_DISSOLVE') ? 1 : 0;
	params[EffectRow.dissolveColor + 3] = entry.keywords.includes('_USE_MASK') ? 1 : 0;
	params[EffectRow.weight] = float('_Bi_Disturb', 0);
	if (entry.keywords.includes('_USE_WEIGHT')) {
		const intensity = float('_WeightTexIntensity', 1);
		params.set(
			[
				intensity * float('_DisturbUseWeight', 1),
				intensity * float('_DissolveUseWeight', 0),
				// the distortion and dissolve then scale by `1 − intensity + red · intensity`
				1,
			],
			EffectRow.weight + 1,
		);
	}
	params[EffectRow.misc + 3] = entry.keywords.includes('_USE_DISTURB') ? 1 : 0;
	params[EffectRow.unfogged] = entry.keywords.includes('_USE_FOG') ? 0 : 1;
	params.set(
		[
			float('_EdgeFadeX', 0),
			float('_EdgeFadeZ', 0),
			float('_EdgeFadeIntensity', 0),
			Math.max(float('_HeightFade', 0), 1e-3),
		],
		EffectRow.decalFade,
	);
	params.set(
		[
			float('_HeightFadeOffset', 0),
			entry.keywords.includes('_USE_NORMALBLEND') ? float('_AngleBlendFallOff', 1) : 0,
		],
		EffectRow.decal,
	);
	return look;
};

// #region lit decals

/**
 * float offsets of an `HGRP/DecalLit` look's parameters, in place of {@link EffectRow}'s rows 17–20. the tint
 * (the placement's colour; alpha times `_DecalOpacity`), the UV rows of slot 0 (`_BaseColorMap`) and 1
 * (`_SampleTex1`) and the last row are shared
 */
export const DecalLitRow = {
	/**
	 * `_RoughnessMin`, `_RoughnessMax`, `_NormalScale`, the angle fade's power (0 without
	 * `_NORMAL_ANGLE_BLEND`)
	 */
	surface: 68,
	/**
	 * 1 when the decal writes its normal over the surface's, 1 when it writes its roughness, then
	 * `_BlendSceneNormal` (how much the decal's normal map takes the surface's frame instead of the box's), 0
	 */
	writes: 72,
	/** 1 when it writes metallic, 1 when it writes occlusion, `_Metallic`, `_OcclusionStrength` */
	pbr: 76,
	/**
	 * 1 when the base map is the PBR map and the colour is the placement's alone (`_BaseTexChannel`),
	 * `_MetallicChannel`, `_OcclusionChannel`, `_AffectNormal`
	 */
	channels: 80,
	/**
	 * `_BLEND_WATER_FLOW`: 1 when on, `_WaterNormalScale`, `_WaterRoughness`, `_NormalFactor` (how far steep
	 * walls push the flow's UVs)
	 */
	water: 84,
	/** `_BLEND_WATER_FLOW`: `_UVMovement` (the two layers' scroll speeds, then their UV scales) */
	flow: 88,
	/** `_BLEND_WATER_FLOW`: `_AngleBlendFallOff2`, the power of the fade towards level surfaces, then 0, 0, 0 */
	flowFade: 92,
} as const;

/**
 * the slot of a lit decal's PBR map (`_SampleTex1`: normal RG, roughness B), or with `_BLEND_WATER_FLOW` its
 * water normal map (`_WaterNormalTex`: normal RG, roughness B, at world positions); its base colour is slot
 * 0
 */
export const DECAL_PBR_SLOT = 1;

/** lit decal keywords that are drawn; the others change the surface in ways the viewer doesn't */
const DECAL_LIT_KEYWORDS = new Set(['_COMPLETE_PBR', '_NORMAL_ANGLE_BLEND', '_BLEND_WATER_FLOW']);

/** Unity's `ColorWriteMask` bits */
const WRITE_RED = 8;
const WRITE_GREEN = 4;
const WRITE_BLUE = 2;

/** a lit decal's effect look, and how it's drawn */
export interface LitDecalLook extends EffectLook {
	/**
	 * `true` when it writes no albedo, only the normal or roughness of the surface beneath: the decal relight
	 * pass then adds the change in that surface's light to the main pass's radiance. `false` when it's laid
	 * over the surface in the transparent pass
	 */
	relight: boolean;
}

/**
 * `HGRP/DecalLit`, the projected decals of the scenery (`docs/game-data/materials.md#decals`): the base
 * colour map tinted by the placement's colour, with the PBR map's roughness and normal (or with
 * `_BLEND_WATER_FLOW` a scrolling water normal map's), written over the surface through the colour masks the
 * material sets (`_ColorMask1` metallic and occlusion, `_ColorMask2` normal and roughness, `_ColorMask3`
 * albedo).
 *
 * @param entry a material of `HGRP/DecalLit`, a placement's copy with its colour and UV transform
 * @param shader its shader
 * @returns its look, `'invisible'` when it changes nothing the viewer draws (it writes neither albedo, normal
 *   nor roughness, or only the PBR map's, without one), or `null` when it uses features that aren't drawn or
 *   lacks a placement or base colour map
 */
export const decalLitLook = (
	entry: ReadyMaterial,
	shader: ShaderEntry,
): LitDecalLook | 'invisible' | null => {
	if (entry.keywords.some((keyword) => !DECAL_LIT_KEYWORDS.has(keyword))) {
		return null;
	}
	const { float, color } = readers(entry, shader);
	const placementColor = entry.colors[DECAL_COLOR_PROPERTY];
	const placementUv = entry.vectors[DECAL_UV_PROPERTY];
	if (placementColor === undefined || placementUv === undefined) {
		return null;
	}
	const waterFlow = entry.keywords.includes('_BLEND_WATER_FLOW');
	const relight = (float('_ColorMask3', 0) & WRITE_RED) === 0;
	const surfaceMask = float('_ColorMask2', 0);
	if (relight && (surfaceMask & (WRITE_RED | WRITE_GREEN | WRITE_BLUE)) === 0) {
		return 'invisible';
	}
	const look = emptyEffect(7);
	const params = look.params;
	const pbrBase = !waterFlow && float('_BaseTexChannel', 0) !== 0;
	const base = entry.slots['_BaseColorMap'];
	if (base === undefined) {
		return null;
	}
	const placement = { scale: [placementUv[0], placementUv[1]], offset: [placementUv[2], placementUv[3]] };
	const still = { speed: [0, 0], cos: 1, sin: 0 };
	setSlot(look, 0, { texture: base.texture, ...placement }, still, ROLE_NONE);
	let pbr: TextureSlot | undefined;
	if (waterFlow) {
		// the water's normal map projects at world positions; its `_ST` scale is per metre
		pbr = entry.slots['_WaterNormalTex'];
		if (pbr !== undefined) {
			setSlot(
				look,
				DECAL_PBR_SLOT,
				{ texture: pbr.texture, scale: pbr.scale, offset: [0, 0] },
				still,
				ROLE_NONE,
			);
		}
	} else {
		pbr = pbrBase ? base : entry.slots['_SampleTex1'];
		if (pbr !== undefined) {
			// its own `_ST` applies to the box's UVs only with `_SampleTex1UVSet`
			const transform =
				!pbrBase && float('_SampleTex1UVSet', 0) !== 0 ? { scale: pbr.scale, offset: pbr.offset } : placement;
			setSlot(look, DECAL_PBR_SLOT, { texture: pbr.texture, ...transform }, still, ROLE_NONE);
		}
	}
	params.set(
		[placementColor[0], placementColor[1], placementColor[2], placementColor[3] * float('_DecalOpacity', 1)],
		EffectRow.tint,
	);
	params.set(
		[
			float('_RoughnessMin', 0),
			float('_RoughnessMax', 1),
			float('_NormalScale', 1),
			entry.keywords.includes('_NORMAL_ANGLE_BLEND') ? Math.max(float('_AngleBlendFallOff', 1), 1e-3) : 0,
		],
		DecalLitRow.surface,
	);
	const pbrMask = float('_ColorMask1', 0);
	const hasPbr = pbr !== undefined;
	// a relit decal changes the surface only through the PBR map
	if (relight && !hasPbr) {
		return 'invisible';
	}
	params.set(
		[
			hasPbr && (surfaceMask & (WRITE_RED | WRITE_GREEN)) !== 0 ? 1 : 0,
			hasPbr && (surfaceMask & WRITE_BLUE) !== 0 ? 1 : 0,
			float('_BlendSceneNormal', 0),
		],
		DecalLitRow.writes,
	);
	params.set(
		[
			(pbrMask & WRITE_RED) !== 0 ? 1 : 0,
			(pbrMask & WRITE_GREEN) !== 0 ? 1 : 0,
			float('_Metallic', 0),
			float('_OcclusionStrength', 1),
		],
		DecalLitRow.pbr,
	);
	params.set(
		[pbrBase ? 1 : 0, float('_MetallicChannel', 0), float('_OcclusionChannel', 0), float('_AffectNormal', 0)],
		DecalLitRow.channels,
	);
	if (waterFlow) {
		params.set(
			[1, float('_WaterNormalScale', 1), float('_WaterRoughness', 0), float('_NormalFactor', 0)],
			DecalLitRow.water,
		);
		params.set(color('_UVMovement') ?? [0, 0, 1, 1], DecalLitRow.flow);
		params[DecalLitRow.flowFade] = Math.max(float('_AngleBlendFallOff2', 1), 1e-3);
	}
	params.set([0, EffectKind.LitDecal], EffectRow.unfogged);
	return { ...look, relight };
};

// #endregion

// #region water sheets

/** what `effect.wgsl` draws a look as, in {@link EffectRow.unfogged}'s second float */
export const EffectKind = {
	/** VFXBaseV2 and VFXDecal's texture stack */
	Stack: 0,
	/** a VFXWater sheet ({@link WaterSheetRow}) */
	WaterSheet: 1,
	/** an `HGRP/DecalLit` box ({@link DecalLitRow}), drawn by the decal entry point */
	LitDecal: 2,
} as const;

/**
 * float offsets of a VFXWater look's parameters, in place of {@link EffectRow}'s rows 17–22 and 26–30. the
 * tint, UV, scroll, soft blend, near fade and last rows are shared, and the vertex offset stays off (row 30's
 * x)
 */
export const WaterSheetRow = {
	/** {@link WaterSheetFlags}, `_BlendMode` (1: additive), `_UseLighting`, `_WaterRandomUV` */
	flags: 68,
	/** `_Bi_Disturb`, `_DisturbUIntensity1`, `_DisturbVIntensity1`, 0 */
	disturb: 72,
	/** how far the distortion moves the main, mask, normal map and dissolve UVs (`_…UseDisturb`) */
	disturbUse: 76,
	/** dissolve threshold, edge sharpness, glowing edge width, 0 */
	dissolve: 80,
	/** the dissolve edge's colour (linear, times the tint intensity), 0 */
	dissolveColor: 84,
	/** flipbook columns, rows, frames per second, `_RandomStartByPos` */
	sequence: 88,
	/** flipbook: motion vector strength, opacity scale, opacity threshold, colour threshold */
	sequenceShape: 104,
	/** flipbook colour tint (linear), normal scale (the flipbook's or the normal map's) */
	sequenceTint: 108,
	/** `_Roughness`, `_Specular`, `_DirSpecularStrength`, `_FresnelStrength` */
	surface: 112,
	/** subsurface hue, saturation, value (0 without `_SUBSURFACE`), indirect strength */
	subsurface: 116,
	/** 0 (the vertex offset's switch), `_IndirectSaturation`, 0, 0 */
	misc: 120,
} as const;

/** {@link WaterSheetRow.flags} bits, matching `effect.wgsl` */
export const WaterSheetFlags = {
	Disturb: 1 << 0,
	/** the disturb texture holds a normal: its (a·r, g) distort instead of its red */
	DisturbNormal: 1 << 1,
	Mask: 1 << 2,
	Dissolve: 1 << 3,
	Sequence: 1 << 4,
	SequenceMotion: 1 << 5,
	/** slot 6 holds the flipbook's normals */
	SequenceNormal: 1 << 6,
	/** slot 6 holds `_NormalMap` */
	NormalMap: 1 << 7,
	MainAsAlpha: 1 << 8,
	MaskAsAlpha: 1 << 9,
	VertexOpacity: 1 << 10,
	FresnelOpacity: 1 << 11,
	VertexColor: 1 << 12,
} as const;

/** the slots of a VFXWater look, in order; slot 6 holds whichever normals the material uses */
const WATER_SLOTS = [
	'_MainTex',
	'_DisturbTex1',
	'_MaskTex',
	'_DissolveTex',
	'_SequenceBaseColorMap',
	'_SequenceMotionVectorMap',
] as const;

/**
 * the prefix of each {@link WATER_SLOTS} texture's UV scroll and rotation properties, `null` for the
 * flipbook's
 */
const WATER_SLOT_ANIM = ['_MainTex', '_Disturb', '_MaskTex', '_Dissolve', null, null] as const;

/**
 * VFXWater keywords that are drawn. `VFX_WATER_SIMPLE_LIGHT`, the game's cheaper lighting from a per-draw
 * ambient probe and the far shadow, is lit the full way
 */
const WATER_KEYWORDS = new Set([
	'_SUBSURFACE',
	'_USE_DISTURB',
	'_USE_MASK',
	'_USE_DISSOLVE',
	'_USE_SOFTBLEND',
	'_NORMAL_MAP',
	'_USE_SEQUENCE_FRAME',
	'_USE_SEQUENCE_FRAME_MV',
	'_USE_SEQUENCE_FRAME_NORMAL',
	'VFX_WATER_SIMPLE_LIGHT',
]);

/**
 * `HGRP/Effect/VFXWater`, the sheets of falling water (`docs/game-data/effects.md#waterfalls`).
 *
 * @param entry a material of `HGRP/Effect/VFXWater`
 * @param shader its shader
 * @returns its look, or `null` when it uses features that aren't drawn (refraction, vertex animation)
 */
export const vfxWaterLook = (entry: ReadyMaterial, shader: ShaderEntry): EffectLook | null => {
	if (entry.blend !== 'premultiplied' || entry.keywords.some((keyword) => !WATER_KEYWORDS.has(keyword))) {
		return null;
	}
	const has = (keyword: string): boolean => entry.keywords.includes(keyword);
	const sequence = has('_USE_SEQUENCE_FRAME');
	if (sequence && entry.slots['_SequenceBaseColorMap'] === undefined) {
		return null;
	}
	const { float, color } = readers(entry, shader);
	const look = emptyEffect(7);
	const params = look.params;
	const intensity = float('_TintColorIntensity', 1);
	const tint = color('_TintColor') ?? [1, 1, 1, 1];
	const linear = linearRgb(tint);
	params.set(
		[
			linear[0] * intensity,
			linear[1] * intensity,
			linear[2] * intensity,
			tint[3] * float('_TintColorAlpha', 1),
		],
		EffectRow.tint,
	);
	// first, since the rows below reuse some of the stack's
	setShared(look, entry, shader, intensity);
	let flags = 0;
	const used = [
		true,
		has('_USE_DISTURB'),
		has('_USE_MASK'),
		has('_USE_DISSOLVE'),
		sequence,
		sequence && has('_USE_SEQUENCE_FRAME_MV'),
	];
	WATER_SLOTS.forEach((name, i) => {
		const slot = entry.slots[name];
		if (!used[i] || slot === undefined || slot.uv > 0) {
			return;
		}
		const prefix = WATER_SLOT_ANIM[i];
		let anim = { speed: [0, 0], cos: 1, sin: 0 };
		if (prefix !== null) {
			const speed = color(`${prefix}UVSpeed${i === 1 ? '1' : ''}`) ?? [0, 0, 0, 0];
			const rotation = color(`${prefix}UVRotateMat${i === 1 ? '1' : ''}`) ?? [1, 0, 0, 1];
			anim = { speed: [speed[0], speed[1]], cos: rotation[0], sin: rotation[1] };
		}
		// the flipbook samples its frames' UVs as they are
		const transform = prefix === null ? { ...slot, scale: [1, 1], offset: [0, 0] } : slot;
		setSlot(look, i, transform, anim, EffectRole.Main);
	});
	if (look.textures[0] < 0 && shader.textures['_MainTex'] !== 'white') {
		return null;
	}
	if (look.textures[1] >= 0) {
		flags |= WaterSheetFlags.Disturb;
		if (float('_DisturbTex1Normal', 0) !== 0) {
			flags |= WaterSheetFlags.DisturbNormal;
		}
	}
	if (look.textures[2] >= 0) {
		flags |= WaterSheetFlags.Mask;
	}
	if (look.textures[3] >= 0) {
		flags |= WaterSheetFlags.Dissolve;
	}
	if (sequence) {
		flags |= WaterSheetFlags.Sequence;
		if (look.textures[5] >= 0) {
			flags |= WaterSheetFlags.SequenceMotion;
		}
	}
	// slot 6: the flipbook's normals, or a normal map
	let normalScale = 1;
	{
		const flipbook = sequence && has('_USE_SEQUENCE_FRAME_NORMAL');
		const name = flipbook ? '_SequenceNormalMap' : has('_NORMAL_MAP') ? '_NormalMap' : null;
		const slot = name === null ? undefined : entry.slots[name];
		if (slot !== undefined && slot.uv === 0) {
			const speed = color('_NormalMapUVSpeed') ?? [0, 0, 0, 0];
			const rotation = color('_NormalMapUVRotateMat') ?? [1, 0, 0, 1];
			setSlot(
				look,
				6,
				flipbook ? { ...slot, scale: [1, 1], offset: [0, 0] } : slot,
				flipbook
					? { speed: [0, 0], cos: 1, sin: 0 }
					: { speed: [speed[0], speed[1]], cos: rotation[0], sin: rotation[1] },
				EffectRole.Main,
			);
			flags |= flipbook ? WaterSheetFlags.SequenceNormal : WaterSheetFlags.NormalMap;
			normalScale = flipbook ? float('_FrameNormalScale', 1) : float('_NormalScale', 1);
		}
	}
	if (float('_UseMainTexAsAlpha', 1) !== 0) {
		flags |= WaterSheetFlags.MainAsAlpha;
	}
	if (float('_UseMaskTexAsAlpha', 1) !== 0) {
		flags |= WaterSheetFlags.MaskAsAlpha;
	}
	if (float('_UseVertexColorAsOpacity', 0) !== 0) {
		flags |= WaterSheetFlags.VertexOpacity;
	}
	if (float('_UseFresnelAsOpacity', 0) !== 0) {
		flags |= WaterSheetFlags.FresnelOpacity;
	}
	if (float('_DisableVertColor', 0) === 0) {
		flags |= WaterSheetFlags.VertexColor;
	}
	params.set(
		[flags, float('_BlendMode', 0), float('_UseLighting', 1), float('_WaterRandomUV', 0)],
		WaterSheetRow.flags,
	);
	params.set(
		[float('_Bi_Disturb', 0), float('_DisturbUIntensity1', 0), float('_DisturbVIntensity1', 0), 0],
		WaterSheetRow.disturb,
	);
	params.set(
		[
			float('_MainTexUseDisturb', 0),
			float('_MaskTexUseDisturb', 0),
			float('_NormalMapUseDisturb', 0),
			float('_DissolveTexUseDisturb', 0),
		],
		WaterSheetRow.disturbUse,
	);
	// the dissolve threshold sweeps from below 0 to past 1 as the schedule goes from 0 to 1
	params.set(
		[
			float('_DissolveScheduleOffset', 0) * 2.02 - 1.01,
			float('_DissolveEdgeSharp', 1),
			float('_DissolveEmissiveEdge', 0),
			0,
		],
		WaterSheetRow.dissolve,
	);
	const edge = linearRgb(color('_DissolveEmissiveColor') ?? [0, 0, 0, 0]);
	params.set([edge[0] * intensity, edge[1] * intensity, edge[2] * intensity, 0], WaterSheetRow.dissolveColor);
	const frames = color('_SequenceFrameSize') ?? [1, 1, 0, 0];
	params.set(
		[
			Math.max(frames[0], 1),
			Math.max(frames[1], 1),
			float('_PlaybackSpeed', 0),
			float('_RandomStartByPos', 0),
		],
		WaterSheetRow.sequence,
	);
	params.set(
		[
			float('_MotionVectorDistortionStrength', 0),
			float('_SequenceOpacityScale', 1),
			float('_SequenceOpacitySdf', 0),
			float('_SequenceBaseColorSdf', 0),
		],
		WaterSheetRow.sequenceShape,
	);
	const sequenceTint = linearRgb(color('_SequenceBaseColorMapTint') ?? [1, 1, 1, 1]);
	params.set([...sequenceTint, normalScale], WaterSheetRow.sequenceTint);
	params.set(
		[
			float('_Roughness', 1),
			float('_Specular', 1),
			float('_DirSpecularStrength', 1),
			float('_FresnelStrength', 0),
		],
		WaterSheetRow.surface,
	);
	params.set(
		[
			float('_SubsurfaceHue', 1),
			float('_SubsurfaceSaturation', 1),
			has('_SUBSURFACE') ? float('_SubsurfaceValue', 1) : 0,
			float('_SubsurfaceIndirect', 1),
		],
		WaterSheetRow.subsurface,
	);
	params.set([0, float('_IndirectSaturation', 1), 0, 0], WaterSheetRow.misc);
	if (has('_USE_SOFTBLEND')) {
		params[EffectRow.soft] = Math.max(float('_SoftDistance', 1), 1e-3);
		params[EffectRow.soft + 1] = float('_SoftBias', 0);
	}
	params[EffectRow.soft + 3] = (flags & WaterSheetFlags.VertexColor) !== 0 ? 1 : 0;
	params.set([0, EffectKind.WaterSheet, 0, 0], EffectRow.unfogged);
	return look;
};

// #endregion

// #region mist

/**
 * float offsets of a mist look's parameters (`fogSimpleLook`, `fakeVolumeFogLook`), in place of
 * {@link EffectRow} for the mist entry points of `effect.wgsl`. the UV rows are shared
 */
export const MistRow = {
	/** colour rgb (linear, HDR), alpha */
	color: 0,
	/** one UV transform per texture slot, as {@link EffectRow.uv} */
	uv: 4,
	/** cards: `_BaseAlphaIntensity`, `_FogNoiseIntensity`, `_UseWind`, `_WindNoiseIntensity` */
	card: 32,
	/** cards: `_WindNoiseContrast`, the wind noise's UV scale in u and v, `_WindSpeed` */
	wind: 36,
	/** cards: `_WindDirX`, `_WindDirY`, 1 when lit, `_LightFactor` */
	light: 40,
	/** cards: `_IndirectColor` (linear), 1 when the blending is additive */
	indirect: 44,
	/** distance fade start and end, near camera fade start and end (view depth, m) */
	fade: 48,
	/** cards: top fade contrast and offset, soft blend distance (0 without `_USE_SOFTBLEND`), 0 */
	top: 52,
	/** volumes: `_FogExponent`, `_FogDensity`, `_CubEdgeFade`, `_NearFadeDistance` (0 when walk-in) */
	volume: 56,
	/** volumes: `_HeightOffset`, `_HeightFalloff`, vertical falloff min, max (equal: none) */
	volumeHeight: 60,
	/** volumes: `_FogIntensityFadeDistance`, 1 to measure it from the centre, `_FogDepthStart`, `_FogDepthEnd` */
	volumeFade: 64,
	/** `_IgnorePostExposure`, 0, 0, 0 */
	misc: 68,
} as const;

/** the slot index of a card's noise texture; its main texture is slot 0 */
export const MIST_NOISE_SLOT = 1;

/**
 * card keywords that are drawn. `_USE_LIGHTING` lights by the mesh normal rather than the game's normal map,
 * and `_USE_FOG`'s own fog isn't drawn (premultiplied cards take the composite's fog, additive ones none)
 */
const FOG_SIMPLE_KEYWORDS = new Set(['_USE_FOG', '_USE_SOFTBLEND', '_USE_LIGHTING']);

/** a fade between two view depths that also works with equal ends (then a step at the start) */
const fadeRange = (start: number, end: number): [number, number] =>
	Math.abs(end - start) < 1e-4 ? [start, start + 1e-4] : [start, end];

/**
 * `HGRP/FogSimple`, the mist cards (`docs/game-data/effects.md#mist`).
 *
 * @param entry a material of `HGRP/FogSimple`
 * @param shader its shader
 * @returns its mist look, or `null` when it uses features that aren't drawn
 */
export const fogSimpleLook = (entry: ReadyMaterial, shader: ShaderEntry): EffectLook | null => {
	if (
		(entry.blend !== 'premultiplied' && entry.blend !== 'additive') ||
		entry.keywords.some((keyword) => !FOG_SIMPLE_KEYWORDS.has(keyword))
	) {
		return null;
	}
	const { float, color } = readers(entry, shader);
	const look = emptyEffect(7);
	const params = look.params;
	for (const [i, name] of ['_MainTex', '_NoiseTex'].entries()) {
		const slot = entry.slots[name];
		if (slot === undefined || slot.uv > 1) {
			return null;
		}
		setSlot(look, i, slot, { speed: [0, 0], cos: 1, sin: 0 }, ROLE_NONE);
	}
	const base = color('_BaseColor') ?? [1, 1, 1, 1];
	params.set([...linearRgb(base), base[3]], MistRow.color);
	params.set(
		[
			float('_BaseAlphaIntensity', 1),
			float('_FogNoiseIntensity', 0),
			float('_UseWind', 0),
			float('_WindNoiseIntensity', 0),
		],
		MistRow.card,
	);
	const separate = float('_UseSeparateScale', 0) !== 0;
	const windScale = float('_WindScale', 1);
	params.set(
		[
			float('_WindNoiseContrast', 0),
			windScale * (separate ? float('_WindScaleX', 1) : 1),
			windScale * (separate ? float('_WindScaleY', 1) : 1),
			float('_WindSpeed', 0),
		],
		MistRow.wind,
	);
	const lit = entry.keywords.includes('_USE_LIGHTING') && float('_UseLighting', 0) !== 0;
	params.set(
		[float('_WindDirX', 1), float('_WindDirY', 0), lit ? 1 : 0, float('_LightFactor', 0)],
		MistRow.light,
	);
	const indirect = color('_IndirectColor') ?? [0, 0, 0, 1];
	params.set([...linearRgb(indirect), entry.blend === 'additive' ? 1 : 0], MistRow.indirect);
	params.set(
		[
			...fadeRange(float('_DistanceFadeStart', 0), float('_DistanceFadeEnd', 0)),
			...fadeRange(float('_NearCameraFadeDistanceStart', 0), float('_NearCameraFadeDistanceEnd', 0)),
		],
		MistRow.fade,
	);
	params.set(
		[
			float('_TopFadeContract', 1),
			float('_TopFadeOffset', 0),
			entry.keywords.includes('_USE_SOFTBLEND') ? Math.max(float('_SoftDistance', 1), 1e-3) : 0,
		],
		MistRow.top,
	);
	return look;
};

/**
 * `HGRP/Effect/VFXFakeVolumeFog`, the mist boxes (`docs/game-data/effects.md#mist`), drawn only when
 * additive.
 *
 * @param entry a material of `HGRP/Effect/VFXFakeVolumeFog`
 * @param shader its shader
 * @returns its mist look, or `null` when it can't be drawn
 */
export const fakeVolumeFogLook = (entry: ReadyMaterial, shader: ShaderEntry): EffectLook | null => {
	if (entry.blend !== 'additive') {
		return null;
	}
	const { float, color } = readers(entry, shader);
	const look = emptyEffect(7);
	const params = look.params;
	const fog = color('_FogColor') ?? [1, 1, 1, 1];
	params.set([...linearRgb(fog), fog[3] * float('_TintColorAlpha', 1)], MistRow.color);
	const walkIn = float('_canWalkIn', 0) !== 0;
	params.set(
		[
			float('_FogExponent', 1),
			float('_FogDensity', 1),
			Math.max(float('_CubEdgeFade', 1), 1e-3),
			walkIn ? 0 : Math.max(float('_NearFadeDistance', 1), 1e-3),
		],
		MistRow.volume,
	);
	params.set(
		[
			float('_HeightOffset', 0),
			float('_HeightFalloff', 0),
			float('_VerticalFalloffMin', 0),
			float('_VerticalFalloffMax', 0),
		],
		MistRow.volumeHeight,
	);
	params.set(
		[
			Math.max(float('_FogIntensityFadeDistance', 1e5), 1e-3),
			float('_FogIntensityFadeUseCenter', 0),
			float('_FogDepthStart', 0),
			float('_FogDepthEnd', 0),
		],
		MistRow.volumeFade,
	);
	params[MistRow.misc] = float('_IgnorePostExposure', 1);
	return look;
};

// #endregion
