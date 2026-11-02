import { FormatError } from '../binary/binary-reader.ts';

import type { TypeTreeObject } from './type-tree.ts';
import { arrayField, booleanField, isObject, numberField, objectField } from './values.ts';

/** a Transform property a clip animates, at the clip's last frame */
export type ClipTransformValue =
	| { kind: 'position' | 'scale'; value: [number, number, number] }
	| { kind: 'rotation'; value: [number, number, number, number] };

/** what a clip leaves each animated Transform and GameObject at */
export interface ClipEndPose {
	/** by binding path: CRC32 of the GameObject's path below the Animator, `/`-joined, 0 for the Animator's own */
	transforms: Map<number, ClipTransformValue[]>;
	/** whether each GameObject whose activity the clip animates ends switched on, by binding path */
	active: Map<number, boolean>;
}

/** Unity's `ClassID(Transform)` in a generic binding */
const TRANSFORM = 4;
/** Unity's `ClassID(GameObject)` in a generic binding */
const GAME_OBJECT = 1;
/** a GameObject binding's attribute for `m_IsActive`: CRC32 of the property name */
const IS_ACTIVE = 0x7c5a_22f6;

const DEGREES = Math.PI / 180;

/**
 * @param x rotation about x, degrees
 * @param y rotation about y, degrees
 * @param z rotation about z, degrees
 * @returns Unity's `Quaternion.Euler`: z first, then x, then y
 */
const eulerQuaternion = (x: number, y: number, z: number): [number, number, number, number] => {
	const [sx, cx] = [Math.sin(x * DEGREES * 0.5), Math.cos(x * DEGREES * 0.5)];
	const [sy, cy] = [Math.sin(y * DEGREES * 0.5), Math.cos(y * DEGREES * 0.5)];
	const [sz, cz] = [Math.sin(z * DEGREES * 0.5), Math.cos(z * DEGREES * 0.5)];
	// qy · qx · qz
	return [
		cy * sx * cz + sy * cx * sz,
		sy * cx * cz - cy * sx * sz,
		cy * cx * sz - sy * sx * cz,
		cy * cx * cz + sy * sx * sz,
	];
};

/**
 * reads the values a generic (non-humanoid) AnimationClip ends on. the muscle clip stores each animated
 * value's start and stop in binding order (`m_ValueArrayDelta`), so the end pose needs no curve sampling.
 * Transform bindings take three values (position, scale, Euler rotation) or four (rotation); other float
 * bindings one; PPtr bindings none. Euler rotations are taken in Unity's default order (z, x, y)
 *
 * @param clip AnimationClip type-tree object
 * @returns the end value of every animated Transform property and GameObject activity
 * @throws {FormatError} for legacy clips, unknown Transform attributes, or a value count that doesn't match
 *   the bindings
 */
export const readClipEndPose = (clip: TypeTreeObject): ClipEndPose => {
	if (booleanField(clip, 'm_Legacy')) {
		throw new FormatError('legacy AnimationClip');
	}
	const deltas = arrayField(objectField(clip, 'm_MuscleClip'), 'm_ValueArrayDelta');
	const stops = deltas.map((delta) => {
		if (!isObject(delta)) {
			throw new FormatError('invalid AnimationClip value delta');
		}
		return numberField(delta, 'm_Stop');
	});
	const transforms = new Map<number, ClipTransformValue[]>();
	const active = new Map<number, boolean>();
	let at = 0;
	for (const binding of arrayField(objectField(clip, 'm_ClipBindingConstant'), 'genericBindings')) {
		if (!isObject(binding)) {
			throw new FormatError('invalid AnimationClip binding');
		}
		if (numberField(binding, 'isPPtrCurve') !== 0) {
			continue;
		}
		const path = numberField(binding, 'path') >>> 0;
		const attribute = numberField(binding, 'attribute');
		const type = numberField(binding, 'typeID');
		if (type === GAME_OBJECT && attribute >>> 0 === IS_ACTIVE && at < stops.length) {
			active.set(path, stops[at] !== 0);
		}
		if (type !== TRANSFORM) {
			at++;
			continue;
		}
		const next = (): number => {
			if (at >= stops.length) {
				throw new FormatError('AnimationClip has fewer values than bindings');
			}
			return stops[at++];
		};
		let value: ClipTransformValue;
		switch (attribute) {
			case 1: {
				value = { kind: 'position', value: [next(), next(), next()] };
				break;
			}
			case 2: {
				value = { kind: 'rotation', value: [next(), next(), next(), next()] };
				break;
			}
			case 3: {
				value = { kind: 'scale', value: [next(), next(), next()] };
				break;
			}
			case 4: {
				value = { kind: 'rotation', value: eulerQuaternion(next(), next(), next()) };
				break;
			}
			default: {
				throw new FormatError(`unsupported AnimationClip Transform attribute ${attribute}`);
			}
		}
		transforms.getOrInsertComputed(path, () => []).push(value);
	}
	if (at !== stops.length) {
		throw new FormatError(`AnimationClip has ${stops.length} values for ${at} bound`);
	}
	return { transforms, active };
};

/**
 * @param clip a non-legacy AnimationClip
 * @returns for each GameObject whose activity the clip animates, by binding path, whether it's switched on at
 *   the clip's first or last frame (the values a clip stores for both ends; frames between aren't read)
 * @throws {FormatError} for legacy clips or malformed bindings
 */
export const readClipActivity = (clip: TypeTreeObject): Map<number, boolean> => {
	if (booleanField(clip, 'm_Legacy')) {
		throw new FormatError('legacy AnimationClip');
	}
	const deltas = arrayField(objectField(clip, 'm_MuscleClip'), 'm_ValueArrayDelta');
	const activity = new Map<number, boolean>();
	let at = 0;
	for (const binding of arrayField(objectField(clip, 'm_ClipBindingConstant'), 'genericBindings')) {
		if (!isObject(binding)) {
			throw new FormatError('invalid AnimationClip binding');
		}
		if (numberField(binding, 'isPPtrCurve') !== 0) {
			continue;
		}
		const type = numberField(binding, 'typeID');
		if (type === GAME_OBJECT && numberField(binding, 'attribute') >>> 0 === IS_ACTIVE) {
			const delta = deltas[at];
			if (!isObject(delta)) {
				throw new FormatError('AnimationClip has fewer values than bindings');
			}
			activity.set(
				numberField(binding, 'path') >>> 0,
				numberField(delta, 'm_Start') !== 0 || numberField(delta, 'm_Stop') !== 0,
			);
		}
		// Transform positions and scales take three values, rotations four (Euler three); other bindings one
		if (type === TRANSFORM) {
			at += numberField(binding, 'attribute') === 2 ? 4 : 3;
		} else {
			at++;
		}
	}
	return activity;
};
