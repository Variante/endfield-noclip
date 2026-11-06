import type { RuleText, SceneControl } from '@endfield-noclip/package-format/states';

import { definite } from '@mary-ext/array-fns';
import type { ReactNode } from 'react';

import { followersOf } from '../../scene-states/listing.ts';
import type { Viewer } from '../../viewer/viewer.ts';
import { ChoiceRow, ControlValueSelect, FlyButton, SceneToggle } from '../controls.tsx';
import { isToggle, placeSize, ruleOf } from '../format.ts';

import { Drivers } from './drivers.tsx';

/** how many followers a row names before summing up the rest */
const FOLLOWERS_NAMED = 4;

/**
 * the controls that follow a control (derived from it), named with their place; nothing without any
 *
 * @param props.control a scene control
 */
const Followers = ({ viewer, control }: { viewer: Viewer; control: SceneControl }) => {
	const states = viewer.manifest?.states;
	const followers = states === undefined ? [] : (followersOf(states).get(control.id) ?? []);
	if (followers.length === 0) {
		return null;
	}
	const named = followers
		.slice(0, FOLLOWERS_NAMED)
		.map((entry) => (entry.place?.label ? `${entry.name} (${entry.place.label})` : entry.name));
	const more = followers.length - named.length;
	return (
		<p className="muted small">
			Drives {named.join(', ')}
			{more > 0 && ` and ${more} more`}
		</p>
	);
};

/**
 * a scene control: a checkbox for an off/on switch only the user sets, otherwise a select. derived and camera
 * controls offer to follow the game or the camera
 *
 * @param props.describe a rule in words, its references named
 */
export const ControlRow = ({
	viewer,
	control,
	describe,
}: {
	viewer: Viewer;
	control: SceneControl;
	describe: (rule: RuleText) => string;
}) => {
	const rule = ruleOf(control);
	const { place } = control;
	const detail = definite([place?.label, rule && describe(rule), control.assumption]).join(' · ');
	let input: ReactNode;
	if (isToggle(control)) {
		input = (
			<SceneToggle
				label={control.name}
				detail={detail}
				checked={(viewer.sceneValues[control.id] ?? control.default) === 1}
				onChange={(checked) => viewer.setSceneValue(control.id, Number(checked))}
			/>
		);
	} else {
		input = (
			<ChoiceRow label={control.name} detail={detail}>
				<ControlValueSelect viewer={viewer} control={control} />
			</ChoiceRow>
		);
	}
	return (
		<div>
			{input}
			{place !== null && (
				<FlyButton viewer={viewer} point={place.position} size={placeSize(place)} back={1.5} />
			)}
			<Drivers viewer={viewer} control={control} />
			<Followers viewer={viewer} control={control} />
		</div>
	);
};
