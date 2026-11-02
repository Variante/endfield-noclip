import type { ProximityInfo } from './states.ts';
import type { Vec3 } from './values.ts';

/**
 * @param proximities the package's proximity controls
 * @param eye where the player stands, in Unity coordinates
 * @returns each proximity control's value there: 1 within its radius, 0 beyond
 */
export const proximityValues = (proximities: readonly ProximityInfo[], eye: Vec3): Record<string, number> =>
	Object.fromEntries(
		proximities.map(({ control, position, radius }) => [
			control,
			Math.hypot(eye[0] - position[0], eye[1] - position[1], eye[2] - position[2]) <= radius ? 1 : 0,
		]),
	);
