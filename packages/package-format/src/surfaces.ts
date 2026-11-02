/**
 * what a material draws, as the extractor interprets its shader, keywords and properties: one description per
 * shading model, with the game's property names, keyword rules and unit conversions already applied. the
 * viewer turns a description into its draw parameters without reading Unity properties.
 *
 * @module
 */

/**
 * a material's surface: a model the viewer draws, `undrawn` for materials the game draws nothing visible
 * with, or `unsupported` for materials the viewer has no faithful look for
 */
export type MaterialSurface = LegacySurface | UndrawnSurface | UnsupportedSurface;

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
