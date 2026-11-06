import type { MaterialCull, MaterialTable } from '@endfield-noclip/package-format/materials';
import type { EffectStencil, StencilMaskSurface } from '@endfield-noclip/package-format/surfaces';

import {
	type EffectLook,
	lightBeamLook,
	litDecalLook,
	mistCardLook,
	mistVolumeLook,
	multipliesScene,
	refractLook,
	sixWaySmokeLook,
	stackLook,
	waterFoamLook,
	waterSheetLook,
} from './effect-looks.ts';
import { litLook } from './lit-look.ts';
import {
	emptyLook,
	LookFlags,
	LookRow,
	type LookStencil,
	type MaterialLook,
	type ScreenEffect,
} from './look.ts';
import { ditheredLook, erosionLook, mattePaintingLook } from './special-looks.ts';

/** {@link unsupportedLook}'s colour, linear magenta */
const UNSUPPORTED_COLOR: [r: number, g: number, b: number] = [1, 0, 1];

/** the side of {@link unsupportedLook}'s checker cells, in metres */
const UNSUPPORTED_CELL = 0.5;

/**
 * unsupported material: a world-space magenta/black checker, unlit and exposure-independent. draws both faces
 * and casts no shadow. also the look of `DrawRole.Unsupported` stand-ins
 *
 * @returns a new look
 */
export const unsupportedLook = (): MaterialLook => {
	const look = emptyLook({ drawn: true });
	look.unsupported = true;
	look.castsShadows = false;
	look.flags |= LookFlags.Unlit;
	look.params.set([...UNSUPPORTED_COLOR, -1], LookRow.tint);
	look.params.set([1, 0, UNSUPPORTED_CELL], LookRow.surface);
	look.params[LookRow.emissive2 + 2] = 1;
	return look;
};

// #region stencils

/** a depth comparison under the viewer's reversed-Z */
const reversedDepthCompare = (compare: GPUCompareFunction): GPUCompareFunction => {
	switch (compare) {
		case 'less': {
			return 'greater';
		}
		case 'less-equal': {
			return 'greater-equal';
		}
		case 'greater': {
			return 'less';
		}
		case 'greater-equal': {
			return 'less-equal';
		}
		default: {
			return compare;
		}
	}
};

/** an effect's stencil state as the viewer draws it: the depth test under reversed-Z */
const lookStencilOf = (stencil: EffectStencil, maskOnly: boolean): LookStencil => ({
	...stencil,
	depthCompare: reversedDepthCompare(stencil.depthCompare),
	maskOnly,
});

/** the stencil-only look of a portal's mask ({@link StencilMaskSurface}) */
const stencilMaskLook = (mask: StencilMaskSurface, cull: MaterialCull): MaterialLook => {
	const look = emptyLook({ drawn: true });
	look.cull = cull;
	look.castsShadows = false;
	look.stencil = lookStencilOf(mask.stencil, true);
	return look;
};

// #endregion

/**
 * @param materials the package's material table
 * @returns a look per material id
 */
export const materialLooks = (materials: MaterialTable): MaterialLook[] => {
	const looks: MaterialLook[] = [];
	for (const entry of materials.entries) {
		// a material that didn't convert (its reason is in debug/assets.json) has nothing to draw by
		if (entry.status !== 'ready') {
			looks[entry.id] = unsupportedLook();
			continue;
		}
		const surface = entry.surface;
		switch (surface.kind) {
			case 'undrawn': {
				looks[entry.id] = emptyLook({ drawn: false });
				break;
			}
			case 'unsupported': {
				looks[entry.id] = unsupportedLook();
				break;
			}
			case 'mattePainting': {
				looks[entry.id] = mattePaintingLook(surface, entry.cull);
				break;
			}
			case 'erosion': {
				looks[entry.id] = erosionLook(surface, entry.cull);
				break;
			}
			case 'dithered': {
				looks[entry.id] = ditheredLook(surface, entry.cull);
				break;
			}
			case 'lit': {
				looks[entry.id] = litLook(surface, entry.cull);
				break;
			}
			case 'mistCard': {
				looks[entry.id] = effectMaterialLook(mistCardLook(surface), {
					flags: LookFlags.Effect | LookFlags.EffectMist,
					cull: entry.cull,
				});
				break;
			}
			case 'mistVolume': {
				looks[entry.id] = effectMaterialLook(mistVolumeLook(surface), {
					flags: LookFlags.Effect | LookFlags.EffectMist | LookFlags.EffectDecal,
					cull: entry.cull,
				});
				break;
			}
			case 'lightBeam': {
				looks[entry.id] = effectMaterialLook(lightBeamLook(surface), {
					flags: LookFlags.Effect,
					cull: entry.cull,
				});
				break;
			}
			case 'effectStack': {
				const effect = stackLook(surface);
				looks[entry.id] = effectMaterialLook(effect, {
					flags: LookFlags.Effect | (surface.variant === 'decal' ? LookFlags.EffectDecal : 0),
					cull: entry.cull,
					stencil: surface.stencil === null ? null : lookStencilOf(surface.stencil, false),
					// drawn over the composited scene
					screen: multipliesScene(effect) ? 'multiply' : null,
				});
				break;
			}
			case 'stencilMask': {
				looks[entry.id] = stencilMaskLook(surface, entry.cull);
				break;
			}
			case 'waterSheet': {
				looks[entry.id] = effectMaterialLook(waterSheetLook(surface), {
					flags: LookFlags.Effect,
					cull: entry.cull,
				});
				break;
			}
			case 'sixWaySmoke': {
				looks[entry.id] = effectMaterialLook(sixWaySmokeLook(surface), {
					flags: LookFlags.Effect,
					cull: entry.cull,
				});
				break;
			}
			case 'litDecal': {
				looks[entry.id] = effectMaterialLook(litDecalLook(surface), {
					flags: LookFlags.Effect | LookFlags.EffectDecal,
					cull: entry.cull,
					relight: surface.relight,
				});
				break;
			}
			case 'refract': {
				looks[entry.id] = effectMaterialLook(refractLook(surface), {
					flags: LookFlags.Effect,
					cull: entry.cull,
					screen: 'refract',
				});
				break;
			}
			case 'waterFoam': {
				looks[entry.id] = effectMaterialLook(waterFoamLook(surface), {
					flags: LookFlags.Effect,
					cull: entry.cull,
					screen: surface.depthTest === 'lessEqual' ? 'waterFoam' : 'waterFoamBehind',
				});
				break;
			}
		}
	}
	return looks;
};

/**
 * @returns the look of a scene effect: alpha-blended and shadowless. decal boxes draw their back faces, so
 *   they still show with the camera inside them
 */
const effectMaterialLook = (
	effect: EffectLook,
	{
		flags,
		cull,
		stencil = null,
		relight = false,
		screen = null,
	}: {
		/** {@link LookFlags.Effect} and the kind's flags */
		flags: number;
		cull: MaterialCull;
		stencil?: LookStencil | null;
		relight?: boolean;
		screen?: ScreenEffect | null;
	},
): MaterialLook => ({
	drawn: true,
	unsupported: false,
	cutout: false,
	transparent: true,
	cull: (flags & LookFlags.EffectDecal) !== 0 ? 'front' : cull,
	castsShadows: false,
	textures: effect.textures,
	uvScales: effect.uvScales,
	volumeTexture: effect.volumeTexture,
	flags,
	params: effect.params,
	stencil,
	relight,
	screen,
});
