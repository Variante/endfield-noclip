import type { Aabb } from './values.ts';

/**
 * @param position translation
 * @param quaternion normalized rotation, xyzw
 * @param scale axis scales
 * @returns a column-major TRS matrix
 */
export const trsMatrix = (
	position: readonly number[],
	quaternion: readonly number[],
	scale: readonly number[],
): Float32Array => {
	const [x, y, z, w] = quaternion;
	const [sx, sy, sz] = scale;
	return new Float32Array([
		(1 - 2 * (y * y + z * z)) * sx,
		2 * (x * y + z * w) * sx,
		2 * (x * z - y * w) * sx,
		0,
		2 * (x * y - z * w) * sy,
		(1 - 2 * (x * x + z * z)) * sy,
		2 * (y * z + x * w) * sy,
		0,
		2 * (x * z + y * w) * sz,
		2 * (y * z - x * w) * sz,
		(1 - 2 * (x * x + y * y)) * sz,
		0,
		position[0],
		position[1],
		position[2],
		1,
	]);
};

/**
 * @param angles Unity Euler angles in degrees, applied Z then X then Y
 * @returns the rotation as an xyzw quaternion
 */
export const unityEulerQuaternion = (angles: readonly number[]): [number, number, number, number] => {
	const [x, y, z] = angles.map((angle) => (angle * Math.PI) / 360);
	const cx = Math.cos(x),
		cy = Math.cos(y),
		cz = Math.cos(z);
	const sx = Math.sin(x),
		sy = Math.sin(y),
		sz = Math.sin(z);
	return [
		cy * sx * cz + sy * cx * sz,
		sy * cx * cz - cy * sx * sz,
		cy * cx * sz - sy * sx * cz,
		cy * cx * cz + sy * sx * sz,
	];
};

/**
 * @param quaternion normalized rotation, xyzw
 * @returns Unity Euler angles in degrees (Z then X then Y), the inverse of {@link unityEulerQuaternion}
 */
export const quaternionUnityEuler = (quaternion: readonly number[]): [number, number, number] => {
	const [x, y, z, w] = quaternion;
	const degrees = 180 / Math.PI;
	const sinX = Math.min(Math.max(2 * (w * x - y * z), -1), 1);
	return [
		Math.asin(sinX) * degrees,
		Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y)) * degrees,
		Math.atan2(2 * (x * y + w * z), 1 - 2 * (x * x + z * z)) * degrees,
	];
};

/**
 * @param a xyzw quaternion
 * @param b xyzw quaternion
 * @returns `a · b`, the rotation `b` followed by `a`
 */
export const multiplyQuaternions = (
	a: readonly number[],
	b: readonly number[],
): [number, number, number, number] => {
	const [ax, ay, az, aw] = a;
	const [bx, by, bz, bw] = b;
	return [
		aw * bx + ax * bw + ay * bz - az * by,
		aw * by - ax * bz + ay * bw + az * bx,
		aw * bz + ax * by - ay * bx + az * bw,
		aw * bw - ax * bx - ay * by - az * bz,
	];
};

/**
 * @param parent column-major parent matrix
 * @param local column-major local matrix
 * @returns their product; neither input is modified
 */
export const multiplyMatrices = (parent: Float32Array, local: Float32Array): Float32Array => {
	const result = new Float32Array(16);
	for (let c = 0; c < 4; c++) {
		for (let r = 0; r < 4; r++) {
			for (let k = 0; k < 4; k++) {
				result[c * 4 + r] += parent[k * 4 + r] * local[c * 4 + k];
			}
		}
	}
	return result;
};

/**
 * @param matrix affine column-major matrix
 * @param point a point
 * @returns the point transformed by the matrix
 */
export const transformPoint = (matrix: Float32Array, point: readonly number[]): [number, number, number] => {
	const out: [number, number, number] = [matrix[12], matrix[13], matrix[14]];
	for (let r = 0; r < 3; r++) {
		for (let c = 0; c < 3; c++) {
			out[r] += matrix[c * 4 + r] * point[c];
		}
	}
	return out;
};

/**
 * @param matrix affine column-major matrix
 * @param point a point
 * @returns the point the matrix takes to `point`
 * @throws {RangeError} if the matrix's linear part is singular
 */
export const inverseTransformPoint = (
	matrix: Float32Array,
	point: readonly number[],
): [number, number, number] => {
	const m = (r: number, c: number): number => matrix[c * 4 + r];
	// cofactors of the 3×3 linear part, transposed: its adjugate
	const adjugate = [
		[
			m(1, 1) * m(2, 2) - m(1, 2) * m(2, 1),
			m(0, 2) * m(2, 1) - m(0, 1) * m(2, 2),
			m(0, 1) * m(1, 2) - m(0, 2) * m(1, 1),
		],
		[
			m(1, 2) * m(2, 0) - m(1, 0) * m(2, 2),
			m(0, 0) * m(2, 2) - m(0, 2) * m(2, 0),
			m(0, 2) * m(1, 0) - m(0, 0) * m(1, 2),
		],
		[
			m(1, 0) * m(2, 1) - m(1, 1) * m(2, 0),
			m(0, 1) * m(2, 0) - m(0, 0) * m(2, 1),
			m(0, 0) * m(1, 1) - m(0, 1) * m(1, 0),
		],
	];
	const determinant = m(0, 0) * adjugate[0][0] + m(0, 1) * adjugate[1][0] + m(0, 2) * adjugate[2][0];
	if (Math.abs(determinant) < 1e-12) {
		throw new RangeError('the matrix has no inverse');
	}
	const d = [point[0] - matrix[12], point[1] - matrix[13], point[2] - matrix[14]];
	const out: [number, number, number] = [0, 0, 0];
	for (let r = 0; r < 3; r++) {
		out[r] = (adjugate[r][0] * d[0] + adjugate[r][1] * d[1] + adjugate[r][2] * d[2]) / determinant;
	}
	return out;
};

/**
 * @param bounds local axis-aligned bounds
 * @param matrix affine column-major matrix
 * @returns enclosing world bounds, including rotated and nonuniformly scaled extents
 */
export const transformBounds = (bounds: Aabb, matrix: Float32Array): Aabb => {
	const center: [number, number, number] = [0, 0, 0];
	const extents: [number, number, number] = [0, 0, 0];
	for (let r = 0; r < 3; r++) {
		center[r] = matrix[12 + r];
		for (let c = 0; c < 3; c++) {
			center[r] += matrix[c * 4 + r] * bounds.center[c];
			extents[r] += Math.abs(matrix[c * 4 + r]) * bounds.extents[c];
		}
	}
	return { center, extents };
};
