import { FormatError } from '@endfield-noclip/formats/binary/binary-reader';
import type { TypeTreeObject } from '@endfield-noclip/formats/unity/type-tree';
import {
	arrayField,
	booleanField,
	isObject,
	numberField,
	objectField,
	optionalNumberField,
	type Aabb,
	type PPtr,
	pptrField,
	vector3Field,
} from '@endfield-noclip/formats/unity/values';
import type { AnimationCurve, CurveKey } from '@endfield-noclip/package-format/environment';
import {
	CurveMode,
	type GradientInfo,
	GradientMode,
	type MinMaxCurveInfo,
	type MinMaxGradientInfo,
	ParticleAlignment,
	type ParticleBurstInfo,
	type ParticleDragInfo,
	ParticleRenderMode,
	type ParticleRingBufferInfo,
	type ParticleShapeInfo,
	ParticleShapeKind,
	type ParticleSystemInfo,
	type ParticleTextureSheetInfo,
	type ParticleVelocityInfo,
	SheetRow,
} from '@endfield-noclip/package-format/particles';

import { SCALING_SHAPE } from './particle-mesh.ts';

/** the renderer's meshes and their weights */
const MESH_FIELDS = ['m_Mesh', 'm_Mesh1', 'm_Mesh2', 'm_Mesh3'] as const;
const MESH_WEIGHT_FIELDS = [
	'm_MeshWeighting',
	'm_MeshWeighting1',
	'm_MeshWeighting2',
	'm_MeshWeighting3',
] as const;

/** `ParticleSystemRenderer.m_MeshDistribution` that picks meshes by their weights rather than evenly */
const MESH_DISTRIBUTION_WEIGHTED = 1;

/** `ParticleSystemRenderer.m_RenderAlignment` of Unity's `Facing`, which the viewer orients like `View` */
const ALIGNMENT_FACING = 3;

/** Unity's gravity, m/s² */
const GRAVITY = 9.81;

/** shapes the viewer emits from, by `ShapeModule.type` */
const SHAPES = new Set<number>(Object.values(ParticleShapeKind));
const isShapeKind = (kind: number): kind is ParticleShapeKind => SHAPES.has(kind);

/** what {@link readParticleSystem} found */
export type ParticleSystemRead =
	| {
			/** the system, drawing the first of its meshes */
			info: ParticleSystemInfo;
			/**
			 * the meshes particles pick from, in the order of {@link ParticleSystemInfo.meshWeights}; empty for
			 * quads, which the caller supplies
			 */
			meshes: PPtr[];
	  }
	| { reason: string };

/**
 * @param value a serialized `AnimationCurve`
 * @returns its keys and wrap modes
 */
export const readAnimationCurve = (value: TypeTreeObject): AnimationCurve => ({
	keys: arrayField(value, 'm_Curve').map((key): CurveKey => {
		if (!isObject(key)) {
			throw new FormatError('curve key is not an object');
		}
		return {
			time: numberField(key, 'time'),
			value: numberField(key, 'value'),
			inSlope: numberField(key, 'inSlope'),
			outSlope: numberField(key, 'outSlope'),
			weightedMode: optionalNumberField(key, 'weightedMode') ?? 0,
			inWeight: optionalNumberField(key, 'inWeight') ?? 0,
			outWeight: optionalNumberField(key, 'outWeight') ?? 0,
		};
	}),
	preWrapMode: optionalNumberField(value, 'm_PreInfinity') ?? 2,
	postWrapMode: optionalNumberField(value, 'm_PostInfinity') ?? 2,
});

/**
 * @param value a serialized `MinMaxCurve`
 * @returns it, with only the curves its mode reads
 * @throws {FormatError} on an unknown mode
 */
export const readMinMaxCurve = (value: TypeTreeObject): MinMaxCurveInfo => {
	const mode = numberField(value, 'minMaxState');
	switch (mode) {
		case CurveMode.Constant:
		case CurveMode.Curve:
		case CurveMode.TwoCurves:
		case CurveMode.TwoConstants: {
			break;
		}
		default: {
			throw new FormatError(`unknown MinMaxCurve mode ${mode}`);
		}
	}
	const curves = mode === CurveMode.Curve || mode === CurveMode.TwoCurves;
	return {
		mode,
		scalar: numberField(value, 'scalar'),
		min: numberField(value, 'minScalar'),
		curve: curves ? readAnimationCurve(objectField(value, 'maxCurve')) : null,
		minCurve: mode === CurveMode.TwoCurves ? readAnimationCurve(objectField(value, 'minCurve')) : null,
	};
};

/** @returns whether a MinMaxCurve is one constant or a random one between two */
const isConstant = (curve: MinMaxCurveInfo): boolean =>
	curve.mode === CurveMode.Constant || curve.mode === CurveMode.TwoConstants;

/**
 * @param curve a MinMaxCurve
 * @returns the largest magnitude it can take (the keys' values bound a curve, overshoot aside)
 */
export const curveReach = (curve: MinMaxCurveInfo): number => {
	switch (curve.mode) {
		case CurveMode.Constant: {
			return Math.abs(curve.scalar);
		}
		case CurveMode.TwoConstants: {
			return Math.max(Math.abs(curve.scalar), Math.abs(curve.min));
		}
		default: {
			let most = 0;
			for (const key of [...(curve.curve?.keys ?? []), ...(curve.minCurve?.keys ?? [])]) {
				most = Math.max(most, Math.abs(key.value));
			}
			return most * Math.abs(curve.scalar);
		}
	}
};

/** @returns whether the module is present and enabled */
const enabled = (system: TypeTreeObject, module: string): boolean =>
	isObject(system[module]) && booleanField(system[module], 'enabled');

const rgba = (value: TypeTreeObject): [number, number, number, number] => [
	numberField(value, 'r'),
	numberField(value, 'g'),
	numberField(value, 'b'),
	numberField(value, 'a'),
];

/** Unity's `GradientMode.Fixed` */
const GRADIENT_FIXED = 1;

/** the most keys a Unity gradient holds */
const GRADIENT_KEYS = 8;

/**
 * @param value a serialized `Gradient`
 * @returns its keys
 * @throws {FormatError} on a key count outside 1–8
 */
export const readGradient = (value: TypeTreeObject): GradientInfo => {
	const colors = numberField(value, 'm_NumColorKeys');
	const alphas = numberField(value, 'm_NumAlphaKeys');
	if (colors < 1 || colors > GRADIENT_KEYS || alphas < 1 || alphas > GRADIENT_KEYS) {
		throw new FormatError(`gradient with ${colors} colour and ${alphas} alpha keys`);
	}
	// key times are stored as 0–65535
	return {
		colorKeys: Array.from({ length: colors }, (_, i) => {
			const [r, g, b] = rgba(objectField(value, `key${i}`));
			return { time: numberField(value, `ctime${i}`) / 65_535, color: [r, g, b] };
		}),
		alphaKeys: Array.from({ length: alphas }, (_, i) => ({
			time: numberField(value, `atime${i}`) / 65_535,
			alpha: rgba(objectField(value, `key${i}`))[3],
		})),
		fixed: numberField(value, 'm_Mode') === GRADIENT_FIXED,
	};
};

/**
 * @param value a serialized `MinMaxGradient`
 * @returns it, with only the gradients its mode reads
 * @throws {FormatError} on an unknown mode
 */
export const readMinMaxGradient = (value: TypeTreeObject): MinMaxGradientInfo => {
	const mode = numberField(value, 'minMaxState');
	switch (mode) {
		case GradientMode.Color:
		case GradientMode.Gradient:
		case GradientMode.TwoColors:
		case GradientMode.TwoGradients:
		case GradientMode.RandomColor: {
			break;
		}
		default: {
			throw new FormatError(`unknown MinMaxGradient mode ${mode}`);
		}
	}
	const gradients =
		mode === GradientMode.Gradient || mode === GradientMode.TwoGradients || mode === GradientMode.RandomColor;
	return {
		mode,
		max: rgba(objectField(value, 'maxColor')),
		min: rgba(objectField(value, 'minColor')),
		maxGradient: gradients ? readGradient(objectField(value, 'maxGradient')) : null,
		minGradient: mode === GradientMode.TwoGradients ? readGradient(objectField(value, 'minGradient')) : null,
	};
};

const readShape = (shape: TypeTreeObject): ParticleShapeInfo | string => {
	const kind = numberField(shape, 'type');
	if (!isShapeKind(kind)) {
		return `shape ${kind}`;
	}
	const radius = objectField(shape, 'radius');
	const arc = objectField(shape, 'arc');
	return {
		kind,
		radius: numberField(radius, 'value'),
		radiusThickness: numberField(shape, 'radiusThickness'),
		angle: numberField(shape, 'angle'),
		length: numberField(shape, 'length'),
		arc: numberField(arc, 'value'),
		position: vector3Field(shape, 'm_Position'),
		rotation: vector3Field(shape, 'm_Rotation'),
		scale: vector3Field(shape, 'm_Scale'),
		randomDirection: numberField(shape, 'randomDirectionAmount'),
		sphericalDirection: numberField(shape, 'sphericalDirectionAmount'),
		randomPosition: numberField(shape, 'randomPositionAmount'),
	};
};

const readVelocity = (velocity: TypeTreeObject): ParticleVelocityInfo | string => {
	const curves = (names: readonly string[]) =>
		names.map((name) => readMinMaxCurve(objectField(velocity, name)));
	const linear = curves(['x', 'y', 'z']);
	const orbital = curves(['orbitalX', 'orbitalY', 'orbitalZ']);
	const [radial, speedModifier] = curves(['radial', 'speedModifier']);
	// linear velocities integrate over a particle's age; the others turn or push along paths that don't
	if (![...orbital, radial, speedModifier].every(isConstant)) {
		return 'velocity curves';
	}
	return {
		linear: [linear[0], linear[1], linear[2]],
		linearInWorld: booleanField(velocity, 'inWorldSpace'),
		orbital: [orbital[0], orbital[1], orbital[2]],
		orbitalOffset: [
			numberField(objectField(velocity, 'orbitalOffsetX'), 'scalar'),
			numberField(objectField(velocity, 'orbitalOffsetY'), 'scalar'),
			numberField(objectField(velocity, 'orbitalOffsetZ'), 'scalar'),
		],
		radial,
		speedModifier,
	};
};

const readDrag = (clamp: TypeTreeObject): ParticleDragInfo | null | string => {
	// a dampen of 0 lets particles pass the speed limit untouched, leaving only the drag
	if (numberField(clamp, 'dampen') !== 0) {
		return 'velocity limit';
	}
	const amount = readMinMaxCurve(objectField(clamp, 'drag'));
	if (!isConstant(amount)) {
		return 'drag curve';
	}
	if (curveReach(amount) === 0) {
		return null;
	}
	return {
		amount,
		bySize: booleanField(clamp, 'multiplyDragByParticleSize'),
		byVelocity: booleanField(clamp, 'multiplyDragByParticleVelocity'),
	};
};

const readBurst = (burst: TypeTreeObject): ParticleBurstInfo => ({
	time: numberField(burst, 'time'),
	count: readMinMaxCurve(objectField(burst, 'countCurve')),
	cycles: Math.max(1, numberField(burst, 'cycleCount')),
	interval: Math.max(numberField(burst, 'repeatInterval'), 1e-4),
	probability: numberField(burst, 'probability'),
});

/** `UVModule` enums the viewer evaluates */
const SheetMode = { Grid: 0 } as const;
const SheetTime = { Lifetime: 0, Fps: 2 } as const;
const SheetAnimation = { WholeSheet: 0, SingleRow: 1 } as const;
const SheetRowMode = { Custom: 0, Random: 1, MeshIndex: 2 } as const;

/** the most tiles along either side of a sheet, so a tile fits the viewer's instance info word */
const MAX_SHEET_TILES = 64;

const readTextureSheet = (uv: TypeTreeObject): ParticleTextureSheetInfo | string => {
	if (numberField(uv, 'mode') !== SheetMode.Grid) {
		return 'sprite sheet';
	}
	const tiles: [number, number] = [numberField(uv, 'tilesX'), numberField(uv, 'tilesY')];
	if (tiles.some((n) => n < 1 || n > MAX_SHEET_TILES)) {
		return `sheet of ${tiles[0]}×${tiles[1]} tiles`;
	}
	let row: number | null;
	switch (numberField(uv, 'animationType')) {
		case SheetAnimation.WholeSheet: {
			row = null;
			break;
		}
		case SheetAnimation.SingleRow: {
			const mode = optionalNumberField(uv, 'rowMode') ?? SheetRowMode.Custom;
			switch (mode) {
				case SheetRowMode.Custom: {
					row = Math.min(Math.max(numberField(uv, 'rowIndex'), 0), tiles[1] - 1);
					break;
				}
				case SheetRowMode.Random: {
					row = SheetRow.Random;
					break;
				}
				case SheetRowMode.MeshIndex: {
					row = SheetRow.MeshIndex;
					break;
				}
				default: {
					return `sheet row mode ${mode}`;
				}
			}
			break;
		}
		default: {
			return `sheet animation ${numberField(uv, 'animationType')}`;
		}
	}
	const timeMode = numberField(uv, 'timeMode');
	if (timeMode !== SheetTime.Lifetime && timeMode !== SheetTime.Fps) {
		return `sheet time mode ${timeMode}`;
	}
	return {
		tiles,
		row,
		frameOverTime: timeMode === SheetTime.Lifetime ? readMinMaxCurve(objectField(uv, 'frameOverTime')) : null,
		fps: numberField(uv, 'fps'),
		startFrame: readMinMaxCurve(objectField(uv, 'startFrame')),
		cycles: numberField(uv, 'cycles'),
		// -1 (every channel) and other masks keep the two UV sets the viewer's shaders read
		uvChannels: numberField(uv, 'uvChannelMask') & 3,
	};
};

/** `ParticleSystem.ringBufferMode` values */
const RingBufferMode = { Disabled: 0, PauseUntilReplaced: 1, LoopUntilReplaced: 2 } as const;

const readRingBuffer = (system: TypeTreeObject): ParticleRingBufferInfo | null | string => {
	const mode = numberField(system, 'ringBufferMode');
	switch (mode) {
		case RingBufferMode.Disabled: {
			return null;
		}
		case RingBufferMode.PauseUntilReplaced:
		case RingBufferMode.LoopUntilReplaced: {
			const range = objectField(system, 'ringBufferLoopRange');
			return {
				loop: mode === RingBufferMode.LoopUntilReplaced,
				loopRange: [numberField(range, 'x'), numberField(range, 'y')],
			};
		}
		default: {
			return `ring buffer mode ${mode}`;
		}
	}
};

/**
 * reads a particle system that plays on its own once loaded. modules the viewer doesn't evaluate (forces,
 * noise, collision, sub-emitters, trails, the by-speed modules, …) are ignored, so such systems play without
 * them.
 *
 * @param system the emitter's `ParticleSystem`
 * @param renderer its `ParticleSystemRenderer`
 * @returns the system and the meshes its particles draw, or why the viewer can't play it: a render mode, a
 *   module, shape, texture sheet or ring buffer mode it doesn't evaluate, velocity curves other than linear
 *   ones, a speed limit, a drag or rate curve, no mesh, or velocity alignment. `null` for a system that
 *   doesn't play on awake, which shows nothing until a script starts it
 */
export const readParticleSystem = (
	system: TypeTreeObject,
	renderer: TypeTreeObject,
): ParticleSystemRead | null => {
	const renderMode = numberField(renderer, 'm_RenderMode');
	switch (renderMode) {
		case ParticleRenderMode.Billboard:
		case ParticleRenderMode.Stretched:
		case ParticleRenderMode.Horizontal:
		case ParticleRenderMode.Vertical:
		case ParticleRenderMode.Mesh: {
			break;
		}
		default: {
			return { reason: `render mode ${renderMode}` };
		}
	}
	if (!booleanField(system, 'playOnAwake')) {
		return null;
	}
	const ringBuffer = readRingBuffer(system);
	if (typeof ringBuffer === 'string') {
		return { reason: ringBuffer };
	}
	// each particle picks one of up to four meshes, evenly or by the weights; other modes draw one quad
	const meshes: PPtr[] = [];
	const meshWeights: number[] = [];
	if (renderMode === ParticleRenderMode.Mesh) {
		const weighted =
			(optionalNumberField(renderer, 'm_MeshDistribution') ?? 0) === MESH_DISTRIBUTION_WEIGHTED;
		for (const [i, field] of MESH_FIELDS.entries()) {
			if (!isObject(renderer[field]) || pptrField(renderer, field).pathId === 0n) {
				continue;
			}
			const weight = weighted ? (optionalNumberField(renderer, MESH_WEIGHT_FIELDS[i]) ?? 1) : 1;
			if (weight > 0) {
				meshes.push(pptrField(renderer, field));
				meshWeights.push(weight);
			}
		}
		if (meshes.length === 0) {
			return { reason: 'no mesh' };
		}
	} else {
		meshWeights.push(1);
	}
	const renderAlignment = numberField(renderer, 'm_RenderAlignment');
	let alignment: ParticleAlignment;
	switch (renderAlignment) {
		case ParticleAlignment.View:
		case ALIGNMENT_FACING: {
			alignment = ParticleAlignment.View;
			break;
		}
		case ParticleAlignment.World:
		case ParticleAlignment.Local: {
			alignment = renderAlignment;
			break;
		}
		default: {
			return { reason: `alignment ${renderAlignment}` };
		}
	}
	const initial = objectField(system, 'InitialModule');
	const emission = objectField(system, 'EmissionModule');
	const emits = booleanField(emission, 'enabled');
	const rate = emits
		? readMinMaxCurve(objectField(emission, 'rateOverTime'))
		: { mode: CurveMode.Constant, scalar: 0, min: 0, curve: null, minCurve: null };
	if (!isConstant(rate)) {
		return { reason: 'rate curve' };
	}
	const bursts = emits
		? arrayField(emission, 'm_Bursts').map((burst) => {
				if (!isObject(burst)) {
					throw new FormatError('burst is not an object');
				}
				return readBurst(burst);
			})
		: [];

	let shape: ParticleShapeInfo | null = null;
	if (enabled(system, 'ShapeModule')) {
		const read = readShape(objectField(system, 'ShapeModule'));
		if (typeof read === 'string') {
			return { reason: read };
		}
		shape = read;
	}
	let velocity: ParticleVelocityInfo | null = null;
	if (enabled(system, 'VelocityModule')) {
		const read = readVelocity(objectField(system, 'VelocityModule'));
		if (typeof read === 'string') {
			return { reason: read };
		}
		velocity = read;
	}
	let drag: ParticleDragInfo | null = null;
	if (enabled(system, 'ClampVelocityModule')) {
		const read = readDrag(objectField(system, 'ClampVelocityModule'));
		if (typeof read === 'string') {
			return { reason: read };
		}
		drag = read;
	}

	const curve = (parent: TypeTreeObject, name: string) => readMinMaxCurve(objectField(parent, name));
	const size = curve(initial, 'startSize');
	const startSize: [MinMaxCurveInfo, MinMaxCurveInfo, MinMaxCurveInfo] = booleanField(initial, 'size3D')
		? [size, curve(initial, 'startSizeY'), curve(initial, 'startSizeZ')]
		: [size, size, size];
	const zero: MinMaxCurveInfo = { mode: CurveMode.Constant, scalar: 0, min: 0, curve: null, minCurve: null };
	const startRotation: [MinMaxCurveInfo, MinMaxCurveInfo, MinMaxCurveInfo] = booleanField(
		initial,
		'rotation3D',
	)
		? [curve(initial, 'startRotationX'), curve(initial, 'startRotationY'), curve(initial, 'startRotation')]
		: [zero, zero, curve(initial, 'startRotation')];

	let sizeOverLifetime: ParticleSystemInfo['sizeOverLifetime'] = null;
	if (enabled(system, 'SizeModule')) {
		const sizeModule = objectField(system, 'SizeModule');
		const x = curve(sizeModule, 'curve');
		sizeOverLifetime = booleanField(sizeModule, 'separateAxes')
			? [x, curve(sizeModule, 'y'), curve(sizeModule, 'z')]
			: [x, x, x];
	}
	let rotationOverLifetime: ParticleSystemInfo['rotationOverLifetime'] = null;
	if (enabled(system, 'RotationModule')) {
		const rotation = objectField(system, 'RotationModule');
		const z = curve(rotation, 'curve');
		const axes: [MinMaxCurveInfo, MinMaxCurveInfo, MinMaxCurveInfo] = booleanField(rotation, 'separateAxes')
			? [curve(rotation, 'x'), curve(rotation, 'y'), z]
			: [zero, zero, z];
		if (!axes.every(isConstant)) {
			return { reason: 'rotation curves' };
		}
		rotationOverLifetime = axes;
	}
	let textureSheet: ParticleTextureSheetInfo | null = null;
	if (enabled(system, 'UVModule')) {
		const read = readTextureSheet(objectField(system, 'UVModule'));
		if (typeof read === 'string') {
			return { reason: read };
		}
		textureSheet = read;
	}

	const duration = Math.max(numberField(system, 'lengthInSec'), 1e-3);
	const startLifetime = curve(initial, 'startLifetime');
	let maxParticles = numberField(initial, 'maxNumParticles');
	if (maxParticles === 0) {
		// some effects store a cap of 0 yet show in game (the tilted torch flames), so the game must size them
		// itself. take the most one lifetime's emission can hold, which also keeps a ring buffer from piling up
		const life = curveReach(startLifetime);
		const burstsPerLoop = bursts.reduce((sum, burst) => sum + curveReach(burst.count) * burst.cycles, 0);
		maxParticles = Math.ceil(curveReach(rate) * life + burstsPerLoop * Math.ceil(life / duration - 1e-6));
	}
	const delay = curve(system, 'startDelay');
	return {
		info: {
			renderMode,
			stretch:
				renderMode === ParticleRenderMode.Stretched
					? {
							lengthScale: numberField(renderer, 'm_LengthScale'),
							velocityScale: numberField(renderer, 'm_VelocityScale'),
						}
					: null,
			shapeScaling: numberField(system, 'scalingMode') === SCALING_SHAPE,
			duration,
			looping: booleanField(system, 'looping'),
			// a random delay takes its midpoint, a curve none
			startDelay: isConstant(delay)
				? (delay.scalar + (delay.mode === CurveMode.Constant ? delay.scalar : delay.min)) / 2
				: 0,
			maxParticles,
			simulationSpeed: numberField(system, 'simulationSpeed'),
			startLifetime,
			startColor: readMinMaxGradient(objectField(initial, 'startColor')),
			colorOverLifetime: enabled(system, 'ColorModule')
				? readMinMaxGradient(objectField(objectField(system, 'ColorModule'), 'gradient'))
				: null,
			startSpeed: curve(initial, 'startSpeed'),
			startSize,
			startRotation,
			gravityModifier: curve(initial, 'gravityModifier'),
			rate,
			bursts,
			shape,
			velocity,
			drag,
			sizeOverLifetime,
			rotationOverLifetime,
			alignment,
			pivot: vector3Field(renderer, 'm_Pivot'),
			meshWeights,
			mesh: 0,
			ringBuffer,
			textureSheet,
		},
		meshes,
	};
};

/**
 * a conservative box around everywhere a system's particles can reach, meshes included, in the emitter's
 * frame: the shape's extent plus the farthest any velocity, gravity or radial push carries a particle in its
 * longest lifetime, around the orbits' centre
 *
 * @param info the system
 * @param meshRadius the particle mesh's bounding radius at size 1
 * @returns the box
 */
export const particleReach = (info: ParticleSystemInfo, meshRadius: number): Aabb => {
	const life = curveReach(info.startLifetime);
	const speedScale = info.velocity === null ? 1 : curveReach(info.velocity.speedModifier);
	let speed = curveReach(info.startSpeed);
	let offset = 0;
	if (info.velocity !== null) {
		const [x, y, z] = info.velocity.linear.map(curveReach);
		speed += Math.hypot(x, y, z) + curveReach(info.velocity.radial);
		offset = Math.hypot(...info.velocity.orbitalOffset);
	}
	let shape = 0;
	if (info.shape !== null) {
		const s = info.shape;
		const along = s.kind === ParticleShapeKind.ConeVolume ? s.length : 0;
		const spread = s.radius + along * Math.tan((Math.min(Math.abs(s.angle), 89) * Math.PI) / 180);
		shape =
			Math.hypot(...s.position) +
			Math.max(...s.scale.map(Math.abs)) * Math.hypot(spread, along) +
			s.randomPosition * Math.sqrt(3);
	}
	const gravity = 0.5 * GRAVITY * curveReach(info.gravityModifier) * life * life;
	let size =
		meshRadius *
		Math.max(...info.startSize.map(curveReach)) *
		Math.max(1, ...(info.sizeOverLifetime ?? []).map(curveReach)) *
		Math.max(1, Math.hypot(...info.pivot));
	if (info.stretch !== null) {
		// a stretched quad lengthens by its length scale and its speed
		const fastest = speed * speedScale + GRAVITY * curveReach(info.gravityModifier) * life;
		size =
			size * Math.max(1, Math.abs(info.stretch.lengthScale)) + Math.abs(info.stretch.velocityScale) * fastest;
	}
	// orbits keep a particle's distance from their centre, which lies `offset` from the emitter
	const half = 2 * offset + shape + speed * speedScale * life + gravity + size;
	return { center: [0, 0, 0], extents: [half, half, half] };
};
