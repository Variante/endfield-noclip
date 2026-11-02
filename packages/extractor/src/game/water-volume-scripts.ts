import { FormatError } from '@endfield-noclip/formats/binary/binary-reader';
import type { MemoryPackValue } from '@endfield-noclip/formats/endfield/memory-pack';

import type { Context } from '../context.ts';
import { VfsGroup } from '../hg/vfs.ts';

// the fills level scripts set water volumes to: `WaterVolumeInfiniteSetHeight` sets a fraction of the volume's
// height, `WaterVolumeSetAmount` an amount out of its maximum, and a `WaterVolumeSetFillSpeed` run just before
// a smooth set-height gives the speed it moves at. see docs/game-data/water.md "water volumes".

/** a fill a level script sets a water volume to */
export interface ScriptWaterLevel {
	/** the volume's id, decimal */
	volume: string;
	/** the script's id */
	script: string;
	/** `fraction` of the volume's height, or `amount` out of its maximum */
	kind: 'fraction' | 'amount';
	value: number;
	/** whether the surface moves there rather than snapping */
	smooth: boolean;
	/** metres per second a fill-speed action just before sets, or `null` */
	speed: number | null;
}

const ROOT = 'Beyond_Gameplay_LevelScriptDataForMemoryPack';
const SCRIPT_PATH = /^Data\/Json\/LevelScriptData\/([^/]+)\/(\d+)\.json$/;

/**
 * reads the constant water volume fills of a scene's level scripts. scripts the schema can't decode are
 * counted and skipped; fills a script computes at runtime aren't listed
 *
 * @param context install readers
 * @param scene owning map
 * @returns fills in script order, and how many scripts couldn't be decoded
 */
export const readScriptWaterLevels = async (
	context: Pick<Context, 'vfs' | 'world' | 'memoryPack'>,
	scene: string,
): Promise<{ levels: ScriptWaterLevel[]; undecoded: number }> => {
	const { vfs, world } = context;
	const reader = await context.memoryPack();
	const levels = new Set(
		[...(await world.levelConfigs()).values()].filter((config) => config.mapId === scene).map(({ id }) => id),
	);
	const result: ScriptWaterLevel[] = [];
	let undecoded = 0;
	for (const name of [...(await vfs.group(VfsGroup.JsonData)).files.keys()].toSorted()) {
		const match = SCRIPT_PATH.exec(name);
		if (match === null || !levels.has(match[1])) {
			continue;
		}
		// oxlint-disable-next-line no-await-in-loop -- scripts are small and released after decoding
		const bytes = await vfs.readVerified((await vfs.find(VfsGroup.JsonData, name))!);
		let decoded: MemoryPackValue;
		try {
			decoded = reader.decode(bytes, ROOT);
		} catch (error) {
			if (!(error instanceof FormatError)) {
				throw error;
			}
			undecoded++;
			continue;
		}
		result.push(...scriptLevels(match[2], decoded));
	}
	return { levels: result, undecoded };
};

type Node = { [key: string]: MemoryPackValue };

const isNode = (value: MemoryPackValue | undefined): value is Node =>
	value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value);

/** @returns a `Param<T>`'s constant, or `undefined` when the script computes it */
const constant = (param: MemoryPackValue | undefined): MemoryPackValue | undefined =>
	isNode(param) && param.paramSource === 0 ? param.constValue : undefined;

const targetOf = (node: Node): string | null => {
	const target = constant(node.target);
	return isNode(target) && (typeof target.id === 'string' || typeof target.id === 'number')
		? String(target.id)
		: null;
};

/**
 * @param script the script's id
 * @param decoded the decoded `LevelScriptData`
 * @returns its constant water volume fills
 */
export const scriptLevels = (script: string, decoded: MemoryPackValue): ScriptWaterLevel[] => {
	const actions: { type: string; node: Node }[] = [];
	const walk = (value: MemoryPackValue): void => {
		if (Array.isArray(value)) {
			value.forEach(walk);
			return;
		}
		if (!isNode(value)) {
			return;
		}
		const match =
			typeof value.$type === 'string'
				? /_Actions_WaterVolume(InfiniteSetHeight|SetAmount|SetFillSpeed)ForMemoryPack$/.exec(value.$type)
				: null;
		if (match !== null) {
			actions.push({ type: match[1], node: value });
		}
		Object.values(value).forEach(walk);
	};
	walk(decoded);
	const result: ScriptWaterLevel[] = [];
	for (const { type, node } of actions) {
		const volume = targetOf(node);
		const value = constant(node.value);
		if (volume === null || typeof value !== 'number') {
			continue;
		}
		if (type === 'InfiniteSetHeight') {
			const smooth = constant(node.isSmooth) === true;
			// the fill speed action whose next node this is, on the same volume
			const before = actions.find(
				(other) =>
					other.type === 'SetFillSpeed' && other.node.nextID === node.ID && targetOf(other.node) === volume,
			);
			const speed = before === undefined ? undefined : constant(before.node.speed);
			result.push({
				volume,
				script,
				kind: 'fraction',
				value,
				smooth,
				speed: smooth && typeof speed === 'number' ? speed : null,
			});
		} else if (type === 'SetAmount') {
			// whether a set amount moves or snaps the surface isn't recovered; it's listed as moving at the volume's speed
			result.push({ volume, script, kind: 'amount', value, smooth: true, speed: null });
		}
	}
	return result;
};
