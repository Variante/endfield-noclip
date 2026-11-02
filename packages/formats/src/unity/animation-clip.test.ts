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

test('a clip ends renderers on their material and renderer values', () => {
	// the blue talosite's idle loop: a glow's `_TintColorAlpha` and `_BlendTint.r`, and a shard's `m_Pivot.x`
	const material = (path: number, attribute: number) => ({ ...binding(path, attribute, 23), customType: 22 });
	const pose = readClipEndPose(
		clip([material(5, 2292127880), material(5, 1141402741), binding(6, 3640387206, 199)], [0.05, 2.174, 0]),
	);
	assert.deepEqual(pose.materials.get(5), [
		{ nameHash: 2292127880 & 0x0fff_ffff, component: null, value: 0.05 },
		{ nameHash: 1141402741 & 0x0fff_ffff, component: 0, value: 2.174 },
	]);
	assert.deepEqual([...pose.renderers.get(6)!], [[3640387206, 0]]);
	// the campfire's locking clip sets a vector's x component (kind 0)
	assert.deepEqual(readClipEndPose(clip([material(5, 109495689)], [0.5])).materials.get(5), [
		{ nameHash: 109495689, component: 0, value: 0.5 },
	]);
	assert.throws(() => readClipEndPose(clip([material(5, 0x9000_0000)], [1])), /material property kind 9/);
});

test('Euler rotations follow Unity: z first, then x, then y', () => {
	// x 90° then y 90°: Quaternion.Euler(90, 90, 0) = (0.5, 0.5, −0.5, 0.5)
	const [rotation] = readClipEndPose(clip([binding(1, 4)], [90, 90, 0])).transforms.get(1)!;
	[0.5, 0.5, -0.5, 0.5].forEach((value, i) => assert.ok(Math.abs(rotation.value[i] - value) < 1e-9));
});
