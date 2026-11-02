import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type AnimationCurve, type Gradient, evaluateCurve, evaluateGradient } from './curves.ts';

const line = (from: number, to: number): AnimationCurve => ({
	keys: [
		{
			time: 0,
			value: from,
			inSlope: to - from,
			outSlope: to - from,
			weightedMode: 0,
			inWeight: 0,
			outWeight: 0,
		},
		{
			time: 1,
			value: to,
			inSlope: to - from,
			outSlope: to - from,
			weightedMode: 0,
			inWeight: 0,
			outWeight: 0,
		},
	],
	preWrapMode: 2,
	postWrapMode: 2,
});

describe('curves', () => {
	it('evaluates a curve between and beyond its keys', () => {
		assert.equal(evaluateCurve(line(0, 1), 0.5), 0.5);
		assert.equal(evaluateCurve(line(0, 1), 2), 1);
		assert.equal(evaluateCurve({ keys: [], preWrapMode: 2, postWrapMode: 2 }, 0.5), 0);
	});

	it('reads weighted segments as Bézier curves, and default weights as the Hermite one', () => {
		const flat = (time: number, value: number, weightedMode: number, weight: number) => ({
			time,
			value,
			inSlope: 0,
			outSlope: 0,
			weightedMode,
			inWeight: weight,
			outWeight: weight,
		});
		const curve = (weightedMode: number, weight: number): AnimationCurve => ({
			keys: [flat(0, 0, weightedMode, weight), flat(1, 1, weightedMode, weight)],
			preWrapMode: 2,
			postWrapMode: 2,
		});
		const hermite = evaluateCurve(curve(0, 0), 0.25);
		assert.ok(Math.abs(evaluateCurve(curve(3, 1 / 3), 0.25) - hermite) < 1e-6);
		// heavier handles hold the ends flat for longer, so a quarter in it has barely risen
		const heavy = evaluateCurve(curve(3, 1), 0.25);
		assert.ok(heavy < hermite && heavy > 0);
		assert.ok(Math.abs(evaluateCurve(curve(3, 1), 0.5) - 0.5) < 1e-4);
	});

	it('blends gradient keys, and holds them in fixed mode', () => {
		const colorKeys = [
			{ time: 0, color: [0, 0, 0] as [number, number, number] },
			{ time: 1, color: [1, 1, 1] as [number, number, number] },
		];
		assert.deepEqual(
			evaluateGradient({ colorKeys, alphaKeys: [], fixed: false }, 0.25),
			[0.25, 0.25, 0.25, 1],
		);
		assert.deepEqual(evaluateGradient({ colorKeys, alphaKeys: [], fixed: true }, 0.25), [1, 1, 1, 1]);
	});
});

describe('gradients', () => {
	const fade: Gradient = {
		colorKeys: [
			{ time: 0, color: [1, 1, 1] },
			{ time: 1, color: [0.5, 0.5, 0.5] },
		],
		alphaKeys: [
			{ time: 0, alpha: 0 },
			{ time: 0.4, alpha: 1 },
		],
		fixed: false,
	};
	it('blend between keys and hold past the ends', () => {
		assert.deepEqual(evaluateGradient(fade, 0.2), [0.9, 0.9, 0.9, 0.5]);
		assert.deepEqual(evaluateGradient(fade, 1), [0.5, 0.5, 0.5, 1]);
	});
	it('step to the next key when fixed', () => {
		assert.deepEqual(evaluateGradient({ ...fade, fixed: true }, 0.2), [0.5, 0.5, 0.5, 1]);
	});
});
