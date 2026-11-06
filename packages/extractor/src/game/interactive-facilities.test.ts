import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { LevelInteractive } from '@endfield-noclip/formats/endfield/level-interactives';
import type { MemoryPackValue } from '@endfield-noclip/formats/endfield/memory-pack';

import { startState, stateOf } from './interactive-facilities.ts';

const property = (key: string, bits: string): MemoryPackValue => ({
	key,
	value: { type: 3, valueArray: [{ valueBit64: bits, valueString: null }] },
});

const commonPerform = { $type: 'Beyond_Gameplay_Core_InteractiveCommonPerformComponentDataForMemoryPack' };

// the jump pad (int_jumpmachine): saved `state` 1, so it starts on; its variants leave `state` alone
const jumpPad: MemoryPackValue = {
	componentList: [commonPerform],
	saveProperties: [property('is_locked', '0'), property('state', '1')],
	configProperties: [],
	tempProperties: [],
	templateVariant: [
		['int_jumpmachine_free', { diffProperties: [property('free_jump', '1')] }],
		['int_jumpmachine_off', { diffProperties: [property('state', '0')] }],
	],
};

test('a template starts in its saved state, and a variant in its own', () => {
	assert.deepEqual(startState(jumpPad), { state: 1, variants: new Map([['int_jumpmachine_off', 0]]) });
});

test('a template without a common-perform component passes no state on', () => {
	assert.equal(startState({ componentList: [], saveProperties: [property('state', '1')] }), null);
});

test('a template without a state property starts at 0', () => {
	assert.deepEqual(startState({ componentList: [commonPerform] }), { state: 0, variants: new Map() });
});

test("a placement's state parameter on any component overrides", () => {
	const row = (params: [number, string, bigint][]): LevelInteractive => ({
		id: 1n,
		template: 'int_jumpmachine',
		createState: 0,
		position: [0, 0, 0],
		rotation: [0, 0, 0],
		scale: [1, 1, 1],
		modelScale: 0,
		componentProperties: new Map(
			params.map(([type, key, bits]) => [type, [{ key, type: 3, values: [{ bits, text: null }] }]]),
		),
	});
	assert.equal(stateOf(row([[173, 'state', 1n]])), 1);
	assert.equal(stateOf(row([[50, 'guide_trigger_by_state', 1n]])), null);
	assert.equal(stateOf(row([[169, 'state', 0xffffffffn]])), -1);
});
