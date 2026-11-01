import { FormatError } from '@endfield-noclip/formats/binary/binary-reader';
import {
	readInteractiveBaseModel,
	readInteractiveTable,
	readInteractiveVariantModels,
} from '@endfield-noclip/formats/endfield/interactive-model';
import {
	type LevelInteractive,
	readLevelInteractives,
	UnsupportedLevelData,
} from '@endfield-noclip/formats/endfield/level-interactives';
import type { LevelPartition } from '@endfield-noclip/formats/endfield/level-partition';
import type { MemoryPackValue } from '@endfield-noclip/formats/endfield/memory-pack';
import { parseSparkTable } from '@endfield-noclip/formats/hg/spark-buffer';
import { UnityClass } from '@endfield-noclip/formats/unity/serialized-file';
import { isObject, numberField, objectField, stringField } from '@endfield-noclip/formats/unity/values';
import type { ConditionalSetInfo, SceneControl } from '@endfield-noclip/package-format/states';

import type { Context } from '../context.ts';
import { VfsGroup } from '../hg/vfs.ts';

import { readDoodadShell, type DoodadShell } from './doodad-shell.ts';
import { readDoorPoses, type DoorPoses } from './door-poses.ts';
import type { StructureModel } from './dynamic-structures.ts';
import type { PrefabPose } from './prefab.ts';
import { progressionControl } from './scenery-variants.ts';

// these facility templates share the validated model-upgrade component, so their visual forms become a
// progression control. every other template draws its base model only.
const TEMPLATES = new Map([
	[
		'int_system_domain_shop',
		{
			name: 'Stock redistribution facility',
			data: 'Data/Json/Interactive/InteractiveData/data_int_system_domain_shop.json',
		},
	],
	[
		'int_system_domain_depot',
		{ name: 'Depot', data: 'Data/Json/Interactive/InteractiveData/data_int_system_domain_depot.json' },
	],
	[
		'int_doodad_core_recycle',
		{
			name: 'Recycling station',
			data: 'Data/Json/Interactive/InteractiveData/data_int_doodad_core_recycle.json',
		},
	],
	[
		'int_system_kite_station',
		{
			name: 'Environment monitoring terminal',
			data: 'Data/Json/Interactive/InteractiveData/data_int_system_kite_station.json',
		},
	],
]);

/** the MemoryPack wrapper of interactive templates */
const TEMPLATE_ROOT = 'Beyond_Gameplay_InteractiveTemplateDataForMemoryPack';

/**
 * @param template a decoded interactive template
 * @param path its file, for errors
 * @returns its base model (the model component's) and its model-upgrade list, one ModelTable id per visual
 *   form
 * @throws {FormatError} if either component is missing or the base model isn't one of the forms
 */
const facilityModels = (
	template: MemoryPackValue,
	path: string,
): { id: string; scale: number; levels: string[] } => {
	const components =
		template !== null && typeof template === 'object' && !Array.isArray(template)
			? template.componentList
			: null;
	const find = (suffix: string) =>
		(Array.isArray(components) ? components : []).find(
			(component): component is { [key: string]: MemoryPackValue } =>
				component !== null &&
				typeof component === 'object' &&
				!Array.isArray(component) &&
				typeof component.$type === 'string' &&
				component.$type.endsWith(suffix),
		);
	const model = find('_InteractiveModelComponentDataForMemoryPack');
	const upgrade = find('_InteractiveModelLevelUpComponentDataForMemoryPack');
	const levels = upgrade?.modelLevelList;
	if (
		typeof model?.modelId !== 'string' ||
		typeof model.modelScale !== 'number' ||
		!Array.isArray(levels) ||
		!levels.every((level) => typeof level === 'string') ||
		!levels.includes(model.modelId)
	) {
		throw new FormatError(`${path} lacks a model and a model-upgrade list holding it`);
	}
	return { id: model.modelId, scale: model.modelScale, levels };
};

/** components that make a template a door: common doors, and Dijiang's room doors */
const DOOR_COMPONENTS = [
	'_InteractiveDoorCommonComponentDataForMemoryPack',
	'_SpaceshipRoomDoorSystemDataForMemoryPack',
];

/** the component of Dijiang's construction-area walls */
const REGION_WALL_COMPONENTS = ['_SpaceshipRegionWallDataForMemoryPack'];

/**
 * @param template a decoded interactive template
 * @param suffixes component type name suffixes
 * @returns whether it has a component of one of those types
 */
const hasComponent = (template: MemoryPackValue, suffixes: readonly string[]): boolean => {
	const components =
		template !== null && typeof template === 'object' && !Array.isArray(template)
			? template.componentList
			: null;
	return (Array.isArray(components) ? components : []).some(
		(component) =>
			component !== null &&
			typeof component === 'object' &&
			!Array.isArray(component) &&
			typeof component.$type === 'string' &&
			suffixes.some((suffix) => typeof component.$type === 'string' && component.$type.endsWith(suffix)),
	);
};

const TABLE = 'Data/Json/Interactive/InteractiveTable.json';

/** construction area → the Control Nexus level that unlocks it */
const AREA_UNLOCK_TABLE = 'Data/TableCfg/SpaceshipAreaUnlockNeedCenterLvTable.bytes';

/** the placement parameter naming a region wall's construction area */
const AREA_KEY = 'system_inst_key';

/**
 * @param row a placed interactive
 * @returns the string of its {@link AREA_KEY} parameter on any component, or null
 */
const areaOf = (row: LevelInteractive): string | null => {
	for (const params of row.componentProperties.values()) {
		const text = params.find((param) => param.key === AREA_KEY)?.values[0]?.text;
		if (text) {
			return text;
		}
	}
	return null;
};

/** a placed door and its open/closed control */
export interface InteractiveDoor {
	control: SceneControl;
	position: [number, number, number];
}

/** a placed interactive with a model the reader couldn't find, to draw a stand-in for */
export interface InteractiveStandIn {
	/** `<LevelData path>#<row id>` */
	source: string;
	template: string;
	reason: string;
	levelTag: number;
	position: [number, number, number];
	/** Unity Euler angles, degrees */
	rotation: [number, number, number];
	scale: [number, number, number];
}

/**
 * resolves the models of interactives placed by referenced LevelData: the visual forms of the facility
 * templates in {@link TEMPLATES}, each under a `facility:<id>` control, and every other interactive's model
 * (its template variant's, else the template's), always shown. a model that is a doodad-group shell also
 * places its form models, one per group level, under a per-level `doodadGroups:<level id>` control. a model
 * with door poses is placed closed and open, under a `door:<id>` control, closed by default
 *
 * @param context install readers and the bundle resolver
 * @param scene owning map
 * @param level restricts decoding to one level, or null for the map
 * @param partition numeric level tags
 * @returns placements, controls, explicit unsupported-file diagnostics and the placements of interactives
 *   whose model wasn't found (a template that's missing or can't be read, or a model id the model table
 *   lacks); no partial file is used
 * @throws {FormatError} for broken authored references or malformed supported records
 */
export const loadInteractiveFacilities = async (
	context: Pick<Context, 'vfs' | 'world' | 'resolver' | 'memoryPack'>,
	scene: string,
	level: string | null,
	partition: LevelPartition | undefined,
): Promise<{
	models: StructureModel[];
	progressions: SceneControl[];
	doors: InteractiveDoor[];
	unsupported: { path: string; reason: string }[];
	standIns: InteractiveStandIn[];
}> => {
	const { vfs, world } = context;
	const reader = await context.memoryPack();
	const find = (name: string) => vfs.find(VfsGroup.JsonData, name);
	const read = async (name: string): Promise<Uint8Array> => {
		const file = await find(name);
		if (!file) {
			throw new FormatError(`missing interactive data ${name}`);
		}
		return vfs.readVerified(file);
	};
	const pool = await world.stringPool();
	const string = (id: number): string | null => pool.get(id);
	const table: unknown = JSON.parse(
		new TextDecoder().decode(await read('Data/Json/GameplayConfig/ModelTable.json')),
	);
	if (!isObject(table)) {
		throw new FormatError('invalid model table');
	}
	const modelData = objectField(table, 'data');
	const formOf = (modelId: string, scale: number): { prefab: string; scale: number } => {
		const data = objectField(modelData, modelId);
		return {
			prefab: stringField(data, 'path').toLowerCase(),
			scale: scale * numberField(data, 'scaleFactor'),
		};
	};
	const interactives = readInteractiveTable(await read(TABLE), string);
	const unsupported: { path: string; reason: string }[] = [];

	// placements first, so only the templates they use are read
	const pathOf = await world.pathLookup();
	const placed: { path: string; levelId: string; levelTag: number; row: LevelInteractive }[] = [];
	{
		const seen = new Set<bigint>();
		for (const config of (await world.levelConfigs()).values()) {
			if (config.mapId !== scene || (level !== null && config.id !== level)) {
				continue;
			}
			const levelTag = partition?.levels.find((entry) => entry.id === config.id)?.tag ?? 0;
			for (const hash of config.levelDataPathHashes ?? []) {
				const path = pathOf(hash);
				if (!path) {
					throw new FormatError(`missing LevelData path ${hash}`);
				}
				let rows;
				try {
					// oxlint-disable-next-line no-await-in-loop -- level files are released after their prefix is decoded
					rows = readLevelInteractives(await read(path), string);
				} catch (error) {
					if (!(error instanceof UnsupportedLevelData)) {
						throw error;
					}
					unsupported.push({ path, reason: error.message });
					continue;
				}
				for (const row of rows) {
					if (row.createState !== 0 || seen.has(row.id)) {
						continue;
					}
					seen.add(row.id);
					placed.push({ path, levelId: config.id, levelTag, row });
				}
			}
		}
	}

	const authored = new Map<
		string,
		{
			name: string | null;
			initial: number;
			forms: { prefab: string; scale: number }[];
			/** the ModelTable id of a single-model interactive, `null` for facilities */
			model: string | null;
			/** the template's data file */
			data: string;
		}
	>();
	/** by placed template id, why its model wasn't found */
	const modelless = new Map<string, string>();
	const templates = new Map<
		string,
		{
			base: { id: string; scale: number } | null;
			variants: Map<string, string | null>;
			/** why the template couldn't be read, `null` when it was */
			failure: string | null;
		}
	>();
	const variantsOf = new Map<string, Set<string>>();
	for (const [id, template] of interactives.templates) {
		if (id !== template) {
			variantsOf.getOrInsertComputed(template, () => new Set()).add(id);
		}
	}
	for (const key of new Set(placed.map(({ row }) => row.template))) {
		const facility = TEMPLATES.get(key);
		if (facility !== undefined) {
			// oxlint-disable-next-line no-await-in-loop -- small templates, read once per map
			const model = facilityModels(reader.decode(await read(facility.data), TEMPLATE_ROOT), facility.data);
			authored.set(key, {
				name: facility.name,
				initial: model.levels.indexOf(model.id),
				forms: model.levels.map((modelId) => formOf(modelId, model.scale)),
				model: null,
				data: facility.data,
			});
			continue;
		}
		const template = interactives.templates.get(key);
		const data = template === undefined ? undefined : interactives.templatePaths.get(template);
		if (template === undefined || data === undefined) {
			unsupported.push({ path: TABLE, reason: `no template for ${key}` });
			modelless.set(key, 'no template');
			continue;
		}
		let resolved = templates.get(template);
		if (resolved === undefined) {
			try {
				// oxlint-disable-next-line no-await-in-loop -- small templates, read once per map
				const bytes = await read(data);
				resolved = {
					base: readInteractiveBaseModel(bytes, string),
					variants: readInteractiveVariantModels(bytes, string, variantsOf.get(template) ?? new Set()),
					failure: null,
				};
			} catch (error) {
				if (!(error instanceof FormatError)) {
					throw error;
				}
				unsupported.push({ path: data, reason: error.message });
				resolved = { base: null, variants: new Map(), failure: error.message };
			}
			templates.set(template, resolved);
		}
		if (resolved.failure !== null) {
			// the template may have had a model, so it gets a stand-in rather than being taken for a trigger
			modelless.set(key, resolved.failure);
			continue;
		}
		const { base } = resolved;
		const modelId = resolved.variants.get(key) ?? base?.id;
		if (modelId === undefined) {
			// triggers and logic-only interactives have no model
			continue;
		}
		if (!(modelId in modelData)) {
			unsupported.push({ path: data, reason: `model ${modelId} of ${key} is not in the model table` });
			modelless.set(key, `model ${modelId} is not in the model table`);
			continue;
		}
		authored.set(key, {
			name: null,
			initial: 0,
			forms: [formOf(modelId, base?.scale ?? 1)],
			model: modelId,
			data,
		});
	}

	const hashes = new Map<string, bigint>();
	const manifest = await world.manifest();
	// the manifest maps hashes to paths only, and each path decompresses on read: stop once all are found
	const findHashes = (paths: Iterable<string>): void => {
		const missing = new Set([...paths].filter((path) => !hashes.has(path)));
		for (const asset of manifest.assets()) {
			if (missing.size === 0) {
				break;
			}
			const path = manifest.assetPath(asset);
			if (missing.delete(path)) {
				hashes.set(path, asset.pathHash);
			}
		}
	};
	findHashes(authored.values().flatMap((template) => template.forms.map((form) => form.prefab)));
	const hashOf = (prefab: string): bigint => {
		const hash = hashes.get(prefab);
		if (hash === undefined) {
			throw new FormatError(`missing interactive prefab ${prefab}`);
		}
		return hash;
	};

	// doodad-group centres draw an empty shell; their visible model is one form per group level
	const doodads = new Map<string, { groupLevel: number; form: { prefab: string; scale: number } }[]>();
	{
		const resolver = await context.resolver();
		const shells = new Map<string, DoodadShell | null>();
		for (const [key, template] of authored) {
			if (template.name !== null) {
				continue;
			}
			const [{ prefab, scale }] = template.forms;
			let shell = shells.get(prefab);
			if (shell === undefined) {
				try {
					// oxlint-disable-next-line no-await-in-loop -- one root per distinct prefab
					const root = await resolver.findUnique(
						{ hash: hashOf(prefab), path: prefab },
						UnityClass.GameObject,
					);
					// oxlint-disable-next-line no-await-in-loop -- as above
					shell = await readDoodadShell(resolver, root);
				} catch (error) {
					if (!(error instanceof FormatError)) {
						throw error;
					}
					unsupported.push({ path: prefab, reason: error.message });
					shell = null;
				}
				shells.set(prefab, shell);
			}
			if (shell === null) {
				continue;
			}
			const levels = [];
			for (const [groupLevel, modelId] of shell.forms.entries()) {
				if (modelId === null) {
					continue;
				}
				if (!(modelId in modelData)) {
					unsupported.push({ path: prefab, reason: `doodad form ${modelId} is not in the model table` });
					continue;
				}
				levels.push({ groupLevel, form: formOf(modelId, scale) });
			}
			doodads.set(key, levels);
		}
		findHashes(doodads.values().flatMap((levels) => levels.map(({ form }) => form.prefab)));
	}

	// doors drawn open or closed: interactives of door templates whose model has door poses, by key. region
	// walls, by key, are drawn while their construction area is locked
	const doorPoses = new Map<string, DoorPoses>();
	const regionWalls = new Set<string>();
	{
		const templateKinds = new Map<string, 'door' | 'regionWall' | null>();
		const byModel = new Map<string, DoorPoses | null>();
		// a failed read reports and leaves the model drawn as saved
		const attempt = async <T>(path: string, run: () => Promise<T>, failed: T): Promise<T> => {
			try {
				return await run();
			} catch (error) {
				if (!(error instanceof FormatError)) {
					throw error;
				}
				unsupported.push({ path, reason: error.message });
				return failed;
			}
		};
		for (const [key, { model, data }] of authored) {
			if (model === null) {
				continue;
			}
			let kind = templateKinds.get(data);
			if (kind === undefined) {
				// oxlint-disable-next-line no-await-in-loop -- one decode per template
				kind = await attempt(
					data,
					async () => {
						const decoded = reader.decode(await read(data), TEMPLATE_ROOT);
						if (hasComponent(decoded, DOOR_COMPONENTS)) {
							return 'door';
						}
						if (hasComponent(decoded, REGION_WALL_COMPONENTS)) {
							return 'regionWall';
						}
						return null;
					},
					null,
				);
				templateKinds.set(data, kind);
			}
			if (kind === 'regionWall') {
				regionWalls.add(key);
			}
			if (kind !== 'door') {
				continue;
			}
			let poses = byModel.get(model);
			if (poses === undefined) {
				// oxlint-disable-next-line no-await-in-loop -- a few view state files and one-frame clips per map
				poses = await attempt(model, () => readDoorPoses(context, model), null);
				byModel.set(model, poses);
			}
			if (poses !== null) {
				doorPoses.set(key, poses);
			}
		}
	}

	// Dijiang's region walls hide once the Control Nexus level unlocks their construction area. one control,
	// offered at the levels that unlock an area; levels between them change no wall
	let nexus: { control: SceneControl; unlockOf: Map<string, number> } | null = null;
	{
		const walls = placed.filter(({ row }) => regionWalls.has(row.template));
		const file = walls.length > 0 ? await vfs.find(VfsGroup.Table, AREA_UNLOCK_TABLE) : undefined;
		if (walls.length > 0 && file === undefined) {
			unsupported.push({ path: AREA_UNLOCK_TABLE, reason: 'missing; region walls stay shown' });
		}
		if (file !== undefined) {
			const unlockOf = new Map<string, number>();
			for (const [area, unlock] of parseSparkTable(await vfs.readVerified(file)).entries) {
				if (typeof area !== 'string' || typeof unlock !== 'number' || unlock < 1 || unlock > 31) {
					throw new FormatError(`${AREA_UNLOCK_TABLE} has an invalid entry for ${String(area)}`);
				}
				unlockOf.set(area, unlock);
			}
			// oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy
			const levels = [...new Set([1, ...unlockOf.values()])].sort((a, b) => a - b);
			nexus = {
				control: {
					kind: 'controlNexus',
					id: `controlNexus:${walls[0].levelId}`,
					name: 'Control Nexus level',
					rule: null,
					assumption: 'level 1, before the player upgrades it',
					story: null,
					drivers: [],
					levelTags: [],
					values: levels.map((value) => ({ value, label: `Level ${value}` })),
					default: 1,
					derived: null,
				},
				unlockOf,
			};
		}
	}

	const models: StructureModel[] = [];
	const progressions: SceneControl[] = nexus === null ? [] : [nexus.control];
	const doors: InteractiveDoor[] = [];
	const doodadLevels = new Map<string, Set<number>>();
	const standIns: InteractiveStandIn[] = [];
	for (const { path, levelId, levelTag, row } of placed) {
		const template = authored.get(row.template);
		if (template === undefined) {
			const reason = modelless.get(row.template);
			if (reason !== undefined) {
				standIns.push({
					source: `${path}#${row.id}`,
					template: row.template,
					reason,
					levelTag,
					position: row.position,
					rotation: row.rotation,
					scale: row.scale,
				});
			}
			continue;
		}
		const place = (
			model: { prefab: string; scale: number },
			visibility: ConditionalSetInfo,
			pose: PrefabPose | null,
		): void => {
			// zero is the authored "no scale override" sentinel on LevelInteractiveData.
			const scale = row.modelScale > 0 ? row.modelScale : model.scale;
			models.push({
				model: {
					pathHash: hashOf(model.prefab),
					position: row.position,
					rotation: row.rotation,
					scale: [row.scale[0] * scale, row.scale[1] * scale, row.scale[2] * scale],
				},
				levelTag,
				source: `${path}#${row.id}`,
				visibility,
				pose,
			});
		};
		const poses = doorPoses.get(row.template);
		if (poses !== undefined) {
			const control = `door:${row.id}`;
			doors.push({
				control: {
					kind: 'door',
					id: control,
					name: `${row.template} (${Math.round(row.position[0])}, ${Math.round(row.position[2])})`,
					rule: null,
					assumption: 'closed: the player or the server opens it',
					story: null,
					drivers: [],
					levelTags: [],
					values: [
						{ value: 0, label: `closed (${poses.closedState})` },
						{ value: 1, label: `open (${poses.openState})` },
					],
					default: 0,
					derived: null,
				},
				position: row.position,
			});
			place(template.forms[0], { alternatives: [[{ control, mask: 1 }]] }, poses.closed);
			place(template.forms[0], { alternatives: [[{ control, mask: 2 }]] }, poses.open);
			continue;
		}
		if (nexus !== null && regionWalls.has(row.template)) {
			const unlock = nexus.unlockOf.get(areaOf(row) ?? '');
			if (unlock === undefined) {
				// no level unlocks the area in this client
				place(template.forms[0], { alternatives: [[]] }, null);
				continue;
			}
			let mask = 0;
			for (const { value } of nexus.control.values) {
				if (value < unlock) {
					mask |= 1 << value;
				}
			}
			if (mask !== 0) {
				place(template.forms[0], { alternatives: [[{ control: nexus.control.id, mask: mask >>> 0 }]] }, null);
			}
			continue;
		}
		if (template.name === null) {
			place(template.forms[0], { alternatives: [[]] }, null);
			const doodad = doodads.get(row.template);
			if (doodad === undefined || doodad.length === 0) {
				continue;
			}
			const id = `doodadGroups:${levelId}`;
			const levels = doodadLevels.getOrInsertComputed(id, () => new Set<number>());
			for (const { groupLevel, form } of doodad) {
				levels.add(groupLevel);
				place(form, { alternatives: [[{ control: id, mask: (1 << groupLevel) >>> 0 }]] }, null);
			}
			continue;
		}
		const id = `facility:${row.id}`;
		progressions.push(
			progressionControl(
				'facility',
				id,
				`${template.name} (${Math.round(row.position[0])}, ${Math.round(row.position[2])})`,
				template.forms.map((_, i) => i),
				template.initial,
				"the template's base model",
			),
		);
		for (const [form, model] of template.forms.entries()) {
			place(model, { alternatives: [[{ control: id, mask: (1 << form) >>> 0 }]] }, null);
		}
	}
	for (const [id, set] of doodadLevels) {
		// oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy
		const levels = [...set].sort((a, b) => a - b);
		// shell slot activity varies (one or all four), so default to the fully grown form
		progressions.push(
			progressionControl(
				'doodadGroups',
				id,
				'Resource nodes',
				levels,
				levels.at(-1)!,
				'the fully grown form',
			),
		);
	}
	return { models, progressions, doors, unsupported, standIns };
};
