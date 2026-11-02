/**
 * surface describers for the shaders the viewer shades as surfaces: what each draws, from its properties and
 * keywords (`docs/game-data/materials.md`).
 */

import type {
	DitheredSurface,
	ErosionSurface,
	MattePaintingSurface,
	Rgb,
	TiledTexture,
	UnsupportedSurface,
} from '@endfield-noclip/package-format/surfaces';

import { linearRgb, type MaterialReader, scaleRgb } from './material-values.ts';

/** @returns an unsupported surface for `reason` */
export const unsupported = (reason: string): UnsupportedSurface => ({ kind: 'unsupported', reason });

// #region matte paintings

/**
 * `HGRP/MattePainting` (`docs/game-data/materials.md#matte-paintings`)
 *
 * @param reader the material's properties
 * @returns its surface
 */
export const describeMattePainting = (reader: MaterialReader): MattePaintingSurface => {
	const { float, color, material } = reader;
	const slot = reader.slot('_MainTex');
	const tint = color('_TintColor') ?? [1, 1, 1, 1];
	const intensity = float('_TintColorIntensity', 1);
	// the alpha test on the texture's alpha alone: saturate(a · scale) < clip ⇔ a < clip / scale while clip ≤ 1;
	// past 1 everything is discarded
	let alphaClip: number | null = null;
	const clip = material.alphaClipThreshold;
	if (clip !== null && clip > 0) {
		const scale = tint[3] * float('_TintColorAlpha', 1);
		alphaClip = clip > 1 || scale <= 0 ? 2 : clip / scale;
	}
	return {
		kind: 'mattePainting',
		texture: slot !== undefined && slot.uv === 0 ? slot : null,
		color: scaleRgb(linearRgb(tint), intensity),
		alphaClip,
		highlight: { threshold: float('_ExpThreshold', 1), intensity: float('_ExpIntensity', 0) },
		ignorePostExposure: float('_IgnorePostExposure', 1),
	};
};

// #endregion

// #region dithered effects

/** keywords a `HGRP/Effect/VFXDitherAlpha` material can have and still be drawn as a dithered surface */
const DITHERED_KEYWORDS = new Set(['_NORMAL_MAP', '_USE_MAIN2']);

/**
 * `HGRP/Effect/VFXDitherAlpha` and its variants as an opaque G-buffer surface
 * (`docs/game-data/effects.md#solid-effects`)
 *
 * @param reader the material's properties
 * @returns its surface, or `unsupported` with keywords or texture combinations the viewer doesn't draw
 */
export const describeDithered = (reader: MaterialReader): DitheredSurface | UnsupportedSurface => {
	const { float, color, has, material } = reader;
	const unknown = material.keywords.filter((keyword) => !DITHERED_KEYWORDS.has(keyword));
	if (unknown.length > 0) {
		return unsupported(`keywords ${unknown.join(', ')}`);
	}
	let second: Rgb = [1, 1, 1];
	if (has('_USE_MAIN2')) {
		if (float('_UseMainTex2AsAlpha', 0) === 0 || float('_MainTex2BlendMode', 0) !== 0) {
			return unsupported('a second texture that colours or blends rather than masks');
		}
		second = linearRgb(color('_MainTex2Color') ?? [1, 1, 1, 1]);
	}
	const redAlpha = float('_UseMainTexAsAlpha', 0) !== 0;
	const main = reader.slot('_MainTex');
	const normal = has('_NORMAL_MAP') ? reader.slot('_NormalMap') : undefined;
	// the geometry's UV set 0 is all the shader reads
	if ((main !== undefined && main.uv !== 0) || (normal !== undefined && normal.uv !== 0)) {
		return unsupported('a texture on a UV set other than 0');
	}
	const lit = float('_UseLighting', 1) !== 0;
	// the depth pass's dithered alpha test, which shapes meshes such as the soft dark disc at the centre of
	// Power Plateau's sky vortex. the viewer draws it for the main texture's alpha (or red, as the alpha alone,
	// on unlit surfaces) in the default dither mode
	let dither: DitheredSurface['dither'] = null;
	if (main !== undefined && !has('_USE_MAIN2') && float('_DitherAlphaMode', 0) === 0 && (!redAlpha || !lit)) {
		dither = {
			texture: main,
			redAlpha,
			alphaScale: (color('_TintColor') ?? [1, 1, 1, 1])[3] * float('_TintColorAlpha', 1),
			exponent: float('_DitherAlphaExp', 1),
			tiling: float('_DitherTilling', 1),
		};
	}
	const tint = scaleRgb(linearRgb(color('_TintColor') ?? [1, 1, 1, 1]), float('_TintColorIntensity', 1));
	return {
		kind: 'dithered',
		baseMap: redAlpha ? null : (main ?? null),
		normalMap: normal ?? null,
		color: [tint[0] * second[0], tint[1] * second[1], tint[2] * second[2]],
		dither,
		lighting: lit
			? {
					roughness: float('_Roughness', 1),
					metallic: float('_Metallic', 0),
					normalScale: float('_NormalScale', 1),
				}
			: null,
		ignorePostExposure: float('_IgnorePostExposure', 1),
	};
};

// #endregion

// #region erosion

/**
 * `HGRP/Erosion` (`docs/game-data/materials.md#erosion`). every map samples UV set 0 and tiles by its own
 * property rather than its `_ST`; the metal, noise and flow colours are HDR and used as stored
 *
 * @param reader the material's properties
 * @returns its surface
 */
export const describeErosion = (reader: MaterialReader): ErosionSurface => {
	const { float, color } = reader;
	const tiled = (name: string, tiling: string | null): TiledTexture | null => {
		const slot = reader.slot(name);
		return slot === undefined
			? null
			: { texture: slot.texture, tiling: tiling === null ? 1 : float(tiling, 1) };
	};
	const hdr = (name: string): Rgb => {
		const value = color(name) ?? [1, 1, 1, 1];
		return [value[0], value[1], value[2]];
	};
	return {
		kind: 'erosion',
		textures: {
			baseNormal: tiled('_BaseNormalMap', '_BaseNormalTilling'),
			metalMix: tiled('_MetalMixMap', null),
			flowRamp: reader.slot('_FlowRampMap')?.texture ?? null,
			detailNormal: tiled('_DetailNormalMap', '_DetailNormalTilling'),
			noisePattern: tiled('_NoisePatternMap', '_NoisePatternMapTilling'),
		},
		baseColor: linearRgb(color('_BaseColor') ?? [1, 1, 1, 1]),
		roughness: float('_Roughness', 0),
		detailRoughnessCover: float('_DetailRoughnessCover', 0),
		metallic: float('_Metallic', 0),
		metallicOffset: float('_MetallicOffset', 0),
		metallicColor: hdr('_MetallicColor'),
		normalScale: float('_NormalScale', 1),
		detailNormalScale: float('_DetailNormalScale', 1),
		occlusionStrength: float('_OcclusionStrength', 1),
		f0: 0.08 * float('_Specular', 0.5),
		noise: {
			depth: float('_NoiseStrength', 0),
			tint: hdr('_NoisePatternTintColor'),
			alphaTint: hdr('_NoisePatternAlphaTintColor'),
			min: float('_NoiseMin', 0),
			emissiveStrength: float('_NoiseEmissiveStrength', 0),
			fadeDistance: float('_DistanceBlend', 1),
		},
		flow: {
			tiling: float('_FlowNormalTilling', 0),
			noiseStrength: float('_FlowNoiseStrength', 0),
			// 0.05 · speed per second (docs/game-data/materials.md#clock)
			scroll: 0.05 * float('_FlowNormalSpeed', 0),
			speedOffset: float('_FlowSpeedOffset', 0),
			colorOffset: float('_FlowColorOffset', 0),
			top: hdr('_FlowTopColor'),
			bottom: hdr('_FlowBottomColor'),
			colorStrength: float('_FlowColorStrength', 0),
			emissiveStrength: float('_FlowColorEmissiveStrength', 0),
			roughness: float('_FlowRoughness', 0),
		},
	};
};

// #endregion
