import assert from 'node:assert/strict';
import { test } from 'node:test';

import { defaultStateClips } from './animator-defaults.ts';

const node = (clip: number) => ({ data: { m_ClipID: clip, m_ChildIndices: [] } });

const state = (nodes: ReturnType<typeof node>[], speed = 1) => ({
	data: {
		m_BlendTreeConstantIndexArray: [0],
		m_BlendTreeConstantArray: [{ data: { m_NodeArray: nodes } }],
		m_Speed: speed,
		m_Loop: true,
	},
});

const layer = (machine: number, weight: number, blending = 0) => ({
	data: {
		m_StateMachineIndex: machine,
		m_DefaultWeight: weight,
		'(int&)m_LayerBlendingMode': blending,
	},
});

const machine = (states: ReturnType<typeof state>[], defaultState = 0) => ({
	data: { m_StateConstantArray: states, m_DefaultState: defaultState },
});

// Wuling City's spinning cube (AC_anm_map02_machine+1_002_01): one layer whose only state, idle_loop, plays
// clip 0. its base layer saves weight 0, which Unity ignores
const cube = {
	m_Controller: {
		m_LayerArray: [layer(0, 0)],
		m_StateMachineArray: [machine([state([node(0)])])],
	},
};

test("a controller's base layer plays its default state's clip whatever its saved weight", () => {
	assert.deepEqual(defaultStateClips(cube), [{ layer: 0, clip: 0, speed: 1 }]);
});

test('only full-weight override layers and single-clip forward states show', () => {
	const controller = {
		m_Controller: {
			m_LayerArray: [layer(0, 0), layer(1, 0), layer(1, 1, 1), layer(1, 0.5), layer(2, 1), layer(3, 1)],
			m_StateMachineArray: [
				machine([state([node(0)], 0), state([node(1)], 2)], 1),
				machine([state([node(2)])]),
				// a blend tree of two clips
				machine([state([node(3), node(4)])]),
				// a state without a clip
				machine([state([node(0xffff_ffff)])]),
			],
		},
	};
	assert.deepEqual(defaultStateClips(controller), [{ layer: 0, clip: 1, speed: 2 }]);
});
