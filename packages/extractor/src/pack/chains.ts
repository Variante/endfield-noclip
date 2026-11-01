import { type Chain, ChainFlags, type ChainDraw, DrawRole } from '@endfield-noclip/package-format/instances';

// float bits make the dedupe key exact: two thresholds are the same only if their f32 bits are
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
const bits = (value: number): number => {
	f32[0] = value;
	return u32[0];
};

/**
 * LOD-chain templates, deduplicated by their ordered draws (geometry, material, submesh, LOD, role,
 * thresholds, source flags, particle system), LOD count and billboard mode
 */
export class ChainTable {
	readonly chains: Chain[] = [];
	readonly #ids = new Map<string, number>();

	/**
	 * @param lodCount the renderer's LOD count
	 * @param draws its draws in the game's order
	 * @param billboard `ChainFlags.BillboardFacing` or `BillboardUpright` when the renderer turns to the camera
	 * @returns the chain id; equal inputs return equal ids
	 */
	intern(lodCount: number, draws: readonly ChainDraw[], billboard = 0): number {
		let key = `${lodCount},${billboard}`;
		for (const draw of draws) {
			key += `|${draw.geometry},${draw.material},${draw.submesh},${draw.lod},${draw.role},${bits(draw.minSquared)},${bits(draw.maxSquared)},${draw.sourceFlags},${draw.particles}`;
		}
		return this.#ids.getOrInsertComputed(
			key,
			() =>
				this.chains.push({
					lodCount,
					flags: chainFlags(draws) | billboard,
					draws: draws.map((draw) => ({ ...draw })),
				}) - 1,
		);
	}
}

const chainFlags = (draws: readonly ChainDraw[]): number => {
	let flags = 0;
	for (const draw of draws) {
		switch (draw.role) {
			case DrawRole.ShadowOnly: {
				flags |= ChainFlags.HasShadowOnly;
				break;
			}
			case DrawRole.Card: {
				flags |= ChainFlags.HasCard;
				break;
			}
			case DrawRole.Hlod: {
				flags |= ChainFlags.Hlod;
				break;
			}
		}
	}
	return flags;
};
