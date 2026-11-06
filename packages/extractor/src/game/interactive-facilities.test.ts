import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { LevelInteractive } from '@endfield-noclip/formats/endfield/level-interactives';
import type { MemoryPackValue } from '@endfield-noclip/formats/endfield/memory-pack';

import { entityProperties, jumpPadArrow, startState, stateOf } from './interactive-facilities.ts';

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

const row = (own: bigint | null, params: [number, string, bigint][]): LevelInteractive => ({
	id: 1n,
	template: 'int_jumpmachine',
	createState: 0,
	position: [0, 0, 0],
	rotation: [0, 0, 0],
	scale: [1, 1, 1],
	modelScale: 0,
	isLocked: false,
	properties: own === null ? [] : [{ key: 'state', type: 3, values: [{ bits: own, text: null }] }],
	componentProperties: new Map(
		params.map(([type, key, bits]) => [type, [{ key, type: 3, values: [{ bits, text: null }] }]]),
	),
});

test("a placement's own state property overrides, then a state parameter on any component", () => {
	assert.equal(stateOf(row(0n, [[173, 'state', 1n]])), 0);
	assert.equal(stateOf(row(null, [[173, 'state', 1n]])), 1);
	assert.equal(stateOf(row(null, [[50, 'guide_trigger_by_state', 1n]])), null);
	assert.equal(stateOf(row(null, [[169, 'state', 0xffffffffn]])), -1);
});

const text = (key: string, value: string): MemoryPackValue => ({
	key,
	value: { type: 7, valueArray: [{ valueBit64: '0', valueString: value }] },
});

// the jump pad's config: its arrow effect and a target position of (-8.3, 0.6, -0.07)
const padTemplate: MemoryPackValue = {
	saveProperties: [property('is_locked', '0')],
	configProperties: [
		text('effect', 'P_common_bouncingplatform_arrow_01'),
		property('free_jump', '0'),
		{
			key: 'target_position',
			value: {
				type: 11,
				valueArray: ['-1056587121', '1057400816', '-1111993876'].map((valueBit64) => ({
					valueBit64,
					valueString: null,
				})),
			},
		},
	],
	templateVariant: [['int_jumpmachine_free', { diffProperties: [property('free_jump', '1')] }]],
};

test('an unlocked jump pad turns its arrow towards its target position', () => {
	const entity = entityProperties(padTemplate)!;
	const pad = { ...row(null, []), position: [-8.3, 0, 10] as [number, number, number] };
	const arrow = jumpPadArrow(entity, pad);
	assert.equal(arrow?.effect, 'P_common_bouncingplatform_arrow_01');
	// about straight down -z
	assert.ok(arrow !== null && Math.abs(Math.abs(arrow.yaw) - 180) < 2, `yaw ${arrow?.yaw}`);
});

test('a free or locked jump pad places no arrow', () => {
	const entity = entityProperties(padTemplate)!;
	assert.equal(jumpPadArrow(entity, { ...row(null, []), template: 'int_jumpmachine_free' }), null);
	const locked = row(null, []);
	locked.properties = [{ key: 'is_locked', type: 1, values: [{ bits: 1n, text: null }] }];
	assert.equal(jumpPadArrow(entity, locked), null);
});
