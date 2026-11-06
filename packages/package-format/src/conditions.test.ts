import assert from 'node:assert/strict';
import { it } from 'node:test';

import { conditionResults, conditionVisible, groupsShown, resolveSceneValues } from './conditions.ts';
import type { ConditionalSetInfo, SceneControl, StatesInfo } from './states.ts';

const control = (
	fields: Pick<SceneControl, 'kind' | 'id' | 'default'> & Partial<SceneControl> & { derived?: number },
): SceneControl => {
	const { derived, ...rest } = fields;
	return {
		name: fields.id,
		category: 'test',
		assumption: '',
		levelTags: [0],
		values: [
			{ value: 0, label: 'off' },
			{ value: 1, label: 'on' },
		],
		source: derived === undefined ? { kind: 'user' } : { kind: 'derived', condition: derived, rule: [] },
		story: null,
		drivers: [],
		...rest,
	};
};

it('selects mutually exclusive upgrades while preserving shared and script-gated resources', () => {
	const states: StatesInfo = {
		controls: [
			control({
				kind: 'poi',
				id: 'poi:facility',
				default: 0,
				values: [0, 2, 31].map((value) => ({ value, label: `Level ${value}` })),
			}),
			control({ kind: 'script', id: 'script:course', default: 0 }),
		],
		conditionalSets: [],
		groups: [],
		streamAreas: null,
		categories: [],
		missions: [],
		mainStory: [],
	};
	const initial = resolveSceneValues(states, {});
	const before = { alternatives: [[{ control: 'poi:facility', mask: 1 }]] };
	const after = { alternatives: [[{ control: 'poi:facility', mask: 4 }]] };
	const gated: ConditionalSetInfo = {
		alternatives: [
			[
				{ control: 'poi:facility', mask: 4 },
				{ control: 'script:course', mask: 2 },
			],
		],
	};
	assert.equal(conditionVisible(before, initial), true);
	assert.equal(conditionVisible(after, initial), false);
	const upgraded = resolveSceneValues(states, { 'poi:facility': 2 });
	assert.equal(conditionVisible(before, upgraded), false);
	assert.equal(conditionVisible(after, upgraded), true);
	assert.equal(conditionVisible(gated, upgraded), false);
	assert.equal(conditionVisible(gated, { ...upgraded, 'script:course': 1 }), true);
	assert.equal(
		conditionVisible({ alternatives: [...before.alternatives, ...after.alternatives] }, upgraded),
		true,
	);
	assert.equal(conditionVisible({ alternatives: [[]] }, {}), true);
	assert.equal(conditionVisible({ alternatives: [] }, initial), false);
	assert.equal(conditionVisible(before, {}), false);
	assert.equal(conditionVisible(before, { 'poi:facility': 32 }), false);
	assert.equal(
		conditionVisible(
			{ alternatives: [[{ control: 'poi:facility', mask: 0x80000000 }]] },
			{ 'poi:facility': 31 },
		),
		true,
	);
	assert.deepEqual(initial, { 'poi:facility': 0, 'script:course': 0 });
});

it('derives scene states from the quests they follow, unless the user overrides them', () => {
	// quest states: 2 processing, 3 completed
	const quest = control({
		kind: 'quest',
		id: 'quest:q',
		default: 3,
		values: [0, 1, 2, 3, 4, 5].map((value) => ({ value, label: String(value) })),
	});
	const states: StatesInfo = {
		controls: [
			quest,
			control({ kind: 'sceneState', id: 'sceneState:0', default: 1, derived: 0 }),
			control({ kind: 'sceneState', id: 'sceneState:1', default: 0, derived: 1 }),
			// derived from another derived control listed before it
			control({ kind: 'sceneState', id: 'sceneState:2', default: 0, derived: 2 }),
		],
		conditionalSets: [
			{ alternatives: [[{ control: 'quest:q', mask: 1 << 3 }]] },
			{ alternatives: [[{ control: 'quest:q', mask: 0b110111 }]] },
			{ alternatives: [[{ control: 'sceneState:1', mask: 2 }]] },
		],
		groups: [],
		streamAreas: null,
		categories: [],
		missions: [],
		mainStory: [],
	};
	assert.deepEqual(resolveSceneValues(states, {}), {
		'quest:q': 3,
		'sceneState:0': 1,
		'sceneState:1': 0,
		'sceneState:2': 0,
	});
	// the two states never hold together while they follow the quest
	assert.deepEqual(resolveSceneValues(states, { 'quest:q': 2 }), {
		'quest:q': 2,
		'sceneState:0': 0,
		'sceneState:1': 1,
		'sceneState:2': 1,
	});
	assert.equal(resolveSceneValues(states, { 'sceneState:0': 0 })['sceneState:0'], 0);
});

it('shows a group of any level when its condition holds', () => {
	const states: StatesInfo = {
		controls: [],
		conditionalSets: [
			{ alternatives: [[{ control: 'sceneState:0', mask: 2 }]] },
			{ alternatives: [[{ control: 'sceneState:1', mask: 2 }]] },
		],
		groups: [
			{ levelTag: 0, condition: null },
			{ levelTag: 1, condition: null },
			{ levelTag: 2, condition: null },
			{ levelTag: 1, condition: 0 },
			{ levelTag: 0, condition: 1 },
		],
		streamAreas: null,
		categories: [],
		missions: [],
		mainStory: [],
	};
	const conditions = conditionResults(states, { 'sceneState:0': 1, 'sceneState:1': 0 });
	assert.deepEqual(conditions, [true, false]);
	assert.deepEqual(groupsShown(states, conditions), [true, true, true, true, false]);
});
