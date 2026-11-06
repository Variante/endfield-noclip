import { LookFlags, type MaterialLook, SLOTS, SLOT_FLAGS } from '../../looks/look.ts';
import { placeholderView, type TextureBinding, type TextureStore } from '../textures/texture-store.ts';

/** the main pass's outputs that scene effects read, as `SceneTextures` holds them */
export interface EffectInputs {
	depth: GPUTextureView;
	reflectionSurface: GPUTextureView;
	/** the diffuse ambient and material occlusion, from which relit decals recover the surface's colour */
	ambient: GPUTextureView;
	/** a copy of the composited scene, which refraction samples; only the pass after compositing has one */
	background?: GPUTextureView;
	version: number;
}

/** what a material's draws take from its textures' current bindings */
export interface MaterialState {
	/** the texture store's version this was derived at */
	version: number;
	/** each slot's binding, `null` where it has no texture or it hasn't streamed in */
	slots: (TextureBinding | null)[];
	/** the look's 3D texture's binding, `null` where it has none or it hasn't streamed in */
	volume: TextureBinding | null;
	/** the look's flags without the flags of slots that aren't bound */
	flags: number;
	/** the material group; `null` for effects, whose group also binds the main pass's outputs */
	group: GPUBindGroup | null;
	/** whether the texture holding the alpha is bound, so alpha testing can run */
	alphaReady: boolean;
	/** whether every texture is bound, which effects wait for */
	complete: boolean;
}

/** an effect draw's material: what its group is built from when its pass encodes */
export interface EffectMaterial {
	material: number;
	slots: readonly (TextureBinding | null)[];
	volume: TextureBinding | null;
}

interface MaterialBinding {
	/** the slot bindings' versions the group was built from (-1 for the fallback) */
	versions: number[];
	group: GPUBindGroup;
}

/** derives the mesh materials' states from their textures' bindings, and owns their bind groups */
export class MaterialBindings {
	#device: GPUDevice;
	#materialLayout: GPUBindGroupLayout;
	#effectLayout: GPUBindGroupLayout;
	#white: GPUTextureView;
	/** bound where an effect has no 3D texture */
	#noVolume: GPUTextureView;
	#defaultSampler: GPUSampler;
	/** samples the composited scene's copy for refraction */
	#clampSampler: GPUSampler;
	/** material bind groups by material id */
	#bindings = new Map<number, MaterialBinding>();
	/** by material id */
	#states = new Map<number, MaterialState>();
	#versions: number[] = SLOTS.map(() => -1);
	/** effect bind groups by material id */
	#effectBindings = new Map<number, MaterialBinding & { inputs: number }>();

	/**
	 * @param device the device
	 * @param materialLayout group 3 of the mesh pipelines
	 * @param effectLayout group 3 of the effect pipelines
	 */
	constructor(device: GPUDevice, materialLayout: GPUBindGroupLayout, effectLayout: GPUBindGroupLayout) {
		this.#device = device;
		this.#materialLayout = materialLayout;
		this.#effectLayout = effectLayout;
		const white = device.createTexture({
			label: 'white',
			size: [1, 1],
			format: 'rgba8unorm',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
		});
		device.queue.writeTexture({ texture: white }, new Uint8Array([255, 255, 255, 255]), {}, [1, 1]);
		this.#white = white.createView();
		this.#noVolume = placeholderView(device, {
			label: 'no effect volume',
			dimension: '3d',
			format: 'r8unorm',
		});
		this.#defaultSampler = device.createSampler({
			label: 'material default',
			addressModeU: 'repeat',
			addressModeV: 'repeat',
			magFilter: 'linear',
			minFilter: 'linear',
			mipmapFilter: 'linear',
		});
		this.#clampSampler = device.createSampler({
			label: 'effect background',
			magFilter: 'linear',
			minFilter: 'linear',
		});
	}

	/** forgets every material's state and bind groups (when a package is unloaded) */
	release(): void {
		this.#bindings.clear();
		this.#states.clear();
		this.#effectBindings.clear();
	}

	/**
	 * @param material the material id
	 * @param look its look
	 * @param textures the package's textures
	 * @returns the material's state, derived again only after the texture store changed
	 */
	state(material: number, look: MaterialLook, textures: TextureStore): MaterialState {
		const cached = this.#states.get(material);
		if (cached !== undefined && cached.version === textures.version) {
			return cached;
		}
		const slots: (TextureBinding | null)[] = [];
		let flags = look.flags;
		let complete = true;
		for (let i = 0; i < SLOTS.length; i++) {
			const texture = look.textures[i];
			const binding = texture < 0 ? null : textures.binding(texture);
			slots.push(binding);
			if (binding === null) {
				flags &= ~SLOT_FLAGS[i];
				complete &&= texture < 0;
			}
		}
		const volume = look.volumeTexture < 0 ? null : textures.binding(look.volumeTexture);
		complete &&= look.volumeTexture < 0 || volume !== null;
		const state: MaterialState = {
			version: textures.version,
			slots,
			volume,
			flags,
			group: (look.flags & LookFlags.Effect) !== 0 ? null : this.#materialGroup(material, slots),
			alphaReady: slots[(look.flags & LookFlags.AlphaNormal) !== 0 ? 1 : 0] !== null,
			complete,
		};
		this.#states.set(material, state);
		return state;
	}

	/** the material's bind group over its slots' current bindings (`null` slots get the white texture) */
	#materialGroup(material: number, slots: readonly (TextureBinding | null)[]): GPUBindGroup {
		const versions = this.#versions;
		for (let i = 0; i < slots.length; i++) {
			versions[i] = slots[i]?.version ?? -1;
		}
		const cached = this.#bindings.get(material);
		if (cached !== undefined && cached.versions.every((version, i) => version === versions[i])) {
			return cached.group;
		}
		const detail = slots[1] ?? slots[2] ?? slots[0];
		const group = this.#device.createBindGroup({
			label: `material ${material}`,
			layout: this.#materialLayout,
			entries: [
				...slots.map((slot, i) => ({ binding: i, resource: slot?.view ?? this.#white })),
				{ binding: SLOTS.length, resource: slots[0]?.sampler ?? this.#defaultSampler },
				{ binding: SLOTS.length + 1, resource: detail?.sampler ?? this.#defaultSampler },
				{ binding: SLOTS.length + 2, resource: slots[5]?.sampler ?? this.#defaultSampler },
			],
		});
		this.#bindings.set(material, { versions: [...versions], group });
		return group;
	}

	/**
	 * @param effect an effect material's slot bindings
	 * @param inputs this frame's main pass outputs
	 * @returns the effect material's bind group over its slots' current bindings and the outputs
	 */
	effectGroup({ material, slots, volume }: EffectMaterial, inputs: EffectInputs): GPUBindGroup {
		const versions = [...slots, volume].map((slot) => slot?.version ?? -1);
		const cached = this.#effectBindings.get(material);
		if (
			cached !== undefined &&
			cached.inputs === inputs.version &&
			cached.versions.every((version, i) => version === versions[i])
		) {
			return cached.group;
		}
		const group = this.#device.createBindGroup({
			label: `effect material ${material}`,
			layout: this.#effectLayout,
			entries: [
				...slots.map((slot, i) => ({ binding: i, resource: slot?.view ?? this.#white })),
				...slots.map((slot, i) => ({
					binding: SLOTS.length + i,
					resource: slot?.sampler ?? this.#defaultSampler,
				})),
				{ binding: 14, resource: inputs.depth },
				{ binding: 15, resource: inputs.reflectionSurface },
				{ binding: 16, resource: inputs.ambient },
				{ binding: 17, resource: volume?.view ?? this.#noVolume },
				{ binding: 18, resource: volume?.sampler ?? this.#defaultSampler },
				{ binding: 19, resource: inputs.background ?? this.#white },
				{ binding: 20, resource: this.#clampSampler },
			],
		});
		this.#effectBindings.set(material, { versions, inputs: inputs.version, group });
		return group;
	}
}
