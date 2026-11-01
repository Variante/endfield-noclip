import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readClipEndPose } from './animation-clip.ts';

const binding = (path: number, attribute: number, typeID = 4, isPPtrCurve = 0) => ({
	path,
	attribute,
	typeID,
	customType: 0,
	isPPtrCurve,
});
const clip = (bindings: ReturnType<typeof binding>[], stops: number[]) => ({
	m_Legacy: false,
	m_MuscleClip: { m_ValueArrayDelta: stops.map((stop) => ({ m_Start: 0, m_Stop: stop })) },
	m_ClipBindingConstant: { genericBindings: bindings },
});

test('a clip ends each Transform binding on its stop values, in binding order', () => {
	const pose = readClipEndPose(
		clip(
			// a door leaf's position, its parent's rotation, an Animator float, a sprite swap
			[binding(1869814087, 1), binding(3066451557, 2), binding(0, 0, 95), binding(7, 0, 212, 1)],
			[0, 3.7, 0, 0, 0, -Math.SQRT1_2, Math.SQRT1_2, 1],
		),
	);
	assert.deepEqual(
		[...pose.transforms],
		[
			[1869814087, [{ kind: 'position', value: [0, 3.7, 0] }]],
			[3066451557, [{ kind: 'rotation', value: [0, 0, -Math.SQRT1_2, Math.SQRT1_2] }]],
		],
	);
});

test('a clip whose values and bindings disagree is rejected', () => {
	assert.throws(() => readClipEndPose(clip([binding(1, 1)], [0, 1])), /fewer values/);
	assert.throws(() => readClipEndPose(clip([binding(1, 1)], [0, 1, 2, 3])), /4 values for 3 bound/);
	assert.throws(() => readClipEndPose(clip([binding(1, 4)], [0, 1, 2])), /attribute 4/);
});
