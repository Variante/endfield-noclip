import {
	EnvironmentBlendMode,
	type EnvironmentVolumeInfo,
} from '@endfield-noclip/package-format/environment';
import type { LevelInfo, PackageManifest } from '@endfield-noclip/package-format/manifest';

import { mapDefined, unique } from '@mary-ext/array-fns';

import { volumeCondition } from '../../environment/blend.ts';
import { volumesForLevel } from '../../scene-states/listing.ts';
import type { Viewer } from '../../viewer.ts';
import { SceneToggle } from '../controls.tsx';

/** @returns how an environment volume applies when its checkbox is on, in words */
const blendText = (volume: EnvironmentVolumeInfo): string => {
	if (volume.control === null) {
		return 'Phase unavailable';
	}
	if (volume.blendMode === EnvironmentBlendMode.Manual) {
		return 'Scripted blend · preview at full strength';
	}
	return `Priority ${volume.priority}`;
};

/**
 * the "Lighting / environment volumes" section: a checkbox per volume listed for the shown level, over its
 * `environmentVolume` control
 *
 * @param props.manifest the loaded package's manifest
 * @param props.level the shown level, or `null` for none
 * @param props.matches the panel's filter
 */
export const EnvironmentVolumes = ({
	viewer,
	manifest,
	level,
	matches,
}: {
	viewer: Viewer;
	manifest: PackageManifest;
	level: LevelInfo | null;
	matches: (text: string) => boolean;
}) => {
	const volumes = volumesForLevel(manifest, level).filter(({ volume }) => matches(volume.name));
	const levelNames = new Map(manifest.levels.map((entry) => [entry.tag, entry.name ?? entry.id]));
	const controlNames = new Map(manifest.states.controls.map((entry) => [entry.id, entry.name]));
	/** @returns the controls a volume loads with besides its own switch, by name */
	const loadingStates = (condition: number, own: string | null): string =>
		unique(
			manifest.states.conditionalSets[condition].alternatives.flatMap((requirements) =>
				mapDefined(requirements, ({ control }) =>
					control === own ? undefined : (controlNames.get(control) ?? control),
				),
			),
		).join(' or ');
	return (
		<details>
			<summary>Lighting / environment volumes ({volumes.length})</summary>
			<p className="muted small">A pinned phase overrides these.</p>
			{volumes.map(({ volume, id, owner }) => {
				const { control } = volume;
				const condition = volumeCondition(manifest, volume);
				const states = condition === null ? '' : loadingStates(condition, control);
				return (
					<SceneToggle
						key={id}
						label={volume.name}
						detail={
							<>
								{blendText(volume)}
								{states !== '' && ` · with ${states}`}
								{condition !== null &&
									control !== null &&
									viewer.sceneValues[control] === 1 &&
									!viewer.conditionResults[condition] &&
									' (not loaded)'}
								{owner !== 0 &&
									owner !== level?.tag &&
									` · from ${levelNames.get(owner) ?? `level ${owner}`}`}
							</>
						}
						disabled={control === null}
						checked={control !== null && viewer.sceneValues[control] === 1}
						onChange={(checked) => {
							if (control !== null) {
								viewer.setSceneValue(control, Number(checked));
							}
						}}
					/>
				);
			})}
		</details>
	);
};
