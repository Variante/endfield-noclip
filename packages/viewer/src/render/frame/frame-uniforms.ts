/**
 * the TS side of `frame.wgsl`'s `Frame` struct.
 *
 * @module
 */

import { BLOCK_SLOT_BITS } from '../../content/instance-rows.ts';
import clipmapWgsl from '../lighting/irradiance-clipmap.wgsl?raw';
import { LOCAL_LIGHTS_WGSL } from '../lighting/local-lights.ts';
import luminanceWgsl from '../shaders/common/luminance.wgsl?raw';
import noiseWgsl from '../shaders/common/noise.wgsl?raw';
import octahedralWgsl from '../shaders/common/octahedral.wgsl?raw';
import phaseWgsl from '../shaders/common/phase.wgsl?raw';
import reflectionSurfaceWgsl from '../shaders/common/reflection-surface.wgsl?raw';
import { wgslConst } from '../shaders/wgsl-const.ts';

import brdfWgsl from './brdf.wgsl?raw';
import frameWgsl from './frame.wgsl?raw';

/** the TS constants frame.wgsl reads */
const CONSTANTS_WGSL = [LOCAL_LIGHTS_WGSL, wgslConst('BLOCK_SLOT_BITS', 'u32', BLOCK_SLOT_BITS)].join('\n');

/** WGSL source of the frame uniforms and shared lighting helpers, prepended to every family */
export const FRAME_WGSL = [
	CONSTANTS_WGSL,
	brdfWgsl,
	noiseWgsl,
	luminanceWgsl,
	phaseWgsl,
	octahedralWgsl,
	reflectionSurfaceWgsl,
	clipmapWgsl,
	frameWgsl,
].join('\n');

/** byte size of `Frame` */
export const FRAME_UNIFORM_BYTES = 928;

/** float offsets of `Frame` fields */
export const FrameOffsets = {
	// camera
	viewProj: 0,
	eye: 16,
	viewForward: 20,
	viewRight: 24,
	viewUp: 28,
	viewport: 32,
	renderSize: 36,
	// lighting
	sun: 40,
	sunColor: 44,
	/** 7 vec4s */
	sh: 48,
	ambient: 76,
	/** three vec4s: irradiance clipmap centres, w = filled */
	irradiance: 80,
	/** light count, tiles across and down, near plane */
	localLights: 92,
	// terrain and debug
	terrain: 96,
	/** u32 */
	flags: 100,
	params: 104,
	// shadows
	/** four mat4s */
	shadowMatrices: 108,
	shadowFade: 172,
	shadowPenumbra: 176,
	/** four vec4s */
	shadowSpheres: 180,
	shadowLook: 196,
	// weather
	/** four vec4s, see `Frame.cloud_shadow` */
	cloudShadow: 200,
	/** three vec4s, see `Frame.wetness` */
	wetness: 216,
	/** see `Frame.wind` */
	wind: 228,
} as const;

/**
 * what the viewer shows instead of the lit image, in the order of their `Frame.flags.y` codes: material
 * channels, and `clouds`, the raw cloud panorama in place of the sky
 */
export const DEBUG_VIEWS = ['lit', 'albedo', 'normals', 'roughness', 'ambient', 'clouds'] as const;

export type DebugView = (typeof DEBUG_VIEWS)[number];
