import type { ParticleSystemInfo, ParticlesTable } from '@endfield-noclip/package-format/particles';

import { intern } from '../collections.ts';

/** the particles table, with equal systems sharing one entry */
export class ParticleTable {
	readonly #systems: ParticleSystemInfo[] = [];
	readonly #ids = new Map<string, number>();

	/**
	 * @param system a particle system
	 * @returns its id; equal systems return equal ids
	 */
	intern(system: ParticleSystemInfo): number {
		return intern(this.#systems, this.#ids, JSON.stringify(system), () => system);
	}

	/** @returns the table as the package stores it */
	table(): ParticlesTable {
		return { systems: this.#systems };
	}
}
