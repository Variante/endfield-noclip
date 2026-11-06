import type { Vec3 } from '../scene/camera.ts';

/**
 * @param v a vector; components past the third (a colour's alpha) are ignored
 * @param s the factor
 * @returns the first three components times `s`
 */
export const scale = (v: Readonly<[number, number, number, ...number[]]>, s: number): Vec3 => [
	v[0] * s,
	v[1] * s,
	v[2] * s,
];

/**
 * @param f a component's value by its index
 * @returns the vector of `f` over the three components
 */
export const vec3From = (f: (i: 0 | 1 | 2) => number): Vec3 => [f(0), f(1), f(2)];
