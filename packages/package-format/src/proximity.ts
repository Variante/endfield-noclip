import type { ProximityInfo } from './states.ts';
import type { Vec3 } from './values.ts';

/**
 * @param proximities the package's proximity controls' reaches
 * @param eye where the player stands, in Unity coordinates
 * @returns each proximity control's value there: 1 within the radius of any of its reaches, 0 beyond all
 */
export const proximityValues = (proximities: readonly ProximityInfo[], eye: Vec3): Record<string, number> => {
	const values: Record<string, number> = {};
	for (const { control, position, radius } of proximities) {
		const near = Math.hypot(eye[0] - position[0], eye[1] - position[1], eye[2] - position[2]) <= radius;
		values[control] = near || values[control] === 1 ? 1 : 0;
	}
	return values;
};
