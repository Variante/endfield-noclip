import type { Viewer } from '../viewer.ts';

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
	const rows = viewer.waterVolumes.flatMap((state, index) => {
		const surface = surfaces.find((entry) => entry.kind === 'volume' && entry.volume === index);
		if (surface === undefined) {
			return [];
		}
		const owner = pkg.manifest.states.groups[surface.group]?.levelTag ?? 0;
		const { entry } = state;
		const listed =
			(entry.levels.length > 1 || entry.floaters.length > 0) &&
			(level === undefined || owner === 0 || owner === level.tag) &&
			matches(`water volume ${entry.id}`);
		return listed ? [{ state, index, surface }] : [];
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
			{rows.map(({ state: { entry, current, target }, index, surface }) => {
				const height = (fraction: number): number => entry.base + entry.heightMax * fraction;
				const { min, max } = surface.bounds;
				const center: [number, number, number] = [
					(min[0] + max[0]) / 2,
					height(current),
					(min[2] + max[2]) / 2,
				];
				const size = Math.max(max[0] - min[0], max[2] - min[2]);
				return (
					<div key={entry.id}>
						<label className="scene-choice">
							<span>
								Water volume {entry.id}
								<small className="muted">
									{current === target
										? `at ${metres(height(current))}`
										: `moving, ${metres(height(current))}`}
									{entry.floaters.length > 0 && ` · ${entry.floaters.length} floating parts`}
								</small>
							</span>
							<select
								value={String(target)}
								onChange={(event) => viewer.setWaterLevel(index, Number(event.currentTarget.value))}
							>
								{entry.levels.map((option) => (
									<option key={option.fraction} value={String(option.fraction)}>
										{metres(height(option.fraction))} ({Math.round(option.fraction * 100)}%) · {option.label}
									</option>
								))}
							</select>
						</label>
						<button type="button" onClick={() => viewer.flyToPoint(center, Math.min(size, 120) * 0.75)}>
							Go
						</button>
					</div>
				);
			})}
		</details>
	);
};
