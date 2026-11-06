import { useSyncExternalStore } from 'react';

import type { Viewer } from '../viewer/viewer.ts';

/**
 * re-renders the caller when the package, the options or the shown level change.
 *
 * @param viewer the viewer
 * @returns the viewer's state revision (only useful as a dependency)
 */
export const useViewerState = (viewer: Viewer): number => {
	return useSyncExternalStore(
		(listener) => viewer.subscribe(listener),
		() => viewer.stateRevision,
	);
};

/**
 * re-renders the caller when the environment at the camera changes (its name or applied volumes).
 *
 * @param viewer the viewer
 * @returns the viewer's environment revision (only useful as a dependency)
 */
export const useViewerEnvironment = (viewer: Viewer): number => {
	return useSyncExternalStore(
		(listener) => viewer.subscribe(listener),
		() => viewer.environmentRevision,
	);
};

/**
 * re-renders the caller when the viewer's stats change.
 *
 * @param viewer the viewer
 * @returns the viewer's stats revision (only useful as a dependency)
 */
export const useViewerStats = (viewer: Viewer): number => {
	return useSyncExternalStore(
		(listener) => viewer.subscribe(listener),
		() => viewer.statsRevision,
	);
};

/** the size of the cells {@link useCameraCell} tells apart, in metres */
const CAMERA_CELL = 25;

/**
 * re-renders the caller when the camera moves into another cell of a 25 m grid, while `enabled`; nothing
 * while it isn't
 *
 * @param viewer the viewer
 * @param enabled whether to follow the camera
 * @returns the camera's cell, as a key (only useful as a dependency); empty while not enabled
 */
export const useCameraCell = (viewer: Viewer, enabled: boolean): string => {
	return useSyncExternalStore(
		(listener) => (enabled ? viewer.subscribe(listener) : () => {}),
		() => (enabled ? viewer.camera.position.map((value) => Math.floor(value / CAMERA_CELL)).join() : ''),
	);
};
