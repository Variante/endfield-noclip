import assert from 'node:assert/strict';
import { it } from 'node:test';

import type { SceneControl } from './states.ts';
import { storyPointPicks, storyPoints } from './story.ts';

const control = (
	kind: 'quest' | 'mission',
	id: string,
	mission: string,
	step: number | null,
): SceneControl => ({
	kind,
	id: `${kind}:${id}`,
	name: id,
	rule: null,
	assumption: '',
	story: { mission, step },
	drivers: [],
	levelTags: [0],
	values: [],
	default: 3,
	derived: null,
});

const CONTROLS = [
	control('mission', 'e1m1', 'e1m1', null),
	control('quest', 'e1m1_q#2', 'e1m1', 2),
	control('quest', 'e1m1_q#5', 'e1m1', 5),
	control('quest', 'e1m1_q#side', 'e1m1', 5.5),
	control('quest', 'e1m2_q#1', 'e1m2', 1),
	control('quest', 'e1m2_q#x', 'e1m2', null),
];
const MISSIONS = ['e1m1', 'e1m2'];

it('a story point completes what came before it and leaves what follows unstarted', () => {
	assert.deepEqual(storyPointPicks(CONTROLS, MISSIONS, { mission: 0, step: 5 }), {
		'mission:e1m1': 2,
		'quest:e1m1_q#2': 3,
		'quest:e1m1_q#5': 2,
		'quest:e1m1_q#side': 0,
		'quest:e1m2_q#1': 0,
		'quest:e1m2_q#x': 0,
	});
	assert.deepEqual(storyPointPicks(CONTROLS, MISSIONS, { mission: 1, step: 0 }), {
		'mission:e1m1': 3,
		'quest:e1m1_q#2': 3,
		'quest:e1m1_q#5': 3,
		'quest:e1m1_q#side': 3,
		'quest:e1m2_q#1': 0,
	});
	// the finished story is the default, so its picks are dropped
	assert.deepEqual(
		Object.values(storyPointPicks(CONTROLS, MISSIONS, null)).every((value) => value === null),
		true,
	);
});

it('lists a point per mission start and per step quest controls sit at, once per step', () => {
	const controls = [...CONTROLS, control('quest', 'e1m1_q#side2', 'e1m1', 5.5)];
	assert.deepEqual(
		storyPoints(controls, MISSIONS).map(({ point, quests }) => [point, quests.map(({ id }) => id)]),
		[
			[{ mission: 0, step: 0 }, []],
			[{ mission: 0, step: 2 }, ['quest:e1m1_q#2']],
			[{ mission: 0, step: 5 }, ['quest:e1m1_q#5']],
			[{ mission: 0, step: 5.5 }, ['quest:e1m1_q#side', 'quest:e1m1_q#side2']],
			[{ mission: 1, step: 0 }, []],
			[{ mission: 1, step: 1 }, ['quest:e1m2_q#1']],
			[null, []],
		],
	);
});
