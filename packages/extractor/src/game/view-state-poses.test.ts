import assert from 'node:assert/strict';
import { test } from 'node:test';

import { restingEffects, settledPath, type ViewStateRecord } from './view-state-poses.ts';

const effect = (
	effectId: string,
	flags: { persistent?: boolean; active?: boolean; fireAndForget?: boolean; node?: string } = {},
): ViewStateRecord => ({
	$type: 'Beyond_Gameplay_Core_ModelViewStateController_MVSCEffectBehaviorDataForMemoryPack',
	effectId,
	effectNodeName: flags.node ?? '',
	isPersistence: flags.persistent ?? false,
	active: flags.active ?? false,
	fireAndForget: flags.fireAndForget ?? false,
	followRot: true,
	dontFollowTrans: false,
});

const state = (stateName: string, behaviors: ViewStateRecord[], to: string | null): ViewStateRecord => ({
	stateName,
	behaviors,
	transitions: to === null ? [] : [{ targetStateName: to, conditionGroup: { conditions: [], logic: 0 } }],
});

test("the jump pad's effect layer rests in On, which keeps its glow playing", () => {
	// int_jumpmachine's EffectLayer: Off → On while `state` is 1
	const layer = {
		layerName: 'EffectLayer',
		stateDatas: [
			{
				...state('Off', [], null),
				isStartingNode: true,
				transitions: [
					{
						targetStateName: 'On',
						conditionGroup: {
							conditions: [
								{
									key: 'state',
									comparison: 0,
									isInvert: false,
									conditionValue: { type: 2, conditionValue: { intValue: 1 } },
								},
							],
						},
					},
				],
			},
			state('On', [effect('P_common_bouncingplatform_01')], null),
		],
	};
	const path = settledPath(layer, new Map([['state', 1]]));
	assert.deepEqual(
		path.map((entry) => entry.stateName),
		['Off', 'On'],
	);
	assert.deepEqual(restingEffects('P_interactive_zmdspring+1_001', path), [
		{
			effect: 'P_common_bouncingplatform_01',
			node: null,
			fallback: 'P_interactive_zmdspring+1_001',
			followRotation: true,
		},
	]);
	assert.deepEqual(restingEffects(null, settledPath(layer, new Map())), []);
});

test('a persistent effect stays on until a later state switches it off; others end with their state', () => {
	const path = [
		state('a', [effect('burst'), effect('kept', { persistent: true, active: true })], 'b'),
		state('b', [effect('glow', { persistent: true, active: true, node: 'Point' })], 'c'),
		state(
			'c',
			[
				effect('glow', { persistent: true, active: false, node: 'Point' }),
				effect('spark', { fireAndForget: true }),
			],
			null,
		),
	];
	assert.deepEqual(
		restingEffects(null, path).map((rest) => rest.effect),
		['kept'],
	);
});
