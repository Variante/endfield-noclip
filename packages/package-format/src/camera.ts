import type { SceneControl } from './states.ts';
import type { Vec3 } from './values.ts';

/**
 * @param controls a package's controls
 * @param eye where the camera stands in for the player, in Unity coordinates
 * @param areas the stream areas shown at the eye (by the game's trigger test, `areasShownIn`), or `null` when
 *   every area shows
 * @returns each camera control's value there: an `area` test 1 while its area shows, a `near` test 1 within
 *   any of its reaches; 0 otherwise
 */
export const cameraValues = (
	controls: readonly SceneControl[],
	eye: Vec3,
	areas: ReadonlySet<number> | null,
): Record<string, number> => {
	const values: Record<string, number> = {};
	for (const { id, source } of controls) {
		if (source.kind !== 'camera') {
			continue;
		}
		const { test } = source;
		switch (test.kind) {
			case 'area': {
				values[id] = Number(areas === null || areas.has(test.area));
				break;
			}
			case 'near': {
				values[id] = Number(
					test.reaches.some(
						({ position, radius }) =>
							Math.hypot(eye[0] - position[0], eye[1] - position[1], eye[2] - position[2]) <= radius,
					),
				);
				break;
			}
		}
	}
	return values;
};
