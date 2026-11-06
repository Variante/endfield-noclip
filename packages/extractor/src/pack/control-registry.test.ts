import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SceneControl } from '@endfield-noclip/package-format/states';

import { derivedSource, sceneControl, SWITCH_VALUES } from '../game/scene-control.ts';

import { ControlRegistry } from './control-registry.ts';

const toggle = (id: string, value = 0): SceneControl =>
	sceneControl({ kind: 'script', id, name: id, values: SWITCH_VALUES, default: value, assumption: '' });

/** a toggle on while every input is on */
const derive = (registry: ControlRegistry, id: string, inputs: string[]): SceneControl => ({
	...toggle(id),
	source: derivedSource(
		registry.condition({ alternatives: [inputs.map((control) => ({ control, mask: 2 }))] }),
		[],
	),
});

const shows = (registry: ControlRegistry, levelTag: number, control: string): void => {
	registry.group(levelTag, registry.condition({ alternatives: [[{ control, mask: 2 }]] }));
};

test('derived controls follow their inputs whatever order they are registered in', () => {
	const registry = new ControlRegistry();
	// a diamond: top reads left and right, both of which read base
	registry.add(
		derive(registry, 'top', ['left', 'right']),
		derive(registry, 'left', ['base']),
		derive(registry, 'right', ['base']),
		toggle('base', 1),
	);
	shows(registry, 7, 'top');
	const { controls } = registry.finish();
	assert.deepEqual(
		controls.map(({ id }) => id),
		['base', 'left', 'right', 'top'],
	);
	// level tags reach the inputs through the derived controls, and derived defaults follow the inputs
	for (const control of controls) {
		assert.deepEqual(control.levelTags, [7]);
		assert.equal(control.default, 1);
	}
});

test('controls nothing consumes are dropped, kept ones stay with their levels', () => {
	const registry = new ControlRegistry();
	registry.add(toggle('unused'), toggle('water'), toggle('gated'));
	registry.keep('water', [3]);
	shows(registry, 2, 'gated');
	const { controls, categories } = registry.finish();
	assert.deepEqual(
		controls.map(({ id, levelTags }) => [id, levelTags]),
		[
			['water', [3]],
			['gated', [2]],
		],
	);
	// only the categories of kept controls are listed
	assert.deepEqual(
		categories.map(({ id }) => id),
		['scripts'],
	);
});

test('cycles, duplicates and unknown inputs throw', () => {
	{
		const registry = new ControlRegistry();
		registry.add(derive(registry, 'a', ['b']), derive(registry, 'b', ['a']));
		shows(registry, 0, 'a');
		assert.throws(() => registry.finish(), /cycle/);
	}
	{
		const registry = new ControlRegistry();
		registry.add(derive(registry, 'a', ['missing']));
		shows(registry, 0, 'a');
		assert.throws(() => registry.finish(), /unknown control missing/);
	}
	{
		const registry = new ControlRegistry();
		registry.add(toggle('a'));
		assert.throws(() => registry.add(toggle('a')), /duplicate/);
	}
});

test('defaults resolve registered and extra controls before finishing', () => {
	const registry = new ControlRegistry();
	registry.add(derive(registry, 'door', ['cabin']));
	assert.deepEqual(registry.defaults([toggle('cabin', 1)]), { cabin: 1, door: 1 });
	// an input not known yet fails its requirement
	assert.deepEqual(registry.defaults(), { door: 0 });
});

test('equivalent conditions share a set, and equal owners and conditions a group', () => {
	const registry = new ControlRegistry();
	const a = registry.condition({
		alternatives: [
			[
				{ control: 'x', mask: 2 },
				{ control: 'y', mask: 2 },
			],
			[{ control: 'z', mask: 1 }],
		],
	});
	const b = registry.condition({
		alternatives: [
			[{ control: 'z', mask: 1 }],
			[
				{ control: 'y', mask: 2 },
				{ control: 'x', mask: 2 },
			],
		],
	});
	assert.equal(a, b);
	assert.equal(registry.group(1, a), registry.group(1, b));
	assert.equal(registry.group(0, null), 0);
});
