import { FormatError } from '../binary/binary-reader.ts';

import type { TypeTreeObject } from './type-tree.ts';
import { arrayField, booleanField, isObject, numberField, objectField } from './values.ts';

/** a Transform property a clip animates, at the clip's last frame */
export type ClipTransformValue =
	| { kind: 'position' | 'scale'; value: [number, number, number] }
	| { kind: 'rotation'; value: [number, number, number, number] };

/** what a clip leaves each animated Transform at */
export interface ClipEndPose {
	/** by binding path: CRC32 of the GameObject's path below the Animator, `/`-joined, 0 for the Animator's own */
	transforms: Map<number, ClipTransformValue[]>;
}

/** Unity's `ClassID(Transform)` in a generic binding */
const TRANSFORM = 4;

/**
 * reads the values a generic (non-humanoid) AnimationClip ends on. the muscle clip stores each animated
 * value's start and stop in binding order (`m_ValueArrayDelta`), so the end pose needs no curve sampling.
 * Transform bindings take three values (position, scale) or four (rotation); other float bindings one; PPtr
 * bindings none
 *
 * @param clip AnimationClip type-tree object
 * @returns the end value of every animated Transform property
 * @throws {FormatError} for legacy clips, Euler bindings, or a value count that doesn't match the bindings
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
	let at = 0;
	for (const binding of arrayField(objectField(clip, 'm_ClipBindingConstant'), 'genericBindings')) {
		if (!isObject(binding)) {
			throw new FormatError('invalid AnimationClip binding');
		}
		if (numberField(binding, 'isPPtrCurve') !== 0) {
			continue;
		}
		if (numberField(binding, 'typeID') !== TRANSFORM) {
			at++;
			continue;
		}
		const path = numberField(binding, 'path') >>> 0;
		const attribute = numberField(binding, 'attribute');
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
			default: {
				throw new FormatError(`unsupported AnimationClip Transform attribute ${attribute}`);
			}
		}
		transforms.getOrInsertComputed(path, () => []).push(value);
	}
	if (at !== stops.length) {
		throw new FormatError(`AnimationClip has ${stops.length} values for ${at} bound`);
	}
	return { transforms };
};
