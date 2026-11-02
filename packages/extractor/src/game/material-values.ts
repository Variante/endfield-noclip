/**
 * reads a converted material's properties for the surface describers: a material's own value, else its
 * shader's declared default, else the describer's fallback.
 */

import type { ReadyMaterial, ShaderEntry, TextureSlot } from '@endfield-noclip/package-format/materials';
import type { Rgb } from '@endfield-noclip/package-format/surfaces';

/** a converted material's values: its overrides of its shader's defaults, slots and render state */
export type MaterialValues = Omit<ReadyMaterial, 'id' | 'status' | 'surface'>;

/** a four-component colour or vector property */
export type Vec4 = [number, number, number, number];

/** a material's properties, resolved against its shader's defaults */
export interface MaterialReader {
	material: MaterialValues;
	shader: ShaderEntry;
	/** whether the material enables a keyword */
	has: (keyword: string) => boolean;
	/** a Float, Range or Int property */
	float: (name: string, fallback: number) => number;
	/** a Color property, as authored */
	color: (name: string) => Vec4 | undefined;
	/** a Vector property */
	vector: (name: string) => Vec4 | undefined;
	/** a Color property, else a Vector of the same name: the effect shaders declare some of each */
	colorOrVector: (name: string) => Vec4 | undefined;
	/** a bound texture, absent when the slot is empty */
	slot: (name: string) => TextureSlot | undefined;
}

/**
 * @param material a converted material
 * @param shader its shader's entry
 * @returns a reader of its properties
 */
export const readerOf = (material: MaterialValues, shader: ShaderEntry): MaterialReader => {
	const color = (name: string): Vec4 | undefined => material.colors[name] ?? shader.colors[name];
	const vector = (name: string): Vec4 | undefined => material.vectors[name] ?? shader.vectors[name];
	return {
		material,
		shader,
		has: (keyword) => material.keywords.includes(keyword),
		float: (name, fallback) => material.floats[name] ?? shader.floats[name] ?? fallback,
		color,
		vector,
		colorOrVector: (name) => color(name) ?? vector(name),
		slot: (name) => material.slots[name],
	};
};

/**
 * @param c an sRGB-encoded channel
 * @returns the linear channel
 */
export const srgbToLinear = (c: number): number => {
	if (c <= 0.04045) {
		return c / 12.92;
	}
	// HDR values: like Unity's `Mathf.GammaToLinearSpace`, a plain 2.2 power past 1
	return c < 1 ? ((c + 0.055) / 1.055) ** 2.4 : c ** 2.2;
};

/**
 * Unity linearizes LDR (non-`[HDR]`) colour properties in linear-space projects
 * (`docs/game-data/materials.md`)
 *
 * @param color a gamma-encoded colour property
 * @returns its RGB, linear
 */
export const linearRgb = (color: Readonly<Vec4>): Rgb => [
	srgbToLinear(color[0]),
	srgbToLinear(color[1]),
	srgbToLinear(color[2]),
];

/** @returns the colour times `k` */
export const scaleRgb = (rgb: Readonly<Rgb> | Readonly<Vec4>, k: number): Rgb => [
	rgb[0] * k,
	rgb[1] * k,
	rgb[2] * k,
];

/** @returns a slot's largest UV scale, at least 1/1000 */
export const uvScaleOf = (slot: Pick<TextureSlot, 'scale'>): number =>
	Math.max(Math.abs(slot.scale[0]), Math.abs(slot.scale[1]), 1e-3);
