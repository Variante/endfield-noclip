/**
 * which scene controls and environment volumes the viewer lists for the shown level (see
 * docs/viewer/scene-states.md "the scene conditions panel").
 *
 * @module
 */

import type { EnvironmentVolumeInfo } from '@endfield-noclip/package-format/environment';
import { volumeReaches } from '@endfield-noclip/package-format/environment-volumes';
import type { LevelInfo, PackageManifest } from '@endfield-noclip/package-format/manifest';
import type { SceneControlBase } from '@endfield-noclip/package-format/states';

import { volumeLevelTag } from '../environment/blend.ts';

/**
 * @param control a scene control
 * @param level the shown level, or `null` for none
 * @returns whether the control gates the level's content: its level tags include 0 or the level's tag. every
 *   control is listed without a level
 */
export const controlListedFor = (control: SceneControlBase, level: LevelInfo | null): boolean =>
	level === null || control.levelTags.includes(0) || control.levelTags.includes(level.tag);

/**
 * @param controls scene controls
 * @param level the shown level, or `null` for none
 * @returns the controls {@link controlListedFor} the level, in order
 */
export const controlsForLevel = <T extends SceneControlBase>(
	controls: readonly T[],
	level: LevelInfo | null,
): T[] => controls.filter((control) => controlListedFor(control, level));

/** an environment volume listed for a level */
export interface ListedVolume {
	/** index into {@link PackageManifest.environmentVolumes} */
	id: number;
	volume: EnvironmentVolumeInfo;
	/** the level tag of the volume's group; 0 for scene-wide volumes */
	owner: number;
}

/**
 * volumes apply wherever they hold the camera, so a neighbour's volume reaching into the level is listed with
 * the level's own and the scene-wide ones
 *
 * @param manifest the package manifest
 * @param level the shown level, or `null` for none (then only scene-wide volumes are listed)
 * @returns the package's environment volumes listed for the level, in order
 */
export const volumesForLevel = (manifest: PackageManifest, level: LevelInfo | null): ListedVolume[] =>
	manifest.environmentVolumes.flatMap((volume, id) => {
		const owner = volumeLevelTag(manifest, volume);
		const listed =
			owner === 0 || (level !== null && (owner === level.tag || volumeReaches(volume.shape, level.rect)));
		return listed ? [{ id, volume, owner }] : [];
	});
