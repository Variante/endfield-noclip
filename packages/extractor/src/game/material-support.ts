/**
 * what the viewer draws of a material, for the pack's debug index: the keywords of the surface shaders it
 * reads, so a material's other keywords can be listed as not drawn, and the shaders it has no look for. the
 * lists mirror what `viewer/src/render/materials.ts` reads; effect shaders check their keywords there and
 * fall back to the unsupported look on any they don't draw.
 */

import type { ShaderFamily } from '@endfield-noclip/package-format/materials';

/** keywords every surface look reads: the alpha test and both emission sources */
const SURFACE_KEYWORDS = ['_ALPHATEST_ON', '_EMISSIVE_MAP', '_EMISSIVE_MASK'];

/** Lit's own layers, which `HGRP/LitEffect` shares */
const LIT_KEYWORDS = [
	...SURFACE_KEYWORDS,
	'_TWO_BASEMAP',
	'_EMISSIVE_ANIM',
	'_TRI_CHANNEL_MASK',
	// only the R channel blends (docs/status.md)
	'_TRI_CHANNEL_MASK_SWITCH_TEXTURE',
	'_TRI_CHANNEL_MASK_SWITCH_TEXTURE_GWITHNORMAL',
	'_DETAIL_MAP',
	'_PARALLAX_MAP',
	'_LAYERBLEND_TOP',
	'_LAYERBLEND_MASK',
	'_LAYERBLEND_MOSS',
];

/** the keywords the viewer reads, by surface shader */
const DRAWN_KEYWORDS: ReadonlyMap<string, ReadonlySet<string>> = new Map(
	Object.entries({
		'HGRP/Lit': LIT_KEYWORDS,
		'HGRP/LitEffect': LIT_KEYWORDS,
		'HGRP/LitTransparent': [...SURFACE_KEYWORDS, '_TWO_BASEMAP'],
		'HGRP/Foliage/Trunk': [...SURFACE_KEYWORDS, '_TWO_BASEMAP'],
		'HGRP/Foliage/Leaf': [...SURFACE_KEYWORDS, '_NORMAL_MAP', '_CANOPY_COLOR_RAMP'],
		'HGRP/Foliage/Grass': [...SURFACE_KEYWORDS, '_NORMAL_MAP', '_USE_CAMERA_BASED_TILLING'],
		'HGRP/Foliage/Grass Cardmesh Lod': [...SURFACE_KEYWORDS, '_NORMAL_MAP', '_USE_CAMERA_BASED_TILLING'],
		// the tree card LOD's own inputs aren't decoded
		'HGRP/Foliage/TreeFoliageCardMeshLod': [...SURFACE_KEYWORDS, '_NORMAL_MAP'],
		'HGRP/LitHLOD': SURFACE_KEYWORDS,
		'HGRP/MattePainting': SURFACE_KEYWORDS,
		'HGRP/Erosion': SURFACE_KEYWORDS,
	}).map(([shader, keywords]) => [shader, new Set(keywords)]),
);

/**
 * @param shader a material's shader name
 * @param keywords its enabled keywords
 * @returns the keywords of a surface shader that the viewer doesn't draw; empty for effect shaders, whose
 *   looks reject materials with keywords they don't draw
 */
export const keywordsNotDrawn = (shader: string, keywords: readonly string[]): string[] => {
	const drawn = DRAWN_KEYWORDS.get(shader);
	return drawn === undefined ? [] : keywords.filter((keyword) => !drawn.has(keyword));
};

/**
 * shaders of the `unknown` family the viewer leaves undrawn on purpose, as the game draws nothing visible
 * with them (`UNDRAWN_SHADERS` in the viewer's materials.ts)
 */
const UNDRAWN_SHADERS = new Set(['HGRP/Effect/VFXReflectionPass']);

/**
 * @param family a material's shader family
 * @param shader its shader name
 * @returns why the viewer has no look for the material, or `null` when it has one or leaves it undrawn on
 *   purpose
 */
export const unsupportedShader = (family: ShaderFamily, shader: string): string | null => {
	return family === 'unknown' && !UNDRAWN_SHADERS.has(shader)
		? 'the viewer has no look for this shader'
		: null;
};
