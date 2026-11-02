/**
 * surface describers for the effect shaders (`docs/game-data/effects.md`): what each draws, from its
 * properties and keywords, or `unsupported` with the keywords or combinations the viewer doesn't draw.
 */

import type {
	FadeRange,
	LightBeamSurface,
	MistCardSurface,
	MistVolumeSurface,
	UnsupportedSurface,
} from '@endfield-noclip/package-format/surfaces';

import { BlendFactor } from './material-classify.ts';
import { linearRgb, type MaterialReader, unsupported } from './material-values.ts';

/** @returns `unsupported` naming the material's keywords outside `drawn`, or `null` when it has none */
export const undrawnKeywords = (
	reader: MaterialReader,
	drawn: ReadonlySet<string>,
): UnsupportedSurface | null => {
	const undrawn = reader.material.keywords.filter((keyword) => !drawn.has(keyword));
	return undrawn.length === 0 ? null : unsupported(`keywords ${undrawn.join(', ')}`);
};

/** a fade between two view depths that also works with equal ends (then a step at the start) */
const fadeRange = (start: number, end: number): FadeRange =>
	Math.abs(end - start) < 1e-4 ? [start, start + 1e-4] : [start, end];

// #region mist

/**
 * card keywords that are drawn. `_USE_LIGHTING` lights by the mesh normal rather than the game's normal map,
 * and `_USE_FOG`'s own fog isn't drawn (premultiplied cards take the composite's fog, additive ones none)
 */
const MIST_CARD_KEYWORDS = new Set(['_USE_FOG', '_USE_SOFTBLEND', '_USE_LIGHTING']);

/**
 * `HGRP/FogSimple` (`docs/game-data/effects.md#mist`)
 *
 * @param reader the material's properties
 * @returns its surface, or `unsupported`
 */
export const describeMistCard = (reader: MaterialReader): MistCardSurface | UnsupportedSurface => {
	const { float, colorOrVector: color, has, material } = reader;
	if (material.blend !== 'premultiplied' && material.blend !== 'additive') {
		return unsupported(`${material.blend} blending`);
	}
	const keywords = undrawnKeywords(reader, MIST_CARD_KEYWORDS);
	if (keywords !== null) {
		return keywords;
	}
	const main = reader.slot('_MainTex');
	const noise = reader.slot('_NoiseTex');
	if (main === undefined || noise === undefined) {
		return unsupported('no main or noise texture');
	}
	if (main.uv > 1 || noise.uv > 1) {
		return unsupported('a texture on a UV set past 1');
	}
	const separate = float('_UseSeparateScale', 0) !== 0;
	const windScale = float('_WindScale', 1);
	// `_BaseColor` and `_IndirectColor` are [HDR]: authored linear, used as stored
	const indirect = color('_IndirectColor') ?? [0, 0, 0, 1];
	return {
		kind: 'mistCard',
		main,
		noise,
		color: color('_BaseColor') ?? [1, 1, 1, 1],
		baseAlphaIntensity: float('_BaseAlphaIntensity', 1),
		noiseIntensity: float('_FogNoiseIntensity', 0),
		useWind: float('_UseWind', 0),
		wind: {
			noiseIntensity: float('_WindNoiseIntensity', 0),
			noiseContrast: float('_WindNoiseContrast', 0),
			scale: [
				windScale * (separate ? float('_WindScaleX', 1) : 1),
				windScale * (separate ? float('_WindScaleY', 1) : 1),
			],
			speed: float('_WindSpeed', 0),
			direction: [float('_WindDirX', 1), float('_WindDirY', 0)],
		},
		lit: has('_USE_LIGHTING') && float('_UseLighting', 0) !== 0,
		lightFactor: float('_LightFactor', 0),
		indirectColor: [indirect[0], indirect[1], indirect[2]],
		additive: material.blend === 'additive',
		distanceFade: fadeRange(float('_DistanceFadeStart', 0), float('_DistanceFadeEnd', 0)),
		nearFade: fadeRange(float('_NearCameraFadeDistanceStart', 0), float('_NearCameraFadeDistanceEnd', 0)),
		topFade: { contrast: float('_TopFadeContract', 1), offset: float('_TopFadeOffset', 0) },
		softDistance: has('_USE_SOFTBLEND') ? Math.max(float('_SoftDistance', 1), 1e-3) : 0,
	};
};

/**
 * `HGRP/Effect/VFXFakeVolumeFog` (`docs/game-data/effects.md#mist`), drawn only when additive
 *
 * @param reader the material's properties
 * @returns its surface, or `unsupported`
 */
export const describeMistVolume = (reader: MaterialReader): MistVolumeSurface | UnsupportedSurface => {
	const { float, colorOrVector: color, has, material } = reader;
	if (material.blend !== 'additive') {
		return unsupported(`${material.blend} blending`);
	}
	const fog = color('_FogColor') ?? [1, 1, 1, 1];
	const noiseSlot = reader.slot('_NoiseTex3D');
	let noise: MistVolumeSurface['noise'] = null;
	if (has('_USE_NOISE3D') && noiseSlot !== undefined) {
		const tiling = color('_NoiseTexTilling1') ?? [1, 1, 1, 1];
		const dir = color('_NoiseUVWDir1') ?? [0, 0, 0, 0];
		const speed = float('_NoiseUVWSpeed1', 0);
		noise = {
			texture: noiseSlot.texture,
			tiling: [tiling[0], tiling[1], tiling[2]],
			world: float('_NoiseTexUseWorldUVW', 1),
			flow: [dir[0] * speed, dir[1] * speed, dir[2] * speed],
			nearIntensity: float('_NoiseIntensity', 1),
			farIntensity: float('_NoiseFarIntensity', 1),
			farPerMetre: 0.1 / Math.max(float('_NoiseFar', 1), 1e-3),
		};
	}
	return {
		kind: 'mistVolume',
		color: [...linearRgb(fog), fog[3] * float('_TintColorAlpha', 1)],
		exponent: float('_FogExponent', 1),
		density: float('_FogDensity', 1),
		edgeFade: Math.max(float('_CubEdgeFade', 1), 1e-3),
		nearFade: float('_canWalkIn', 0) !== 0 ? 0 : Math.max(float('_NearFadeDistance', 1), 1e-3),
		height: {
			offset: float('_HeightOffset', 0),
			falloff: float('_HeightFalloff', 0),
			verticalFalloff: [float('_VerticalFalloffMin', 0), float('_VerticalFalloffMax', 0)],
		},
		intensityFadeDistance: Math.max(float('_FogIntensityFadeDistance', 1e5), 1e-3),
		intensityFadeFromCentre: float('_FogIntensityFadeUseCenter', 0),
		depth: [float('_FogDepthStart', 0), float('_FogDepthEnd', 0)],
		ignorePostExposure: float('_IgnorePostExposure', 1),
		noise,
	};
};

// #endregion

// #region light beams

/**
 * beam keywords that are drawn. `VLB_NOISE_3D`'s noise is left out; under `VLB_USE_FOG`, alpha-blended beams
 * take the composite's fog and additive ones stay unfogged
 */
const BEAM_KEYWORDS = new Set(['VLB_DEPTH_BLEND', 'VLB_NOISE_3D', 'VLB_USE_FOG']);

/**
 * `Hidden/VLB_*` (`docs/game-data/lighting.md#light-beams`)
 *
 * @param reader the material's properties
 * @returns its surface, or `unsupported` for keywords or blending the viewer doesn't draw
 */
export const describeLightBeam = (reader: MaterialReader): LightBeamSurface | UnsupportedSurface => {
	const { float, colorOrVector, has } = reader;
	const keywords = undrawnKeywords(reader, BEAM_KEYWORDS);
	if (keywords !== null) {
		return keywords;
	}
	const blendMode = float('_BlendMode', 0);
	const src = float('_BlendSrcFactor', BlendFactor.One);
	const dst = float('_BlendDstFactor', BlendFactor.One);
	const additive = blendMode === 1 && src === BlendFactor.One && dst === BlendFactor.One;
	const blended = blendMode === 0 && src === BlendFactor.SrcAlpha && dst === BlendFactor.OneMinusSrcAlpha;
	if (!additive && !blended) {
		return unsupported(`blend mode ${blendMode} with factors ${src}, ${dst}`);
	}
	const flat = colorOrVector('_ColorFlat') ?? [1, 1, 1, 1];
	return {
		kind: 'lightBeam',
		color: [...linearRgb(flat), flat[3]],
		cone: colorOrVector('_ConeParams0') ?? [1, 1, 1, 0],
		direction: colorOrVector('_ConeParams1') ?? [0, 0, 1, 0],
		falloff: colorOrVector('_DistanceFallOff') ?? [0, 1, 1, 0],
		alphaInside: float('_AlphaInside', 1),
		alphaOutside: float('_AlphaOutside', 1),
		attenuationLerp: float('_AttenuationLerpLinearQuad', 0.5),
		fresnelPower: float('_FresnelPow', 1),
		glareFrontal: float('_GlareFrontal', 0.5),
		glareBehind: float('_GlareBehind', 0.5),
		apexOffset: float('_ConeGeomProps', 0),
		additive,
		distanceFade: fadeRange(float('_DistanceFadeStart', 0), float('_DistanceFadeEnd', 1)),
		distanceFadeSecond: fadeRange(float('_DistanceFadeStartSecond', 0), float('_DistanceFadeEndSecond', 0)),
		cameraClipping: float('_DistanceCamClipping', 0.5),
		depthBlend: has('VLB_DEPTH_BLEND') ? float('_DepthBlendDistance', 2) : 0,
		depthBlendCapOff: float('_DepthBlendCapOff', 0),
		useClippingPlane: float('_UseClippingPlane', 0),
		clippingPlane: colorOrVector('_AdditionalClippingPlaneWS') ?? [0, 1, 0, 0],
		tilt: [float('_TiltVectorX', 0), float('_TiltVectorY', 0)],
		clippingPlaneTransition: Math.max(float('_ClippingPlaneTransition', 1), 1e-4),
		unfogged: !has('VLB_USE_FOG'),
	};
};

// #endregion
