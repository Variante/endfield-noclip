/* oxlint-disable no-await-in-loop -- walks a prefab's hierarchy in authored order */
import { FormatError } from '@endfield-noclip/formats/binary/binary-reader';
import { type ClipMotion, readClipEndPose } from '@endfield-noclip/formats/unity/animation-clip';
import { isTransformClass, UnityClass } from '@endfield-noclip/formats/unity/serialized-file';
import type { TypeTreeObject } from '@endfield-noclip/formats/unity/type-tree';
import {
	arrayField,
	asPPtr,
	booleanField,
	isObject,
	numberField,
	objectField,
	pptrField,
	stringField,
} from '@endfield-noclip/formats/unity/values';

import type { AssetResolver, ObjectRef } from './assets.ts';
import type { PoseClip, PrefabPose } from './prefab.ts';
import { loopingMotion } from './view-state-poses.ts';

// what a prefab's own Animators play when nothing drives them: docs/game-data/assets.md#scenery-animators

/** `m_ClipID` of a blend tree node without a clip */
const NO_CLIP = 0xffff_ffff;

/** the clip one controller layer's default state plays */
export interface DefaultStateClip {
	layer: number;
	/** index into the controller's `m_AnimationClips` */
	clip: number;
	/** the state's playback speed */
	speed: number;
}

const data = (value: unknown, what: string): TypeTreeObject => {
	if (!isObject(value)) {
		throw new FormatError(`invalid animator controller ${what}`);
	}
	return objectField(value, 'data');
};

/**
 * @param controller an AnimatorController's fields
 * @returns per layer that shows, in layer order, the clip its default state plays. the base layer always
 *   shows; another shows when it overrides at full default weight. layers that blend (additive, partial
 *   weight) and states that play a blend tree, no clip or not forwards are left out
 * @throws {FormatError} on a malformed controller
 */
export const defaultStateClips = (controller: TypeTreeObject): DefaultStateClip[] => {
	const constant = objectField(controller, 'm_Controller');
	const machines = arrayField(constant, 'm_StateMachineArray');
	const result: DefaultStateClip[] = [];
	for (const [layer, entry] of arrayField(constant, 'm_LayerArray').entries()) {
		const layerData = data(entry, 'layer');
		// Unity holds the base layer at weight 1 whatever its saved weight
		const weight = layer === 0 ? 1 : numberField(layerData, 'm_DefaultWeight');
		// `AnimatorLayerBlendingMode`: 0 override, 1 additive
		if (weight !== 1 || numberField(layerData, '(int&)m_LayerBlendingMode') !== 0) {
			continue;
		}
		const machine = data(machines[numberField(layerData, 'm_StateMachineIndex')], 'state machine');
		const state = data(
			arrayField(machine, 'm_StateConstantArray')[numberField(machine, 'm_DefaultState')],
			'state',
		);
		const speed = numberField(state, 'm_Speed');
		const treeIndex = arrayField(state, 'm_BlendTreeConstantIndexArray')[0];
		if (speed <= 0 || typeof treeIndex !== 'number' || treeIndex < 0) {
			continue;
		}
		const tree = data(arrayField(state, 'm_BlendTreeConstantArray')[treeIndex], 'blend tree');
		const nodes = arrayField(tree, 'm_NodeArray');
		if (nodes.length !== 1) {
			continue;
		}
		const clip = numberField(data(nodes[0], 'blend tree node'), 'm_ClipID');
		if (clip !== NO_CLIP) {
			result.push({ layer, clip, speed });
		}
	}
	return result;
};

/**
 * @param motion a clip's motion
 * @param speed the state's playback speed, above 0
 * @returns the motion as the state plays it
 */
const atSpeed = (motion: ClipMotion, speed: number): ClipMotion => {
	if (speed === 1) {
		return motion;
	}
	return {
		...motion,
		duration: motion.duration / speed,
		sample: (time) => motion.sample(Math.min(time * speed, motion.duration)),
	};
};

/**
 * reads what a prefab's own Animators play when no view state drives them: each enabled Animator on a
 * GameObject active as saved plays its AnimatorController's default states from load, holding a clip's end
 * pose once it ends or playing on while it loops
 *
 * @param resolver bundle reader
 * @param root prefab GameObject
 * @returns the pose, or `null` when no Animator plays a clip
 * @throws {FormatError} on a malformed hierarchy or controller
 */
export const animatorDefaultPose = async (
	resolver: AssetResolver,
	root: ObjectRef,
): Promise<PrefabPose | null> => {
	const clips: PoseClip[] = [];
	const visit = async (go: ObjectRef, isRoot: boolean): Promise<void> => {
		const goData = await resolver.read(go);
		if (!booleanField(goData, 'm_IsActive')) {
			return;
		}
		let transform: { ref: ObjectRef; data: TypeTreeObject } | null = null;
		for (const item of arrayField(goData, 'm_Component')) {
			if (!isObject(item)) {
				throw new FormatError('prefab component is not an object');
			}
			const ref = await resolver.resolve(go, pptrField(item, 'component'));
			if (ref === null) {
				continue;
			}
			if (isTransformClass(ref.info.classId)) {
				transform = { ref, data: await resolver.read(ref) };
				continue;
			}
			if (ref.info.classId !== UnityClass.Animator) {
				continue;
			}
			const animator = await resolver.read(ref);
			const controller =
				numberField(animator, 'm_Enabled') === 0
					? null
					: await resolver.resolve(ref, pptrField(animator, 'm_Controller'));
			// override controllers swap clips by name; their base controller isn't followed yet
			if (controller === null || controller.info.classId !== UnityClass.AnimatorController) {
				continue;
			}
			const controllerData = await resolver.read(controller);
			const pointers = arrayField(controllerData, 'm_AnimationClips');
			for (const { clip, speed } of defaultStateClips(controllerData)) {
				const pointer = pointers[clip];
				const clipRef = pointer === undefined ? null : await resolver.resolve(controller, asPPtr(pointer));
				if (clipRef === null) {
					continue;
				}
				const clipData = await resolver.read(clipRef);
				const motion = loopingMotion(clipData);
				clips.push({
					animator: isRoot ? null : stringField(goData, 'm_Name'),
					...readClipEndPose(clipData),
					motion: motion === null ? null : atSpeed(motion, speed),
				});
			}
		}
		if (transform === null) {
			throw new FormatError(`prefab GameObject has no Transform`);
		}
		for (const pointer of arrayField(transform.data, 'm_Children')) {
			const child = await resolver.resolve(transform.ref, asPPtr(pointer));
			if (child === null) {
				continue;
			}
			const childGo = await resolver.resolve(child, pptrField(await resolver.read(child), 'm_GameObject'));
			if (childGo !== null) {
				await visit(childGo, false);
			}
		}
	};
	await visit(root, true);
	return clips.length === 0 ? null : { key: 'animator-defaults', clips, active: new Map() };
};
