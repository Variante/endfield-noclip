import type { ParticleSystemInfo, ParticlesTable } from '@endfield-noclip/package-format/particles';

/** the particles table, with equal systems sharing one entry */
export class ParticleTable {
	readonly #systems: ParticleSystemInfo[] = [];
	readonly #ids = new Map<string, number>();

	/**
	 * @param system a particle system
	 * @returns its id; equal systems return equal ids
	 */
	intern(system: ParticleSystemInfo): number {
		return this.#ids.getOrInsertComputed(JSON.stringify(system), () => this.#systems.push(system) - 1);
	}

	/** @returns the table as the package stores it */
	table(): ParticlesTable {
		return { systems: this.#systems };
	}
}
