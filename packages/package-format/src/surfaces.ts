/**
 * what a material draws, as the extractor interprets its shader, keywords and properties: one description per
 * shading model, with the game's property names, keyword rules and unit conversions already applied. the
 * viewer turns a description into its draw parameters without reading Unity properties.
 *
 * @module
 */

import type { TextureSlot } from './materials.ts';

/**
 * a material's surface: a model the viewer draws, `undrawn` for materials the game draws nothing visible
 * with, or `unsupported` for materials the viewer has no faithful look for
 */
export type MaterialSurface =
	| LegacySurface
	| UndrawnSurface
	| UnsupportedSurface
	| LitSurface
	| MattePaintingSurface
	| ErosionSurface
	| DitheredSurface;

/** a texture sampled on UV set 0, tiled by a scale of its own in place of its `_ST` */
export interface TiledTexture {
	/** index into the texture table */
	texture: number;
	tiling: number;
}

/** a linear RGB colour */
export type Rgb = [r: number, g: number, b: number];

/** a material whose family hasn't moved to a description yet: the viewer reads its raw properties */
export interface LegacySurface {
	kind: 'legacy';
}

/** a material the game draws nothing visible with */
export interface UndrawnSurface {
	kind: 'undrawn';
	/** why, for the debug index */
	reason: string;
}

/** a material the viewer can't draw faithfully; it shows as the unsupported checker */
export interface UnsupportedSurface {
	kind: 'unsupported';
	/** what the viewer lacks, for the debug index */
	reason: string;
}

// #region lit

/**
 * the HGRP Lit model and the shaders that share it: `HGRP/Lit`, `HGRP/LitEffect`, `HGRP/LitTransparent`
 * glass, `HGRP/LitHLOD`, the trunks, leaves, grass and their card LODs (`docs/game-data/materials.md`).
 * optional parts are `null` when the material's keywords or textures leave them off
 */
export interface LitSurface {
	kind: 'lit';
	/**
	 * how the maps pack their channels (`docs/game-data/materials.md#texture-layouts`): `mro` an MRO map and an
	 * `RAG` normal map; `twoBasemap` roughness in the normal map's B and occlusion in its A; `roughnessInB`
	 * (foliage outside the layout switch) roughness in B alone; `plain` a plain normal map
	 */
	layout: 'mro' | 'twoBasemap' | 'roughnessInB' | 'plain';
	/** `twoBasemap` with `_BaseTextureMapCount` 1: metallic is the base colour's alpha */
	metallicFromBaseAlpha: boolean;
	textures: {
		base: TextureSlot | null;
		normal: TextureSlot | null;
		/** the `mro` layout's MRO map */
		mro: TextureSlot | null;
		/** `_EMISSIVE_MAP`'s map; its R scales the emission */
		emissive: TextureSlot | null;
	};
	/** the alpha-test threshold, or `null` without alpha testing */
	alphaClip: number | null;
	/** the alpha tested (and, for glass, the opacity) is the normal map's rather than the base colour's */
	alphaFromNormal: boolean;
	/**
	 * `opaque`, or glass blended over what lies behind: `alphaBlend` by its opacity, `premultiplied` adding its
	 * radiance whole
	 */
	blend: 'opaque' | 'alphaBlend' | 'premultiplied';
	/** glass: the opacity before the texture's alpha (`_BaseColor.a`) */
	opacity: number;
	/** the base colour's tint, linear (white for `HGRP/LitHLOD`, which ignores it) */
	tint: Rgb;
	/** how much the tint covers the base colour (1 untextured) */
	tintCover: number;
	/** the base colour's brightening, before the tint covers it */
	brighterScale: number;
	/** roughness read from a map is remapped between these */
	roughness: [min: number, max: number];
	metallic: number;
	normalScale: number;
	occlusionStrength: number;
	/** Fresnel reflectance at normal incidence */
	f0: number;
	/** foliage transmission (0 elsewhere) */
	transmission: number;
	emission: LitEmission | null;
	/** `_TRI_CHANNEL_MASK`'s channels R, G, B (`docs/game-data/materials.md#lit-layers`) */
	triChannel: { mask: TextureSlot; channels: [MaskChannel, MaskChannel, MaskChannel] } | null;
	detail: LitDetail | null;
	/** the parallax glow or the second layer, which share their textures' slots */
	overlay: ParallaxGlow | LitLayer | null;
	foliage: LeafInputs | GrassInputs | CardInputs | null;
	/** the surface keeps `HGRP/DecalLit` decals off (`docs/game-data/materials.md#decals`) */
	keepsLitDecalsOff: boolean;
}

/** a Lit surface's emission (`docs/game-data/materials.md#emission`) */
export interface LitEmission {
	/** HDR, as stored */
	color: Rgb;
	/** `map`: the emissive map's R; `mask`: a channel of the material's own maps */
	source: 'map' | 'mask';
	/** `_EmissiveMaskChannel` */
	maskChannel: number;
	/** 1 when emission ignores the albedo (`_AlbedoAffectEmissive`) */
	albedoAffect: number;
	/** 1 when emission keeps its brightness whatever the exposure */
	ignorePostExposure: number;
	/** `_EMISSIVE_ANIM`'s pulse, `null` when still */
	pulse: {
		/** cycles per second */
		rate: number;
		/** `_EmissiveAnimRandom` */
		phase: number;
		/** the share of a cycle the pulse takes */
		interval: number;
		minimum: number;
		/** how much it dims the emission (`_EmissiveColor.a`) */
		depth: number;
	} | null;
}

/** one tri-channel mask channel */
export interface MaskChannel {
	/** the albedo blended toward, linear */
	albedo: Rgb;
	/** how strongly it blends (0 for channels the viewer can't read) */
	strength: number;
	roughness: number;
	metallic: number;
	/** contrast */
	scale: number;
	offset: number;
}

/** `_DETAIL_MAP` */
export interface LitDetail {
	texture: TextureSlot;
	/** 0 colour overlay, 1 PBR */
	mode: number;
	/** where the weight comes from (`_DetailMaskMode`) */
	maskMode: number;
	normalIntensity: number;
	pbrIntensity: number;
	/** view depths where it starts and finishes fading out */
	fade: [start: number, end: number];
	brighterScale: number;
	/** colour mode's overlay, linear, and how much it covers */
	overlay: Rgb;
	overlayCover: number;
}

/** `_PARALLAX_MAP`'s glow; both maps ignore their `_ST` and tile by their own scale */
export interface ParallaxGlow {
	kind: 'parallax';
	/** the pattern, on its own UV set; its G picks between the colours */
	pattern: TextureSlot;
	patternTiling: number;
	/** the height field marched through, on the pattern's UV set */
	noise: number;
	noiseTiling: number;
	depth: number;
	/** march steps, 1–20 */
	steps: number;
	fresnelPower: number;
	/** the pulse: phase per second, phase per metre of the object's position, then its range */
	pulseRate: number;
	pulsePhasePerMetre: number;
	pulseMinimum: number;
	/** HDR colours times the intensity */
	bright: Rgb;
	dark: Rgb;
	/** numbered like the emission mask, minus one */
	maskChannel: number;
	ignorePostExposure: number;
	/** the brightening near the player: radii and strength (0 for none) */
	near: { outer: number; inner: number; strength: number };
}

/** what decides how much a Lit layer covers */
export type LayerCoverage =
	| { kind: 'top' }
	/** `_LayerBlendMaskMap`'s R, untiled, on UV set 0 or 1 */
	| { kind: 'maskMap'; texture: number; uv: number }
	| { kind: 'layerBumpAlpha' }
	| { kind: 'baseAlpha' }
	| { kind: 'normalAlpha' }
	| { kind: 'full' };

/** `_LAYERBLEND_TOP` and `_LAYERBLEND_MASK`, with `_LAYERBLEND_MOSS` */
export interface LitLayer {
	kind: 'layer';
	/** both sampled at one coordinate, tiled and offset by the layer's own values */
	base: number;
	bump: number;
	tiling: number;
	offset: [u: number, v: number];
	/** 0 UV set 0, 1 world XZ, 2 UV set 2 */
	uvType: number;
	coverage: LayerCoverage;
	/** how much the bumped normal decides top coverage, its threshold and smoothness */
	top: { bumped: number; threshold: number; smoothness: number };
	/** the height blend's transition, `null` without it */
	heightTransition: number | null;
	/** linear tint times its brightening, and how much colour it keeps (saturation) */
	tint: Rgb;
	saturation: number;
	/** 0 replace, 1 add */
	colorBlendMode: number;
	additiveIntensity: number;
	metallicType: number;
	metallic: number;
	bumpScale: number;
	baseNormalIntensity: number;
	aoStrength: number;
	aoType: number;
	/** `_LAYERBLEND_MOSS`'s fuzz */
	moss: {
		coreDarkness: number;
		edgeBrightness: number;
		edgeShadowRange: number;
		edgeShadowOffset: number;
		edgeShadowIntensity: number;
		darkPower: number;
		brightPower: number;
		normalStrength: number;
	} | null;
}

/** `HGRP/Foliage/Leaf`'s inputs to the foliage lighting (`docs/game-data/materials.md#foliage`) */
export interface LeafInputs {
	kind: 'leaf';
	occlusionShadow: number;
	fakeShadow: { strength: number; power: number };
	diffuseUsesVertexNormal: number;
	/** the vertex AO ranges that fade transmission and subsurface in */
	aoTransmission: [start: number, range: number];
	aoSubsurface: [start: number, range: number];
	subsurface: number;
	transmissionDistanceFade: number;
	/** `_CANOPY_COLOR_RAMP`, `null` without it */
	canopy: {
		intensity: number;
		startsAtTop: boolean;
		range: number;
		transition: number;
		brighterScale: number;
		cover: number;
		color: Rgb;
	} | null;
}

/** `HGRP/Foliage/Grass` and its card LOD's inputs (`docs/game-data/materials.md#foliage`) */
export interface GrassInputs {
	kind: 'grass';
	/** the card LOD decodes its normal map its own way and takes neither the bend nor the masks */
	bendNormalUpward: number;
	/** the lean away from the camera's intensity (0 without `_USE_CAMERA_BASED_TILLING`) */
	cameraLean: number;
	maskOnDiffuse: number;
	maskOnTransmission: number;
	twoSidedNormal: boolean;
	subsurface: number;
	/** the occlusion and sun mask ramps: start height, rate, strength */
	ao: [start: number, rate: number, strength: number];
	sunMask: [start: number, rate: number, strength: number];
}

/** `HGRP/Foliage/TreeFoliageCardMeshLod`, whose own inputs aren't decoded: plain foliage */
export interface CardInputs {
	kind: 'card';
}

// #endregion

/**
 * `HGRP/MattePainting`, an unlit painted backdrop (`docs/game-data/materials.md#matte-paintings`). it casts
 * no shadows
 */
export interface MattePaintingSurface {
	kind: 'mattePainting';
	/** the painting, on UV set 0; `null` without one */
	texture: TextureSlot | null;
	/** the radiance the texture is multiplied by (the tint times its intensity), linear */
	color: Rgb;
	/**
	 * the threshold the texture's alpha alone is tested against, with the alpha scale folded in (2 when
	 * everything is discarded); `null` without alpha testing
	 */
	alphaClip: number | null;
	/** what exceeds `threshold` is added again times `intensity` */
	highlight: { threshold: number; intensity: number };
	/** 1 when the radiance ignores the post exposure (`_IgnorePostExposure`) */
	ignorePostExposure: number;
}

/**
 * an `HGRP/Effect/VFXDitherAlpha` material drawn as an opaque G-buffer surface
 * (`docs/game-data/effects.md#solid-effects`): its colour lit, or unlit as radiance, optionally cut out where
 * its alpha loses to a dither. it casts no shadows
 */
export interface DitheredSurface {
	kind: 'dithered';
	/** the main texture, on UV set 0; `null` when it's only the alpha (its red) or unbound */
	baseMap: TextureSlot | null;
	/** on UV set 0, with `_NORMAL_MAP` */
	normalMap: TextureSlot | null;
	/** the tint times its intensity (and the second texture's colour), linear */
	color: Rgb;
	/** the depth pass's dithered alpha test, `null` without it */
	dither: {
		/** the main texture, whose alpha (or red) is tested */
		texture: TextureSlot;
		/** 1 when the red is the alpha (`_UseMainTexAsAlpha`) */
		redAlpha: boolean;
		/** the tint's alpha times `_TintColorAlpha` */
		alphaScale: number;
		/** the power the alpha is raised to, which sets the share of pixels that survive */
		exponent: number;
		/** the dither pattern's tiling */
		tiling: number;
	} | null;
	/** the lit surface's inputs; `null` when unlit (`_UseLighting` off) */
	lighting: { roughness: number; metallic: number; normalScale: number } | null;
	/** unlit: 1 when the radiance ignores the post exposure */
	ignorePostExposure: number;
}

/**
 * `HGRP/Erosion`, the blight-covered rock (`docs/game-data/materials.md#erosion`). colours are linear; the
 * metal, noise and flow colours are HDR
 */
export interface ErosionSurface {
	kind: 'erosion';
	textures: {
		baseNormal: TiledTexture | null;
		/** R metal (0) or not, G occlusion, B the flow band's mask */
		metalMix: TiledTexture | null;
		/** sampled at a coordinate of its own, not by UV */
		flowRamp: number | null;
		detailNormal: TiledTexture | null;
		/** the noise layer: the parallax march samples it untiled, the colour lookup tiled */
		noisePattern: TiledTexture | null;
	};
	baseColor: Rgb;
	roughness: number;
	/** how far roughness blends toward the detail normal map's alpha */
	detailRoughnessCover: number;
	metallic: number;
	/** subtracted from the metal mask before it scales `metallic` */
	metallicOffset: number;
	metallicColor: Rgb;
	normalScale: number;
	detailNormalScale: number;
	occlusionStrength: number;
	/** Fresnel reflectance at normal incidence */
	f0: number;
	noise: {
		/** how deep the parallax step reaches */
		depth: number;
		tint: Rgb;
		/** tint where the base normal map's alpha is set */
		alphaTint: Rgb;
		/** the floor of the `N·V` scale */
		min: number;
		/** how much of it goes to emission */
		emissiveStrength: number;
		/** metres over which it fades out with distance */
		fadeDistance: number;
	};
	flow: {
		/** object-space height tiling of the ramp */
		tiling: number;
		/** how much the metal map's G shifts the ramp */
		noiseStrength: number;
		/** ramp scroll per second */
		scroll: number;
		speedOffset: number;
		/** the height splitting the bottom and top colours */
		colorOffset: number;
		top: Rgb;
		bottom: Rgb;
		/** how much of it is added to the colour where the metal map's B is set */
		colorStrength: number;
		/** how much of it is added to emission elsewhere */
		emissiveStrength: number;
		/** roughness lowered per unit of its brightness */
		roughness: number;
	};
}
