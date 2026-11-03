import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { TypeTreeObject } from '@endfield-noclip/formats/unity/type-tree';
import {
	CurveMode,
	GradientMode,
	ParticleAlignment,
	ParticleRenderMode,
	ParticleShapeKind,
	SheetRow,
} from '@endfield-noclip/package-format/particles';

import { particleReach, readParticleSystem } from './particle-system.ts';

const constant = (value: number) => ({ minMaxState: 0, scalar: value, minScalar: 0 });
const between = (min: number, max: number) => ({ minMaxState: 3, scalar: max, minScalar: min });
const curve = (keys: [number, number][]) => ({
	minMaxState: 1,
	scalar: 1,
	minScalar: 0,
	maxCurve: {
		m_Curve: keys.map(([time, value]) => ({ time, value, inSlope: 0, outSlope: 0 })),
		m_PreInfinity: 2,
		m_PostInfinity: 2,
	},
});
const vector = (x: number, y: number, z: number) => ({ x, y, z });
const white = { r: 1, g: 1, b: 1, a: 1 };
/** a serialized Unity gradient from colour keys (rgb) and alpha keys, as `[time, value]` */
const gradient = (colors: [number, [number, number, number]][], alphas: [number, number][], mode = 0) => {
	const value: Record<string, unknown> = {
		m_Mode: mode,
		m_NumColorKeys: colors.length,
		m_NumAlphaKeys: alphas.length,
	};
	for (let i = 0; i < 8; i++) {
		const [r, g, b] = colors[i]?.[1] ?? [0, 0, 0];
		value[`key${i}`] = { r, g, b, a: alphas[i]?.[1] ?? 0 };
		value[`ctime${i}`] = Math.round((colors[i]?.[0] ?? 0) * 65_535);
		value[`atime${i}`] = Math.round((alphas[i]?.[0] ?? 0) * 65_535);
	}
	return value;
};
const pointer = (pathId: bigint) => ({ m_FileID: 0, m_PathID: pathId });

const system = (
	overrides: Record<string, unknown> = {},
	initial: Record<string, unknown> = {},
): TypeTreeObject => ({
	lengthInSec: 5,
	looping: true,
	playOnAwake: true,
	ringBufferMode: 0,
	ringBufferLoopRange: { x: 0, y: 1 },
	simulationSpeed: 1,
	scalingMode: 1,
	startDelay: constant(0),
	InitialModule: {
		enabled: true,
		startLifetime: constant(80),
		startSpeed: constant(0),
		startColor: { minMaxState: 0, minColor: white, maxColor: white },
		size3D: true,
		startSize: between(5, 3),
		startSizeY: between(5, 3),
		startSizeZ: between(5, 3),
		rotation3D: false,
		startRotation: between(0, 6.28),
		maxNumParticles: 150,
		gravityModifier: between(-0.003, -0.012),
		...initial,
	},
	EmissionModule: { enabled: true, rateOverTime: constant(1.1), m_Bursts: [] },
	ShapeModule: {
		enabled: true,
		type: 4,
		radius: { value: 65 },
		radiusThickness: 0.5,
		angle: 2,
		length: 5,
		arc: { value: 360 },
		m_Position: vector(0, 0, 0),
		m_Rotation: vector(0, 0, 0),
		m_Scale: vector(1, 1, 1),
		randomDirectionAmount: 0,
		sphericalDirectionAmount: 0,
		randomPositionAmount: 0,
	},
	VelocityModule: {
		enabled: true,
		x: constant(0),
		y: constant(0),
		z: constant(0),
		orbitalX: constant(0),
		orbitalY: constant(0),
		orbitalZ: between(-0.05, -0.005),
		orbitalOffsetX: constant(0),
		orbitalOffsetY: constant(0),
		orbitalOffsetZ: constant(0),
		radial: constant(0),
		speedModifier: constant(1),
		inWorldSpace: false,
	},
	SizeModule: {
		enabled: true,
		separateAxes: false,
		curve: curve([
			[0, 1],
			[1, 0.1],
		]),
	},
	RotationModule: { enabled: false },
	ColorModule: { enabled: false },
	NoiseModule: { enabled: false },
	...overrides,
});

const renderer = (overrides: Record<string, unknown> = {}): TypeTreeObject => ({
	m_RenderMode: 4,
	m_RenderAlignment: 0,
	m_Mesh: pointer(7n),
	m_Mesh1: pointer(0n),
	m_Pivot: vector(0, 0, 0),
	...overrides,
});

test('a looping mesh particle system keeps its emission, shape, gravity, orbit and size over lifetime', () => {
	const read = readParticleSystem(system(), renderer());
	assert.ok(read !== null && 'info' in read);
	const { info } = read;
	assert.deepEqual(
		read.meshes.map((mesh) => mesh.pathId),
		[7n],
	);
	assert.deepEqual(info.meshWeights, [1]);
	assert.equal(info.alignment, ParticleAlignment.View);
	assert.equal(info.rate.scalar, 1.1);
	assert.equal(info.shape?.kind, ParticleShapeKind.Cone);
	assert.equal(info.shape?.radius, 65);
	assert.equal(info.motion.kind, 'free');
	assert.deepEqual(info.motion.gravityModifier, {
		mode: CurveMode.TwoConstants,
		scalar: -0.012,
		min: -0.003,
		curve: null,
		minCurve: null,
	});
	assert.equal(info.motion.velocity?.orbital[2].min, -0.05);
	// without 3D rotation only the rotation about z is read
	assert.equal(info.startRotation[0].scalar, 0);
	assert.equal(info.startRotation[2].scalar, 6.28);
	assert.deepEqual(
		info.sizeOverLifetime?.[1].curve?.keys.map((key) => key.value),
		[1, 0.1],
	);
	assert.equal(info.rotationOverLifetime, null);
});

test('particles pick among the renderer meshes evenly, or by weight when the distribution says so', () => {
	const meshes = { m_Mesh1: pointer(8n), m_Mesh2: pointer(0n), m_Mesh3: pointer(9n) };
	const even = readParticleSystem(system(), renderer(meshes));
	assert.ok(even !== null && 'info' in even);
	assert.deepEqual(
		even.meshes.map((mesh) => mesh.pathId),
		[7n, 8n, 9n],
	);
	assert.deepEqual(even.info.meshWeights, [1, 1, 1]);
	const weighted = readParticleSystem(
		system(),
		renderer({
			...meshes,
			m_MeshDistribution: 1,
			m_MeshWeighting: 2,
			m_MeshWeighting1: 0,
			m_MeshWeighting3: 0.5,
		}),
	);
	assert.ok(weighted !== null && 'info' in weighted);
	// a mesh weighted 0 is never picked
	assert.deepEqual(
		weighted.meshes.map((mesh) => mesh.pathId),
		[7n, 9n],
	);
	assert.deepEqual(weighted.info.meshWeights, [2, 0.5]);
});

const sheet = (overrides: Record<string, unknown> = {}) => ({
	enabled: true,
	mode: 0,
	timeMode: 0,
	fps: 30,
	frameOverTime: {
		...curve([
			[0, 0],
			[1, 1],
		]),
		scalar: 0.9999,
	},
	startFrame: constant(0),
	tilesX: 8,
	tilesY: 8,
	animationType: 0,
	rowIndex: 0,
	cycles: 1,
	uvChannelMask: -1,
	rowMode: 1,
	...overrides,
});

test('a ring-buffered flipbook particle keeps its sheet and how it outlives its lifetime', () => {
	const faint = { startColor: { minMaxState: 0, minColor: white, maxColor: { ...white, a: 0.25 } } };
	const read = readParticleSystem(system({ ringBufferMode: 1, UVModule: sheet() }, faint), renderer());
	assert.ok(read !== null && 'info' in read);
	assert.deepEqual(read.info.startColor.max, [1, 1, 1, 0.25]);
	assert.equal(read.info.startColor.maxGradient, null);
	assert.deepEqual(read.info.ringBuffer, { loop: false, loopRange: [0, 1] });
	const textureSheet = read.info.textureSheet;
	assert.deepEqual(textureSheet?.tiles, [8, 8]);
	// the whole sheet ignores the row mode
	assert.equal(textureSheet?.row, null);
	assert.equal(textureSheet?.frameOverTime?.scalar, 0.9999);
	assert.equal(textureSheet?.uvChannels, 3);

	const looped = readParticleSystem(
		system({ ringBufferMode: 2, ringBufferLoopRange: { x: 0.2, y: 0.8 } }),
		renderer(),
	);
	assert.ok(looped !== null && 'info' in looped);
	assert.deepEqual(looped.info.ringBuffer, { loop: true, loopRange: [0.2, 0.8] });
	assert.equal(looped.info.textureSheet, null);

	// a single row: a fixed one, a random one, or the mesh's; frames per second leave no curve
	const row = (overrides: Record<string, unknown>) => {
		const result = readParticleSystem(
			system({ UVModule: sheet({ animationType: 1, ...overrides }) }),
			renderer(),
		);
		assert.ok(result !== null && 'info' in result);
		return result.info.textureSheet;
	};
	assert.equal(row({ rowMode: 0, rowIndex: 3 })?.row, 3);
	assert.equal(row({ rowMode: 1 })?.row, SheetRow.Random);
	assert.equal(row({ rowMode: 2 })?.row, SheetRow.MeshIndex);
	assert.equal(row({ rowMode: 0, timeMode: 2 })?.frameOverTime, null);
});

test('a cap of 0 becomes what one lifetime of emission holds', () => {
	// one particle per 1.6 s loop living 1.6 s, as the tilted torch flame
	const flame = readParticleSystem(
		system(
			{
				lengthInSec: 1.6,
				ringBufferMode: 2,
				EmissionModule: {
					enabled: true,
					rateOverTime: constant(0),
					m_Bursts: [
						{ time: 0, countCurve: constant(1), cycleCount: 1, repeatInterval: 0.01, probability: 1 },
					],
				},
			},
			{ startLifetime: constant(1.6), maxNumParticles: 0 },
		),
		renderer(),
	);
	assert.ok(flame !== null && 'info' in flame);
	assert.equal(flame.info.maxParticles, 1);
	// 1.1 per second for 80 s
	const steady = readParticleSystem(system({}, { maxNumParticles: 0 }), renderer());
	assert.ok(steady !== null && 'info' in steady);
	assert.equal(steady.info.maxParticles, 88);
});

test('systems the viewer cannot play say why', () => {
	const reason = (s: TypeTreeObject, r: TypeTreeObject = renderer()) => {
		const read = readParticleSystem(s, r);
		return read !== null && 'reason' in read ? read.reason : null;
	};
	assert.equal(reason(system(), renderer({ m_RenderMode: 5 })), 'render mode 5');
	// modules the viewer doesn't evaluate are ignored
	assert.equal(reason(system({ NoiseModule: { enabled: true } })), null);
	assert.equal(reason(system({ ringBufferMode: 3 })), 'ring buffer mode 3');
	assert.equal(reason(system({ UVModule: sheet({ mode: 1 }) })), 'sprite sheet');
	assert.equal(reason(system({ UVModule: sheet({ timeMode: 1 }) })), 'sheet time mode 1');
	assert.equal(reason(system({ UVModule: sheet({ tilesX: 65 }) })), 'sheet of 65×8 tiles');
	assert.equal(reason(system(), renderer({ m_RenderAlignment: 5 })), 'alignment 5');
	assert.equal(reason(system({ ShapeModule: { ...(system().ShapeModule as object), type: 6 } })), 'shape 6');
	assert.equal(reason(system(), renderer({ m_Mesh: pointer(0n) })), 'no mesh');
	const turning = { ...curve([[0, 1]]), minMaxState: 1 };
	assert.equal(
		reason(system({ VelocityModule: { ...(system().VelocityModule as object), radial: turning } })),
		'velocity curves',
	);
	assert.equal(
		reason(system({ EmissionModule: { enabled: true, rateOverTime: curve([[0, 1]]), m_Bursts: [] } })),
		'rate curve',
	);
	// one a script starts shows nothing until then, so it's neither played nor unsupported
	assert.equal(readParticleSystem(system({ playOnAwake: false }), renderer()), null);
});

test('the accelerate mushroom plays its velocity-aligned arrows, spin curves and donut', () => {
	// the arrows (dajiantou02) rise along their velocity; the wind meshes (wind01) slow their spin by curves
	const twoCurves = (scalar: number) => ({
		...curve([
			[0, -1],
			[1, 0],
		]),
		minMaxState: 2,
		scalar,
		minCurve: {
			m_Curve: [{ time: 0, value: 1, inSlope: 0, outSlope: 0 }],
			m_PreInfinity: 2,
			m_PostInfinity: 2,
		},
	});
	const read = readParticleSystem(
		system({
			RotationModule: {
				enabled: true,
				separateAxes: false,
				x: constant(0),
				y: constant(0),
				curve: twoCurves(1.05),
			},
			ShapeModule: { ...(system().ShapeModule as object), type: 17, radius: { value: 1 }, donutRadius: 0.2 },
		}),
		renderer({ m_RenderAlignment: 4 }),
	);
	assert.ok(read !== null && 'info' in read);
	assert.equal(read.info.alignment, ParticleAlignment.Velocity);
	assert.equal(read.info.rotationOverLifetime?.[2].mode, CurveMode.TwoCurves);
	assert.equal(read.info.rotationOverLifetime?.[2].scalar, 1.05);
	assert.equal(read.info.shape?.kind, ParticleShapeKind.Donut);
	assert.equal(read.info.shape?.donutRadius, 0.2);
});

test('billboards draw one quad, stretched ones keep how they lengthen', () => {
	const billboard = readParticleSystem(system(), renderer({ m_RenderMode: 0, m_Mesh: pointer(0n) }));
	assert.ok(billboard !== null && 'info' in billboard);
	assert.equal(billboard.info.renderMode, ParticleRenderMode.Billboard);
	assert.deepEqual(billboard.meshes, []);
	assert.deepEqual(billboard.info.meshWeights, [1]);
	assert.equal(billboard.info.stretch, null);
	const stretched = readParticleSystem(
		system({ scalingMode: 2 }),
		renderer({ m_RenderMode: 1, m_LengthScale: 1.5, m_VelocityScale: 0.2 }),
	);
	assert.ok(stretched !== null && 'info' in stretched);
	assert.deepEqual(stretched.info.stretch, { lengthScale: 1.5, velocityScale: 0.2 });
	assert.equal(stretched.info.sizedByScale, false);
	assert.equal(billboard.info.sizedByScale, true);
});

test('start colours and colour over lifetime keep their gradients and random ranges', () => {
	const read = readParticleSystem(
		system(
			{
				ColorModule: {
					enabled: true,
					gradient: {
						minMaxState: 3,
						minColor: white,
						maxColor: white,
						maxGradient: gradient(
							[
								[0, [1, 1, 1]],
								[1, [0.5, 0.5, 0.5]],
							],
							[
								[0, 0],
								[0.4, 1],
								[1, 1],
							],
						),
						minGradient: gradient([[0, [1, 1, 1]]], [[0, 1]], 1),
					},
				},
			},
			{
				startColor: { minMaxState: 2, minColor: { ...white, a: 0.2 }, maxColor: { ...white, a: 0.45 } },
			},
		),
		renderer(),
	);
	assert.ok(read !== null && 'info' in read);
	const { startColor, colorOverLifetime } = read.info;
	assert.equal(startColor.mode, GradientMode.TwoColors);
	assert.equal(startColor.min[3], 0.2);
	assert.equal(startColor.max[3], 0.45);
	assert.equal(colorOverLifetime?.mode, GradientMode.TwoGradients);
	assert.deepEqual(colorOverLifetime?.maxGradient?.colorKeys, [
		{ time: 0, color: [1, 1, 1] },
		{ time: 1, color: [0.5, 0.5, 0.5] },
	]);
	assert.deepEqual(
		colorOverLifetime?.maxGradient?.alphaKeys.map((key) => key.alpha),
		[0, 1, 1],
	);
	assert.ok(Math.abs((colorOverLifetime?.maxGradient?.alphaKeys[1].time ?? 0) - 0.4) < 1e-4);
	assert.equal(colorOverLifetime?.maxGradient?.fixed, false);
	assert.equal(colorOverLifetime?.minGradient?.fixed, true);
});

test('linear velocities can be curves', () => {
	const read = readParticleSystem(
		system({
			VelocityModule: {
				...(system().VelocityModule as object),
				y: curve([
					[0, 0],
					[1, 2],
				]),
			},
		}),
		renderer(),
	);
	assert.ok(read !== null && 'info' in read);
	assert.equal(
		read.info.motion.kind === 'free' && read.info.motion.velocity?.linear[1].mode,
		CurveMode.Curve,
	);
});

test('the reach covers the cone, the rise under gravity and the largest mesh', () => {
	const read = readParticleSystem(system(), renderer());
	assert.ok(read !== null && 'info' in read);
	const reach = particleReach(read.info, 1);
	// radius 65 plus a slight spread, ½ · 9.81 · 0.012 · 80² of rise, a mesh of size 5
	const rise = 0.5 * 9.81 * 0.012 * 80 * 80;
	assert.ok(reach.extents[1] >= 65 + rise + 5);
	assert.ok(reach.extents[1] < 65 + rise + 5 + 1);
	assert.deepEqual(reach.center, [0, 0, 0]);
});
