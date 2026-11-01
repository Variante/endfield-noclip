import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DynamicEntity, DynamicGate } from '@endfield-noclip/formats/endfield/dynamic-scene';

import { outpostTiers } from './dynamic-structures.ts';

const entity = (uid: bigint, entityType: number, patch: Partial<DynamicEntity> = {}): DynamicEntity => ({
	grid: 0,
	uid,
	entityType,
	components: [],
	controllers: [],
	gates: [],
	resourceGroups: [],
	extraScene: null,
	...patch,
});

const mapVar = (key: number, value = 1): DynamicGate => ({
	kind: 'mapVar',
	key,
	compare: 0,
	value,
	mapId: 85,
});

test('variable-gated owners after an outpost and its region become its levels, in order', () => {
	const outpost = entity(100n, 16, {
		controllers: [{ kind: 'settlement', settlementId: 'stm_a', isMain: true }],
	});
	const tiers = outpostTiers([
		outpost,
		entity(101n, 17),
		entity(102n, 38, { gates: [mapVar(321)] }),
		entity(103n, 38, { gates: [mapVar(322)] }),
		entity(104n, 38, { gates: [mapVar(323)] }),
		// not the next variable, so the run ends
		entity(105n, 38, { gates: [mapVar(400)] }),
	]);
	assert.deepEqual(
		[...tiers],
		[
			[102n, [[{ control: 'settlement:stm_a', mask: 0b10 }]]],
			[103n, [[{ control: 'settlement:stm_a', mask: 0b100 }]]],
			[104n, [[{ control: 'settlement:stm_a', mask: 0b1000 }]]],
		],
	);
});

test('a single variable-gated neighbour, or one tested against another value, is not a tier', () => {
	const outpost = entity(100n, 16, {
		controllers: [{ kind: 'settlement', settlementId: 'stm_a', isMain: true }],
	});
	assert.equal(outpostTiers([outpost, entity(102n, 38, { gates: [mapVar(321)] })]).size, 0);
	assert.equal(
		outpostTiers([
			outpost,
			entity(102n, 38, { gates: [mapVar(321, 0)] }),
			entity(103n, 38, { gates: [mapVar(322, 0)] }),
		]).size,
		0,
	);
});
