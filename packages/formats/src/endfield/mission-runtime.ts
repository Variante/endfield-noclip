import { FormatError } from '../binary/binary-reader.ts';
import { isObject } from '../unity/values.ts';

// mission definitions: `Data/Json/MissionRuntimeAsset/<missionId>.json`, plain JSON. a mission holds its quests
// (`questDic`), each with objective texts, and lists its main flow in order (`mainPathQuests`). only what labels
// a quest and the levels the mission names are read; objectives, actions and rewards are not.

/** a mission and its quests, as far as labelling needs */
export interface MissionRuntime {
	id: string;
	/** text key of its name, or `null` for internal missions without one */
	nameKey: string | null;
	/**
	 * `MissionType`: 0 Main, 1 Char, 2 Factory, 4 Hide, 5 Misc, 7 World, 8 WeekRaid, 9 FakeMain, 10 Side, 11
	 * Activity, 12 TBCMain
	 */
	type: number;
	/** `MissionChapter` bits: 1 chapter one, 2 chapter two, 4 indie; 0 for none */
	chapters: number;
	/** the level its quest log points to */
	levelId: string | null;
	/** every level or map it names: {@link levelId}, quests' level overrides, tracked scenes and other scene ids */
	levels: string[];
	/** the operator a character mission belongs to, e.g. `chr_0037_minghe`, or `null` */
	charId: string | null;
	/** quest ids of the main flow in order, hidden steps included */
	mainPath: string[];
	quests: MissionQuest[];
}

/** a quest of a mission */
export interface MissionQuest {
	id: string;
	/** text key of its first objective, or `null` without objectives */
	objectiveKey: string | null;
	/** text key of the mission description shown while it runs, or `null` */
	descriptionKey: string | null;
	/** `QuestShowMode` 1000: never shown in the quest log */
	hidden: boolean;
	/** quests that must complete before it starts */
	previous: string[];
}

/**
 * @param text the file decoded as UTF-8 (a leading BOM is tolerated)
 * @returns the mission's labelling fields
 * @throws {FormatError} if the id, type, chapter mask or quest table is missing or malformed
 */
export const parseMissionRuntime = (text: string): MissionRuntime => {
	const raw: unknown = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
	if (!isObject(raw) || typeof raw.missionId !== 'string') {
		throw new FormatError('mission has no missionId');
	}
	const id = raw.missionId;
	const { missionType: type, missionChapterBitmask: chapters, questDic, mainPathQuests } = raw;
	if (
		typeof type !== 'number' ||
		!Number.isInteger(type) ||
		typeof chapters !== 'number' ||
		!Number.isInteger(chapters) ||
		!isObject(questDic)
	) {
		throw new FormatError(`mission ${id} lacks missionType, missionChapterBitmask or questDic`);
	}
	if (!Array.isArray(mainPathQuests) || !mainPathQuests.every((quest) => typeof quest === 'string')) {
		throw new FormatError(`mission ${id} has a malformed mainPathQuests`);
	}
	const quests = Object.entries(questDic).map(([questId, quest]): MissionQuest => {
		if (!isObject(quest) || !Array.isArray(quest.objectiveList) || typeof quest.showMode !== 'number') {
			throw new FormatError(`quest ${questId} lacks objectiveList or showMode`);
		}
		const { prevQuestIdList: previous } = quest;
		if (!Array.isArray(previous) || !previous.every((entry) => typeof entry === 'string')) {
			throw new FormatError(`quest ${questId} has a malformed prevQuestIdList`);
		}
		const [first] = quest.objectiveList;
		return {
			id: questId,
			objectiveKey: isObject(first) ? textKey(first.description) : null,
			descriptionKey: quest.overrideMissionDesc === true ? textKey(quest.descriptionOverride) : null,
			hidden: quest.showMode === 1000,
			previous,
		};
	});
	return {
		id,
		nameKey: textKey(raw.missionName),
		type,
		chapters,
		levelId: typeof raw.levelId === 'string' && raw.levelId !== '' ? raw.levelId : null,
		levels: [...namedLevels(raw, new Set())],
		charId: typeof raw.charId === 'string' && raw.charId !== '' ? raw.charId : null,
		mainPath: mainPathQuests,
		quests,
	};
};

/** fields that hold a level or map id wherever they appear: on the mission, quests, trackers and actions */
const LEVEL_FIELDS = new Set(['levelId', 'levelIdOverride', 'sceneId', '_mapId']);

/**
 * @param value a JSON value
 * @param found ids collected so far; added to
 * @returns `found`
 */
const namedLevels = (value: unknown, found: Set<string>): Set<string> => {
	if (Array.isArray(value)) {
		for (const item of value) {
			namedLevels(item, found);
		}
	} else if (isObject(value)) {
		for (const [key, field] of Object.entries(value)) {
			// conditions wrap their operands, `{ constValue: … }`
			const id = isObject(field) && typeof field.constValue === 'string' ? field.constValue : field;
			if (LEVEL_FIELDS.has(key) && typeof id === 'string') {
				if (id !== '') {
					found.add(id);
				}
			} else {
				namedLevels(field, found);
			}
		}
	}
	return found;
};

/** @returns a `{ key }` text reference's key, or `null` when absent or empty */
const textKey = (value: unknown): string | null =>
	isObject(value) && typeof value.key === 'string' && value.key !== '' ? value.key : null;
