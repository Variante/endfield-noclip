/** shader labels and pipeline keys identify immutable descriptors for the lifetime of the cache */
export class PipelineCache {
	#device: GPUDevice;
	#modules = new Map<string, GPUShaderModule>();
	#pipelines = new Map<string, GPURenderPipeline>();
	#pending = new Map<string, Promise<GPURenderPipeline>>();

	/** @param device the device */
	constructor(device: GPUDevice) {
		this.#device = device;
	}

	/**
	 * @param label module label, also the cache key
	 * @param code WGSL source
	 * @returns the compiled module
	 */
	module(label: string, code: string): GPUShaderModule {
		return this.#modules.getOrInsertComputed(label, () => this.#device.createShaderModule({ label, code }));
	}

	/**
	 * concurrent requests for a key share one compilation; a rejected compilation remains cached.
	 *
	 * @param key unique key of the pipeline's state, e.g. `terrain/fill`
	 * @param describe builds the descriptor; only called on a miss
	 * @returns the pipeline
	 */
	prepare(key: string, describe: () => GPURenderPipelineDescriptor): Promise<GPURenderPipeline> {
		const ready = this.#pipelines.get(key);
		if (ready !== undefined) {
			return Promise.resolve(ready);
		}
		return this.#pending.getOrInsertComputed(key, () =>
			this.#device.createRenderPipelineAsync({ label: key, ...describe() }).then((pipeline) => {
				this.#pipelines.set(key, pipeline);
				this.#pending.delete(key);
				return pipeline;
			}),
		);
	}

	/**
	 * @param key a key passed to {@link prepare}
	 * @returns the pipeline, or `undefined` while it compiles
	 */
	get(key: string): GPURenderPipeline | undefined {
		return this.#pipelines.get(key);
	}

	/** @returns how many pipelines are still compiling */
	get compiling(): number {
		return this.#pending.size;
	}

	/** @returns compiled pipeline count */
	get size(): number {
		return this.#pipelines.size;
	}
}
