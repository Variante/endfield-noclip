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
	| MattePaintingSurface
	| ErosionSurface;

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
