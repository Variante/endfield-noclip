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
import type { AnimationCurve, CurveKey, Gradient } from '@endfield-noclip/package-format/curves';
import {
	CurveMode,
	GradientMode,
	GRAVITY,
	type MinMaxCurveInfo,
	type MinMaxGradientInfo,
	ParticleAlignment,
	type ParticleBurstInfo,
	type ParticleClampInfo,
	type ParticleDragInfo,
	type ParticleSpeedLimitInfo,
	ParticleRenderMode,
	type ParticleRingBufferInfo,
	type ParticleShapeInfo,
	ParticleShapeKind,
	type ParticleSystemInfo,
	type ParticleTextureSheetInfo,
	type ParticleVelocityInfo,
	SheetRow,
} from '@endfield-noclip/package-format/particles';

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

/** `ParticleSystem.scalingMode` values */
export const ScalingMode = {
	/** the whole hierarchy's scale sizes and moves particles */
	Hierarchy: 0,
	/** the system's own scale alone sizes and moves them, ignoring its parents' */
	Local: 1,
	/** the scale moves particles but leaves their size */
	Shape: 2,
} as const;

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
export const readGradient = (value: TypeTreeObject): Gradient => {
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
		donutRadius: optionalNumberField(shape, 'donutRadius') ?? 0,
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
	// linear velocities and the speed modifier integrate over a particle's age; the others turn or push along
	// paths that don't
	if (![...orbital, radial].every(isConstant)) {
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

/** a speed limit, `null` when `dampen` is 0 and the limit does nothing */
const readSpeedLimit = (clamp: TypeTreeObject): ParticleSpeedLimitInfo | null | string => {
	const dampen = numberField(clamp, 'dampen');
	if (dampen <= 0) {
		return null;
	}
	if (booleanField(clamp, 'separateAxis')) {
		return 'per-axis velocity limit';
	}
	return {
		kind: 'limit',
		limit: readMinMaxCurve(objectField(clamp, 'magnitude')),
		dampen: Math.min(dampen, 1),
	};
};

const readDrag = (clamp: TypeTreeObject): ParticleDragInfo | null | string => {
	const amount = readMinMaxCurve(objectField(clamp, 'drag'));
	if (!isConstant(amount)) {
		return 'drag curve';
	}
	if (curveReach(amount) === 0) {
		return null;
	}
	return {
		kind: 'drag',
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
 *   module, shape, texture sheet or ring buffer mode it doesn't evaluate, orbital or radial velocity curves,
 *   a speed modifier curve alongside a speed limit or drag, a per-axis speed limit or one alongside drag, a
 *   drag or rate curve, or no mesh. `null` for a system that doesn't play on awake, which shows nothing until
 *   a script starts it
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
		case ParticleAlignment.Local:
		case ParticleAlignment.Velocity: {
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
	let clamp: ParticleClampInfo | null = null;
	if (enabled(system, 'ClampVelocityModule')) {
		const module = objectField(system, 'ClampVelocityModule');
		const limit = readSpeedLimit(module);
		const drag = readDrag(module);
		if (typeof limit === 'string') {
			return { reason: limit };
		}
		if (typeof drag === 'string') {
			return { reason: drag };
		}
		// where the game applies drag relative to the limit isn't known
		if (limit !== null && drag !== null) {
			return { reason: 'velocity limit with drag' };
		}
		clamp = limit ?? drag;
		// the viewer's stepped and dragged paths take the speed modifier as a constant
		if (clamp !== null && velocity !== null && !isConstant(velocity.speedModifier)) {
			return { reason: 'speed modifier curve with a velocity limit or drag' };
		}
	}

	const curve = (parent: TypeTreeObject, name: string) => readMinMaxCurve(objectField(parent, name));
	const { startSize, startRotation } = readStartPose(initial);
	const zero: MinMaxCurveInfo = { mode: CurveMode.Constant, scalar: 0, min: 0, curve: null, minCurve: null };

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
		rotationOverLifetime = booleanField(rotation, 'separateAxes')
			? [curve(rotation, 'x'), curve(rotation, 'y'), z]
			: [zero, zero, z];
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
	const bound = emissionBound(rate, bursts, startLifetime, duration);
	let maxParticles = numberField(initial, 'maxNumParticles');
	if (maxParticles === 0) {
		// some effects store a cap of 0 yet show in game (the tilted torch flames), so the game must size them
		// itself. take the most one lifetime's emission can hold, which also keeps a ring buffer from piling up
		maxParticles = bound;
	}
	const delay = curve(system, 'startDelay');
	// Unity's inspector offers a constant or two for the delay; a curve would need a time to read it at
	if (!isConstant(delay)) {
		return { reason: 'start delay curve' };
	}
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
			screenSize:
				renderMode === ParticleRenderMode.Mesh
					? null
					: {
							min: numberField(renderer, 'm_MinParticleSize'),
							max: numberField(renderer, 'm_MaxParticleSize'),
						},
			// the packer folds the other modes' scale into the emitter's matrix (particleEmitterMatrix)
			sizedByScale: numberField(system, 'scalingMode') !== ScalingMode.Shape,
			duration,
			looping: booleanField(system, 'looping'),
			startDelay: delay,
			maxParticles,
			emissionBound: bound,
			simulationSpeed: numberField(system, 'simulationSpeed'),
			startLifetime,
			startColor: readMinMaxGradient(objectField(initial, 'startColor')),
			colorOverLifetime: enabled(system, 'ColorModule')
				? readMinMaxGradient(objectField(objectField(system, 'ColorModule'), 'gradient'))
				: null,
			startSize,
			startRotation,
			rate,
			bursts,
			shape,
			motion: {
				kind: 'free',
				startSpeed: curve(initial, 'startSpeed'),
				gravityModifier: curve(initial, 'gravityModifier'),
				velocity,
				clamp,
			},
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
 * @param rate particles per second, a constant or two
 * @param bursts each loop's bursts
 * @param startLifetime the particles' lifetime
 * @param duration seconds per loop
 * @returns the most particles one longest lifetime of emission holds, whatever the cap: the top rate times
 *   the lifetime, plus each loop's top burst counts times the loops that lifetime spans
 */
export const emissionBound = (
	rate: MinMaxCurveInfo,
	bursts: readonly ParticleBurstInfo[],
	startLifetime: MinMaxCurveInfo,
	duration: number,
): number => {
	const life = Math.max(curveReach(startLifetime), 0);
	const perLoop = bursts.reduce((sum, burst) => sum + curveReach(burst.count) * burst.cycles, 0);
	return Math.ceil(curveReach(rate) * life + perLoop * Math.ceil(life / duration - 1e-6));
};

/**
 * @param initial a `ParticleSystem`'s `InitialModule`
 * @returns each particle's start size per axis and start Euler angles (radians, about x, y and z), as
 *   {@link ParticleSystemInfo} keeps them: one size for all three axes and a turn about z alone unless the
 *   module sets them per axis
 */
export const readStartPose = (
	initial: TypeTreeObject,
): Pick<ParticleSystemInfo, 'startSize' | 'startRotation'> => {
	const curve = (name: string) => readMinMaxCurve(objectField(initial, name));
	const size = curve('startSize');
	const zero: MinMaxCurveInfo = { mode: CurveMode.Constant, scalar: 0, min: 0, curve: null, minCurve: null };
	return {
		startSize: booleanField(initial, 'size3D')
			? [size, curve('startSizeY'), curve('startSizeZ')]
			: [size, size, size],
		startRotation: booleanField(initial, 'rotation3D')
			? [curve('startRotationX'), curve('startRotationY'), curve('startRotation')]
			: [zero, zero, curve('startRotation')],
	};
};

/**
 * @param curve a MinMaxCurve
 * @returns its constant, or the midpoint of its two constants (the game's random draws can't be reproduced
 *   offline); `null` for curves
 */
export const constantMidpoint = (curve: MinMaxCurveInfo): number | null => {
	switch (curve.mode) {
		case CurveMode.Constant: {
			return curve.scalar;
		}
		case CurveMode.TwoConstants: {
			return (curve.min + curve.scalar) / 2;
		}
		default: {
			return null;
		}
	}
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
	const motion = info.motion;
	if (motion.kind === 'spline') {
		// a Bézier segment stays inside its control points' hull
		let farthest = 0;
		for (const segment of motion.segments) {
			for (const point of segment.points) {
				farthest = Math.max(farthest, Math.hypot(...point));
			}
		}
		const start =
			info.shape === null ? 0 : Math.hypot(...info.shape.position) + Math.hypot(...info.shape.scale) / 2;
		const size =
			meshRadius *
			Math.max(...info.startSize.map(curveReach)) *
			Math.max(1, ...(info.sizeOverLifetime ?? []).map(curveReach));
		const half = farthest + start + size;
		return { center: [0, 0, 0], extents: [half, half, half] };
	}
	const life = curveReach(info.startLifetime);
	const { velocity } = motion;
	const speedScale = velocity === null ? 1 : curveReach(velocity.speedModifier);
	let speed = curveReach(motion.startSpeed);
	let offset = 0;
	if (velocity !== null) {
		const [x, y, z] = velocity.linear.map(curveReach);
		speed += Math.hypot(x, y, z) + curveReach(velocity.radial);
		offset = Math.hypot(...velocity.orbitalOffset);
	}
	let shape = 0;
	if (info.shape !== null) {
		const s = info.shape;
		const along = s.kind === ParticleShapeKind.ConeVolume ? s.length : 0;
		const tube = s.kind === ParticleShapeKind.Donut ? s.donutRadius : 0;
		const spread = s.radius + tube + along * Math.tan((Math.min(Math.abs(s.angle), 89) * Math.PI) / 180);
		shape =
			Math.hypot(...s.position) +
			Math.max(...s.scale.map(Math.abs)) * Math.hypot(spread, along) +
			s.randomPosition * Math.sqrt(3);
	}
	const gravity = 0.5 * GRAVITY * curveReach(motion.gravityModifier) * life * life;
	// the pivot moves the mesh by multiples of the particle's size
	let size =
		(meshRadius + Math.hypot(...info.pivot)) *
		Math.max(...info.startSize.map(curveReach)) *
		Math.max(1, ...(info.sizeOverLifetime ?? []).map(curveReach));
	if (info.stretch !== null) {
		// a stretched quad lengthens by its length scale and its speed
		const fastest = speed * speedScale + GRAVITY * curveReach(motion.gravityModifier) * life;
		size =
			size * Math.max(1, Math.abs(info.stretch.lengthScale)) + Math.abs(info.stretch.velocityScale) * fastest;
	}
	// orbits keep a particle's distance from their centre, which lies `offset` from the emitter
	const half = 2 * offset + shape + speed * speedScale * life + gravity + size;
	return { center: [0, 0, 0], extents: [half, half, half] };
};
