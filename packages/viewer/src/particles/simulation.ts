import {
	CurveMode,
	GRAVITY,
	type MinMaxCurveInfo,
	type ParticleDragInfo,
	type ParticleForcesInfo,
	type ParticleVelocityInfo,
	ParticleShapeKind,
	type ParticleSpeedLimitInfo,
	type ParticleSystemInfo,
} from '@endfield-noclip/package-format/particles';

import { linearRgb } from '../math/color.ts';
import type { Vec3 } from '../scene/camera.ts';

import { evaluateMinMax, evaluateMinMaxGradient, meanOf, upperBound } from './curves.ts';
import { applyForces, type ForceRandoms, type PreparedField, prepareField } from './forces.ts';
import {
	dragged,
	draggedFall,
	integrateAge,
	type SteppedState,
	splinePoint,
	steppedPath,
	travelled,
} from './motion.ts';
import { Channel, hash2, random } from './random.ts';
import { sheetTile } from './texture-sheet.ts';
import { eulerQuaternion, normalize, rotate, rotateBy, unitVector } from './vector-math.ts';

/**
 * floats per particle in {@link ParticleSimulation.evaluate}'s output: position, rotation (xyzw), size, the
 * texture sheet's tile (0 without a sheet), colour (linear rgb, alpha), velocity (m/s), all in the emitter's
 * frame, then its custom data (`ParticleSystemInfo.customData`, zero without)
 */
export const PARTICLE_FLOATS = 22;

/** where each value starts in a particle's {@link PARTICLE_FLOATS} */
export const ParticleFloat = {
	position: 0,
	rotation: 3,
	size: 7,
	tile: 10,
	color: 11,
	velocity: 15,
	custom: 18,
} as const;

/** the most particles one emitter shows */
export const MAX_PARTICLES = 1024;

/**
 * @param lived a ring-buffered particle's age over its lifetime, which can pass 1
 * @param loopRange the span of the lifetime it replays once it reaches the span's end, or `null` to hold it
 *   at the end of its lifetime
 * @returns the age over its lifetime it shows
 */
export const ringBufferAge = (lived: number, loopRange: readonly [number, number] | null): number => {
	if (loopRange === null) {
		return Math.min(lived, 1);
	}
	const [start, end] = loopRange;
	if (lived <= end) {
		return lived;
	}
	const span = end - start;
	return span > 0 ? start + ((lived - end) % span) : end;
};

/** one emission: when (system time) and which particle */
interface Emission {
	time: number;
	id: number;
}

interface AdmittedEmission extends Emission {
	/** s */
	life: number;
}

/** what a freely moving particle's path starts from, in the emitter's frame */
interface PathStart {
	id: number;
	start: Vec3;
	direction: Vec3;
	/** m/s along {@link direction} */
	speed: number;
	/** the velocity module's speed modifier, 1 when it's a curve ({@link modifierAt}) */
	modifier: number;
	/**
	 * a speed modifier curve at an age, s, which `speed` leaves out; `null` when it's constant. the packer
	 * leaves such systems without a speed limit or drag
	 */
	modifierAt: ((age: number) => number) | null;
	/** m/s² along {@link down} */
	gravity: number;
	/** seconds */
	age: number;
	life: number;
	down: Vec3;
	worldToLocal: (direction: Vec3) => Vec3;
}

/**
 * a system's particles over time, for one emitter
 *
 * @see ParticleField for the emitter's frame
 */
export class ParticleSimulation {
	readonly info: ParticleSystemInfo;
	readonly #seed: number;
	/** seconds before the first emission, drawn once per emitter as the game draws it once per play */
	readonly #startDelay: number;
	/** the longest a particle lives, s */
	readonly #longest: number;
	/** how far back emissions can still be alive, s: their lifetime, or until enough newer ones replace them */
	readonly #lookback: number;
	/** particles per second */
	readonly #rate: number;
	readonly #meshTotal: number;
	readonly #shapeRotation: [number, number, number, number];
	readonly #emissions: Emission[] = [];
	/** whether the cap can turn emissions away, so that which particles live depends on what came before */
	readonly #capped: boolean;
	/** the emissions the cap let in that may still be alive, oldest first */
	#admitted: AdmittedEmission[] = [];
	/** the system time {@link #admitted} has been played to */
	#admittedUntil = -Infinity;
	/** the force fields, prepared; `null` without */
	readonly #forces: { multiplier: MinMaxCurveInfo; fields: PreparedField[] } | null;
	/**
	 * where each stepped particle drawn last frame had got to, so the next frame steps on from there rather
	 * than from its birth
	 */
	#stepped = new Map<number, SteppedState>();
	/** the stepped particles placed during the current {@link evaluate} */
	#steppedNow = new Map<number, SteppedState>();

	/**
	 * @param info the system
	 * @param seed the emitter's random seed; emitters drawing other meshes of the same renderer share it
	 */
	constructor(info: ParticleSystemInfo, seed: number) {
		this.info = info;
		this.#seed = seed;
		this.#startDelay = Math.max(evaluateMinMax(info.startDelay, 0, random(seed, 0, Channel.StartDelay)), 0);
		this.#longest = Math.max(upperBound(info.startLifetime), 0);
		this.#rate = Math.max(meanOf(info.rate), 0);
		this.#lookback = this.#longest;
		if (info.ringBuffer !== null) {
			// the newest `maxParticles` emissions stay; look back far enough to find that many
			const burstsPerLoop = info.bursts.reduce(
				(sum, burst) => sum + Math.max(upperBound(burst.count), 0) * burst.cycles * burst.probability,
				0,
			);
			const perSecond = this.#rate + burstsPerLoop / info.duration;
			const kept = Math.min(info.maxParticles, MAX_PARTICLES) + 1;
			if (!info.looping) {
				this.#lookback = Infinity;
			} else if (perSecond > 0) {
				this.#lookback = Math.max(this.#longest, kept / perSecond + info.duration);
			}
		}
		this.#capped = info.ringBuffer === null && info.emissionBound > info.maxParticles;
		this.#meshTotal = info.meshWeights.reduce((sum, weight) => sum + weight, 0);
		const forces: ParticleForcesInfo | null = info.motion.kind === 'free' ? info.motion.forces : null;
		this.#forces =
			forces === null ? null : { multiplier: forces.multiplier, fields: forces.fields.map(prepareField) };
		const rotation = info.shape?.rotation ?? [0, 0, 0];
		this.#shapeRotation = eulerQuaternion(
			(rotation[0] * Math.PI) / 180,
			(rotation[1] * Math.PI) / 180,
			(rotation[2] * Math.PI) / 180,
		);
	}

	/** seconds a looping system needs to look as if it had always played */
	get settleTime(): number {
		return this.#startDelay + this.#lookback + this.info.duration;
	}

	/** the most particles alive at once: the cap, or less when one lifetime of emission holds fewer */
	get liveBound(): number {
		const { maxParticles, ringBuffer } = this.info;
		if (ringBuffer !== null) {
			return maxParticles;
		}
		return Math.min(maxParticles, this.info.emissionBound);
	}

	/**
	 * the live particles that draw this entry's mesh at a system time, newest last.
	 *
	 * @param time seconds of system time (the viewer's time times the simulation speed)
	 * @param down world down in the emitter's frame, unit length per metre of world (gravity's direction)
	 * @param worldToLocal turns a world direction into the emitter's frame (for world-space velocities)
	 * @param out {@link PARTICLE_FLOATS} floats per particle: position in the emitter's frame, rotation, size,
	 *   texture sheet tile
	 * @returns how many particles were written (at most `out.length / PARTICLE_FLOATS`)
	 */
	evaluate(time: number, down: Vec3, worldToLocal: (direction: Vec3) => Vec3, out: Float32Array): number {
		const emissions = this.#capped ? this.#admit(time) : this.#emitted(time - this.#lookback, time);
		this.#steppedNow.clear();
		const capacity = Math.floor(out.length / PARTICLE_FLOATS);
		const ringBuffer = this.info.ringBuffer;
		let count = 0;
		// with a ring buffer the newest particles win when there are more than the system allows
		let alive = 0;
		for (let i = emissions.length - 1; i >= 0 && alive < this.info.maxParticles && count < capacity; i--) {
			const { time: born, id } = emissions[i];
			let age = time - born;
			const life = this.#lifetime(emissions[i]);
			if (age < 0 || (ringBuffer === null && age >= life)) {
				continue;
			}
			// a paused particle holds its age but keeps moving, as the game goes on stepping it; a looping one
			// replays its path with its age
			let moved = age;
			if (ringBuffer !== null && life > 0) {
				age = life * ringBufferAge(age / life, ringBuffer.loop ? ringBuffer.loopRange : null);
				if (ringBuffer.loop) {
					moved = age;
				}
			}
			// a particle that runs off its path's end is gone
			if (this.#splineAt(id, age, life) === null) {
				continue;
			}
			alive++;
			if (this.#drawsMesh(id)) {
				this.#place(id, born, { age, moved }, down, worldToLocal, out, count * PARTICLE_FLOATS);
				count++;
			}
		}
		// keep only the particles still drawn
		[this.#stepped, this.#steppedNow] = [this.#steppedNow, this.#stepped];
		return count;
	}

	/**
	 * @returns where a particle is along the system's path and how it moves there, in the path's frame:
	 *   `undefined` without a path, `null` once it has run off the end
	 */
	#splineAt(id: number, age: number, life: number): { position: Vec3; moving: Vec3 } | null | undefined {
		const spline = this.info.motion;
		if (spline.kind !== 'spline') {
			return undefined;
		}
		const r = random(this.#seed, id, Channel.SplineSpeed);
		const point = splinePoint(spline, travelled(spline.speed, age, life, r));
		if (point === null) {
			return null;
		}
		const speed = evaluateMinMax(spline.speed, life > 0 ? Math.min(age / life, 1) : 0, r);
		const t = point.tangent;
		return { position: point.position, moving: [t[0] * speed, t[1] * speed, t[2] * speed] };
	}

	/** @returns how long an emission's particle lives, s */
	#lifetime({ time, id }: Emission): number {
		return evaluateMinMax(
			this.info.startLifetime,
			this.#loopFraction(time),
			random(this.#seed, id, Channel.Lifetime),
		);
	}

	/**
	 * plays the cap forward to `time`: an emission is let in only while fewer than the cap are alive, as the
	 * game skips emissions once the system is full. the result depends on every earlier emission, so it's kept
	 * between calls and played from where it stopped.
	 *
	 * @returns the admitted emissions that may still be alive, oldest first
	 */
	#admit(time: number): AdmittedEmission[] {
		const { maxParticles } = this.info;
		const startDelay = this.#startDelay;
		// further back than a few lifetimes the history barely shows, so a long jump or a step back starts
		// afresh from an empty system there
		const horizon = 4 * this.#longest + this.info.duration;
		let after = this.#admittedUntil;
		if (time < after || time - after > horizon) {
			this.#admitted = [];
			after = Math.max(startDelay, time - horizon) - 1e-9;
		}
		// the stream's emissions per window are capped, so play in steps that hold them all
		const step = Math.max(
			this.#rate > 0 ? Math.min(this.#longest, MAX_PARTICLES / this.#rate) : this.#longest,
			1e-3,
		);
		let admitted = this.#admitted;
		while (after < time) {
			const to = Math.min(time, after + step);
			for (const emission of this.#emitted(after, to)) {
				if (emission.time <= after) {
					continue;
				}
				let alive = 0;
				for (const other of admitted) {
					if (other.time + other.life > emission.time) {
						alive++;
					}
				}
				if (alive < maxParticles) {
					admitted.push({ ...emission, life: this.#lifetime(emission) });
				}
			}
			admitted = admitted.filter((emission) => emission.time + emission.life > to);
			after = to;
		}
		this.#admitted = admitted;
		this.#admittedUntil = time;
		return admitted;
	}

	/** the emissions in a window of system time whose particles could be alive at its end */
	#emitted(start: number, time: number): Emission[] {
		const emissions = this.#emissions;
		emissions.length = 0;
		const { duration, looping, bursts } = this.info;
		const startDelay = this.#startDelay;
		const from = Math.max(start, startDelay);
		const end = looping ? time : Math.min(time, startDelay + duration);
		if (end < from) {
			return emissions;
		}
		// bursts first, then the rate's steady stream, each with ids of their own
		for (const [b, burst] of bursts.entries()) {
			const firstLoop = looping
				? Math.max(0, Math.floor((from - startDelay - burst.time) / duration) - 1)
				: 0;
			const lastLoop = looping ? Math.floor((end - startDelay) / duration) : 0;
			for (let loop = firstLoop; loop <= lastLoop; loop++) {
				for (let cycle = 0; cycle < burst.cycles; cycle++) {
					const offset = burst.time + cycle * burst.interval;
					const at = startDelay + loop * duration + offset;
					if (offset > duration || at < from || at > end) {
						continue;
					}
					const event = hash2(hash2(b, loop), cycle);
					if (random(this.#seed, event, Channel.Burst) >= burst.probability) {
						continue;
					}
					const count = Math.round(
						evaluateMinMax(burst.count, offset / duration, random(this.#seed, event, 0)),
					);
					for (let j = 0; j < Math.min(count, MAX_PARTICLES); j++) {
						emissions.push({ time: at, id: hash2(event, j) | 1 });
					}
				}
			}
		}
		emissions.sort((a, b) => a.time - b.time);
		if (this.#rate > 0) {
			const first = Math.max(0, Math.ceil((from - startDelay) * this.#rate));
			const last = Math.floor((end - startDelay) * this.#rate);
			for (let k = Math.max(first, last - MAX_PARTICLES); k <= last; k++) {
				// even ids for the stream, odd for bursts
				emissions.push({ time: startDelay + k / this.#rate, id: (k * 2) >>> 0 });
			}
		}
		emissions.sort((a, b) => a.time - b.time);
		return emissions;
	}

	/** @returns the emission time's place within its loop, 0–1, where start values read their curves */
	#loopFraction(born: number): number {
		const t = (born - this.#startDelay) / this.info.duration;
		return this.info.looping ? t - Math.floor(t) : Math.min(Math.max(t, 0), 1);
	}

	/** whether a particle picked this entry's mesh */
	#drawsMesh(id: number): boolean {
		const weights = this.info.meshWeights;
		if (weights.length <= 1) {
			return true;
		}
		let pick = random(this.#seed, id, Channel.Mesh) * this.#meshTotal;
		for (const [i, weight] of weights.entries()) {
			pick -= weight;
			if (pick < 0) {
				return i === this.info.mesh;
			}
		}
		return weights.length - 1 === this.info.mesh;
	}

	/** where a particle starts and which way it leaves, in the emitter's frame */
	#start(id: number): { position: Vec3; direction: Vec3 } {
		const shape = this.info.shape;
		if (shape === null) {
			return { position: [0, 0, 0], direction: [0, 0, 1] };
		}
		const r0 = random(this.#seed, id, Channel.Shape0);
		const r1 = random(this.#seed, id, Channel.Shape1);
		const r2 = random(this.#seed, id, Channel.Shape2);
		const inner = 1 - Math.min(Math.max(shape.radiusThickness, 0), 1);
		let position: Vec3;
		let direction: Vec3;
		switch (shape.kind) {
			case ParticleShapeKind.Sphere:
			case ParticleShapeKind.Hemisphere: {
				direction = unitVector(r0, r1);
				if (shape.kind === ParticleShapeKind.Hemisphere) {
					direction[2] = Math.abs(direction[2]);
				}
				// uniform in the shell's volume
				const radius = shape.radius * Math.cbrt(inner ** 3 + (1 - inner ** 3) * r2);
				position = [direction[0] * radius, direction[1] * radius, direction[2] * radius];
				break;
			}
			case ParticleShapeKind.Cone:
			case ParticleShapeKind.ConeVolume:
			case ParticleShapeKind.Circle: {
				const phi = (r0 * shape.arc * Math.PI) / 180;
				// uniform in the ring's area
				const rho = Math.sqrt(inner * inner + (1 - inner * inner) * r1);
				const c = Math.cos(phi);
				const s = Math.sin(phi);
				position = [rho * shape.radius * c, rho * shape.radius * s, 0];
				if (shape.kind === ParticleShapeKind.Circle) {
					direction = [c, s, 0];
					break;
				}
				// towards the matching point on the cone's far end
				const spread = rho * Math.tan((shape.angle * Math.PI) / 180);
				direction = normalize([spread * c, spread * s, 1]);
				if (shape.kind === ParticleShapeKind.ConeVolume) {
					const along = (shape.length * r2) / direction[2];
					position = [
						position[0] + direction[0] * along,
						position[1] + direction[1] * along,
						position[2] + direction[2] * along,
					];
				}
				break;
			}
			case ParticleShapeKind.Box: {
				position = [r0 - 0.5, r1 - 0.5, r2 - 0.5];
				direction = [0, 0, 1];
				break;
			}
			case ParticleShapeKind.Donut: {
				// a point of the circle, then one of the tube's cross-section around it, uniform in its area
				const phi = (r0 * shape.arc * Math.PI) / 180;
				const theta = 2 * Math.PI * r1;
				const rho = shape.donutRadius * Math.sqrt(inner * inner + (1 - inner * inner) * r2);
				const out: Vec3 = [Math.cos(phi), Math.sin(phi), 0];
				direction = [out[0] * Math.cos(theta), out[1] * Math.cos(theta), Math.sin(theta)];
				position = [
					out[0] * shape.radius + direction[0] * rho,
					out[1] * shape.radius + direction[1] * rho,
					direction[2] * rho,
				];
				break;
			}
		}
		position = rotate(this.#shapeRotation, [
			position[0] * shape.scale[0],
			position[1] * shape.scale[1],
			position[2] * shape.scale[2],
		]);
		position = [
			position[0] + shape.position[0],
			position[1] + shape.position[1],
			position[2] + shape.position[2],
		];
		direction = normalize(
			rotate(this.#shapeRotation, [
				direction[0] * shape.scale[0],
				direction[1] * shape.scale[1],
				direction[2] * shape.scale[2],
			]),
		);
		if (shape.randomDirection > 0) {
			const away = unitVector(
				random(this.#seed, id, Channel.Direction0),
				random(this.#seed, id, Channel.Direction1),
			);
			const a = shape.randomDirection;
			direction = normalize([
				direction[0] + (away[0] - direction[0]) * a,
				direction[1] + (away[1] - direction[1]) * a,
				direction[2] + (away[2] - direction[2]) * a,
			]);
		}
		if (shape.sphericalDirection > 0) {
			const out = normalize([
				position[0] - shape.position[0],
				position[1] - shape.position[1],
				position[2] - shape.position[2],
			]);
			const a = shape.sphericalDirection;
			direction = normalize([
				direction[0] + (out[0] - direction[0]) * a,
				direction[1] + (out[1] - direction[1]) * a,
				direction[2] + (out[2] - direction[2]) * a,
			]);
		}
		if (shape.randomPosition > 0) {
			const a = shape.randomPosition * 2;
			position = [
				position[0] + (random(this.#seed, id, Channel.Position0) - 0.5) * a,
				position[1] + (random(this.#seed, id, Channel.Position1) - 0.5) * a,
				position[2] + (random(this.#seed, id, Channel.Position2) - 0.5) * a,
			];
		}
		return { position, direction };
	}

	/** where an unlimited particle is at an age and how it moves then, in closed form */
	#freePath(
		drag: ParticleDragInfo | null,
		velocity: ParticleVelocityInfo | null,
		motion: PathStart & { startSize: number[] },
	): { position: Vec3; moving: Vec3 } {
		const seed = this.#seed;
		const {
			id,
			start,
			direction,
			speed,
			modifier,
			modifierAt,
			gravity,
			startSize,
			age,
			life,
			down,
			worldToLocal,
		} = motion;
		// a ring buffer's paused particle moves on past its lifetime with its curves at their end
		const lived = life > 0 ? Math.min(age / life, 1) : 0;
		// the game moves a particle by its whole velocity times the speed modifier: `scaledAge` is the modifier's
		// integral over the age, which a constant velocity moves by, and `scaleNow` its value now
		const scaledAge = modifierAt === null ? age : integrateAge(modifierAt, age);
		const scaleNow = modifierAt === null ? 1 : modifierAt(age);
		const [launch, launchSpeed] =
			drag === null
				? [speed * scaledAge, speed * scaleNow]
				: dragged(drag, speed, Math.max(...startSize), age, random(seed, id, Channel.Drag));
		const [fall, fallSpeed] =
			drag === null
				? [0.5 * gravity * age * age, gravity * age]
				: draggedFall(drag, gravity, Math.max(...startSize), age, random(seed, id, Channel.Drag));
		let position: Vec3 = [
			start[0] + direction[0] * launch + down[0] * fall,
			start[1] + direction[1] * launch + down[1] * fall,
			start[2] + direction[2] * launch + down[2] * fall,
		];
		let moving: Vec3 = [
			direction[0] * launchSpeed + down[0] * fallSpeed,
			direction[1] * launchSpeed + down[1] * fallSpeed,
			direction[2] * launchSpeed + down[2] * fallSpeed,
		];
		if (velocity !== null) {
			const channels = [Channel.VelocityX, Channel.VelocityY, Channel.VelocityZ];
			let linear: Vec3 = [0, 0, 0];
			let linearNow: Vec3 = [0, 0, 0];
			for (let axis = 0; axis < 3; axis++) {
				const r = random(seed, id, channels[axis]);
				linear[axis] = travelled(velocity.linear[axis], age, life, r, modifierAt ?? undefined);
				linearNow[axis] = evaluateMinMax(velocity.linear[axis], lived, r) * scaleNow;
			}
			if (velocity.linearInWorld) {
				linear = worldToLocal(linear);
				linearNow = worldToLocal(linearNow);
			}
			const offset = velocity.orbitalOffset;
			const radialRandom = random(seed, id, Channel.Radial);
			const radialSpeed = evaluateMinMax(velocity.radial, lived, radialRandom) * modifier * scaleNow;
			const radial = travelled(velocity.radial, age, life, radialRandom, modifierAt ?? undefined) * modifier;
			const outward = normalize([start[0] - offset[0], start[1] - offset[1], start[2] - offset[2]]);
			position = [
				position[0] + linear[0] * modifier + outward[0] * radial,
				position[1] + linear[1] * modifier + outward[1] * radial,
				position[2] + linear[2] * modifier + outward[2] * radial,
			];
			moving = [
				moving[0] + linearNow[0] * modifier + outward[0] * radialSpeed,
				moving[1] + linearNow[1] * modifier + outward[1] * radialSpeed,
				moving[2] + linearNow[2] * modifier + outward[2] * radialSpeed,
			];
			// the orbit turns the particle about the offset by its rate's integral over the age; applied to the whole
			// path, which is exact when the other motion runs along the orbit's axis (the crater rocks rise along
			// theirs)
			const angle = (axis: number, channel: number): number =>
				travelled(velocity.orbital[axis], age, life, random(seed, id, channel), modifierAt ?? undefined) *
				modifier;
			const turn: Vec3 = [angle(0, Channel.OrbitalX), angle(1, Channel.OrbitalY), angle(2, Channel.OrbitalZ)];
			const turned = rotateBy(turn, [
				position[0] - offset[0],
				position[1] - offset[1],
				position[2] - offset[2],
			]);
			position = [turned[0] + offset[0], turned[1] + offset[1], turned[2] + offset[2]];
		}
		return { position, moving };
	}

	/**
	 * where a particle under a speed limit or force fields is at an age and how it moves then, stepped ({@link
	 * steppedPath}). the velocity module's linear, orbital and radial terms are the extra velocity the limit
	 * includes; the orbit moves the particle along its circle's tangent at its current place. the packer leaves
	 * such systems without drag
	 */
	#steppedPath(
		limit: ParticleSpeedLimitInfo | null,
		velocity: ParticleVelocityInfo | null,
		motion: PathStart & { sizeAt: (age: number) => number },
	): { position: Vec3; moving: Vec3 } {
		const seed = this.#seed;
		const { id, start, direction, speed, modifier, gravity, age, life, down, worldToLocal, sizeAt } = motion;
		const forces = this.#forces;
		let push: ((age: number, moved: Vec3, own: Vec3, step: number) => void) | null = null;
		if (forces !== null) {
			const r = (channel: number) => random(seed, id, channel);
			const randoms: ForceRandoms = {
				multiplier: r(Channel.ForceMultiplier),
				tiltX: r(Channel.ForceTiltX),
				tiltZ: r(Channel.ForceTiltZ),
				direction: [r(Channel.ForceDirectionX), r(Channel.ForceDirectionY), r(Channel.ForceDirectionZ)],
				gravity: r(Channel.ForceGravity),
				spin: r(Channel.ForceSpin),
				attraction: r(Channel.ForceAttraction),
				drag: r(Channel.ForceDrag),
			};
			push = (t, moved, own, step) => {
				const at: Vec3 = [start[0] + moved[0], start[1] + moved[1], start[2] + moved[2]];
				applyForces(forces, at, own, life > 0 ? Math.min(t / life, 1) : 0, sizeAt(t), randoms, step);
			};
		}
		const linearChannels = [Channel.VelocityX, Channel.VelocityY, Channel.VelocityZ];
		const linearRandoms = linearChannels.map((channel) => random(seed, id, channel));
		const orbitChannels = [Channel.OrbitalX, Channel.OrbitalY, Channel.OrbitalZ];
		const orbitRandoms = orbitChannels.map((channel) => random(seed, id, channel));
		const radialRandom = random(seed, id, Channel.Radial);
		const extra = (t: number, moved: Vec3): Vec3 => {
			if (velocity === null) {
				return [0, 0, 0];
			}
			const lived = life > 0 ? Math.min(t / life, 1) : 0;
			let linear: Vec3 = [0, 0, 0];
			const spin: Vec3 = [0, 0, 0];
			for (let axis = 0; axis < 3; axis++) {
				linear[axis] = evaluateMinMax(velocity.linear[axis], lived, linearRandoms[axis]) * modifier;
				spin[axis] = evaluateMinMax(velocity.orbital[axis], lived, orbitRandoms[axis]) * modifier;
			}
			const radial = evaluateMinMax(velocity.radial, lived, radialRandom) * modifier;
			if (velocity.linearInWorld) {
				linear = worldToLocal(linear);
			}
			const centre = velocity.orbitalOffset;
			const from: Vec3 = [
				start[0] + moved[0] - centre[0],
				start[1] + moved[1] - centre[1],
				start[2] + moved[2] - centre[2],
			];
			const outward = normalize(from);
			// ω × r, the orbit's velocity at the particle's place
			return [
				linear[0] + spin[1] * from[2] - spin[2] * from[1] + outward[0] * radial,
				linear[1] + spin[2] * from[0] - spin[0] * from[2] + outward[1] * radial,
				linear[2] + spin[0] * from[1] - spin[1] * from[0] + outward[2] * radial,
			];
		};
		const {
			offset,
			velocity: moving,
			state,
		} = steppedPath({
			limit: limit === null ? null : { info: limit, r: random(seed, id, Channel.SpeedLimit) },
			start: [direction[0] * speed, direction[1] * speed, direction[2] * speed],
			acceleration: [down[0] * gravity, down[1] * gravity, down[2] * gravity],
			push,
			extra,
			age,
			life,
			from: this.#stepped.get(id),
		});
		this.#steppedNow.set(id, state);
		return { position: [start[0] + offset[0], start[1] + offset[1], start[2] + offset[2]], moving };
	}

	/** writes one live particle */
	/**
	 * writes one live particle
	 *
	 * @param ages the age its curves read and the age it has moved for, s: they differ for a ring buffer's
	 *   paused particle, which holds its age and moves on
	 */
	#place(
		id: number,
		born: number,
		ages: { age: number; moved: number },
		down: Vec3,
		worldToLocal: (direction: Vec3) => Vec3,
		out: Float32Array,
		at: number,
	): void {
		const info = this.info;
		const seed = this.#seed;
		const { age, moved } = ages;
		const u = this.#loopFraction(born);
		const life = evaluateMinMax(info.startLifetime, u, random(seed, id, Channel.Lifetime));
		const { position: start, direction } = this.#start(id);
		const lived = life > 0 ? age / life : 0;
		const sizeRandom = random(seed, id, Channel.Size);
		const growth = random(seed, id, Channel.SizeOverLifetime);
		const startSize = info.startSize.map((curve) => evaluateMinMax(curve, u, sizeRandom));
		const sizeAt = (a: number): number[] =>
			startSize.map((value, axis) => {
				const over = info.sizeOverLifetime;
				return (
					value *
					(over === null ? 1 : evaluateMinMax(over[axis], life > 0 ? Math.min(a / life, 1) : 0, growth))
				);
			});
		let path: { position: Vec3; moving: Vec3 };
		const motion = info.motion;
		if (motion.kind === 'spline') {
			// a path's particles start at their place in the shape, offset from it
			const along = this.#splineAt(id, age, life) ?? { position: [0, 0, 0], moving: [0, 0, 0] };
			path = {
				position: [start[0] + along.position[0], start[1] + along.position[1], start[2] + along.position[2]],
				moving: along.moving,
			};
		} else {
			const { velocity, clamp } = motion;
			let modifier = 1;
			let modifierAt: ((age: number) => number) | null = null;
			if (velocity !== null) {
				const curve = velocity.speedModifier;
				const r = random(seed, id, Channel.SpeedModifier);
				if (curve.mode === CurveMode.Constant || curve.mode === CurveMode.TwoConstants) {
					modifier = evaluateMinMax(curve, 0, r);
				} else {
					// the game reads it each step at the particle's age over its lifetime, as linear velocities
					modifierAt = (a) => evaluateMinMax(curve, life > 0 ? Math.min(a / life, 1) : 0, r);
				}
			}
			const begin: PathStart = {
				id,
				start,
				direction,
				speed: evaluateMinMax(motion.startSpeed, u, random(seed, id, Channel.Speed)) * modifier,
				modifier,
				modifierAt,
				// gravity, which Unity always pulls down the world's y
				gravity: GRAVITY * evaluateMinMax(motion.gravityModifier, u, random(seed, id, Channel.Gravity)),
				age: moved,
				life,
				down,
				worldToLocal,
			};
			if (clamp?.kind === 'limit' || motion.forces !== null) {
				// drag by size reads the first axis' size
				path = this.#steppedPath(clamp?.kind === 'limit' ? clamp : null, velocity, {
					...begin,
					sizeAt: (a) => sizeAt(a)[0],
				});
			} else {
				path = this.#freePath(clamp, velocity, { ...begin, startSize });
			}
		}
		const { position, moving } = path;

		const size = sizeAt(age);

		const angles = info.startRotation.map((curve, axis) =>
			evaluateMinMax(curve, u, random(seed, id, Channel.RotationX + axis)),
		);
		const spin = info.rotationOverLifetime;
		if (spin !== null) {
			// a paused particle keeps spinning at its last rate
			for (let axis = 0; axis < 3; axis++) {
				angles[axis] += travelled(spin[axis], moved, life, random(seed, id, Channel.SpinX + axis));
			}
		}
		const rotation = eulerQuaternion(angles[0], angles[1], angles[2]);
		let color = evaluateMinMaxGradient(info.startColor, u, random(seed, id, Channel.Color));
		if (info.colorOverLifetime !== null) {
			const over = evaluateMinMaxGradient(
				info.colorOverLifetime,
				Math.min(lived, 1),
				random(seed, id, Channel.ColorOverLifetime),
			);
			color = [color[0] * over[0], color[1] * over[1], color[2] * over[2], color[3] * over[3]];
		}
		out.set(position, at + ParticleFloat.position);
		out.set(rotation, at + ParticleFloat.rotation);
		out.set(size, at + ParticleFloat.size);
		out[at + ParticleFloat.tile] =
			info.textureSheet === null
				? 0
				: sheetTile(info.textureSheet, lived, age, u, (channel) => random(seed, id, channel), info.mesh);
		out.set(linearRgb(color), at + ParticleFloat.color);
		out[at + ParticleFloat.color + 3] = color[3];
		out.set(moving, at + ParticleFloat.velocity);
		// read every frame at the age over the lifetime, each component's random fixed for the particle's life
		const custom = info.customData;
		for (let c = 0; c < 4; c++) {
			const curve = custom?.[c] ?? null;
			out[at + ParticleFloat.custom + c] =
				curve === null ? 0 : evaluateMinMax(curve, Math.min(lived, 1), random(seed, id, Channel.CustomX + c));
		}
	}
}
