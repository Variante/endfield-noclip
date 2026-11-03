import type {
	EffectNearFade,
	EffectSoftBody,
	EffectStackSurface,
	EffectTexture,
	EffectUvSource,
	EffectVertexOffset,
	LightBeamSurface,
	LitDecalSurface,
	MistCardSurface,
	MistVolumeSurface,
	RefractSurface,
	StackLayer,
	WaterFoamSurface,
	WaterSheetSurface,
} from '@endfield-noclip/package-format/surfaces';

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

/** each {@link StackLayer} role's {@link EffectRole} */
const ROLES: Record<StackLayer['role'], number> = {
	disturb1: EffectRole.Disturb1,
	disturb2: EffectRole.Disturb2,
	weight: EffectRole.Weight,
	mask: EffectRole.Mask,
	blend: EffectRole.Blend,
	dissolve: EffectRole.Dissolve,
	main: EffectRole.Main,
};

/** float offsets of an effect look's parameters (`MaterialLook.params`); the shader reads them as vec4 rows */
export const EffectRow = {
	/** tint rgb (times its intensity), alpha */
	tint: 0,
	/** one UV transform per texture slot: scale, offset */
	uv: 4,
	/** per slot: UV scroll per second (xy), the UV rotation's cosine and sine */
	anim: 32,
	/**
	 * per slot: role, plus 16 when its red channel is its alpha, plus 32 times its {@link SlotSource}, or
	 * {@link SLOT_NO_BASE}, plus {@link slotDisturb} of the share of the distortion its UVs take
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
	/**
	 * decals: edge fade across x, across z, the fades' width, height fade. the texture stack, which decals
	 * don't draw through: the breathing's minimum alpha, speed and power, 1 when it breathes
	 */
	decalFade: 104,
	/**
	 * decals: height fade offset, angle falloff (0: no angle fade); the texture stack: 0, then the height
	 * (world y) below which fragments show the unsupported checker (`waterBlendBelow`, {@link NO_WATER_BLEND}
	 * without), and the power its alpha is raised to (1 but for VFXDitherAlpha's `_DitherAlphaExp`)
	 */
	decal: 108,
	/**
	 * vertex offset (VFXBaseV2, VFXDitherAlpha): `_OffsetDir` xyz, then how it's read: 0 in object space, 1 in
	 * world space, 2 along the vertex normal (`_OffsetSwitchDir`)
	 */
	offsetDir: 112,
	/**
	 * vertex offset (VFXBaseV2, VFXDitherAlpha): `_OffsetIntensity`, `_Bi_Offset`, how much the vertex alpha
	 * weighs the offset, the most it pulls vertices towards the camera (`_VertCameraOffset`, m; VFXBaseV2
	 * only)
	 */
	offset: 116,
	/**
	 * VFXBaseV2: {@link VertexMotion}, 1 when the offset texture reads UV set 1, 1 when `_USE_LIGHTING` lights
	 * the colour, 1 when it lights it at the world's up rather than the surface normal
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
 * floats of an effect look's parameters, `LOOK_FLOATS` in materials.ts: the mesh looks' 32 rows, then 4 only
 * effect looks use
 */
const EFFECT_FLOATS = 144;

/**
 * how the vertex stage moves an effect's vertices ({@link EffectRow.offsetMode} x). with the soft body, the
 * {@link OFFSET_SLOT} holds the position texture, its UV row UV1's u scale and the frame rows' scale, its
 * scroll row the cycles per second and the phase; {@link EffectRow.offsetDir} holds the offset's minimum and
 * the frame count, and {@link EffectRow.offset} its range and the camera pull
 */
export const VertexMotion = {
	None: 0,
	Offset: 1,
	SoftBody: 2,
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

/** each {@link EffectUvSource}'s {@link SlotSource} */
const SOURCES: Record<EffectUvSource, SlotSource> = {
	uv0: SlotSource.Uv0,
	uv1: SlotSource.Uv1,
	polar: SlotSource.Polar,
	screen: SlotSource.Screen,
};

/**
 * {@link EffectRow.slotBits} bit of a slot whose UVs start from zero, as the game's do when the source its
 * weights pick isn't computed (polar or screen UVs without their keyword and switch)
 */
export const SLOT_NO_BASE = 128;

/**
 * the {@link EffectRow.slotBits} term for the share of the distortion a slot's UVs take (`*UseDisturb`), in
 * 1/1024ths above the low byte, which f32 holds exactly
 *
 * @param share the material's `*UseDisturb`, 0 for none and 1 for all of it
 * @returns the term to add to the slot's bits
 */
export const slotDisturb = (share: number): number => Math.round(Math.max(share, 0) * 1024) * 256;

/**
 * the texture stack's slot of the vertex offset's texture, which the vertex stage samples; its UV and scroll
 * rows hold the texture's `_ST` and scroll. VFXBaseV2's sixth sample texture shares it, so a material can't
 * have both
 */
export const OFFSET_SLOT = 6;

/** the water-blend height of a texture stack without one: below every world */
export const NO_WATER_BLEND = -1e30;

/** what an effect look puts in `MaterialLook` besides its parameters */
export interface EffectLook {
	/** texture id per slot, or -1 */
	textures: number[];
	/** largest UV scale per slot, for streaming */
	uvScales: number[];
	/** a 3D texture sampled besides the slots, or -1 */
	volumeTexture: number;
	params: Float32Array;
}

/** fills a slot's texture, UV transform, scroll and rotation, and role bits */
const setSlot = (look: EffectLook, i: number, texture: EffectTexture, bits: number): void => {
	look.textures[i] = texture.texture;
	look.uvScales[i] = Math.max(Math.abs(texture.scale[0]), Math.abs(texture.scale[1]), 1e-3);
	look.params.set([...texture.scale, ...texture.offset], EffectRow.uv + i * 4);
	look.params.set([...texture.scroll, ...texture.rotation], EffectRow.anim + i * 4);
	look.params[EffectRow.slotBits + i] = bits;
};

/** a still texture without its own transform */
const still = (texture: number): EffectTexture => ({
	texture,
	scale: [1, 1],
	offset: [0, 0],
	scroll: [0, 0],
	rotation: [1, 0],
});

/** an effect look with no textures */
const emptyEffect = (slots: number): EffectLook => {
	const params = new Float32Array(EFFECT_FLOATS);
	for (let i = 0; i < slots; i++) {
		params[EffectRow.slotBits + i] = ROLE_NONE;
		params.set([1, 1, 0, 0], EffectRow.uv + i * 4);
		params.set([0, 0, 1, 0], EffectRow.anim + i * 4);
	}
	params[EffectRow.decal + 3] = 1;
	return {
		textures: Array.from({ length: slots }, () => -1),
		uvScales: Array.from({ length: slots }, () => 1),
		volumeTexture: -1,
		params,
	};
};

/** the near camera fade's rows */
const setNear = (look: EffectLook, near: EffectNearFade): void => {
	look.params.set(near.range, EffectRow.near);
	look.params[EffectRow.misc] = near.on ? 1 : 0;
};

// #region the texture stack

/** a stack layer's {@link EffectRow.slotBits} */
const layerBits = (layer: StackLayer): number =>
	ROLES[layer.role] +
	(layer.redAlpha ? 16 : 0) +
	(layer.source === null ? SLOT_NO_BASE : SOURCES[layer.source] * 32) +
	slotDisturb(layer.disturbShare);

/** the vertex offset's slot and rows */
const setVertexOffset = (look: EffectLook, offset: EffectVertexOffset): void => {
	const params = look.params;
	setSlot(look, OFFSET_SLOT, offset.texture, ROLE_NONE);
	params.set([...offset.direction, offset.space], EffectRow.offsetDir);
	params.set([offset.intensity, offset.bias, offset.vertexAlphaWeight, offset.cameraPull], EffectRow.offset);
	params.set([VertexMotion.Offset, offset.uv1 ? 1 : 0], EffectRow.offsetMode);
};

/** the soft-body animation's slot and rows ({@link VertexMotion}) */
const setSoftBody = (look: EffectLook, body: EffectSoftBody): void => {
	const params = look.params;
	// a fixed frame is a still phase in the middle of its frame
	const rate = body.fixedFrame === null ? body.cycleRate : 0;
	const phase =
		body.fixedFrame === null ? -body.cycleStart * body.cycleRate : (body.fixedFrame + 0.5) / body.frameCount;
	setSlot(
		look,
		OFFSET_SLOT,
		{
			texture: body.texture,
			scale: [body.uScale, body.vScale],
			offset: [0, 0],
			scroll: [rate, phase],
			rotation: [1, 0],
		},
		ROLE_NONE,
	);
	params.set([...body.min, body.frameCount], EffectRow.offsetDir);
	params.set([...body.range, body.cameraPull], EffectRow.offset);
	params[EffectRow.offsetMode] = VertexMotion.SoftBody;
};

/**
 * the texture stack of VFXBaseV2, VFXDecal and VFXDitherAlpha's effect variants ({@link EffectStackSurface})
 *
 * @param stack the stack
 * @returns its look
 */
export const stackLook = (stack: EffectStackSurface): EffectLook => {
	const look = emptyEffect(7);
	const params = look.params;
	stack.layers.forEach((layer, i) => {
		if (layer !== null) {
			setSlot(look, i, layer, layerBits(layer));
		}
	});
	params.set(stack.tint, EffectRow.tint);
	params.set(stack.blendTint, EffectRow.blendTint);
	params.set(stack.disturb, EffectRow.disturb);
	params.set(
		[stack.disturbBias, stack.weight.disturb, stack.weight.dissolve, stack.weight.used ? 1 : 0],
		EffectRow.weight,
	);
	const { dissolve } = stack;
	params.set(
		[dissolve.threshold, dissolve.sharpness, dissolve.edgeWidth, dissolve.on ? 1 : 0],
		EffectRow.dissolve,
	);
	params.set([...dissolve.edgeColor, stack.masked ? 1 : 0], EffectRow.dissolveColor);
	if (stack.fresnel !== null) {
		const { fresnel } = stack;
		params.set([fresnel.power, fresnel.bias, fresnel.flip, fresnel.opacity], EffectRow.fresnel);
	}
	params.set(
		[stack.soft?.distance ?? 0, stack.soft?.bias ?? 0, stack.ignorePostExposure, stack.vertexColor ? 1 : 0],
		EffectRow.soft,
	);
	setNear(look, stack.near);
	params.set(
		[stack.brighten.threshold, stack.brighten.intensity, stack.distorted ? 1 : 0],
		EffectRow.misc + 1,
	);
	if (stack.decalFade !== null) {
		const fade = stack.decalFade;
		params.set([...fade.edge, fade.width, fade.height], EffectRow.decalFade);
		params.set([fade.heightOffset, fade.angle], EffectRow.decal);
	} else if (stack.breathing !== null) {
		const { breathing } = stack;
		params.set([breathing.minAlpha, breathing.speed, breathing.power, 1], EffectRow.decalFade);
	}
	params[EffectRow.decal + 2] = stack.waterBlendBelow ?? NO_WATER_BLEND;
	params[EffectRow.decal + 3] = stack.alphaPower;
	if (stack.offset !== null) {
		setVertexOffset(look, stack.offset);
	}
	if (stack.softBody !== null) {
		setSoftBody(look, stack.softBody);
	}
	if (stack.lighting !== null) {
		params.set([1, stack.lighting.worldUp ? 1 : 0], EffectRow.offsetMode + 2);
	}
	params.set(
		[
			stack.unfogged ? 1 : 0,
			EffectKind.Stack,
			stack.blendMode,
			(stack.screenUv.byDepth ? 1 : 0) + (stack.screenUv.heightAsV ? 2 : 0),
		],
		EffectRow.unfogged,
	);
	return look;
};

/**
 * @param look a look from {@link stackLook}
 * @returns whether it multiplies what lies behind (`_BlendMode` 2), which the transparent pass's targets
 *   can't hold, so it draws over the composited scene instead
 */
export const multipliesScene = (look: EffectLook): boolean => look.params[EffectRow.unfogged + 2] === 2;

// #endregion

// #region refraction

/**
 * float offsets of a VFXRefract look's parameters. the UV, scroll, slot bit, near fade and last rows are
 * {@link EffectRow}'s; slot 0 is `_RefractTex`, slot 1 `_MaskTex`
 */
export const RefractRow = {
	/** `_RefractDir` xy, the strength (`_Intensity · _TintColorAlpha`), `_Bi_Refract` */
	refract: 68,
	/**
	 * 1 when the refraction texture is a normal map (`_RefractIsNormal`), `_MaskTexUseRefract`, 1 with a mask,
	 * 0
	 */
	refract2: 72,
	/**
	 * the colour offsets (`_USE_RBOFFSET`): the further samples' offset in screen UVs (`_RBOffset · 0.01 ·
	 * _Intensity`), the second sample's share of it (`_GOffset`), `_RBIntensity`
	 */
	rb: 76,
	/** `_RBMainColorMask` rgb, 1 with colour offsets */
	rbMain: 80,
	/** the first further sample's colour mask rgb, `_UseMainTexAsMask` */
	rbFirst: 84,
	/** the second further sample's colour mask rgb, 1 when it's taken (`_USE_RGBOFFSET`) */
	rbSecond: 88,
	/** the dissolve (slot 2): threshold, sharpness, how much it scales the alpha, 1 when dissolving */
	dissolve: 104,
} as const;

/** a refraction slot's source bits: polar UVs about the centre, or UV set 0 */
const polarBits = (polar: boolean): number => (polar ? SlotSource.Polar : SlotSource.Uv0) * 32;

/**
 * a VFXRefract layer ({@link RefractSurface}). it samples the finished scene, so it draws over the composited
 * scene rather than in the transparent pass
 */
export const refractLook = (refract: RefractSurface): EffectLook => {
	const look = emptyEffect(7);
	const params = look.params;
	setSlot(look, 0, refract.refraction, polarBits(refract.refractionPolar));
	if (refract.mask !== null) {
		setSlot(look, 1, refract.mask.texture, polarBits(refract.mask.polar) + (refract.mask.redAlpha ? 16 : 0));
	}
	params.set([...refract.direction, refract.strength, refract.bias], RefractRow.refract);
	params.set(
		[refract.isNormal ? 1 : 0, refract.maskUsesRefraction, refract.mask === null ? 0 : 1, 0],
		RefractRow.refract2,
	);
	const offsets = refract.colorOffsets;
	if (offsets !== null) {
		params.set([...offsets.offset, offsets.secondShare, offsets.intensity], RefractRow.rb);
		params.set([...offsets.main, 1], RefractRow.rbMain);
		params.set([...offsets.first, offsets.mainAsMask], RefractRow.rbFirst);
		params.set([...(offsets.second ?? [0, 0, 1]), offsets.second === null ? 0 : 1], RefractRow.rbSecond);
	}
	const { dissolve } = refract;
	if (dissolve !== null) {
		setSlot(look, 2, dissolve.texture, polarBits(false));
		params.set([dissolve.threshold, dissolve.sharpness, dissolve.affectsAlpha, 1], RefractRow.dissolve);
	}
	params[EffectRow.soft] = refract.softDistance;
	setNear(look, refract.near);
	params.set([1, EffectKind.Refract, 0, 0], EffectRow.unfogged);
	return look;
};

// #endregion

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
	/** `_BLEND_EMISSIVE`: `_EmissiveColor` rgb, then 1 when on */
	emissive: 96,
	/**
	 * `_BLEND_EMISSIVE`: `_EmissiveChannel` (0–3 pick `_SampleTex1`'s R–A, 4 the base map's alpha),
	 * `_AlbedoAffectEmissive` (1: emission ignores the albedo), `_IgnorePostExposure`, 0
	 */
	emissiveMask: 100,
	/**
	 * 1 when the PBR map takes the placement's UV transform rather than its own (`FX_UV` + 1), then 0, 0, 0.
	 * the base map always takes the placement's, and the tint row holds `_DecalOpacity` in its alpha, which
	 * multiplies the placement's colour
	 */
	pbrPlaced: 104,
} as const;

/**
 * the slot of a lit decal's PBR map (`_SampleTex1`: normal RG, roughness B), or with `_BLEND_WATER_FLOW` its
 * water normal map (`_WaterNormalTex`: normal RG, roughness B, at world positions); its base colour is slot
 * 0
 */
export const DECAL_PBR_SLOT = 1;

/**
 * a lit decal ({@link LitDecalSurface}): its base colour map tinted by the placement's colour, with the PBR
 * map's roughness and normal (or a scrolling water normal map's), on the game's VFXDecal cube. each
 * placement's colour and UV transform come from its row
 */
export const litDecalLook = (decal: LitDecalSurface): EffectLook => {
	const look = emptyEffect(7);
	const params = look.params;
	setSlot(look, 0, still(decal.base), ROLE_NONE);
	if (decal.pbr !== null) {
		const own = decal.pbr.ownTransform;
		if (own === null) {
			setSlot(look, DECAL_PBR_SLOT, still(decal.pbr.texture), ROLE_NONE);
			params[DecalLitRow.pbrPlaced] = 1;
		} else {
			const transform = {
				scale: [own[0], own[1]] as [number, number],
				offset: [own[2], own[3]] as [number, number],
			};
			setSlot(look, DECAL_PBR_SLOT, { ...still(decal.pbr.texture), ...transform }, ROLE_NONE);
		}
	}
	params.set([1, 1, 1, decal.opacity], EffectRow.tint);
	params.set([...decal.roughness, decal.normalScale, decal.angleFade], DecalLitRow.surface);
	params.set(
		[decal.writesNormal ? 1 : 0, decal.writesRoughness ? 1 : 0, decal.blendSceneNormal],
		DecalLitRow.writes,
	);
	params.set(
		[decal.writesMetallic ? 1 : 0, decal.writesOcclusion ? 1 : 0, decal.metallic, decal.occlusionStrength],
		DecalLitRow.pbr,
	);
	params.set(
		[decal.pbrBase ? 1 : 0, decal.metallicChannel, decal.occlusionChannel, decal.affectNormal],
		DecalLitRow.channels,
	);
	const { waterFlow, emission } = decal;
	if (waterFlow !== null) {
		params.set([1, waterFlow.normalScale, waterFlow.roughness, waterFlow.normalFactor], DecalLitRow.water);
		params.set(waterFlow.movement, DecalLitRow.flow);
		params[DecalLitRow.flowFade] = waterFlow.levelFade;
	}
	if (emission !== null) {
		params.set([...emission.color, 1], DecalLitRow.emissive);
		params.set(
			[emission.channel, emission.albedoAffect, emission.ignorePostExposure],
			DecalLitRow.emissiveMask,
		);
	}
	params.set([0, EffectKind.LitDecal], EffectRow.unfogged);
	return look;
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
	/** a volumetric light beam's cone ({@link BeamRow}) */
	Beam: 3,
	/** a VFXRefract layer ({@link RefractRow}), drawn by the refraction entry point over the composited scene */
	Refract: 4,
	/** a WaterDecal box ({@link WaterFoamRow}), drawn into the water's foam by its own entry point */
	WaterFoam: 5,
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

/**
 * a VFXWater sheet ({@link WaterSheetSurface}): main, disturb, mask, dissolve, flipbook and its motion
 * vectors in slots 0–5, and slot 6 whichever normals it uses
 */
export const waterSheetLook = (sheet: WaterSheetSurface): EffectLook => {
	const look = emptyEffect(7);
	const params = look.params;
	const { textures } = sheet;
	const slots = [
		textures.main,
		textures.disturb,
		textures.mask,
		textures.dissolve,
		textures.sequence,
		textures.sequenceMotion,
	];
	slots.forEach((texture, i) => {
		if (texture !== null) {
			setSlot(look, i, texture, EffectRole.Main);
		}
	});
	let flags = 0;
	if (textures.disturb !== null) {
		flags |= WaterSheetFlags.Disturb | (sheet.disturbNormal ? WaterSheetFlags.DisturbNormal : 0);
	}
	if (textures.mask !== null) {
		flags |= WaterSheetFlags.Mask;
	}
	if (textures.dissolve !== null) {
		flags |= WaterSheetFlags.Dissolve;
	}
	if (textures.sequence !== null) {
		flags |=
			WaterSheetFlags.Sequence | (textures.sequenceMotion === null ? 0 : WaterSheetFlags.SequenceMotion);
	}
	if (textures.normals !== null) {
		setSlot(look, 6, textures.normals.texture, EffectRole.Main);
		flags |= textures.normals.flipbook ? WaterSheetFlags.SequenceNormal : WaterSheetFlags.NormalMap;
	}
	flags |=
		(sheet.mainAsAlpha ? WaterSheetFlags.MainAsAlpha : 0) |
		(sheet.maskAsAlpha ? WaterSheetFlags.MaskAsAlpha : 0) |
		(sheet.vertexOpacity ? WaterSheetFlags.VertexOpacity : 0) |
		(sheet.fresnelOpacity ? WaterSheetFlags.FresnelOpacity : 0) |
		(sheet.vertexColor ? WaterSheetFlags.VertexColor : 0);
	params.set(sheet.tint, EffectRow.tint);
	params.set([flags, sheet.blendMode, sheet.useLighting, sheet.randomUv], WaterSheetRow.flags);
	params.set([sheet.disturbBias, ...sheet.disturb, 0], WaterSheetRow.disturb);
	params.set(sheet.disturbUse, WaterSheetRow.disturbUse);
	const { dissolve, sequence } = sheet;
	params.set([dissolve.threshold, dissolve.sharpness, dissolve.edgeWidth, 0], WaterSheetRow.dissolve);
	params.set([...dissolve.edgeColor, 0], WaterSheetRow.dissolveColor);
	params.set(
		[sequence.columns, sequence.rows, sequence.framesPerSecond, sequence.randomStartByPosition],
		WaterSheetRow.sequence,
	);
	params.set(
		[sequence.motionStrength, sequence.opacityScale, sequence.opacityThreshold, sequence.colorThreshold],
		WaterSheetRow.sequenceShape,
	);
	params.set([...sequence.tint, textures.normals?.scale ?? 1], WaterSheetRow.sequenceTint);
	params.set([sheet.roughness, sheet.specular, sheet.directSpecular, sheet.fresnel], WaterSheetRow.surface);
	params.set(sheet.subsurface, WaterSheetRow.subsurface);
	params.set([0, sheet.indirectSaturation, 0, 0], WaterSheetRow.misc);
	params.set(
		[sheet.soft?.distance ?? 0, sheet.soft?.bias ?? 0, sheet.ignorePostExposure, sheet.vertexColor ? 1 : 0],
		EffectRow.soft,
	);
	setNear(look, sheet.near);
	params.set([0, EffectKind.WaterSheet, 0, 0], EffectRow.unfogged);
	return look;
};

// #endregion

// #region water foam

/**
 * float offsets of a WaterDecal look's parameters, in place of {@link EffectRow}'s rows 17–27. slots 0–3 are
 * the base colour map, disturb, mask and dissolve textures; their UV rows hold each `_ST` and their scroll
 * rows each scroll per second, which the shader applies in the game's order for each
 */
export const WaterFoamRow = {
	/** `_BaseColor` rgb, `_OverallOpacity` */
	base: 0,
	/** `_BaseColorTint` rgb, {@link WaterFoamFlags} */
	tint: 68,
	/** `_Bi_Disturb`, `_DisturbUIntensity1`, `_DisturbVIntensity1`, `_BlendMode` */
	disturb: 72,
	/** how far the distortion moves the base, mask and dissolve UVs, then `_UseAChannelAsAlpha` */
	use: 76,
	/** each slot's UV source (`WaterFoamSource` in package-format) */
	sources: 80,
	/** the mask's UV matrix, by columns */
	maskMatrix: 84,
	/** dissolve threshold, edge sharpness, glowing edge width, `_UseMaskTexAsAlpha` */
	dissolve: 88,
	/** the dissolve edge's colour (HDR), 0 */
	dissolveColor: 92,
	/** the box's UV scale and offset */
	boxUv: 96,
	/** `_EdgeFadeRange` xy, then the soft blend's bias and distance (0 without `_USE_SOFTBLEND`) */
	fade: 100,
} as const;

/** {@link WaterFoamRow.tint}'s w bits, matching `effect.wgsl` */
export const WaterFoamFlags = {
	Disturb: 1 << 0,
	Mask: 1 << 1,
	Dissolve: 1 << 2,
	EdgeFade: 1 << 3,
	ClipToBox: 1 << 4,
	Soft: 1 << 5,
} as const;

/** a WaterDecal box ({@link WaterFoamSurface}) */
export const waterFoamLook = (foam: WaterFoamSurface): EffectLook => {
	const look = emptyEffect(7);
	const params = look.params;
	const { textures } = foam;
	[textures.base, textures.disturb, textures.mask, textures.dissolve].forEach((texture, i) => {
		if (texture !== null) {
			setSlot(look, i, texture, EffectRole.Main);
		}
	});
	const flags =
		(textures.disturb === null ? 0 : WaterFoamFlags.Disturb) |
		(textures.mask === null ? 0 : WaterFoamFlags.Mask) |
		(foam.dissolve === null ? 0 : WaterFoamFlags.Dissolve) |
		(foam.edgeFade === null ? 0 : WaterFoamFlags.EdgeFade) |
		(foam.clipToBox ? WaterFoamFlags.ClipToBox : 0) |
		(foam.soft === null ? 0 : WaterFoamFlags.Soft);
	params.set([...foam.baseColor, foam.opacity], WaterFoamRow.base);
	params.set([...foam.tint, flags], WaterFoamRow.tint);
	params.set([foam.disturbBias, ...foam.disturb, foam.blendMode], WaterFoamRow.disturb);
	params.set([...foam.disturbUse, foam.baseAlpha], WaterFoamRow.use);
	const { sources } = foam;
	params.set([sources.base, sources.disturb, sources.mask, sources.dissolve], WaterFoamRow.sources);
	params.set(foam.maskMatrix, WaterFoamRow.maskMatrix);
	const dissolve = foam.dissolve;
	params.set(
		[dissolve?.threshold ?? 0, dissolve?.sharpness ?? 1, dissolve?.edgeWidth ?? 0, foam.maskAsAlpha],
		WaterFoamRow.dissolve,
	);
	params.set([...(dissolve?.edgeColor ?? [0, 0, 0]), 0], WaterFoamRow.dissolveColor);
	params.set(foam.boxUv, WaterFoamRow.boxUv);
	params.set(
		[...(foam.edgeFade ?? [0, 0]), foam.soft?.bias ?? 0, foam.soft?.distance ?? 0],
		WaterFoamRow.fade,
	);
	params.set([0, EffectKind.WaterFoam, 0, 0], EffectRow.unfogged);
	return look;
};

// #endregion

// #region mist

/**
 * float offsets of a mist look's parameters (`mistCardLook`, `mistVolumeLook`), in place of {@link EffectRow}
 * for the mist entry points of `effect.wgsl`. the UV rows are shared
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
	/** volumes: the 3D noise's tiling xyz, 1 to sample it at the world position (else the box's) */
	volumeNoise: 72,
	/** volumes: the 3D noise's scroll per second xyz (`_NoiseUVWDir1 · _NoiseUVWSpeed1`), 0 */
	volumeNoiseFlow: 76,
	/**
	 * volumes: `_NoiseIntensity` (near), `_NoiseFarIntensity`, 0.1 / `_NoiseFar` (per metre towards far), 1
	 * with the noise (`_USE_NOISE3D` and its texture)
	 */
	volumeNoiseMix: 80,
} as const;

/** the slot index of a card's noise texture; its main texture is slot 0 */
export const MIST_NOISE_SLOT = 1;

/** a mist card ({@link MistCardSurface}): its main texture in slot 0, its noise in {@link MIST_NOISE_SLOT} */
export const mistCardLook = (card: MistCardSurface): EffectLook => {
	const look = emptyEffect(7);
	const params = look.params;
	setSlot(
		look,
		0,
		{ ...still(card.main.texture), scale: card.main.scale, offset: card.main.offset },
		ROLE_NONE,
	);
	setSlot(
		look,
		MIST_NOISE_SLOT,
		{ ...still(card.noise.texture), scale: card.noise.scale, offset: card.noise.offset },
		ROLE_NONE,
	);
	const { wind } = card;
	params.set(card.color, MistRow.color);
	params.set([card.baseAlphaIntensity, card.noiseIntensity, card.useWind, wind.noiseIntensity], MistRow.card);
	params.set([wind.noiseContrast, ...wind.scale, wind.speed], MistRow.wind);
	params.set([...wind.direction, card.lit ? 1 : 0, card.lightFactor], MistRow.light);
	params.set([...card.indirectColor, card.additive ? 1 : 0], MistRow.indirect);
	params.set([...card.distanceFade, ...card.nearFade], MistRow.fade);
	params.set([card.topFade.contrast, card.topFade.offset, card.softDistance], MistRow.top);
	return look;
};

/** a mist box ({@link MistVolumeSurface}), its noise the look's volume texture */
export const mistVolumeLook = (volume: MistVolumeSurface): EffectLook => {
	const look = emptyEffect(7);
	const params = look.params;
	params.set(volume.color, MistRow.color);
	params.set([volume.exponent, volume.density, volume.edgeFade, volume.nearFade], MistRow.volume);
	params.set(
		[volume.height.offset, volume.height.falloff, ...volume.height.verticalFalloff],
		MistRow.volumeHeight,
	);
	params.set(
		[volume.intensityFadeDistance, volume.intensityFadeFromCentre, ...volume.depth],
		MistRow.volumeFade,
	);
	params[MistRow.misc] = volume.ignorePostExposure;
	const { noise } = volume;
	if (noise !== null) {
		look.volumeTexture = noise.texture;
		params.set([...noise.tiling, noise.world], MistRow.volumeNoise);
		params.set(noise.flow, MistRow.volumeNoiseFlow);
		params.set([noise.nearIntensity, noise.farIntensity, noise.farPerMetre, 1], MistRow.volumeNoiseMix);
	}
	return look;
};

// #endregion

// #region light beams

/**
 * float offsets of a light beam's parameters (`lightBeamLook`), in place of {@link EffectRow}'s rows 0–9.
 * lengths are in the beam's own units, before its transform's scale. row 31 is shared
 */
export const BeamRow = {
	/** `_ColorFlat`: linear colour, alpha */
	color: 0,
	/** `_ConeParams0`: start and end radius, the side's normal (cosine and sine of the half angle) */
	cone: 4,
	/** `_ConeParams1`: the beam's direction xyz, 1 when the start cap is drawn */
	direction: 8,
	/** `_DistanceFallOff`: attenuation start and end, length, the fade-in length from the start (0: none) */
	falloff: 12,
	/** `_AlphaInside`, `_AlphaOutside`, `_AttenuationLerpLinearQuad`, `_FresnelPow` */
	alpha: 16,
	/** `_GlareFrontal`, `_GlareBehind`, the apex's offset behind the start (`_ConeGeomProps`), `_BlendMode` */
	glare: 20,
	/** distance fade start and end, second start and end (camera to the beam's origin, m) */
	fade: 24,
	/**
	 * the near camera fade's length (`_DistanceCamClipping`), the depth blend distance (0 without
	 * `VLB_DEPTH_BLEND`), `_DepthBlendCapOff`, `_UseClippingPlane`
	 */
	clip: 28,
	/** `_AdditionalClippingPlaneWS`: world-space normal, offset */
	plane: 32,
	/** `_TiltVectorX`, `_TiltVectorY`, `_ClippingPlaneTransition`, 0 */
	tilt: 36,
} as const;

/** a volumetric light beam ({@link LightBeamSurface}), drawn on its cone mesh */
export const lightBeamLook = (beam: LightBeamSurface): EffectLook => {
	const look = emptyEffect(7);
	const params = look.params;
	const additive = beam.additive ? 1 : 0;
	params.set(beam.color, BeamRow.color);
	params.set(beam.cone, BeamRow.cone);
	params.set(beam.direction, BeamRow.direction);
	params.set(beam.falloff, BeamRow.falloff);
	params.set([beam.alphaInside, beam.alphaOutside, beam.attenuationLerp, beam.fresnelPower], BeamRow.alpha);
	params.set([beam.glareFrontal, beam.glareBehind, beam.apexOffset, additive], BeamRow.glare);
	params.set([...beam.distanceFade, ...beam.distanceFadeSecond], BeamRow.fade);
	params.set(
		[beam.cameraClipping, beam.depthBlend, beam.depthBlendCapOff, beam.useClippingPlane],
		BeamRow.clip,
	);
	params.set(beam.clippingPlane, BeamRow.plane);
	params.set([...beam.tilt, beam.clippingPlaneTransition], BeamRow.tilt);
	params.set([beam.unfogged ? 1 : 0, EffectKind.Beam, additive, 0], EffectRow.unfogged);
	return look;
};

// #endregion
