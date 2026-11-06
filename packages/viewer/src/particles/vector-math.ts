import type { Vec3 } from '../scene/camera.ts';

// the `…Into` forms write their result into `out` and return it, so the per-particle hot path needn't
// allocate. each reads all of its inputs before writing, so `out` may be one of them

/** an xyzw quaternion */
export type Quat = [x: number, y: number, z: number, w: number];

/** @returns the 3×3 rows `a` times `v` */
export const times3 = (a: readonly number[], v: ArrayLike<number>): Vec3 =>
	times3Into([0, 0, 0], a, v[0], v[1], v[2]);

/** writes the 3×3 rows `a` times `(x, y, z)` into `out` @returns `out` */
export const times3Into = (out: Vec3, a: readonly number[], x: number, y: number, z: number): Vec3 => {
	out[0] = a[0] * x + a[1] * y + a[2] * z;
	out[1] = a[3] * x + a[4] * y + a[5] * z;
	out[2] = a[6] * x + a[7] * y + a[8] * z;
	return out;
};

/** @returns the xyzw quaternion of Unity Euler angles in radians (Z, then X, then Y) */
export const eulerQuaternion = (x: number, y: number, z: number): Quat =>
	eulerQuaternionInto([0, 0, 0, 1], x, y, z);

/** writes {@link eulerQuaternion} into `out` @returns `out` */
export const eulerQuaternionInto = (out: Quat, x: number, y: number, z: number): Quat => {
	const cx = Math.cos(x / 2),
		cy = Math.cos(y / 2),
		cz = Math.cos(z / 2);
	const sx = Math.sin(x / 2),
		sy = Math.sin(y / 2),
		sz = Math.sin(z / 2);
	out[0] = cy * sx * cz + sy * cx * sz;
	out[1] = sy * cx * cz - cy * sx * sz;
	out[2] = cy * cx * sz - sy * sx * cz;
	out[3] = cy * cx * cz + sy * sx * sz;
	return out;
};

/** @returns `v` rotated by the xyzw quaternion `q` */
export const rotate = (q: ArrayLike<number>, v: ArrayLike<number>): Vec3 =>
	rotateInto([0, 0, 0], q, v[0], v[1], v[2]);

/** writes `(vx, vy, vz)` rotated by the xyzw quaternion `q` into `out` @returns `out` */
export const rotateInto = (out: Vec3, q: ArrayLike<number>, vx: number, vy: number, vz: number): Vec3 => {
	const x = q[0],
		y = q[1],
		z = q[2],
		w = q[3];
	// t = 2 · cross(q.xyz, v); v' = v + w · t + cross(q.xyz, t)
	const tx = 2 * (y * vz - z * vy);
	const ty = 2 * (z * vx - x * vz);
	const tz = 2 * (x * vy - y * vx);
	out[0] = vx + w * tx + (y * tz - z * ty);
	out[1] = vy + w * ty + (z * tx - x * tz);
	out[2] = vz + w * tz + (x * ty - y * tx);
	return out;
};

const turn: Quat = [0, 0, 0, 1];

/** writes `v` rotated about the unit axis of `omega` by its length (radians) into `out` @returns `out` */
export const rotateByInto = (out: Vec3, omega: Vec3, v: Vec3): Vec3 => {
	const angle = Math.hypot(omega[0], omega[1], omega[2]);
	if (angle < 1e-9) {
		out[0] = v[0];
		out[1] = v[1];
		out[2] = v[2];
		return out;
	}
	const s = Math.sin(angle / 2) / angle;
	turn[0] = omega[0] * s;
	turn[1] = omega[1] * s;
	turn[2] = omega[2] * s;
	turn[3] = Math.cos(angle / 2);
	return rotateInto(out, turn, v[0], v[1], v[2]);
};

/**
 * @param to a direction, any length
 * @returns the xyzw quaternion turning +z onto it the shortest way: none for a zero vector, half a turn about
 *   x for −z
 */
export const turnFromZ = (to: ArrayLike<number>): Quat => turnFromZInto([0, 0, 0, 1], to);

/** writes {@link turnFromZ} into `out` @returns `out` */
export const turnFromZInto = (out: Quat, to: ArrayLike<number>): Quat => {
	const length = Math.hypot(to[0], to[1], to[2]);
	if (length < 1e-12) {
		return setQuat(out, 0, 0, 0, 1);
	}
	const z = to[2] / length;
	if (z < -1 + 1e-9) {
		return setQuat(out, 1, 0, 0, 0);
	}
	// half the angle via the halfway vector: q = (z × v, 1 + z · v), normalized
	const x = -to[1] / length;
	const y = to[0] / length;
	const w = 1 + z;
	const n = Math.hypot(x, y, w);
	return setQuat(out, x / n, y / n, 0, w / n);
};

const setQuat = (out: Quat, x: number, y: number, z: number, w: number): Quat => {
	out[0] = x;
	out[1] = y;
	out[2] = z;
	out[3] = w;
	return out;
};

/**
 * @param velocity a mesh particle's world velocity
 * @returns the right, up and forward axes the game turns a velocity-aligned mesh particle into: forward along
 *   the velocity (the world's +z when still), right level (the world's +x when moving straight up or down)
 */
export const velocityBasis = (velocity: ArrayLike<number>): [Vec3, Vec3, Vec3] =>
	velocityBasisInto(
		[
			[0, 0, 0],
			[0, 0, 0],
			[0, 0, 0],
		],
		velocity,
	);

/** writes {@link velocityBasis} into `out` @returns `out` */
export const velocityBasisInto = (
	out: [Vec3, Vec3, Vec3],
	velocity: ArrayLike<number>,
): [Vec3, Vec3, Vec3] => {
	const [right, up, forward] = out;
	const length = Math.hypot(velocity[0], velocity[1], velocity[2]);
	if (length > 1e-15) {
		const vx = velocity[0],
			vy = velocity[1],
			vz = velocity[2];
		forward[0] = vx / length;
		forward[1] = vy / length;
		forward[2] = vz / length;
	} else {
		forward[0] = 0;
		forward[1] = 0;
		forward[2] = 1;
	}
	const level = Math.hypot(forward[2], forward[0]);
	if (level > 1e-15) {
		right[0] = forward[2] / level;
		right[1] = 0;
		right[2] = -forward[0] / level;
	} else {
		right[0] = 1;
		right[1] = 0;
		right[2] = 0;
	}
	up[0] = forward[1] * right[2] - forward[2] * right[1];
	up[1] = forward[2] * right[0] - forward[0] * right[2];
	up[2] = forward[0] * right[1] - forward[1] * right[0];
	return out;
};

/** @returns the matrix whose columns are `columns`, times `v` */
export const times3Columns = (columns: readonly Vec3[], v: ArrayLike<number>): Vec3 =>
	times3ColumnsInto([0, 0, 0], columns, v[0], v[1], v[2]);

/** writes the matrix whose columns are `columns`, times `(x, y, z)`, into `out` @returns `out` */
export const times3ColumnsInto = (
	out: Vec3,
	columns: readonly Vec3[],
	x: number,
	y: number,
	z: number,
): Vec3 => {
	const [a, b, c] = columns;
	out[0] = a[0] * x + b[0] * y + c[0] * z;
	out[1] = a[1] * x + b[1] * y + c[1] * z;
	out[2] = a[2] * x + b[2] * y + c[2] * z;
	return out;
};

/** @returns `v` scaled to unit length, or +z when it has none */
export const normalize = (v: Vec3): Vec3 => normalizeInto([0, 0, 0], v[0], v[1], v[2]);

/** writes `(x, y, z)` scaled to unit length, or +z when it has none, into `out` @returns `out` */
export const normalizeInto = (out: Vec3, x: number, y: number, z: number): Vec3 => {
	const length = Math.hypot(x, y, z);
	if (length > 1e-12) {
		out[0] = x / length;
		out[1] = y / length;
		out[2] = z / length;
	} else {
		out[0] = 0;
		out[1] = 0;
		out[2] = 1;
	}
	return out;
};

/** writes a uniformly random unit vector from two random values into `out` @returns `out` */
export const unitVectorInto = (out: Vec3, a: number, b: number): Vec3 => {
	const z = 2 * a - 1;
	const r = Math.sqrt(Math.max(0, 1 - z * z));
	const phi = 2 * Math.PI * b;
	out[0] = r * Math.cos(phi);
	out[1] = r * Math.sin(phi);
	out[2] = z;
	return out;
};
