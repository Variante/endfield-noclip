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
export type MaterialSurface = LegacySurface | UndrawnSurface | UnsupportedSurface | MattePaintingSurface;

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
