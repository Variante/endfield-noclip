import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ACL_TRANSFORM_STRIDE, decodeAclTransforms } from './acl.ts';
import { readClipMotion } from './animation-clip.ts';

/** FNV-1a, as ACL hashes its buffers */
const fnv1a = (bytes: Uint8Array): number => {
	let hash = 0x811c_9dc5;
	for (const byte of bytes) {
		hash = Math.imul(hash ^ byte, 0x0100_0193) >>> 0;
	}
	return hash;
};

/**
 * a two-track ACL 2.1 buffer laid out as the game's are (variable rotations dropping w, variable
 * translations, no scale, one segment): track 0 holds a constant rotation and an animated translation, track
 * 1 an animated rotation and a default translation. each stored sample is three u8 rotation and three u8
 * translation values
 */
const buffer = (options: {
	samples: number[][];
	sampleCount: number;
	storedMask: number | null;
}): Uint8Array => {
	const bytes = new Uint8Array(256);
	const view = new DataView(bytes.buffer);
	const stripped = options.storedMask !== null;
	// tracks header
	view.setUint32(8, 0xac11_ac11, true);
	view.setUint16(12, 10, true);
	bytes[14] = 0;
	bytes[15] = 12;
	view.setUint32(16, 2, true);
	view.setUint32(20, options.sampleCount, true);
	view.setFloat32(24, 30, true);
	// default scale 1, variable scale and translation, rotation format 3, trivial defaults, stripped keyframes
	view.setUint32(28, (1 << 1) | (1 << 2) | (1 << 3) | (3 << 4) | (1 << 9) | (stripped ? 1 << 10 : 0), true);
	// transform header at 32
	const t = 32;
	const segmentHeader = t + 52;
	const subTrackTypes = segmentHeader + (stripped ? 20 : 16);
	const constantData = subTrackTypes + 8;
	const clipRange = constantData + 12;
	const segmentData = clipRange + 48;
	for (const [i, value] of [1, 5, 1, 1, 0, 1, 0, 0].entries()) {
		view.setUint32(t + i * 4, value, true);
	}
	view.setUint32(t + 32, 0, true);
	view.setUint32(t + 36, segmentHeader - t, true);
	view.setUint32(t + 40, subTrackTypes - t, true);
	view.setUint32(t + 44, constantData - t, true);
	view.setUint32(t + 48, clipRange - t, true);
	// segment header: 48 bits a pose
	view.setUint32(segmentHeader, 48, true);
	view.setUint32(segmentHeader + 4, 24, true);
	view.setUint32(segmentHeader + 8, 24, true);
	view.setUint32(segmentHeader + 12, segmentData - t, true);
	if (stripped) {
		view.setUint32(segmentHeader + 16, options.storedMask ?? 0, true);
	}
	// sub-track kinds, two bits a track from the top: rotations (constant, animated), translations (animated, default)
	view.setUint32(subTrackTypes, (1 << 30) | (2 << 28), true);
	view.setUint32(subTrackTypes + 4, 2 << 30, true);
	// the constant rotation's x, y, z
	view.setFloat32(constantData + 4, 0.6, true);
	// clip ranges: the rotation's min x, y, z and extent x, y, z (one lane), then the translation's
	for (const [i, value] of [0, 0, 0, 0.6, 0.6, 0.6, 1, 2, 3, 10, 10, 10].entries()) {
		view.setFloat32(clipRange + i * 4, value, true);
	}
	// 8 bits a component: rotations padded to four format bytes, then the translation's
	bytes.set([8, 0, 0, 0, 8], segmentData);
	const animated = segmentData + 8;
	for (const [i, sample] of options.samples.entries()) {
		bytes.set(sample, animated + i * 6);
	}
	const size = animated + options.samples.length * 6;
	view.setUint32(0, size, true);
	view.setUint32(4, fnv1a(bytes.subarray(8, size)), true);
	return bytes.subarray(0, size);
};

const at = (values: Float32Array, sample: number, track: number, from: number, count: number): number[] =>
	Array.from(
		values.subarray(
			(sample * 2 + track) * ACL_TRANSFORM_STRIDE + from,
			(sample * 2 + track) * ACL_TRANSFORM_STRIDE + from + count,
		),
		(value) => Math.round(value * 1e4) / 1e4,
	);

test('ACL transform tracks decode constant, default and range-reduced animated sub-tracks', () => {
	const decoded = decodeAclTransforms(
		buffer({
			sampleCount: 3,
			storedMask: null,
			samples: [
				[0, 0, 0, 0, 0, 0],
				[255, 0, 0, 255, 255, 255],
				[0, 255, 0, 51, 102, 0],
			],
		}),
	);
	assert.equal(decoded.trackCount, 2);
	assert.equal(decoded.sampleCount, 3);
	// track 0: the constant rotation's w is rebuilt positive; the translation spans its clip range
	assert.deepEqual(at(decoded.values, 1, 0, 0, 4), [0, 0.6, 0, 0.8]);
	assert.deepEqual(at(decoded.values, 0, 0, 4, 3), [1, 2, 3]);
	assert.deepEqual(at(decoded.values, 1, 0, 4, 3), [11, 12, 13]);
	assert.deepEqual(at(decoded.values, 2, 0, 4, 3), [3, 6, 3]);
	// track 1: the animated rotation, a default translation and the default scale
	assert.deepEqual(at(decoded.values, 0, 1, 0, 4), [0, 0, 0, 1]);
	assert.deepEqual(at(decoded.values, 1, 1, 0, 4), [0.6, 0, 0, 0.8]);
	assert.deepEqual(at(decoded.values, 2, 1, 0, 4), [0, 0.6, 0, 0.8]);
	assert.deepEqual(at(decoded.values, 2, 1, 4, 6), [0, 0, 0, 1, 1, 1]);
});

test('ACL samples stripped from a segment interpolate between the stored ones', () => {
	// samples 0 and 2 stored (the mask's top bit is sample 0)
	const decoded = decodeAclTransforms(
		buffer({
			sampleCount: 3,
			storedMask: (1 << 31) | (1 << 29),
			samples: [
				[0, 0, 0, 0, 0, 0],
				[0, 0, 255, 255, 255, 255],
			],
		}),
	);
	assert.deepEqual(at(decoded.values, 1, 0, 4, 3), [6, 7, 8]);
	// halfway between identity and (0, 0, 0.6, 0.8), normalized
	const half = Math.round((0.3 / Math.hypot(0.3, 0.9)) * 1e4) / 1e4;
	assert.deepEqual(at(decoded.values, 1, 1, 0, 4), [
		0,
		0,
		half,
		Math.round((0.9 / Math.hypot(0.3, 0.9)) * 1e4) / 1e4,
	]);
});

test('an ACL buffer whose hash disagrees is rejected', () => {
	const bytes = buffer({ sampleCount: 1, storedMask: null, samples: [[0, 0, 0, 0, 0, 0]] });
	bytes[40] ^= 1;
	assert.throws(() => decodeAclTransforms(bytes), /hash/);
});

test("an ACL clip's masks route each kind's bindings to tracks, and constant bindings keep the clip's values", () => {
	const transformBinding = (path: number, attribute: number) => ({
		path,
		attribute,
		typeID: 4,
		customType: 0,
		isPPtrCurve: 0,
	});
	const clip = {
		m_Legacy: false,
		m_SampleRate: 30,
		m_MuscleClip: { m_StartTime: 0, m_StopTime: 2 / 30, m_LoopTime: true },
		// path 100's position, path 200's rotation, path 100's rotation, an Animator float
		m_ClipBindingConstant: {
			genericBindings: [
				transformBinding(100, 1),
				transformBinding(200, 2),
				transformBinding(100, 2),
				{ path: 0, attribute: 0, typeID: 95, customType: 8, isPPtrCurve: 0 },
			],
		},
		m_AclCompressedBuffer: {
			OutputTrackCount: 2,
			FloatCurveCount: 1,
			TransformBufferData: buffer({
				sampleCount: 3,
				storedMask: null,
				samples: [
					[0, 0, 0, 0, 0, 0],
					[255, 0, 0, 255, 255, 255],
					[0, 255, 0, 51, 102, 0],
				],
			}),
			// one byte a kind: track 1 takes the position, both tracks rotations (track 0 first), none scales
			TransformSubTrackMasks: new Uint8Array([0b0100_0000, 0b1100_0000, 0, 0]),
			// the position binding and the float are constant
			m_ConstantIndexs: new Uint16Array([0, 3]),
			m_ConstantValues: new Float32Array([5, 6, 7, 0.5]),
		},
	};
	const motion = readClipMotion(clip);
	assert.deepEqual(motion.paths, [100, 200]);
	const round = (values: readonly number[]) => values.map((value) => Math.round(value * 1e4) / 1e4);
	const pose = motion.sample(1 / 30);
	assert.deepEqual(
		pose.get(100)?.map(({ kind, value }) => [kind, round(value)]),
		[
			['position', [5, 6, 7]],
			['rotation', [0.6, 0, 0, 0.8]],
		],
	);
	assert.deepEqual(round(pose.get(200)?.[0].value ?? []), [0, 0.6, 0, 0.8]);
});
