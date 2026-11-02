import type { Viewer } from '../viewer.ts';

import { Drivers } from './drivers.tsx';
import { useViewerState, useViewerStats } from './use-viewer.ts';

/** how fast water volumes move between levels, as multiples of the game's speed */
const RATES: { value: number; label: string }[] = [
	{ value: 1, label: 'As in game' },
	{ value: 10, label: '10× faster' },
	{ value: 100, label: '100× faster' },
	{ value: Infinity, label: 'Instantly' },
];

/** a metre count with one decimal */
const metres = (value: number): string => `${value.toFixed(1)} m`;

/**
 * the "Water levels" section: per gameplay water volume of the shown level that scripts move or that
 * something floats on, a select of the levels the game sets it to
 *
 * @param viewer the loaded scene
 * @param matches the panel's filter
 */
export const WaterLevels = ({ viewer, matches }: { viewer: Viewer; matches: (text: string) => boolean }) => {
	useViewerState(viewer);
	// the surfaces' heights change while they move
	useViewerStats(viewer);
	const pkg = viewer.scene?.pkg;
	if (pkg === undefined) {
		return null;
	}
	const level = pkg.manifest.levels.find((entry) => entry.id === viewer.level);
	const surfaces = pkg.water.surfaces;
	const controls = new Map(pkg.manifest.states.controls.map((control) => [control.id, control]));
	// a volume is listed with its `waterLevel` control, for the levels that control is listed for
	const rows = viewer.waterVolumes.flatMap((state, index) => {
		const surface = surfaces.find((entry) => entry.kind === 'volume' && entry.volume === index);
		const control = state.entry.control === null ? undefined : controls.get(state.entry.control);
		if (surface === undefined || control === undefined) {
			return [];
		}
		const listed =
			(level === undefined || control.levelTags.includes(0) || control.levelTags.includes(level.tag)) &&
			matches(`${control.name} ${control.id}`);
		return listed ? [{ state, surface, control }] : [];
	});
	return (
		<details>
			<summary>Water levels ({rows.length})</summary>
			<p className="muted small">
				Gameplay water that switches, timers and scripts raise or lower. Picking a level moves the water there
				at the game&apos;s speed; what floats on it follows.
			</p>
			<label className="scene-choice">
				<span>Movement</span>
				<select
					value={String(viewer.options.waterLevelRate)}
					onChange={(event) => viewer.setOptions({ waterLevelRate: Number(event.currentTarget.value) })}
				>
					{RATES.map(({ value, label }) => (
						<option key={label} value={String(value)}>
							{label}
						</option>
					))}
				</select>
			</label>
			{rows.map(({ state: { entry, current, target }, surface, control }) => {
				const height = (fraction: number): number => entry.base + entry.heightMax * fraction;
				const { min, max } = surface.bounds;
				const center: [number, number, number] = [
					(min[0] + max[0]) / 2,
					height(current),
					(min[2] + max[2]) / 2,
				];
				const size = Math.max(max[0] - min[0], max[2] - min[2]);
				return (
					<div key={control.id}>
						<label className="scene-choice">
							<span>
								{control.name}
								<small className="muted">
									{current === target
										? `at ${metres(height(current))}`
										: `moving, ${metres(height(current))}`}
									{entry.floaters.length > 0 && ` · ${entry.floaters.length} floating parts`}
								</small>
							</span>
							<select
								value={String(viewer.sceneValues[control.id] ?? control.default)}
								onChange={(event) => viewer.setSceneValue(control.id, Number(event.currentTarget.value))}
							>
								{control.values.map((option) => (
									<option key={option.value} value={String(option.value)}>
										{option.label}
										{option.value === control.default ? ' (initial)' : ''}
									</option>
								))}
							</select>
						</label>
						<button type="button" onClick={() => viewer.flyToPoint(center, Math.min(size, 120) * 0.75)}>
							Go
						</button>
						<Drivers viewer={viewer} control={control} />
					</div>
				);
			})}
		</details>
	);
};
