import {
	type MinMaxCurveInfo,
	type ParticleForceFieldInfo,
	PARTICLE_STEP_RATE,
} from '@endfield-noclip/package-format/particles';

import type { Vec3 } from '../scene/camera.ts';

import { evaluateMinMax } from './curves.ts';
import { times3 } from './vector-math.ts';

/** a force field ready to step: its matrices as 3×3 rows plus a translation */
export interface PreparedField {
	info: ParticleForceFieldInfo;
	/** the emitter's frame to the field's: `p_field = toField · p + toFieldOffset` */
	toField: number[];
	toFieldOffset: Vec3;
	/** the field's vectors in the emitter's frame (the inverse of {@link toField}) */
	fromField: number[];
}

/**
 * @param info a force field
 * @returns it with its matrices as rows, from its column-major `fromEmitter`
 */
export const prepareField = (info: ParticleForceFieldInfo): PreparedField => {
	const m = info.fromEmitter;
	// row r, column c of a column-major 4×4 is m[c * 4 + r]
	const a = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]];
	const cofactor = [
		a[4] * a[8] - a[5] * a[7],
		a[2] * a[7] - a[1] * a[8],
		a[1] * a[5] - a[2] * a[4],
		a[5] * a[6] - a[3] * a[8],
		a[0] * a[8] - a[2] * a[6],
		a[2] * a[3] - a[0] * a[5],
		a[3] * a[7] - a[4] * a[6],
		a[1] * a[6] - a[0] * a[7],
		a[0] * a[4] - a[1] * a[3],
	];
	const det = a[0] * cofactor[0] + a[1] * cofactor[3] + a[2] * cofactor[6];
	const inverse = Math.abs(det) > 1e-20 ? cofactor.map((value) => value / det) : [1, 0, 0, 0, 1, 0, 0, 0, 1];
	return { info, toField: a, toFieldOffset: [m[12], m[13], m[14]], fromField: inverse };
};

/** one particle's random values for the force fields, the same for every field as in the game */
export interface ForceRandoms {
	multiplier: number;
	tiltX: number;
	tiltZ: number;
	direction: [number, number, number];
	gravity: number;
	spin: number;
	attraction: number;
	drag: number;
}

/**
 * changes a particle's own velocity by the force fields for one step, as the game's sphere fields do ({@link
 * ParticleForceFieldInfo})
 *
 * @param forces the system's forces, their fields prepared
 * @param position the particle's place in the emitter's frame, before the step
 * @param own its own velocity, changed in place
 * @param lived its age over its lifetime, 0–1, where the multiplier is read
 * @param size its size, which drag can scale by
 * @param r its random values
 * @param dt the step, s
 */
export const applyForces = (
	forces: { multiplier: MinMaxCurveInfo; fields: readonly PreparedField[] },
	position: Vec3,
	own: Vec3,
	lived: number,
	size: number,
	r: ForceRandoms,
	dt: number,
): void => {
	const m = evaluateMinMax(forces.multiplier, lived, r.multiplier);
	for (const field of forces.fields) {
		const { info, toField, toFieldOffset, fromField } = field;
		const local = times3(toField, position);
		const p: Vec3 = [local[0] + toFieldOffset[0], local[1] + toFieldOffset[1], local[2] + toFieldOffset[2]];
		const d = Math.hypot(...p);
		const { startRange: start, endRange: end } = info;
		if (d < start || d > end) {
			continue;
		}
		const tf = end > start ? Math.max((d - start) / (end - start), 0) : 0;
		if (info.direction.some((curve) => curve.scalar !== 0)) {
			const push = times3(
				fromField,
				info.direction.map((curve, axis) => evaluateMinMax(curve, tf, r.direction[axis])),
			);
			for (let axis = 0; axis < 3; axis++) {
				own[axis] += push[axis] * m * dt;
			}
		}
		if (info.gravity.scalar !== 0) {
			let n = times3(fromField, p);
			const length = Math.hypot(...n);
			n = length > 1e-15 ? [n[0] / length, n[1] / length, n[2] / length] : [0, 0, 0];
			const sign = d < start + info.gravityFocus * (end - start) ? -1 : 1;
			const pull = -evaluateMinMax(info.gravity, tf, r.gravity) * m * dt * PARTICLE_STEP_RATE * sign;
			for (let axis = 0; axis < 3; axis++) {
				own[axis] += n[axis] * pull;
			}
		}
		if (info.rotationSpeed.scalar !== 0 && info.rotationAttraction.scalar !== 0) {
			const speed = evaluateMinMax(info.rotationSpeed, tf, r.spin) * m;
			const attraction = evaluateMinMax(info.rotationAttraction, tf, r.attraction) * m;
			// the swirl's axis, the field's +y, tilted by a fixed random turn about x then z per particle
			const ax = (r.tiltX - 0.5) * 2 * Math.PI * info.rotationRandomness[0];
			const az = (r.tiltZ - 0.5) * 2 * Math.PI * info.rotationRandomness[1];
			const tilt = Math.abs(ax) > 1e-6 || Math.abs(az) > 1e-6;
			const cx = Math.cos(ax),
				sx = Math.sin(ax),
				cz = Math.cos(az),
				sz = Math.sin(az);
			// rows of Rx(ax) · Rz(az)
			const turn = tilt
				? [cz, -sz, 0, cx * sz, cx * cz, -sx, sx * sz, sx * cz, cx]
				: [1, 0, 0, 0, 1, 0, 0, 0, 1];
			const q = times3(turn, p);
			// ŷ × q, turned back by the tilt's transpose
			const c: Vec3 = [q[2], 0, -q[0]];
			const back: Vec3 = [
				turn[0] * c[0] + turn[3] * c[1] + turn[6] * c[2],
				turn[1] * c[0] + turn[4] * c[1] + turn[7] * c[2],
				turn[2] * c[0] + turn[5] * c[1] + turn[8] * c[2],
			];
			let tangent = times3(fromField, back);
			const length = Math.hypot(...tangent);
			tangent = length > 1e-15 ? [tangent[0] / length, tangent[1] / length, tangent[2] / length] : [0, 0, 0];
			const k = attraction * dt * PARTICLE_STEP_RATE;
			for (let axis = 0; axis < 3; axis++) {
				own[axis] += (tangent[axis] * speed - own[axis]) * k;
			}
		}
		if (info.drag.scalar !== 0) {
			const amount = evaluateMinMax(info.drag, tf, r.drag);
			const s = Math.hypot(...own);
			const k =
				(info.dragBySize ? Math.PI * (size / 2) ** 2 : 1) * amount * (info.dragByVelocity ? s * s : 1);
			const kept = s > 1e-15 ? Math.max(0, s - k * m * dt) / s : 0;
			for (let axis = 0; axis < 3; axis++) {
				own[axis] *= kept;
			}
		}
	}
};
