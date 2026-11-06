import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FormatError } from '../binary/binary-reader.ts';

import { parseMissionRuntime } from './mission-runtime.ts';

const quest = (fields: Record<string, unknown>) => ({
	questType: 0,
	showMode: 1,
	objectiveList: [{ description: { key: 'objective_x1m1_1_001' } }],
	overrideMissionDesc: false,
	descriptionOverride: {},
	prevQuestIdList: [],
	...fields,
});

test('reads a mission name, operator, the levels it names, its main flow and per-quest text keys', () => {
	const mission = parseMissionRuntime(
		`﻿${JSON.stringify({
			missionId: 'x1m1',
			missionName: { key: 'x1m1_name' },
			missionType: 0,
			missionChapterBitmask: 1,
			charId: 'chr_0001_x',
			levelId: 'map01_lv002',
			questDic: {
				'x1m1_q#1': quest({
					levelIdOverride: '',
					objectiveList: [
						{
							description: { key: 'objective_x1m1_1_001' },
							condition: {
								_mapId: { constValue: 'dung01_rdg002' },
								// Treasure Beneath the Pond's drain: the pond at 800 of 40000 or less
								subConditions: [
									{
										$type: 'Beyond.Gameplay.CheckFluidVolume, Gameplay.Beyond',
										levelId: { constValue: 'map02_lv002' },
										volumeId: { constValue: { id: 22800060004 } },
										_comparer: { constValue: 5 },
										_targetVolume: { constValue: 800 },
									},
								],
							},
							trackingInfoList: [{ sceneId: 'dung01_rdg001' }, { sceneId: 'map01_lv002' }],
						},
					],
				}),
				'x1m1_q#2': quest({
					overrideMissionDesc: true,
					descriptionOverride: { key: 'x1m1_desc_002' },
					prevQuestIdList: ['x1m1_q#1'],
				}),
				'x1m1_q#Deco': quest({ showMode: 1000, objectiveList: [], prevQuestIdList: ['x1m1_q#1'] }),
			},
			mainPathQuests: ['x1m1_q#1', 'x1m1_q#2'],
		})}`,
	);
	assert.deepEqual(mission, {
		id: 'x1m1',
		nameKey: 'x1m1_name',
		type: 0,
		chapters: 1,
		levelId: 'map01_lv002',
		levels: ['map01_lv002', 'dung01_rdg002', 'map02_lv002', 'dung01_rdg001'],
		charId: 'chr_0001_x',
		mainPath: ['x1m1_q#1', 'x1m1_q#2'],
		quests: [
			{
				id: 'x1m1_q#1',
				objectiveKey: 'objective_x1m1_1_001',
				descriptionKey: null,
				hidden: false,
				previous: [],
				fluidChecks: [{ levelId: 'map02_lv002', volume: '22800060004', compare: 5, target: 800 }],
			},
			{
				id: 'x1m1_q#2',
				objectiveKey: 'objective_x1m1_1_001',
				descriptionKey: 'x1m1_desc_002',
				hidden: false,
				previous: ['x1m1_q#1'],
				fluidChecks: [],
			},
			{
				id: 'x1m1_q#Deco',
				objectiveKey: null,
				descriptionKey: null,
				hidden: true,
				previous: ['x1m1_q#1'],
				fluidChecks: [],
			},
		],
	});
});

test('internal missions have no name; malformed ones throw', () => {
	const base = {
		missionId: 'hidden1',
		missionName: {},
		missionType: 4,
		missionChapterBitmask: 0,
		questDic: {},
	};
	assert.equal(parseMissionRuntime(JSON.stringify({ ...base, mainPathQuests: [] })).nameKey, null);
	assert.throws(() => parseMissionRuntime(JSON.stringify(base)), FormatError);
	assert.throws(
		() => parseMissionRuntime(JSON.stringify({ ...base, missionType: '0', mainPathQuests: [] })),
		FormatError,
	);
});
