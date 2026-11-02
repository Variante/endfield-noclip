/**
 * mesh particles that stand still: a particle system that emits one mesh particle and keeps it once its
 * lifetime ends (ring buffer mode) draws a fixed mesh, which the packer can place like a mesh renderer.
 * scenery uses these for slow effect shapes, such as the threads swirling over Wuling City's pillar array.
 *
 * @module
 */

import { multiplyMatrices, trsMatrix, unityEulerQuaternion } from '@endfield-noclip/formats/unity/transform';
import type { TypeTreeObject } from '@endfield-noclip/formats/unity/type-tree';
import {
	booleanField,
	isObject,
	numberField,
	objectField,
	vector3Field,
} from '@endfield-noclip/formats/unity/values';

/** a Transform's local placement */
export interface LocalTransform {
	position: readonly number[];
	/** xyzw */
	rotation: readonly number[];
	scale: readonly number[];
}

/** `ParticleSystemRenderer.m_RenderMode` that draws a mesh per particle */
const RENDER_MODE_MESH = 4;

/** `ParticleSystemRenderer.m_RenderAlignment` values whose orientation doesn't follow the camera */
const Alignment = {
	World: 1,
	Local: 2,
	Velocity: 4,
} as const;

/** `ShapeModule.type` of a box, which emits along the emitter's forward axis */
const SHAPE_BOX = 5;

/** `ParticleSystem.scalingMode` that sizes particles by the whole hierarchy's scale */
const SCALING_HIERARCHY = 0;

/**
 * `ParticleSystem.scalingMode` that sizes and moves particles by the system's own scale, ignoring its
 * parents'
 */
const SCALING_LOCAL = 1;

/** `ParticleSystem.scalingMode` that leaves particle sizes unscaled */
export const SCALING_SHAPE = 2;

/**
 * the matrix a played particle system's particles move in: its whole world matrix, except under the `Local`
 * scaling mode, which drops the parents' scale. the `Shape` mode keeps the hierarchy's scale here, since that
 * scale still moves its particles; only their size ignores it.
 *
 * @param parent the parent's world matrix
 * @param local the system's local transform
 * @param scalingMode `ParticleSystem.scalingMode`
 * @returns the emitter's world matrix
 */
export const particleEmitterMatrix = (
	parent: Float32Array,
	local: LocalTransform,
	scalingMode: number,
): Float32Array =>
	scalingMode === SCALING_LOCAL
		? particleStandInMatrix(parent, local, SCALING_LOCAL)
		: multiplyMatrices(parent, trsMatrix(local.position, local.rotation, local.scale));

/**
 * where a particle system the viewer can't play stands in: at its transform, sized as the game sizes its
 * particles. `Hierarchy` takes the whole hierarchy's scale, `Local` only the system's own and `Shape` none,
 * so a system whose parent stretches a wide spawn box doesn't stand in as a quad as wide as the box.
 *
 * @param parent the parent's world matrix
 * @param local the system's local transform
 * @param scalingMode `ParticleSystem.scalingMode`
 * @returns the stand-in's world matrix
 */
export const particleStandInMatrix = (
	parent: Float32Array,
	local: LocalTransform,
	scalingMode: number,
): Float32Array => {
	if (scalingMode === SCALING_HIERARCHY) {
		return multiplyMatrices(parent, trsMatrix(local.position, local.rotation, local.scale));
	}
	const matrix = multiplyMatrices(parent, trsMatrix(local.position, local.rotation, [1, 1, 1]));
	// rescaling each axis to the system's own scale drops the parents' scale and keeps where the axes point
	const own = scalingMode === SCALING_SHAPE ? [1, 1, 1] : local.scale;
	for (let axis = 0; axis < 3; axis++) {
		const length = Math.hypot(matrix[axis * 4], matrix[axis * 4 + 1], matrix[axis * 4 + 2]);
		const factor = length > 0 ? own[axis] / length : 0;
		for (let i = 0; i < 3; i++) {
			matrix[axis * 4 + i] *= factor;
		}
	}
	return matrix;
};

/**
 * a MinMaxCurve's value: a constant, or the midpoint of a random range between two constants, since the
 * game's random draws can't be reproduced offline
 */
const curveValue = (curve: TypeTreeObject): number | null => {
	switch (numberField(curve, 'minMaxState')) {
		case 0: {
			return numberField(curve, 'scalar');
		}
		case 3: {
			return (numberField(curve, 'minScalar') + numberField(curve, 'scalar')) / 2;
		}
		default: {
			return null;
		}
	}
};

/**
 * the placement of the one particle a frozen mesh particle system shows. the particle keeps its start size
 * and start rotation, at the shape's centre; the drift and spin it picks up over its lifetime are left out,
 * so the system's lifetime should be short against its speeds. the scaling mode sizes it as it sizes played
 * particles ({@link particleStandInMatrix}) and moves the shape's centre as {@link particleEmitterMatrix}
 * does.
 *
 * @param system the emitter's `ParticleSystem`
 * @param renderer its `ParticleSystemRenderer`
 * @param parent the emitter's parent's world matrix
 * @param emitter the emitter's local transform
 * @returns the particle mesh's world matrix, or `null` when the system doesn't keep a single mesh particle
 *   from awake in a fixed orientation and look (camera-facing alignment, velocity alignment without a box
 *   shape, several particles, curves, a texture sheet)
 */
export const frozenParticleMatrix = (
	system: TypeTreeObject,
	renderer: TypeTreeObject,
	parent: Float32Array,
	emitter: LocalTransform,
): Float32Array | null => {
	const initial = objectField(system, 'InitialModule');
	const shape = objectField(system, 'ShapeModule');
	if (
		numberField(renderer, 'm_RenderMode') !== RENDER_MODE_MESH ||
		// ring buffer mode 0 lets particles die at the end of their lifetime
		numberField(system, 'ringBufferMode') === 0 ||
		!booleanField(system, 'playOnAwake') ||
		numberField(initial, 'maxNumParticles') !== 1 ||
		// a flipbook changes the particle's tile as it ages, which a still mesh can't show
		(isObject(system['UVModule']) && booleanField(system['UVModule'], 'enabled'))
	) {
		return null;
	}
	const scalingMode = numberField(system, 'scalingMode');
	// the emitter's axes, each as long as the scale that sizes its particles
	const sizing = particleStandInMatrix(parent, emitter, scalingMode);
	let frame: Float32Array;
	switch (numberField(renderer, 'm_RenderAlignment')) {
		case Alignment.World: {
			// the world's axes, keeping the sizing scale
			const lengths = [0, 1, 2].map((axis) =>
				Math.hypot(sizing[axis * 4], sizing[axis * 4 + 1], sizing[axis * 4 + 2]),
			);
			frame = trsMatrix([0, 0, 0], [0, 0, 0, 1], lengths);
			break;
		}
		case Alignment.Local: {
			frame = sizing;
			break;
		}
		case Alignment.Velocity: {
			// a box sends its particles along the emitter's forward axis, so they face where the emitter does
			if (!booleanField(shape, 'enabled') || numberField(shape, 'type') !== SHAPE_BOX) {
				return null;
			}
			frame = sizing;
			break;
		}
		default: {
			return null;
		}
	}
	const sizes = booleanField(initial, 'size3D')
		? ['startSize', 'startSizeY', 'startSizeZ']
		: ['startSize', 'startSize', 'startSize'];
	const angles = booleanField(initial, 'rotation3D')
		? ['startRotationX', 'startRotationY', 'startRotation']
		: [null, null, 'startRotation'];
	const size: number[] = [];
	for (const name of sizes) {
		const value = curveValue(objectField(initial, name));
		if (value === null) {
			return null;
		}
		size.push(value);
	}
	const degrees: number[] = [];
	for (const name of angles) {
		const value = name === null ? 0 : curveValue(objectField(initial, name));
		if (value === null) {
			return null;
		}
		degrees.push((value * 180) / Math.PI);
	}
	// the shape's centre moves with the emitter's matrix, as played particles do
	const [x, y, z] = booleanField(shape, 'enabled') ? vector3Field(shape, 'm_Position') : [0, 0, 0];
	const moving = particleEmitterMatrix(parent, emitter, scalingMode);
	const placed = Float32Array.from(frame);
	for (let r = 0; r < 3; r++) {
		placed[12 + r] = moving[r] * x + moving[4 + r] * y + moving[8 + r] * z + moving[12 + r];
	}
	return multiplyMatrices(placed, trsMatrix([0, 0, 0], unityEulerQuaternion(degrees), size));
};
