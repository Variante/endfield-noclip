/**
 * draws the sky beyond the atmosphere ({@link CelestialLook}) at the sky pixels in the celestial pass
 * (celestial.wgsl), for the composite to put over the atmosphere's sky. the uniforms are written each frame,
 * since the ray-traced planet is placed relative to the camera.
 *
 * @module
 */

import {
	CELESTIAL_TEXTURE_SLOTS,
	type CelestialLook,
	type CelestialTextureSlot,
	NO_CELESTIAL,
} from '../../environment/celestial-look.ts';
import type { Vec3 } from '../../scene/camera.ts';
import { placeholderView, type TextureBinding } from '../textures/texture-store.ts';

/** byte size of `Celestial` in celestial.wgsl */
const UNIFORM_BYTES = (11 + 19 + 2 * 13 + 2) * 16;
const STAR_OFFSET = 4 * 4;
const RAY_OFFSET = 11 * 4;
const SKY_OFFSET = (11 + 19) * 4;
const SKY_STRIDE = 13 * 4;
const SUN_OFFSET = (11 + 19 + 2 * 13) * 4;

/** owns the celestial pass's group 1: its uniforms, samplers and bound textures */
export class CelestialLayer {
	#device: GPUDevice;
	#uniforms: GPUBuffer;
	#data = new Float32Array(UNIFORM_BYTES / 4);
	#words = new Uint32Array(this.#data.buffer);
	#sampler: GPUSampler;
	#pointSampler: GPUSampler;
	/** black, for slots without a texture */
	#black: GPUTextureView;
	#views = new Map<CelestialTextureSlot, GPUTextureView>();
	#look: CelestialLook = NO_CELESTIAL;
	#group: { layout: GPUBindGroupLayout; group: GPUBindGroup } | null = null;

	/** @param device the device */
	constructor(device: GPUDevice) {
		this.#device = device;
		this.#uniforms = device.createBuffer({
			label: 'celestial uniforms',
			size: UNIFORM_BYTES,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		const sampler = (label: string, filter: GPUFilterMode): GPUSampler =>
			device.createSampler({
				label,
				magFilter: filter,
				minFilter: filter,
				mipmapFilter: filter,
				addressModeU: 'repeat',
				addressModeV: 'repeat',
			});
		this.#sampler = sampler('celestial', 'linear');
		this.#pointSampler = sampler('celestial clouds', 'nearest');
		this.#black = placeholderView(device, { label: 'no celestial texture', dimension: '2d' });
	}

	/** @param look what to draw */
	setLook(look: CelestialLook): void {
		this.#look = look;
	}

	/**
	 * binds the textures as they stream in; a slot whose texture isn't resident yet draws nothing of its body
	 *
	 * @param binding gives each slot's binding, or `null`
	 */
	setTextures(binding: (slot: CelestialTextureSlot) => TextureBinding | null): void {
		let changed = false;
		for (const slot of CELESTIAL_TEXTURE_SLOTS) {
			const view = binding(slot)?.view ?? this.#black;
			if (this.#views.get(slot) !== view) {
				this.#views.set(slot, view);
				changed = true;
			}
		}
		if (changed) {
			this.#group = null;
		}
	}

	/**
	 * @param layout the celestial pipeline's group 1 layout
	 * @returns the group to bind there
	 */
	group(layout: GPUBindGroupLayout): GPUBindGroup {
		if (this.#group?.layout !== layout) {
			this.#group = {
				layout,
				group: this.#device.createBindGroup({
					label: 'celestial',
					layout,
					entries: [
						{ binding: 0, resource: { buffer: this.#uniforms } },
						{ binding: 1, resource: this.#sampler },
						{ binding: 2, resource: this.#pointSampler },
						...CELESTIAL_TEXTURE_SLOTS.map((slot, i) => ({
							binding: 3 + i,
							resource: this.#views.get(slot) ?? this.#black,
						})),
					],
				}),
			};
		}
		return this.#group.group;
	}

	/**
	 * writes the uniforms for a frame
	 *
	 * @param eye the camera's world position
	 * @param sun unit vector towards the scene's sun
	 * @param sunIlluminance its pre-exposed illuminance
	 */
	write(eye: Vec3, sun: Vec3, sunIlluminance: Vec3): void {
		const f = this.#data;
		const u = this.#words;
		f.fill(0);
		const look = this.#look;
		const has = (slot: CelestialTextureSlot): boolean =>
			(this.#views.get(slot) ?? this.#black) !== this.#black;
		const set = (index: number, values: readonly number[]): void => {
			f.set(values, index * 4);
		};

		const disc = look.sun;
		if (disc !== null) {
			u[5] = 1;
			f.set([...disc.direction, disc.ramp], SUN_OFFSET);
			f.set([...disc.color, disc.sharpness], SUN_OFFSET + 4);
		}

		const nebula = look.nebula;
		if (nebula !== null && has('nebula')) {
			u[0] = 1;
			set(2, [...nebula.tint, nebula.rotation]);
			set(3, [nebula.planetMask, 0, 0, 0]);
		}

		const stars = look.stars;
		if (stars !== null && has('starDensity')) {
			u[4] = 1;
			for (const [i, param] of stars.params.entries()) {
				f.set(param, STAR_OFFSET + i * 4);
			}
		}

		const ray = look.ray;
		if (ray !== null && has('rayBase') && has('rayRsm') && has('rayClouds') && has('rayLut')) {
			u[1] = 1;
			const r = RAY_OFFSET;
			// in f64 here: the planet is hundreds of kilometres away
			const origin = [eye[0] - ray.center[0], eye[1] - ray.center[1], eye[2] - ray.center[2]];
			const lightColor = ray.lightColor ?? sunIlluminance;
			f.set([...origin, ray.radius], r);
			f.set([ray.groundRadius, ray.topRadius, ray.cloudRadius, ray.viewSamples], r + 4);
			f.set([...ray.scaleHeights, ray.mieAnisotropy, ray.useLut ? 1 : 0], r + 8);
			f.set([...ray.rayleigh, ray.brightness], r + 12);
			f.set([...ray.mie, ray.cloudShadows ? 1 : 0], r + 16);
			f.set([...(ray.light ?? sun), 0], r + 20);
			f.set(
				lightColor.map((c) => c * ray.lightScale),
				r + 24,
			);
			f.set(ray.tilt[0], r + 28);
			f.set(ray.tilt[1], r + 32);
			f.set(ray.tilt[2], r + 36);
			f.set([ray.spin, ray.baseTransform[2], ray.baseTransform[0], ray.baseTransform[1]], r + 40);
			f.set(ray.tint, r + 44);
			f.set(ray.seaShallow, r + 48);
			f.set(ray.seaDeep, r + 52);
			f.set(ray.fresnel, r + 56);
			f.set(ray.indirect, r + 60);
			f.set(ray.cloudShadow, r + 64);
			f.set(ray.ambient, r + 68);
			f.set([ray.cloudAlpha, ray.cloudBrightness, ray.roughness, ray.roughnessFromMap ? 1 : 0], r + 72);
		}

		for (const [i, planet] of look.sky.entries()) {
			if (planet === null || !has(i === 0 ? 'sky0Main' : 'sky1Main')) {
				continue;
			}
			u[2 + i] = 1;
			const s = SKY_OFFSET + i * SKY_STRIDE;
			const atmosphere = planet.atmosphere;
			f.set([...planet.center, 1], s);
			f.set(planet.up, s + 4);
			f.set(planet.forward, s + 8);
			f.set(planet.right, s + 12);
			f.set([...planet.light, atmosphere === null ? 0 : 1], s + 16);
			f.set([planet.radius, ...planet.ring], s + 20);
			f.set([...planet.color, atmosphere?.unlit ?? 0], s + 24);
			f.set([...planet.emissive, planet.horizonFade], s + 28);
			f.set(planet.ringColor, s + 32);
			f.set([planet.sharpness, planet.backFace, planet.ringShadowSoftness, 0], s + 36);
			if (atmosphere !== null) {
				f.set(
					[atmosphere.height, atmosphere.viewSamples, atmosphere.scattering, atmosphere.planetRadius],
					s + 40,
				);
				f.set(
					[atmosphere.lightSamples, atmosphere.falloff, atmosphere.brightness, atmosphere.hueShift],
					s + 44,
				);
				f.set(
					planet.center.map((c) => c * atmosphere.distance),
					s + 48,
				);
			}
		}
		this.#device.queue.writeBuffer(this.#uniforms, 0, f);
	}

	/** releases the GPU objects */
	destroy(): void {
		this.#uniforms.destroy();
	}
}
