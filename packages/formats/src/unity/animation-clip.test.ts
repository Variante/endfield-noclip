import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readClipActivity, readClipEndPose } from './animation-clip.ts';

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
	assert.throws(() => readClipEndPose(clip([binding(1, 5)], [0, 1, 2])), /attribute 5/);
});

test('a clip ends Euler rotations as quaternions and GameObjects on their activity', () => {
	const pose = readClipEndPose(
		clip(
			// a spinning ring (x −90°, then a full turn about z), a node switched off and one switched on
			[binding(11, 4), binding(12, 0x7c5a22f6, 1), binding(13, 0x7c5a22f6, 1)],
			[-90, 0, -360, 0, 1],
		),
	);
	const [rotation] = pose.transforms.get(11)!;
	assert.equal(rotation.kind, 'rotation');
	// a full turn about z flips the quaternion's sign, which is the same rotation
	const expected = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];
	const sign = Math.sign(rotation.value[3]) * Math.sign(expected[3]);
	rotation.value.forEach((value, i) => assert.ok(Math.abs(value * sign - expected[i]) < 1e-9));
	assert.deepEqual(
		[...pose.active],
		[
			[12, false],
			[13, true],
		],
	);
});

test('a clip shows a GameObject when it starts or ends switched on', () => {
	const IS_ACTIVE = 0x7c5a22f6;
	const shown = clip(
		// a rotation's four values come first; then a node held off, one switched off, one switched on
		[binding(1, 2), binding(21, IS_ACTIVE, 1), binding(22, IS_ACTIVE, 1), binding(23, IS_ACTIVE, 1)],
		[0, 0, 0, 1, 0, 0, 1],
	);
	shown.m_MuscleClip.m_ValueArrayDelta[5].m_Start = 1;
	assert.deepEqual(
		[...readClipActivity(shown)],
		[
			[21, false],
			[22, true],
			[23, true],
		],
	);
});

test('Euler rotations follow Unity: z first, then x, then y', () => {
	// x 90° then y 90°: Quaternion.Euler(90, 90, 0) = (0.5, 0.5, −0.5, 0.5)
	const [rotation] = readClipEndPose(clip([binding(1, 4)], [90, 90, 0])).transforms.get(1)!;
	[0.5, 0.5, -0.5, 0.5].forEach((value, i) => assert.ok(Math.abs(rotation.value[i] - value) < 1e-9));
});
