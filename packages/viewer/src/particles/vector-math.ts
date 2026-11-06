import type { Vec3 } from '../scene/camera.ts';

/** @returns the 3×3 rows `a` times `v` */
export const times3 = (a: readonly number[], v: ArrayLike<number>): Vec3 => [
	a[0] * v[0] + a[1] * v[1] + a[2] * v[2],
	a[3] * v[0] + a[4] * v[1] + a[5] * v[2],
	a[6] * v[0] + a[7] * v[1] + a[8] * v[2],
];

/** @returns the xyzw quaternion of Unity Euler angles in radians (Z, then X, then Y) */
export const eulerQuaternion = (x: number, y: number, z: number): [number, number, number, number] => {
	const cx = Math.cos(x / 2),
		cy = Math.cos(y / 2),
		cz = Math.cos(z / 2);
	const sx = Math.sin(x / 2),
		sy = Math.sin(y / 2),
		sz = Math.sin(z / 2);
	return [
		cy * sx * cz + sy * cx * sz,
		sy * cx * cz - cy * sx * sz,
		cy * cx * sz - sy * sx * cz,
		cy * cx * cz + sy * sx * sz,
	];
};

/** @returns `v` rotated by the xyzw quaternion `q` */
export const rotate = (q: ArrayLike<number>, v: ArrayLike<number>): Vec3 => {
	const x = q[0],
		y = q[1],
		z = q[2],
		w = q[3];
	// t = 2 · cross(q.xyz, v); v' = v + w · t + cross(q.xyz, t)
	const tx = 2 * (y * v[2] - z * v[1]);
	const ty = 2 * (z * v[0] - x * v[2]);
	const tz = 2 * (x * v[1] - y * v[0]);
	return [
		v[0] + w * tx + (y * tz - z * ty),
		v[1] + w * ty + (z * tx - x * tz),
		v[2] + w * tz + (x * ty - y * tx),
	];
};

/** @returns `v` rotated about the unit axis of `omega` by its length (radians) */
export const rotateBy = (omega: Vec3, v: Vec3): Vec3 => {
	const angle = Math.hypot(omega[0], omega[1], omega[2]);
	if (angle < 1e-9) {
		return v;
	}
	const s = Math.sin(angle / 2) / angle;
	return rotate([omega[0] * s, omega[1] * s, omega[2] * s, Math.cos(angle / 2)], v);
};

/**
 * @param to a direction, any length
 * @returns the xyzw quaternion turning +z onto it the shortest way: none for a zero vector, half a turn about
 *   x for −z
 */
export const turnFromZ = (to: ArrayLike<number>): [number, number, number, number] => {
	const length = Math.hypot(to[0], to[1], to[2]);
	if (length < 1e-12) {
		return [0, 0, 0, 1];
	}
	const z = to[2] / length;
	if (z < -1 + 1e-9) {
		return [1, 0, 0, 0];
	}
	// half the angle via the halfway vector: q = (z × v, 1 + z · v), normalized
	const x = -to[1] / length;
	const y = to[0] / length;
	const w = 1 + z;
	const n = Math.hypot(x, y, w);
	return [x / n, y / n, 0, w / n];
};

/**
 * @param velocity a mesh particle's world velocity
 * @returns the right, up and forward axes the game turns a velocity-aligned mesh particle into: forward along
 *   the velocity (the world's +z when still), right level (the world's +x when moving straight up or down)
 */
export const velocityBasis = (velocity: ArrayLike<number>): [Vec3, Vec3, Vec3] => {
	const length = Math.hypot(velocity[0], velocity[1], velocity[2]);
	const forward: Vec3 =
		length > 1e-15 ? [velocity[0] / length, velocity[1] / length, velocity[2] / length] : [0, 0, 1];
	const level = Math.hypot(forward[2], forward[0]);
	const right: Vec3 = level > 1e-15 ? [forward[2] / level, 0, -forward[0] / level] : [1, 0, 0];
	const up: Vec3 = [
		forward[1] * right[2] - forward[2] * right[1],
		forward[2] * right[0] - forward[0] * right[2],
		forward[0] * right[1] - forward[1] * right[0],
	];
	return [right, up, forward];
};

/** @returns the matrix whose columns are `columns`, times `v` */
export const times3Columns = (columns: readonly Vec3[], v: ArrayLike<number>): Vec3 => [
	columns[0][0] * v[0] + columns[1][0] * v[1] + columns[2][0] * v[2],
	columns[0][1] * v[0] + columns[1][1] * v[1] + columns[2][1] * v[2],
	columns[0][2] * v[0] + columns[1][2] * v[1] + columns[2][2] * v[2],
];

export const normalize = (v: Vec3): Vec3 => {
	const length = Math.hypot(v[0], v[1], v[2]);
	return length > 1e-12 ? [v[0] / length, v[1] / length, v[2] / length] : [0, 0, 1];
};

/** a uniformly random unit vector from two random values */
export const unitVector = (a: number, b: number): Vec3 => {
	const z = 2 * a - 1;
	const r = Math.sqrt(Math.max(0, 1 - z * z));
	const phi = 2 * Math.PI * b;
	return [r * Math.cos(phi), r * Math.sin(phi), z];
};
