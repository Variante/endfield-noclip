import { resolveSceneValues } from '@endfield-noclip/package-format/conditions';
import type {
	ConditionalSetInfo,
	ControlCategory,
	SceneControl,
	VisibilityGroup,
} from '@endfield-noclip/package-format/states';
import type { Bounds, Vec3 } from '@endfield-noclip/package-format/values';

import { sceneStateControl } from '../game/scene-conditions.ts';
import { CONTROL_CATEGORIES } from '../game/scene-control.ts';
import type { ChunkSource } from '../game/world-index.ts';

import { sourceVisibility } from './chunk-sources.ts';

// one owner for a package's scene controls, conditional sets and visibility groups (docs/package-format.md#conditions).
// mechanisms register controls in any order; finish() orders derived controls after the controls they read,
// keeps only the controls something consumes, and fills in their level tags and derived defaults

/**
 * beyond this width or depth (metres), a control's content counts as spread over the scene, so a box around
 * it says nothing about where it is: about a large level's size
 */
const LOCAL_EXTENT = 1024;

const unionBounds = (a: Bounds, b: Bounds): Bounds => ({
	min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
	max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
});

const centre = ({ min, max }: Bounds): Vec3 => [
	(min[0] + max[0]) / 2,
	(min[1] + max[1]) / 2,
	(min[2] + max[2]) / 2,
];

/** @returns whether the box is small enough to say where its content is */
const local = ({ min, max }: Bounds): boolean =>
	max[0] - min[0] <= LOCAL_EXTENT && max[2] - min[2] <= LOCAL_EXTENT;

/** the levels and the box of what a control gates */
interface Reach {
	tags: Set<number>;
	bounds: Bounds | null;
}

/** adds levels and a box to a reach */
const spread = (into: Reach, tags: Iterable<number>, bounds: Bounds | null): void => {
	for (const tag of tags) {
		into.tags.add(tag);
	}
	if (bounds !== null) {
		into.bounds = into.bounds === null ? structuredClone(bounds) : unionBounds(into.bounds, bounds);
	}
};

/** a control's inputs: the controls its formula reads */
const inputsOf = (control: SceneControl, conditions: readonly ConditionalSetInfo[]): Set<string> => {
	const inputs = new Set<string>();
	if (control.source.kind === 'derived') {
		for (const requirements of conditions[control.source.condition]?.alternatives ?? []) {
			for (const { control: input } of requirements) {
				inputs.add(input);
			}
		}
	}
	return inputs;
};

/** the scene controls, conditional sets and visibility groups of one package */
export class ControlRegistry {
	readonly conditions: ConditionalSetInfo[] = [];
	readonly groups: VisibilityGroup[] = [];
	/** MapConfig scene state indices some visibility expression requires */
	readonly sceneStates = new Set<number>();
	/** stream areas some visibility expression requires */
	readonly areas = new Set<number>();
	readonly #controls = new Map<string, SceneControl>();
	/** controls consumed by something other than a visibility group (water levels), with its level tags */
	readonly #kept = new Map<string, Set<number>>();
	readonly #conditionIds = new Map<string, number>();
	readonly #groupIds = new Map<string, number>();

	/** group 0 is the shared, always-loaded one */
	constructor() {
		this.group(0, null);
	}

	// #region controls

	/**
	 * @param controls controls to register; the registry owns them and fills in their level tags and derived
	 *   defaults when finishing
	 * @throws {Error} if a control's id is already registered
	 */
	add(...controls: SceneControl[]): void {
		for (const control of controls) {
			if (this.#controls.has(control.id)) {
				throw new Error(`duplicate scene control ${control.id}`);
			}
			this.#controls.set(control.id, control);
		}
	}

	/**
	 * @param id a control id
	 * @returns the registered control, or `undefined`
	 */
	get(id: string): SceneControl | undefined {
		return this.#controls.get(id);
	}

	/**
	 * keeps a control that gates no visibility group but drives other content (a water level), listing it for
	 * the given levels
	 *
	 * @param id a registered control's id
	 * @param levelTags the levels of the content it drives
	 */
	keep(id: string, levelTags: Iterable<number>): void {
		const tags = this.#kept.getOrInsertComputed(id, () => new Set());
		for (const tag of levelTags) {
			tags.add(tag);
		}
	}

	/**
	 * @param extra controls not registered (yet) to resolve along with the registered ones; a registered id
	 *   wins
	 * @returns every control's default value, derived controls evaluated after their inputs; a derived control
	 *   whose input isn't known reads it as missing, which fails its requirement
	 */
	defaults(extra: readonly SceneControl[] = []): Record<string, number> {
		const all = new Map(extra.map((control) => [control.id, control]));
		for (const [id, control] of this.#controls) {
			all.set(id, control);
		}
		return resolveSceneValues({ controls: this.#ordered(all, false), conditionalSets: this.conditions }, {});
	}

	/**
	 * orders the controls inputs first, drops those no visibility group or kept consumer needs (directly or
	 * through a derived control), and fills in the rest's level tags, places and derived defaults
	 *
	 * @param options.groupBounds by visibility group index, a box around its placed content
	 * @param options.locate names where a point is (the level and the nearest place name), `null` outside every
	 *   level
	 * @returns the kept controls in registration order, each derived control after its inputs, and the
	 *   categories they list under, in listing order
	 * @throws {Error} if a requirement names an unregistered control, or derived controls form a cycle
	 */
	finish(options: {
		groupBounds: ReadonlyMap<number, Bounds>;
		locate: (position: Readonly<Vec3>) => string | null;
	}): { controls: SceneControl[]; categories: ControlCategory[] } {
		const ordered = this.#ordered(this.#controls, true);
		/** per control, the levels and the box of what it gates */
		const reaches = new Map<string, Reach>();
		const reach = (id: string) => reaches.getOrInsertComputed(id, () => ({ tags: new Set(), bounds: null }));
		const note = (set: number, tags: Iterable<number>, bounds: Bounds | null): void => {
			for (const requirements of this.conditions[set].alternatives) {
				for (const { control } of requirements) {
					if (!this.#controls.has(control)) {
						throw new Error(`a visibility expression requires unknown control ${control}`);
					}
					spread(reach(control), tags, bounds);
				}
			}
		};
		for (const [index, { levelTag, condition }] of this.groups.entries()) {
			if (condition !== null) {
				note(condition, [levelTag], options.groupBounds.get(index) ?? null);
			}
		}
		for (const [id, levelTags] of this.#kept) {
			if (!this.#controls.has(id)) {
				throw new Error(`kept control ${id} isn't registered`);
			}
			spread(reach(id), levelTags, null);
		}
		// every control reading another comes after it, so walking backwards passes a control's reach on to its
		// inputs before those are visited
		for (const control of ordered.toReversed()) {
			const gated = reaches.get(control.id);
			if (control.source.kind === 'derived' && gated !== undefined) {
				note(control.source.condition, [...gated.tags], gated.bounds);
			}
		}
		const used = ordered.filter((control) => reaches.has(control.id));
		for (const control of used) {
			const { tags, bounds } = reaches.get(control.id)!;
			control.levelTags = [...tags].toSorted((a, b) => a - b);
			const position = control.place?.position ?? (bounds && local(bounds) ? centre(bounds) : null);
			control.place = position === null ? null : { position, bounds, label: options.locate(position) };
		}
		const values = resolveSceneValues({ controls: used, conditionalSets: this.conditions }, {});
		for (const control of used) {
			if (control.source.kind === 'derived') {
				control.default = values[control.id];
			}
		}
		const listed = new Set(used.map(({ category }) => category));
		return {
			controls: used,
			categories: CONTROL_CATEGORIES.filter(({ id }) => listed.has(id)),
		};
	}

	/**
	 * @param strict whether an unknown input throws rather than being skipped
	 * @returns the controls in registration order, each moved after the controls it reads
	 */
	#ordered(controls: ReadonlyMap<string, SceneControl>, strict: boolean): SceneControl[] {
		const ordered: SceneControl[] = [];
		const done = new Set<string>();
		const visiting = new Set<string>();
		const visit = (control: SceneControl): void => {
			if (done.has(control.id)) {
				return;
			}
			if (visiting.has(control.id)) {
				throw new Error(`derived scene controls form a cycle through ${control.id}`);
			}
			visiting.add(control.id);
			for (const id of inputsOf(control, this.conditions)) {
				const input = controls.get(id);
				if (input !== undefined) {
					visit(input);
				} else if (strict) {
					throw new Error(`scene control ${control.id} reads unknown control ${id}`);
				}
			}
			visiting.delete(control.id);
			done.add(control.id);
			ordered.push(control);
		};
		for (const control of controls.values()) {
			visit(control);
		}
		return ordered;
	}

	// #endregion

	// #region conditions and groups

	/**
	 * @param visibility a visibility expression
	 * @returns its index in {@link conditions}, shared by equivalent expressions
	 */
	condition(visibility: ConditionalSetInfo): number {
		// canonical order at both levels, so equivalent expressions share one set
		const alternatives = [
			...new Map(
				visibility.alternatives.map((requirements) => {
					const sorted = requirements.toSorted((a, b) => a.control.localeCompare(b.control));
					return [JSON.stringify(sorted), sorted];
				}),
			),
		]
			.toSorted(([a], [b]) => Number(a > b) - Number(a < b))
			.map(([, requirements]) => requirements);
		const serialized = JSON.stringify(alternatives);
		return this.#conditionIds.getOrInsertComputed(
			serialized,
			() => this.conditions.push({ alternatives }) - 1,
		);
	}

	/**
	 * @param levelTag the owning level's tag, 0 for shared content
	 * @param condition index into {@link conditions}, or `null` for content that always loads
	 * @returns the visibility group's index, shared by equal owners and conditions
	 */
	group(levelTag: number, condition: number | null): number {
		return this.#groupIds.getOrInsertComputed(`${levelTag}/${condition}`, () => {
			this.groups.push({ levelTag, condition });
			return this.groups.length - 1;
		});
	}

	/**
	 * @param levelTag the owning level's tag
	 * @param visibility when the content loads, `null` for always
	 * @returns its visibility group
	 */
	groupOf(levelTag: number, visibility: ConditionalSetInfo | null): number {
		return this.group(levelTag, visibility === null ? null : this.condition(visibility));
	}

	/**
	 * @param indices MapConfig scene state indices
	 * @returns visibility while any of them is active
	 */
	stateVisibility(indices: readonly number[]): ConditionalSetInfo {
		for (const index of indices) {
			this.sceneStates.add(index);
		}
		return { alternatives: indices.map((index) => [{ control: sceneStateControl(index), mask: 2 }]) };
	}

	/**
	 * @param sources the chunk files holding some content
	 * @returns when it loads, noting the scene states and stream areas it needs
	 */
	sourceVisibility(sources: readonly ChunkSource[]): ConditionalSetInfo | null {
		const visibility = sourceVisibility(sources);
		if (visibility !== null) {
			for (const { sceneState, area } of sources) {
				if (sceneState !== 0) {
					this.sceneStates.add(sceneState - 1);
				}
				if (area !== 0) {
					this.areas.add(area);
				}
			}
		}
		return visibility;
	}

	/**
	 * @param levelTag the owning level's tag
	 * @param sources the chunk files holding the content
	 * @returns the visibility group of content loading with any of those files
	 */
	groupOfSources(levelTag: number, sources: readonly ChunkSource[]): number {
		return this.groupOf(levelTag, this.sourceVisibility(sources));
	}

	// #endregion
}
