/**
 * surface describers for the shaders the viewer shades as surfaces: what each draws, from its properties and
 * keywords (`docs/game-data/materials.md`).
 */

import type {
	ErosionSurface,
	MattePaintingSurface,
	Rgb,
	TiledTexture,
} from '@endfield-noclip/package-format/surfaces';

import { linearRgb, type MaterialReader, scaleRgb } from './material-values.ts';

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
