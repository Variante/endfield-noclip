import type { RuleText, SceneControl } from '@endfield-noclip/package-format/states';

import { definite } from '@mary-ext/array-fns';
import type { ReactNode } from 'react';

import type { Viewer } from '../../viewer/viewer.ts';
import { ChoiceRow, ControlValueSelect, SceneToggle } from '../controls.tsx';
import { isToggle, ruleOf } from '../format.ts';

import { Drivers } from './drivers.tsx';

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
	const detail = definite([rule && describe(rule), control.assumption]).join(' · ');
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
			<Drivers viewer={viewer} control={control} />
		</div>
	);
};
