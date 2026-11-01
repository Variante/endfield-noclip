import { FormatError } from '@endfield-noclip/formats/binary/binary-reader';
import { readChunkLights, type ChunkLight } from '@endfield-noclip/formats/endfield/chunk-lights';
import {
	dynamicResourceSlice,
	readDynamicResources,
	type DynamicModel,
	type DynamicResourceEntity,
	type DynamicResourceGrid,
} from '@endfield-noclip/formats/endfield/dynamic-resources';
import type { DynamicEntity, ExtraSceneSlot } from '@endfield-noclip/formats/endfield/dynamic-scene';
import {
	parseDynamicChunk,
	readChunkEntities,
	type ChunkEntity,
} from '@endfield-noclip/formats/endfield/init-chunk-data';
import type { LevelPartition } from '@endfield-noclip/formats/endfield/level-partition';
import { unpackHgPayload } from '@endfield-noclip/formats/hg/payload';
import type { ConditionalSetInfo, SceneControl } from '@endfield-noclip/package-format/states';
import { streamAreaControl } from '@endfield-noclip/package-format/stream-areas';

import type { Context } from '../context.ts';
import { VfsGroup } from '../hg/vfs.ts';

import { allOf, gateCondition, type Alternatives, type GameState } from './game-state.ts';
import type { PrefabPose } from './prefab.ts';
import { sceneStateControl, SWITCH_VALUES } from './scene-conditions.ts';
import { controllerKey, progressionId } from './scenery-variants.ts';

/** `EDynamicSceneEntityType.Tree`: harvestable trees, whose logic state is standing or felled */
const TREE_ENTITY = 19;
/** `ResourceWithIdControlBySettlement`: an outpost, whose logic state is its level */
const SETTLEMENT_ENTITY = 16;
/** `ResourceWithIdControlByMapVar`: scenery loaded while one map variable holds a value */
const MAP_VAR_ENTITY = 38;

/**
 * finds outpost tiers: an outpost's per-level scenery (its beacon beam and boards), which reads the level
 * through one map variable per tier instead of the outpost's logic state. client data doesn't map tiers to
 * variables, so they're recognised by layout: an outpost's owner with id `u`, its factory region at `u + 1`,
 * then owners at `u + 2`, `u + 3`, … each loading while one map variable equals 1, on consecutive variable
 * ids. tier `n` (from 1) shows at level `n`
 *
 * @param entities dynamic entities in stored order
 * @returns the progression requirement standing in for each tier owner's gate, by owner id
 */
export const outpostTiers = (entities: readonly DynamicEntity[]): Map<bigint, Alternatives> => {
	const byId = new Map<bigint, DynamicEntity>();
	for (const entity of entities) {
		if (entity.uid !== null) {
			byId.set(entity.uid, entity);
		}
	}
	const tiers = new Map<bigint, Alternatives>();
	for (const outpost of entities) {
		const controller = outpost.controllers[0];
		if (
			outpost.uid === null ||
			outpost.entityType !== SETTLEMENT_ENTITY ||
			controller?.kind !== 'settlement'
		) {
			continue;
		}
		const found: bigint[] = [];
		let key: number | null = null;
		for (let id = outpost.uid + 2n; ; id++) {
			const gate = byId.get(id)?.gates;
			const variable = gate?.length === 1 ? gate[0] : undefined;
			if (
				byId.get(id)?.entityType !== MAP_VAR_ENTITY ||
				variable?.kind !== 'mapVar' ||
				variable.compare !== 0 ||
				variable.value !== 1 ||
				(key !== null && variable.key !== key + 1)
			) {
				break;
			}
			key = variable.key;
			found.push(id);
		}
		// a lone variable-gated neighbour is too weak a pattern to tie to the outpost
		if (found.length < 2) {
			continue;
		}
		const control = progressionId(controller.kind, controllerKey(controller));
		for (const [i, id] of found.entries()) {
			tiers.set(id, [[{ control, mask: 1 << (i + 1) }]]);
		}
	}
	return tiers;
};

/** a prefab placement and its owning level */
export interface StructureModel {
	model: DynamicModel;
	levelTag: number;
	source: string;
	visibility: ConditionalSetInfo;
	/** the pose to draw the prefab in, `null` for the saved one */
	pose: PrefabPose | null;
}

/** structures and their visibility decoded from dynamic resources */
export interface DynamicStructures {
	entities: { entity: ChunkEntity; visibility: ConditionalSetInfo }[];
	/** local lights in the ECS groups, under their structure's visibility */
	lights: { light: ChunkLight; visibility: ConditionalSetInfo }[];
	/** script-group and logic-gate controls; load gates read controls of the game state instead */
	controls: SceneControl[];
	/** MapConfig scene state indices the visibility expressions require, as `sceneStateControl` controls */
	sceneStates: Set<number>;
	/** stream areas the visibility expressions require, as `streamAreaControl` controls */
	areas: Set<number>;
	/** slots for separately stored scenes (Dijiang cabins), one per distinct slot, with the first owner's id */
	slots: { id: string; slot: ExtraSceneSlot }[];
	models: StructureModel[];
	/** selections and exclusions, for the pack report */
	counts: Record<string, number>;
}

/**
 * resolves dynamic scenery and preserves progression masks, load gates and manual script/state gates
 *
 * @param context install readers
 * @param scene streaming scene id
 * @param partition level ownership, when available
 * @param game the scene's game state; the load gates' conditions are noted in it and read its controls
 * @returns ECS renderers and prefab placements, deduplicated by their stored resource references
 * @throws {FormatError} if a selected resource has no grid, chunk or group
 */
export const loadDynamicStructures = async (
	context: Pick<Context, 'vfs'>,
	scene: string,
	partition: LevelPartition | undefined,
	game: GameState,
): Promise<DynamicStructures> => {
	const { vfs } = context;
	const prefix = `Data/DynamicStreaming/PC/Scene/${scene}/`;
	const names = [...(await vfs.group(VfsGroup.DynamicStreaming)).files.keys()]
		.filter((name) => name.startsWith(`${prefix}fb_main_`))
		.toSorted();
	const read = async (name: string): Promise<Uint8Array> => {
		const file = await vfs.find(VfsGroup.DynamicStreaming, name);
		if (file === undefined) {
			throw new FormatError(`missing dynamic resource ${name}`);
		}
		return vfs.readVerified(file);
	};
	const grids = new Map<number, DynamicResourceGrid>();
	const owners: DynamicResourceEntity[] = [];
	for (const name of names) {
		// oxlint-disable-next-line no-await-in-loop -- main files are small and released after decoding
		const decoded = readDynamicResources(await read(name));
		for (const grid of decoded.grids) {
			if (grids.has(grid.id)) {
				throw new FormatError(`duplicate dynamic grid ${grid.id}`);
			}
			grids.set(grid.id, grid);
		}
		owners.push(...decoded.entities);
	}
	const result: DynamicStructures = {
		entities: [],
		lights: [],
		models: [],
		controls: [],
		sceneStates: new Set(),
		areas: new Set(),
		slots: [],
		counts: { owners: owners.length, ecsGroups: 0, models: 0, effects: 0 },
	};
	const controls = new Map<string, SceneControl>();
	const tiers = outpostTiers(owners.map((owner) => owner.entity));
	game.note(
		owners.flatMap(({ entity }) =>
			entity.uid !== null && tiers.has(entity.uid) ? [] : entity.gates.map(gateCondition),
		),
	);
	const chunks = new Map<string, Map<number, ConditionalSetInfo>>();
	const models = new Map<string, StructureModel>();
	const ordinals = new Map<number, number>();
	const addSwitch = (kind: 'script' | 'logic', id: string, enabled: boolean): void => {
		if (!controls.has(id)) {
			controls.set(id, {
				kind,
				id,
				name: id,
				rule: null,
				assumption:
					kind === 'logic'
						? 'no recovered controller, so off'
						: enabled
							? 'authored to load until a script hides it'
							: 'loads only when a level script shows it',
				story: null,
				drivers: [],
				levelTags: [],
				values: SWITCH_VALUES,
				default: Number(enabled),
				derived: null,
			});
		}
	};
	for (const owner of owners) {
		const { entity } = owner;
		const ordinal = ordinals.get(entity.grid) ?? 0;
		ordinals.set(entity.grid, ordinal + 1);
		// level scripts address script-controlled entities by their global id, which holds across builds
		const owned = entity.uid === null ? `${entity.grid}:${ordinal}` : String(entity.uid);
		// a slot is stored on two entities with identical components
		const { extraScene } = entity;
		if (
			extraScene !== null &&
			!result.slots.some(({ slot }) => slot.position.every((v, i) => v === extraScene.position[i]))
		) {
			result.slots.push({ id: owned, slot: extraScene });
		}
		const controller = entity.controllers[0];
		const gates =
			(entity.uid === null ? undefined : tiers.get(entity.uid)) ??
			entity.gates.reduce<Alternatives>(
				(partial, gate) => allOf(partial, game.requirements(gateCondition(gate))),
				[[]],
			);
		for (const [i, group] of entity.resourceGroups.entries()) {
			const ref = group.resources;
			if (ref.count === 0) {
				continue;
			}
			const tag = partition?.levels.find((level) => level.idNum === group.levelNum)?.tag ?? 0;
			let alternatives = gates;
			if (owner.scriptDefaultLoad !== null) {
				addSwitch('script', `script:${owned}`, owner.scriptDefaultLoad);
				alternatives = allOf(alternatives, [[{ control: `script:${owned}`, mask: 2 }]]);
			}
			if (group.logicState !== 0) {
				if (controller) {
					alternatives = allOf(alternatives, [
						[{ control: progressionId(controller.kind, controllerKey(controller)), mask: group.logicState }],
					]);
				} else if (entity.entityType === TREE_ENTITY) {
					// bit 0 standing, bit 1 the stump: the player fells each tree at runtime, so one control per
					// level previews them all
					const id = `harvest:${tag}`;
					if (!controls.has(id)) {
						controls.set(id, {
							kind: 'harvest',
							id,
							name: 'Harvestable trees',
							rule: null,
							assumption: 'standing, as before the player fells them',
							story: null,
							drivers: [],
							levelTags: [],
							values: [
								{ value: 0, label: 'standing' },
								{ value: 1, label: 'felled' },
							],
							default: 0,
							derived: null,
						});
					}
					alternatives = allOf(alternatives, [[{ control: id, mask: group.logicState }]]);
				} else if ((group.logicState & 1) === 0) {
					const id = `logic:${owned}:${group.logicState}`;
					addSwitch('logic', id, false);
					alternatives = allOf(alternatives, [[{ control: id, mask: 2 }]]);
				}
			}
			// visible-state lists hold MapConfig scene state indices; the entity and the group each need one of
			// theirs active
			for (const states of [owner.states, owner.groupStates[i]]) {
				if (states.length === 0) {
					continue;
				}
				for (const index of states) {
					result.sceneStates.add(index);
				}
				alternatives = allOf(
					alternatives,
					states.map((index) => [{ control: sceneStateControl(index), mask: 2 }]),
				);
			}
			// visible-area lists hold stream areas, shown while the camera is in a trigger zone listing one; area 0
			// is shown everywhere
			for (const areas of [owner.areas, owner.groupAreas[i]]) {
				if (areas.length === 0 || areas.includes(0)) {
					continue;
				}
				for (const area of areas) {
					result.areas.add(area);
				}
				alternatives = allOf(
					alternatives,
					areas.map((area) => [{ control: streamAreaControl(area), mask: 2 }]),
				);
			}
			const grid = grids.get(ref.grid);
			if (!grid) {
				throw new FormatError(`missing dynamic grid ${ref.grid}`);
			}
			switch (ref.type) {
				// effect rows place prefabs like model rows, from their own vector
				case 5:
				case 6: {
					const effect = ref.type === 6;
					const rows = dynamicResourceSlice(effect ? grid.effects : grid.models, ref);
					if (effect) {
						result.counts.effects += rows.length;
					}
					for (const [index, model] of rows.entries()) {
						const key = `${effect ? 'effect:' : ''}${ref.grid}/${ref.index + index}`;
						models
							.getOrInsertComputed(key, () => ({
								model,
								levelTag: tag,
								source: key,
								visibility: { alternatives: [] },
								pose: null,
							}))
							.visibility.alternatives.push(...alternatives);
					}
					break;
				}
				case 7: {
					for (const ecs of dynamicResourceSlice(grid.ecs, ref)) {
						const key = `${ecs.sceneIndex.toString().padStart(2, '0')}_${ecs.chunk.toString().padStart(8, '0')}`;
						chunks
							.getOrInsertComputed(key, () => new Map())
							.getOrInsertComputed(ecs.index, () => ({ alternatives: [] }))
							.alternatives.push(...alternatives);
					}
					break;
				}
				default: {
					throw new FormatError(`unsupported dynamic resource type ${ref.type}`);
				}
			}
		}
	}
	const entities = new Map<number, { entity: ChunkEntity; visibility: ConditionalSetInfo }>();
	const lights = new Map<number, { light: ChunkLight; visibility: ConditionalSetInfo }>();
	for (const [key, indices] of chunks) {
		// oxlint-disable-next-line no-await-in-loop -- release each pair after its renderer groups are decoded
		const [init, streaming] = await Promise.all([
			read(`${prefix}fb_init_${key}.bytes`),
			read(`${prefix}fb_streaming_${key}.bytes`),
		]);
		const initPayload = unpackHgPayload(init);
		const chunk = parseDynamicChunk(initPayload, unpackHgPayload(streaming));
		const chunkLights = new Map(readChunkLights(initPayload, chunk).map((light) => [light.id, light]));
		for (const [index, visibility] of indices) {
			const group = chunk.groups[index];
			if (!group) {
				throw new FormatError(`missing ECS group ${key}/${index}`);
			}
			result.counts.ecsGroups++;
			for (const entity of readChunkEntities({ ...chunk, groups: [group] })) {
				entities
					.getOrInsertComputed(entity.id, () => ({ entity, visibility: { alternatives: [] } }))
					.visibility.alternatives.push(...visibility.alternatives);
			}
			for (const id of group.ids) {
				const light = chunkLights.get(id);
				if (light !== undefined) {
					lights
						.getOrInsertComputed(id, () => ({ light, visibility: { alternatives: [] } }))
						.visibility.alternatives.push(...visibility.alternatives);
				}
			}
		}
	}
	// representative renderer names identify manual groups without assigning an invented event condition.
	const labels = new Map<string, Map<string, number>>();
	for (const { entity, visibility } of entities.values()) {
		const name = entity.name.replace(/#.*$/, '').replace(/ \(\d+\)(?:_ECSMerged)?$/, '');
		for (const control of new Set(
			visibility.alternatives.flatMap((requirements) =>
				requirements.map((requirement) => requirement.control),
			),
		)) {
			const frequencies = labels.getOrInsertComputed(control, () => new Map());
			frequencies.set(name, (frequencies.get(name) ?? 0) + 1);
		}
	}
	for (const control of controls.values()) {
		if (control.kind === 'harvest') {
			continue;
		}
		// oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy
		const ranked = [...(labels.get(control.id) ?? [])].sort((a, b) => b[1] - a[1]);
		control.name =
			ranked
				.slice(0, 2)
				.map(([name]) => name)
				.join(' / ') || control.id;
	}
	result.entities = [...entities.values()];
	result.lights = [...lights.values()];
	result.models = [...models.values()];
	result.controls = [...controls.values()];
	result.counts.models = result.models.length;
	return result;
};
