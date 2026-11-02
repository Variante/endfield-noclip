import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { MemoryPackValue } from '@endfield-noclip/formats/endfield/memory-pack';

import type { GameCondition } from './game-state.ts';
import {
	activationCondition,
	entityVisibilityTargets,
	linkScripts,
	toScript,
	type Script,
} from './script-drivers.ts';

const node = (type: string, fields: Record<string, MemoryPackValue>): MemoryPackValue => ({
	$type: `Beyond_Gameplay_Actions_${type}ForMemoryPack`,
	...fields,
});
const constant = (value: MemoryPackValue): MemoryPackValue => ({
	constValue: value,
	idRef: -1,
	paramSource: 0,
	path: null,
});

const script = (
	id: string,
	level: string,
	lists: { actions: MemoryPackValue[]; headers: MemoryPackValue[]; getters?: MemoryPackValue[] },
	data: Record<string, MemoryPackValue> = {},
): Script => {
	const decoded = {
		$type: 'Beyond_Gameplay_LevelScriptDataForMemoryPack',
		...data,
		actionMap: {
			dataMap: { actionList: lists.actions, headerList: lists.headers, getterList: lists.getters ?? [] },
		},
	};
	const result = toScript(id, level, decoded);
	assert.ok(result);
	return result;
};

test('follows show and hide actions back to quests, switches, the script area and other levels', async () => {
	const show = (ID: number, visible: boolean) =>
		node('ShowSceneDecorationNew', {
			ID,
			nextID: -1,
			targetDynamicEntity: constant('555'),
			visible: constant(visible),
		});
	const own = script(
		'100',
		'lv1',
		{
			headers: [
				node('ScriptEvent_OnScriptActive', { ID: 1, nextID: 2 }),
				node('EntityEvent_OnInteractiveStateChanged', {
					ID: 10,
					nextID: 11,
					targetEntity: constant({ useSlotId: true, logicId: '0', slotId: 40001 }),
				}),
			],
			actions: [
				// shown on activation only while a quest check passes
				node('IfElseAction', {
					ID: 2,
					onTrueID: 3,
					onFalseID: -1,
					condition: { constValue: false, idRef: -1, paramSource: 3, path: '$50@_result' },
				}),
				show(3, true),
				show(11, false),
			],
			getters: [node('CheckQuestState', { ID: 50, questId: constant('x1m1_q#2') })],
		},
		{
			interactives: [[40001, { entityDataIdKey: 'int_switch', position: [1, 2, 3] }]],
			startShapeList: [{ offset: [10, 0, 10], radius: 50 }],
		},
	);
	const dungeon = script('200', 'dung', {
		headers: [node('ScriptEvent_OnScriptActive', { ID: 1, nextID: 2 })],
		actions: [show(2, true)],
	});
	const { drivers, rules } = await linkScripts([own, dungeon], {
		entities: new Set(['555']),
		ownLevels: new Set(['lv1']),
		placements: new Map(),
		missionsOf: new Map(),
		label: async (id) => ({ id, mission: 'Mission', name: 'Step two' }),
		levelNames: new Map([['dung', 'A Dungeon']]),
	});
	assert.deepEqual(drivers.get('555'), [
		{ kind: 'quest', quests: [{ id: 'x1m1_q#2', mission: 'Mission', name: 'Step two' }], shows: true },
		{ kind: 'script', position: [10, 0, 10], radius: 50, shows: true },
		{ kind: 'switch', template: 'int_switch', position: [1, 2, 3], shows: false },
		{ kind: 'level', levelId: 'dung', name: 'A Dungeon', shows: true },
	]);
	// the activation path checks a quest state other than complete or in progress
	assert.equal(rules.size, 0);
});

test('derives what a group shows from the quest checks its scripts make when they run', async () => {
	const decoration = (ID: number, target: string, visible: boolean, nextID = -1) =>
		node('ShowSceneDecorationNew', {
			ID,
			nextID,
			targetDynamicEntity: constant(target),
			visible: constant(visible),
		});
	// getters wired to an input by `idRef`, as the game stores them
	const getterRef = (idRef: number): MemoryPackValue => ({
		constValue: true,
		idRef,
		paramSource: -1,
		path: null,
	});
	const complete = (ID: number, id: string, isQuest: boolean) =>
		node('CheckMissionOrQuestIsComplete', { ID, isQuest: constant(isQuest), missionId: constant(id) });
	const scripts = [
		// opens a gate on activation once a mission is complete: `validate` guards the header
		script('1', 'lv1', {
			headers: [node('ScriptEvent_OnScriptActive', { ID: 1, nextID: 2, validate: getterRef(9) })],
			actions: [decoration(2, 'open', true, 3), decoration(3, 'closed', false)],
			getters: [complete(9, 'm1', false)],
		}),
		// shows or hides props by a quest check
		script('2', 'lv1', {
			headers: [node('ScriptEvent_OnScriptActive', { ID: 1, nextID: 2, validate: constant(true) })],
			actions: [
				node('IfElseAction', { ID: 2, onTrueID: 3, onFalseID: 4, condition: getterRef(9) }),
				decoration(3, 'props', true),
				decoration(4, 'props', false),
			],
			getters: [complete(9, 'm2_q#1', true)],
		}),
		// shown or hidden past check nodes that stop the path unless their value is true or false
		script('4', 'lv1', {
			headers: [node('ScriptEvent_OnScriptActive', { ID: 1, nextID: 2 })],
			actions: [
				node('CheckBoolIfTrue', { ID: 2, nextID: 3, value: getterRef(9) }),
				decoration(3, 'checked', true, 4),
				node('CheckBoolIfFalse', { ID: 4, nextID: 5, value: getterRef(8) }),
				decoration(5, 'unchecked', false),
			],
			getters: [complete(9, 'm1', false), complete(8, 'm3', false)],
		}),
		// shown whenever the script runs, which the rule can't tell
		script('3', 'lv1', {
			headers: [node('ScriptEvent_OnScriptActive', { ID: 1, nextID: 2 })],
			actions: [decoration(2, 'event', true)],
		}),
	];
	const { drivers, rules } = await linkScripts(scripts, {
		entities: new Set(['open', 'closed', 'props', 'checked', 'unchecked', 'event']),
		ownLevels: new Set(['lv1']),
		placements: new Map(),
		missionsOf: new Map(),
		label: async (id) => ({ id, mission: null, name: null }),
		levelNames: new Map(),
	});
	const m1 = { kind: 'mission', id: 'm1', compare: 0, target: 3 } as const;
	const q1 = { kind: 'quest', id: 'm2_q#1', compare: 0, target: 3 } as const;
	assert.deepEqual(Object.fromEntries(rules), {
		open: { show: [[m1]], hide: [] },
		closed: { show: [], hide: [[m1]] },
		props: { show: [[q1]], hide: [[{ ...q1, compare: 1 }]] },
		checked: { show: [[m1]], hide: [] },
		unchecked: { show: [], hide: [[m1, { kind: 'mission', id: 'm3', compare: 1, target: 3 }]] },
	});
	assert.deepEqual(drivers.get('props')?.[0], {
		kind: 'quest',
		quests: [{ id: 'm2_q#1', mission: null, name: null }],
		shows: true,
	});

	const any = (reverse: boolean, tests: GameCondition[]) => ({
		kind: 'any',
		reverse,
		conditions: [{ kind: 'all', reverse: false, conditions: tests }],
	});
	assert.deepEqual(activationCondition(rules.get('open')!, false), any(false, [m1]));
	assert.deepEqual(activationCondition(rules.get('closed')!, true), any(true, [m1]));
	assert.deepEqual(activationCondition(rules.get('props')!, false), any(false, [q1]));
	// nothing changes a flag no path moves away from
	assert.equal(activationCondition(rules.get('open')!, true), null);
	// a state that both shows and hides the group leaves it unsettled
	assert.equal(activationCondition({ show: [[m1]], hide: [[q1]] }, false), null);
});

test('follows entity show and hide actions on interactives, counting targets computed at runtime', async () => {
	const pointer = (logicId: string): MemoryPackValue => ({ logicId, slotId: 0, useSlotId: false });
	const own = script('300', 'lv1', {
		headers: [node('LevelEvent_OnQuestStateChanged', { ID: 1, nextID: 2, questId: constant('q1') })],
		actions: [
			node('EntityHide', { ID: 2, nextID: 3, entityPtr: constant(pointer('777')) }),
			node('EntityShowList', { ID: 3, nextID: 4, entityListPtr: constant([pointer('778')]) }),
			node('SetEntitiesVisibility', {
				ID: 4,
				nextID: 5,
				isVisible: constant(false),
				targetEntities: constant([pointer('779'), { logicId: '0', slotId: 3, useSlotId: true }]),
			}),
			node('EntityShow', { ID: 5, nextID: -1, entityPtr: { idRef: 9, paramSource: 3, path: null } }),
		],
	});
	assert.deepEqual([...entityVisibilityTargets([own], new Set(['lv1']))], ['777', '778', '779']);
	const { drivers, untraced } = await linkScripts([own], {
		entities: new Set(['777', '778', '779']),
		ownLevels: new Set(['lv1']),
		placements: new Map(),
		missionsOf: new Map(),
		label: async (id) => ({ id, mission: null, name: null }),
		levelNames: new Map(),
	});
	const quest = (shows: boolean) => [
		{ kind: 'quest', quests: [{ id: 'q1', mission: null, name: null }], shows },
	];
	assert.deepEqual(drivers.get('777'), quest(false));
	assert.deepEqual(drivers.get('778'), quest(true));
	assert.deepEqual(drivers.get('779'), quest(false));
	// the slot pointer and the getter
	assert.equal(untraced, 2);
});
