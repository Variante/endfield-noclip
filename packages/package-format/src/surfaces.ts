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
	| UndrawnSurface
	| UnsupportedSurface
	| LitSurface
	| MattePaintingSurface
	| ErosionSurface
	| DitheredSurface
	| MistCardSurface
	| MistVolumeSurface
	| LightBeamSurface
	| EffectStackSurface
	| StencilMaskSurface
	| WaterSheetSurface
	| LitDecalSurface
	| RefractSurface;

/** an RGBA colour */
export type Rgba = [r: number, g: number, b: number, a: number];

/** a texture sampled on UV set 0, tiled by a scale of its own in place of its `_ST` */
export interface TiledTexture {
	/** index into the texture table */
	texture: number;
	tiling: number;
}

/** a linear RGB colour */
export type Rgb = [r: number, g: number, b: number];

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

// #region mist and beams

/** a fade between two view depths in metres, the ends at least 1e-4 apart */
export type FadeRange = [start: number, end: number];

/** `HGRP/FogSimple`, a mist card (`docs/game-data/effects.md#mist`) */
export interface MistCardSurface {
	kind: 'mistCard';
	main: TextureSlot;
	noise: TextureSlot;
	/** HDR, as stored, with its alpha */
	color: Rgba;
	baseAlphaIntensity: number;
	noiseIntensity: number;
	/** 1 when the wind moves the noise */
	useWind: number;
	wind: {
		noiseIntensity: number;
		noiseContrast: number;
		/** the wind noise's UV scale in u and v */
		scale: [u: number, v: number];
		speed: number;
		direction: [x: number, y: number];
	};
	/** lit by the mesh normal (`_USE_LIGHTING` and `_UseLighting`) */
	lit: boolean;
	lightFactor: number;
	/** HDR, as stored */
	indirectColor: Rgb;
	/** additive rather than premultiplied */
	additive: boolean;
	distanceFade: FadeRange;
	nearFade: FadeRange;
	topFade: { contrast: number; offset: number };
	/** the soft blend's distance, 0 without `_USE_SOFTBLEND` */
	softDistance: number;
}

/** `HGRP/Effect/VFXFakeVolumeFog`, an additive mist box (`docs/game-data/effects.md#mist`) */
export interface MistVolumeSurface {
	kind: 'mistVolume';
	/** linear, with the alpha times `_TintColorAlpha` */
	color: Rgba;
	exponent: number;
	density: number;
	edgeFade: number;
	/** the fade towards the camera's distance, 0 for boxes the player walks into */
	nearFade: number;
	height: { offset: number; falloff: number; verticalFalloff: [min: number, max: number] };
	intensityFadeDistance: number;
	/** 1 to measure the intensity fade from the box's centre */
	intensityFadeFromCentre: number;
	depth: [start: number, end: number];
	ignorePostExposure: number;
	/** `_USE_NOISE3D`'s noise, `null` without it */
	noise: {
		/** a 3D texture */
		texture: number;
		tiling: [x: number, y: number, z: number];
		/** 1 to sample it at the world position, else the box's */
		world: number;
		/** scroll per second */
		flow: [x: number, y: number, z: number];
		nearIntensity: number;
		farIntensity: number;
		/** towards far, per metre */
		farPerMetre: number;
	} | null;
}

/** `Hidden/VLB_*`, a volumetric light beam on its cone (`docs/game-data/lighting.md#light-beams`) */
export interface LightBeamSurface {
	kind: 'lightBeam';
	/** linear, with its alpha */
	color: Rgba;
	/** `_ConeParams0`: start and end radius, the side's normal (cosine and sine of the half angle) */
	cone: Rgba;
	/** `_ConeParams1`: the direction xyz, 1 when the start cap is drawn */
	direction: Rgba;
	/** `_DistanceFallOff`: attenuation start and end, length, fade-in length */
	falloff: Rgba;
	alphaInside: number;
	alphaOutside: number;
	attenuationLerp: number;
	fresnelPower: number;
	glareFrontal: number;
	glareBehind: number;
	/** the apex's offset behind the start (`_ConeGeomProps`) */
	apexOffset: number;
	/** additive (one, one) rather than alpha-blended */
	additive: boolean;
	distanceFade: FadeRange;
	distanceFadeSecond: FadeRange;
	/** the near camera fade's length */
	cameraClipping: number;
	/** the depth blend distance, 0 without `VLB_DEPTH_BLEND` */
	depthBlend: number;
	depthBlendCapOff: number;
	useClippingPlane: number;
	/** world-space normal, offset */
	clippingPlane: Rgba;
	tilt: [x: number, y: number];
	clippingPlaneTransition: number;
	/** drawn without fog (no `VLB_USE_FOG`) */
	unfogged: boolean;
}

// #endregion

// #region effects

/** a texture an effect samples, with its UV transform and animation */
export interface EffectTexture {
	/** index into the texture table, or -1 for an unset slot whose shader defaults to white */
	texture: number;
	/** `uv' = uv · scale + offset` */
	scale: [u: number, v: number];
	offset: [u: number, v: number];
	/** UV scroll per second */
	scroll: [u: number, v: number];
	/** the UV rotation's cosine and sine */
	rotation: [cos: number, sin: number];
}

/** what a texture-stack layer's texture does (`docs/game-data/effects.md`) */
export type EffectRole = 'disturb1' | 'disturb2' | 'weight' | 'mask' | 'blend' | 'dissolve' | 'main';

/** where a layer's UVs start: a mesh UV set, polar coordinates about the UV centre, or the screen */
export type EffectUvSource = 'uv0' | 'uv1' | 'polar' | 'screen';

/** a texture of an effect's stack */
export interface StackLayer extends EffectTexture {
	role: EffectRole;
	/** its red is its alpha */
	redAlpha: boolean;
	/** where its UVs start; `null` from zero, as the game's do when the source isn't computed */
	source: EffectUvSource | null;
	/** the share of the distortion its UVs take */
	disturbShare: number;
}

/** a Unity `CompareFunction`, as WebGPU names it */
export type EffectCompare =
	| 'never'
	| 'less'
	| 'equal'
	| 'less-equal'
	| 'greater'
	| 'not-equal'
	| 'greater-equal'
	| 'always';

/** a stencil test and write, and the depth test that goes with it (`_Stencil*`, `_ZTest`) */
export interface EffectStencil {
	compare: EffectCompare;
	/** passing fragments write the reference (Unity's Replace); the rest keep the stencil */
	replace: boolean;
	reference: number;
	readMask: number;
	writeMask: number;
	/** the depth test, in Unity's (forward) depth */
	depthCompare: EffectCompare;
}

/** the vertex offset of VFXBaseV2 and VFXDitherAlpha: along a direction by a texture's red */
export interface EffectVertexOffset {
	/** read after its `_ST`, unscaled and unrotated */
	texture: EffectTexture;
	/** samples UV set 1 rather than 0 */
	uv1: boolean;
	direction: [x: number, y: number, z: number];
	/** 0 object space, 1 world space, 2 along the vertex normal */
	space: number;
	intensity: number;
	/** `_Bi_Offset`'s remap */
	bias: number;
	/** how much the vertex alpha weighs it (VFXBaseV2) */
	vertexAlphaWeight: number;
	/** the most it pulls vertices towards the camera, in metres (VFXBaseV2) */
	cameraPull: number;
}

/**
 * VFXBaseV2's soft-body vertex animation (`_VAT_SOFTBODY`, Houdini's vertex animation textures): each vertex
 * moves by a position texture's texel at its UV1 column and the current frame's row
 * (`docs/game-data/effects.md`)
 */
export interface EffectSoftBody {
	/** the position texture (`_PositionTexture`), sampled at its own coordinates, without its `_ST` */
	texture: number;
	/** the object-space offset is `range · texel + min`; textures of HDR offsets store them as they are */
	min: [x: number, y: number, z: number];
	range: [x: number, y: number, z: number];
	frameCount: number;
	/**
	 * the frame is `floor(fract((time − cycleStart) · cycleRate) · frameCount)`, or `fixedFrame` when not
	 * `null`
	 */
	cycleRate: number;
	cycleStart: number;
	fixedFrame: number | null;
	/** UV1's u is scaled by `uScale`, and the frame rows by `vScale` (the padding the bounds' digits encode) */
	uScale: number;
	vScale: number;
	/** the most it pulls vertices towards the camera, in metres (`_VertCameraOffset`) */
	cameraPull: number;
}

/** the fades by view depth every effect shader shares */
export interface EffectNearFade {
	on: boolean;
	/** start, end, second start, second end */
	range: [number, number, number, number];
}

/** the dissolve of the texture stack */
export interface EffectDissolve {
	on: boolean;
	/** sweeps from below 0 to past 1 as the schedule goes from 0 to 1 */
	threshold: number;
	sharpness: number;
	edgeWidth: number;
	/** HDR, times the tint intensity */
	edgeColor: Rgb;
}

/**
 * the texture stack of `HGRP/Effect/VFXBaseV2`, `HGRP/Effect/VFXDecal` and VFXDitherAlpha's effect variants
 * (`docs/game-data/effects.md`)
 */
export interface EffectStackSurface {
	kind: 'effectStack';
	/** VFXDecal boxes project onto the surfaces inside them */
	variant: 'base' | 'decal' | 'dither';
	/** seven slots; the last is the vertex offset's when there is one */
	layers: (StackLayer | null)[];
	/** linear rgb times its intensity, alpha */
	tint: Rgba;
	/** the blend layer's tint (HDR) and how strongly it covers */
	blendTint: Rgba;
	/** distortion per unit of the first and second disturb texture: u1, v1, u2, v2 */
	disturb: [number, number, number, number];
	/** `_Bi_Disturb` */
	disturbBias: number;
	/** `_USE_DISTURB`/`_UseDisturb`: the distortion is on */
	distorted: boolean;
	/** the weight texture's strength on the distortion and on the dissolve, and whether it's used */
	weight: { disturb: number; dissolve: number; used: boolean };
	dissolve: EffectDissolve;
	/** a mask is used: one switched on without a texture in that role leaves nothing, as in the game */
	masked: boolean;
	fresnel: { power: number; bias: number; flip: number; opacity: number } | null;
	soft: { distance: number; bias: number } | null;
	ignorePostExposure: number;
	vertexColor: boolean;
	near: EffectNearFade;
	brighten: { threshold: number; intensity: number };
	/** VFXDecal's fades: across x and z, their width, the height fade and its offset, the angle falloff */
	decalFade: {
		edge: [x: number, z: number];
		width: number;
		height: number;
		heightOffset: number;
		angle: number;
	} | null;
	/** the power the alpha is raised to (VFXDitherAlpha's `_DitherAlphaExp`) */
	alphaPower: number;
	offset: EffectVertexOffset | null;
	/** VFXBaseV2's soft-body animation, which takes the vertex offset's slot */
	softBody: EffectSoftBody | null;
	/** `_USE_LIGHTING`: lit at the world's up rather than the surface normal */
	lighting: { worldUp: boolean } | null;
	/** drawn after the fog (no `_USE_FOG`); VFXDitherAlpha's G-buffer surface is fogged */
	unfogged: boolean;
	/** VFXBaseV2's `_BlendMode`: 0 blends over, 1 adds, 2 multiplies what lies behind */
	blendMode: number;
	/** screen UVs scale by the object's view depth, and take v from the world height */
	screenUv: { byDepth: boolean; heightAsV: boolean };
	stencil: EffectStencil | null;
}

/** an opaque VFXBaseV2 material that only writes the stencil: a portal's mask */
export interface StencilMaskSurface {
	kind: 'stencilMask';
	stencil: EffectStencil;
}

/** `HGRP/Effect/VFXWater`, a sheet of falling water (`docs/game-data/effects.md#waterfalls`) */
export interface WaterSheetSurface {
	kind: 'waterSheet';
	/** HDR, as stored, times its intensity, with the alpha */
	tint: Rgba;
	textures: {
		main: EffectTexture | null;
		disturb: EffectTexture | null;
		mask: EffectTexture | null;
		dissolve: EffectTexture | null;
		/** the flipbook, sampled at its frames' UVs as they are */
		sequence: EffectTexture | null;
		sequenceMotion: EffectTexture | null;
		/** the flipbook's normals, or a normal map */
		normals: { texture: EffectTexture; flipbook: boolean; scale: number } | null;
	};
	/** the disturb texture holds a normal */
	disturbNormal: boolean;
	mainAsAlpha: boolean;
	maskAsAlpha: boolean;
	vertexOpacity: boolean;
	fresnelOpacity: boolean;
	vertexColor: boolean;
	/** 1 additive */
	blendMode: number;
	useLighting: number;
	randomUv: number;
	disturbBias: number;
	disturb: [u: number, v: number];
	/** how far the distortion moves the main, mask, normal map and dissolve UVs */
	disturbUse: [main: number, mask: number, normal: number, dissolve: number];
	dissolve: EffectDissolve;
	sequence: {
		columns: number;
		rows: number;
		framesPerSecond: number;
		randomStartByPosition: number;
		motionStrength: number;
		opacityScale: number;
		opacityThreshold: number;
		colorThreshold: number;
		/** linear */
		tint: Rgb;
	};
	roughness: number;
	specular: number;
	directSpecular: number;
	fresnel: number;
	/** hue, saturation, value (0 without `_SUBSURFACE`), indirect strength */
	subsurface: [hue: number, saturation: number, value: number, indirect: number];
	indirectSaturation: number;
	soft: { distance: number; bias: number } | null;
	ignorePostExposure: number;
	near: EffectNearFade;
}

/**
 * `HGRP/DecalLit`, a projected decal of the scenery (`docs/game-data/materials.md#decals`). each placement's
 * colour and UV transform are its instance row's (`DecalPlacements` in instances.ts)
 */
export interface LitDecalSurface {
	kind: 'litDecal';
	/** the base colour map, through the placement's UV transform */
	base: number;
	/** `_DecalOpacity`, which multiplies the placement's alpha */
	opacity: number;
	/**
	 * the PBR map (normal RG, roughness B): through the placement's UV transform, or its own `_ST` of the box's
	 * UVs (`ownTransform`); or with `_BLEND_WATER_FLOW` the water normal map at world positions, its scale per
	 * metre
	 */
	pbr: { texture: number; ownTransform: [number, number, number, number] | null } | null;
	/** it writes no albedo: drawn by adding its change to the surface's light */
	relight: boolean;
	roughness: [min: number, max: number];
	normalScale: number;
	/** the angle fade's power, 0 without `_NORMAL_ANGLE_BLEND` */
	angleFade: number;
	writesNormal: boolean;
	writesRoughness: boolean;
	writesMetallic: boolean;
	writesOcclusion: boolean;
	blendSceneNormal: number;
	metallic: number;
	occlusionStrength: number;
	/** the base map is the PBR map and the colour stands alone */
	pbrBase: boolean;
	metallicChannel: number;
	occlusionChannel: number;
	affectNormal: number;
	/** `_BLEND_WATER_FLOW` */
	waterFlow: {
		normalScale: number;
		roughness: number;
		normalFactor: number;
		/** the two layers' scroll speeds, then their UV scales */
		movement: Rgba;
		levelFade: number;
	} | null;
	/** `_BLEND_EMISSIVE` */
	emission: { color: Rgb; channel: number; albedoAffect: number; ignorePostExposure: number } | null;
}

/** `HGRP/Effect/VFXRefract`, the scene behind seen at an offset (`docs/game-data/effects.md#refraction`) */
export interface RefractSurface {
	kind: 'refract';
	refraction: EffectTexture;
	refractionPolar: boolean;
	mask: { texture: EffectTexture; polar: boolean; redAlpha: boolean } | null;
	direction: [u: number, v: number];
	/** `_Intensity · _TintColorAlpha` */
	strength: number;
	bias: number;
	isNormal: boolean;
	maskUsesRefraction: number;
	/** `_USE_RBOFFSET`'s colour offsets, `null` without */
	colorOffsets: {
		/** in screen UVs */
		offset: [u: number, v: number];
		secondShare: number;
		intensity: number;
		/** linear colour masks */
		main: Rgb;
		first: Rgb;
		mainAsMask: number;
		/** `_USE_RGBOFFSET`'s second further sample */
		second: Rgb | null;
	} | null;
	/**
	 * `_USE_DISSOLVE`, `null` without: the dissolve texture's red past the threshold, times the sharpness and
	 * saturated, scales the offset, and the alpha by `affectsAlpha`
	 */
	dissolve: {
		texture: EffectTexture;
		/** sweeps from below 0 to past 1 as the schedule goes from 0 to 1 */
		threshold: number;
		sharpness: number;
		/** `_DissolveAffectBlend` */
		affectsAlpha: number;
	} | null;
	softDistance: number;
	near: EffectNearFade;
}

// #endregion
