import { FormatError } from '@endfield-noclip/formats/binary/binary-reader';
import type { MemoryPackValue } from '@endfield-noclip/formats/endfield/memory-pack';
import { readClipEndPose } from '@endfield-noclip/formats/unity/animation-clip';
import { UnityClass } from '@endfield-noclip/formats/unity/serialized-file';

import type { Context } from '../context.ts';
import { VfsGroup } from '../hg/vfs.ts';

import type { PrefabPose } from './prefab.ts';

// interactive doors keep their open and closed looks as view states of their model
// (docs/game-data/assets.md#interactive-doors): per animator layer, a state machine whose settled states play a
// one-frame idle clip. the open state is the settled state whose clip its authors named `…openidle…`; the
// closed one is where the open one returns to. each pose is that clip's end pose plus the GameObjects the
// state switches on or off.

const ROOT = 'Beyond_Gameplay_Core_ModelViewStateController_MVSCModelViewStateControllerDataForMemoryPack';

/** the open and closed looks of a door model */
export interface DoorPoses {
	/** the view states' names, for labels */
	openState: string;
	closedState: string;
	open: PrefabPose;
	closed: PrefabPose;
}

type Record = { [key: string]: MemoryPackValue };

const isRecord = (value: MemoryPackValue | undefined): value is Record =>
	value !== null && typeof value === 'object' && !Array.isArray(value);

const records = (value: MemoryPackValue | undefined): Record[] =>
	Array.isArray(value) ? value.filter(isRecord) : [];

const text = (value: MemoryPackValue | undefined): string | null =>
	typeof value === 'string' ? value : null;

/** a state is settled when nothing moves it on by itself: each of its transitions waits on a condition */
const settled = (state: Record): boolean =>
	state.isHaveClip === true &&
	records(state.transitions).every(
		(transition) =>
			isRecord(transition.conditionGroup) && records(transition.conditionGroup.conditions).length > 0,
	);

/**
 * @param context install readers and the bundle resolver
 * @param model a ModelTable id
 * @returns the model's door poses, or `null` when it has no view states or none is an open idle state
 * @throws {FormatError} if the view states are ambiguous (several open states, no way back to a closed one)
 *   or a clip can't be found or read
 */
export const readDoorPoses = async (
	context: Pick<Context, 'vfs' | 'world' | 'resolver' | 'memoryPack'>,
	model: string,
): Promise<DoorPoses | null> => {
	const path = `Data/Json/Interactive/ModelViewStateControllerData/${model}.json`;
	const file = await context.vfs.find(VfsGroup.JsonData, path);
	if (file === undefined) {
		return null;
	}
	const data = (await context.memoryPack()).decode(await context.vfs.readVerified(file), ROOT);
	if (!isRecord(data)) {
		throw new FormatError(`${path} isn't a view state controller`);
	}
	const found: { animator: string | null; states: Map<string, Record>; open: Record }[] = [];
	for (const animator of records(data.modelAnimatorDatas)) {
		const name = text(animator.modelName);
		for (const layer of records(animator.layerFsmDatas)) {
			const states = new Map(records(layer.stateDatas).map((state) => [text(state.stateName) ?? '', state]));
			for (const state of states.values()) {
				if (settled(state) && /openidle/i.test(text(state.animationClipName) ?? '')) {
					found.push({ animator: name === '$$ROOT$$' ? null : name, states, open: state });
				}
			}
		}
	}
	if (found.length === 0) {
		return null;
	}
	if (found.length > 1) {
		throw new FormatError(`${path} has ${found.length} open idle states`);
	}
	const [{ animator, states, open }] = found;
	// the open state leaves on a condition, then plays through unconditional states to the closed one
	let closed: Record | undefined;
	{
		const [leave] = records(open.transitions);
		let state = states.get(text(leave?.targetStateName) ?? '');
		for (let hops = 0; state !== undefined && hops < 8; hops++) {
			if (settled(state)) {
				closed = state;
				break;
			}
			const onward = records(state.transitions);
			state = onward.length === 1 ? states.get(text(onward[0].targetStateName) ?? '') : undefined;
		}
	}
	if (closed === undefined || records(open.transitions).length !== 1) {
		throw new FormatError(`${path} has no single way from its open state back to a closed one`);
	}

	const clips = new Map(
		records(data.clipAssetInfos).map((info) => [text(info.animationClipName), info.animationClipHash]),
	);
	const [resolver, pathOf] = await Promise.all([context.resolver(), context.world.pathLookup()]);
	const pose = async (state: Record): Promise<PrefabPose> => {
		const name = text(state.stateName) ?? '';
		const clipName = text(state.animationClipName);
		const hashValue = clips.get(clipName);
		if (typeof hashValue !== 'string' && typeof hashValue !== 'number') {
			throw new FormatError(`${path} lists no clip ${clipName}`);
		}
		const hash = BigInt.asUintN(64, BigInt(hashValue));
		const clipPath = pathOf(hash);
		if (clipPath === undefined) {
			throw new FormatError(`${path}: clip ${clipName} isn't in StringPathHash`);
		}
		const clip = await resolver.findUnique({ hash, path: clipPath }, UnityClass.AnimationClip);
		const active = new Map<string, boolean>();
		for (const behavior of records(state.behaviors)) {
			const target = text(behavior.gameObjName);
			if (text(behavior.$type)?.endsWith('SetActiveBehaviorDataForMemoryPack') && target !== null) {
				active.set(target, behavior.active === true);
			}
		}
		return {
			key: `${model}:${name}`,
			animator,
			transforms: readClipEndPose(await resolver.read(clip)).transforms,
			active,
		};
	};
	return {
		openState: text(open.stateName) ?? '',
		closedState: text(closed.stateName) ?? '',
		open: await pose(open),
		closed: await pose(closed),
	};
};
