import { FormatError } from '@endfield-noclip/formats/binary/binary-reader';
import type { MemoryPackValue } from '@endfield-noclip/formats/endfield/memory-pack';
import {
	type ClipMotion,
	readClipEndPose,
	readClipMotion,
} from '@endfield-noclip/formats/unity/animation-clip';
import { UnityClass } from '@endfield-noclip/formats/unity/serialized-file';
import type { TypeTreeObject } from '@endfield-noclip/formats/unity/type-tree';
import { booleanField, objectField } from '@endfield-noclip/formats/unity/values';

import type { Context } from '../context.ts';
import { VfsGroup } from '../hg/vfs.ts';

import type { PoseClip, PrefabPose } from './prefab.ts';

// model view states (`ModelViewStateControllerData`) and the poses they settle in.
// rules: docs/game-data/assets.md#interactive-view-states.

const ROOT = 'Beyond_Gameplay_Core_ModelViewStateController_MVSCModelViewStateControllerDataForMemoryPack';

/** a decoded MemoryPack record */
export type ViewStateRecord = { [key: string]: MemoryPackValue };

/** a model's decoded view-state controller */
export interface ViewStates {
	model: string;
	/** where it was read from, for errors */
	path: string;
	data: ViewStateRecord;
}

/**
 * a ModelTable model and the model whose view states it uses: its own id, or the one its row names in
 * `dependModelViewDataId` (a resized copy borrows its original's)
 */
export interface ModelViews {
	model: string;
	source: string;
}

/** the values a model's state machines test, by key; keys left out are false or 0 */
export type Blackboard = ReadonlyMap<string, boolean | number>;

const isRecord = (value: MemoryPackValue | undefined): value is ViewStateRecord =>
	value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * @param value a decoded list
 * @returns its records
 */
export const records = (value: MemoryPackValue | undefined): ViewStateRecord[] =>
	Array.isArray(value) ? value.filter(isRecord) : [];

/**
 * @param value a decoded value
 * @returns it as a string, or `null`
 */
export const text = (value: MemoryPackValue | undefined): string | null =>
	typeof value === 'string' ? value : null;

/**
 * @param context install readers
 * @param model the ModelTable id, and `source`, the id whose view-state file it uses ({@link ModelViews})
 * @returns the model's view states, or `null` when it has none
 * @throws {FormatError} if the file isn't a view-state controller
 */
export const readViewStates = async (
	context: Pick<Context, 'vfs' | 'memoryPack'>,
	{ model, source }: ModelViews,
): Promise<ViewStates | null> => {
	const path = `Data/Json/Interactive/ModelViewStateControllerData/${source}.json`;
	const file = await context.vfs.find(VfsGroup.JsonData, path);
	if (file === undefined) {
		return null;
	}
	const data = (await context.memoryPack()).decode(await context.vfs.readVerified(file), ROOT);
	if (!isRecord(data)) {
		throw new FormatError(`${path} isn't a view state controller`);
	}
	return { model, path, data };
};

/** the game's `Comparison`: 0 =, 1 >, 2 <, 3 ≥, 4 ≤ */
const compare = (value: number, comparison: number, target: number): boolean => {
	switch (comparison) {
		case 0: {
			return value === target;
		}
		case 1: {
			return value > target;
		}
		case 2: {
			return value < target;
		}
		case 3: {
			return value >= target;
		}
		case 4: {
			return value <= target;
		}
		default: {
			throw new FormatError(`unknown view state comparison ${comparison}`);
		}
	}
};

/**
 * @returns whether a transition condition holds; a trigger never has fired
 * @throws {FormatError} for an unknown comparison or value type
 */
const holds = (condition: ViewStateRecord, blackboard: Blackboard): boolean => {
	const key = text(condition.key) ?? '';
	const wrapper = isRecord(condition.conditionValue) ? condition.conditionValue : {};
	const union = isRecord(wrapper.conditionValue) ? wrapper.conditionValue : {};
	const comparison = typeof condition.comparison === 'number' ? condition.comparison : 0;
	const value = blackboard.get(key);
	let result: boolean;
	// `DataType`: 0 bool, 1 float, 2 int, 3 trigger
	switch (wrapper.type) {
		case 0: {
			result = compare(
				value === true || (typeof value === 'number' && value !== 0) ? 1 : 0,
				comparison,
				union.boolValue === true ? 1 : 0,
			);
			break;
		}
		case 1: {
			result = compare(typeof value === 'number' ? value : 0, comparison, Number(union.floatValue ?? 0));
			break;
		}
		case 2: {
			result = compare(typeof value === 'number' ? value : 0, comparison, Number(union.intValue ?? 0));
			break;
		}
		case 3: {
			result = false;
			break;
		}
		default: {
			throw new FormatError(`unknown view state condition type ${JSON.stringify(wrapper.type)}`);
		}
	}
	return condition.isInvert === true ? !result : result;
};

/**
 * @param layer an animator layer's state machine
 * @param blackboard the values its conditions test
 * @returns the state the layer rests in: from the starting state, the first transition whose conditions all
 *   hold is taken (one without conditions always is) until none holds
 * @throws {FormatError} if the layer has no starting state or its transitions loop
 */
export const settledState = (layer: ViewStateRecord, blackboard: Blackboard): ViewStateRecord => {
	const layerName = text(layer.layerName) ?? '?';
	const states = new Map(records(layer.stateDatas).map((state) => [text(state.stateName) ?? '', state]));
	const start = records(layer.stateDatas).find((candidate) => candidate.isStartingNode === true);
	if (start === undefined) {
		throw new FormatError(`view state layer ${layerName} has no starting state`);
	}
	let state: ViewStateRecord = start;
	const visited = new Set<ViewStateRecord>();
	for (;;) {
		if (visited.has(state)) {
			throw new FormatError(`view state layer ${layerName} loops at ${text(state.stateName) ?? '?'}`);
		}
		visited.add(state);
		const next: ViewStateRecord | undefined = records(state.transitions).find((transition) =>
			records(isRecord(transition.conditionGroup) ? transition.conditionGroup.conditions : []).every(
				(condition) => holds(condition, blackboard),
			),
		);
		const target: ViewStateRecord | undefined =
			next === undefined ? undefined : states.get(text(next.targetStateName) ?? '');
		if (target === undefined) {
			return state;
		}
		state = target;
	}
};

/**
 * a settled state's looping clip keeps playing; any other rests on its end pose
 *
 * @param clip an AnimationClip
 * @returns its motion when it loops, `null` otherwise or when its curves can't be read (it then holds its end
 *   pose)
 */
export const loopingMotion = (clip: TypeTreeObject): ClipMotion | null => {
	if (!booleanField(objectField(clip, 'm_MuscleClip'), 'm_LoopTime')) {
		return null;
	}
	try {
		return readClipMotion(clip);
	} catch (error) {
		if (error instanceof FormatError) {
			return null;
		}
		throw error;
	}
};

/**
 * @param context bundle and path readers
 * @param states the model's view states
 * @param key tells this pose apart from the model's others, for caching
 * @param settled each animator's states to draw: the GameObject its clips bind below (`null` for the prefab
 *   root) and one state per layer, in layer order
 * @returns the states' clip end poses and the GameObjects their SetActive behaviours switch
 * @throws {FormatError} if a clip isn't listed, found or readable
 */
export const statesPose = async (
	context: Pick<Context, 'world' | 'resolver'>,
	states: ViewStates,
	key: string,
	settled: readonly { animator: string | null; states: readonly ViewStateRecord[] }[],
): Promise<PrefabPose> => {
	const clipHashes = new Map(
		records(states.data.clipAssetInfos).map((info) => [text(info.animationClipName), info.animationClipHash]),
	);
	const [resolver, pathOf] = await Promise.all([context.resolver(), context.world.pathLookup()]);
	const clips: PoseClip[] = [];
	const active = new Map<string, boolean>();
	for (const { animator, states: layerStates } of settled) {
		for (const state of layerStates) {
			for (const behavior of records(state.behaviors)) {
				const target = text(behavior.gameObjName);
				if (text(behavior.$type)?.endsWith('SetActiveBehaviorDataForMemoryPack') && target !== null) {
					active.set(target, behavior.active === true);
				}
			}
			if (state.isHaveClip !== true) {
				continue;
			}
			const clipName = text(state.animationClipName);
			const hashValue = clipHashes.get(clipName);
			if (typeof hashValue !== 'string' && typeof hashValue !== 'number') {
				throw new FormatError(`${states.path} lists no clip ${clipName}`);
			}
			const hash = BigInt.asUintN(64, BigInt(hashValue));
			const clipPath = pathOf(hash);
			if (clipPath === undefined) {
				throw new FormatError(`${states.path}: clip ${clipName} isn't in StringPathHash`);
			}
			// oxlint-disable-next-line no-await-in-loop -- a few one-frame clips per model
			const clip = await resolver.findUnique({ hash, path: clipPath }, UnityClass.AnimationClip);
			// oxlint-disable-next-line no-await-in-loop -- as above
			const data = await resolver.read(clip);
			clips.push({ animator, ...readClipEndPose(data), motion: loopingMotion(data) });
		}
	}
	return { key: `${states.model}:${key}`, clips, active };
};

/**
 * @param context bundle and path readers
 * @param states the model's view states
 * @param key tells this pose apart from the model's others, for caching
 * @param blackboard the values the state machines test
 * @returns the pose every animator layer settles in under those values, and the settled states' names
 * @throws {FormatError} if a layer can't settle or a clip can't be read
 */
export const settledPose = async (
	context: Pick<Context, 'world' | 'resolver'>,
	states: ViewStates,
	key: string,
	blackboard: Blackboard,
): Promise<{ pose: PrefabPose; states: string[] }> => {
	const settled = records(states.data.modelAnimatorDatas).map((animator) => {
		const name = text(animator.modelName);
		return {
			animator: name === '$$ROOT$$' ? null : name,
			states: records(animator.layerFsmDatas).map((layer) => settledState(layer, blackboard)),
		};
	});
	return {
		pose: await statesPose(context, states, key, settled),
		states: settled.flatMap(({ states: layerStates }) =>
			layerStates.map((state) => text(state.stateName) ?? ''),
		),
	};
};
