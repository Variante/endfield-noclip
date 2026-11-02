import type { EnvironmentVolumeShape } from './environment.ts';
import type { Rect, Vec3 } from './values.ts';

// where environment volumes apply and in what order they stack: shared by the extractor's base-environment
// vote and the viewer's blend at the camera, so both pick the same volume at the same point.

/**
 * shape order among equal priorities, by volume type (prism is `PolyArea`, 3). the game's order among equal
 * priorities isn't known; this is an assumption
 */
const SHAPE_ORDER: Record<EnvironmentVolumeShape['kind'], number> = { global: 0, box: 1, prism: 3 };

/**
 * orders two volumes as they stack: ascending priority, then shape kind (global, box, prism). volumes that
 * still tie keep their list order, and the later one stacks on top
 *
 * @param a a volume
 * @param b another volume
 * @returns negative when `a` stacks under `b`, positive when over, 0 on a tie
 */
export const compareVolumes = (
	a: { priority: number; shape: EnvironmentVolumeShape },
	b: { priority: number; shape: EnvironmentVolumeShape },
): number => a.priority - b.priority || SHAPE_ORDER[a.shape.kind] - SHAPE_ORDER[b.shape.kind];

/**
 * @param shape a volume's shape
 * @param point a world position
 * @returns how far inside the shape the point is (m), infinite for global volumes, or ≤ 0 outside
 */
export const distanceInsideVolume = (shape: EnvironmentVolumeShape, [x, y, z]: Readonly<Vec3>): number => {
	switch (shape.kind) {
		case 'global': {
			return Infinity;
		}
		case 'box': {
			const local = toBoxFrame(shape, [x - shape.position[0], y - shape.position[1], z - shape.position[2]]);
			let inside = Infinity;
			for (let axis = 0; axis < 3; axis++) {
				const half = Math.abs(shape.scale[axis]) / 2;
				inside = Math.min(inside, half - Math.abs(local[axis]));
			}
			return inside;
		}
		case 'prism': {
			if (y < shape.bottom || y > shape.top) {
				return 0;
			}
			const edge = distanceInPolygon(shape.points, x, z);
			return Math.min(edge, y - shape.bottom, shape.top - y);
		}
	}
};

/**
 * @param shape a volume's shape
 * @param x world x
 * @param z world z
 * @returns whether the shape holds the point at some height: a prism at any height, a box at its centre's
 */
export const volumeFootprintContains = (shape: EnvironmentVolumeShape, x: number, z: number): boolean => {
	switch (shape.kind) {
		case 'global': {
			return true;
		}
		case 'box': {
			return distanceInsideVolume(shape, [x, shape.position[1], z]) >= 0;
		}
		case 'prism': {
			return distanceInPolygon(shape.points, x, z) > 0;
		}
	}
};

/**
 * @param shape a volume's shape
 * @param rect a world x, z rectangle
 * @returns whether the volume's footprint may reach into the rectangle (boxes are bounded by their rotated
 *   extents' circle, so this can be true just outside a box's corners)
 */
export const volumeReaches = (shape: EnvironmentVolumeShape, rect: Rect): boolean => {
	switch (shape.kind) {
		case 'global': {
			return true;
		}
		case 'box': {
			const radius = Math.hypot(shape.scale[0], shape.scale[1], shape.scale[2]) / 2;
			const [x, , z] = shape.position;
			return (
				x + radius >= rect.minX &&
				x - radius <= rect.maxX &&
				z + radius >= rect.minZ &&
				z - radius <= rect.maxZ
			);
		}
		case 'prism': {
			const xs = shape.points.map(([x]) => x);
			const zs = shape.points.map(([, z]) => z);
			return (
				Math.max(...xs) >= rect.minX &&
				Math.min(...xs) <= rect.maxX &&
				Math.max(...zs) >= rect.minZ &&
				Math.min(...zs) <= rect.maxZ
			);
		}
	}
};

/** undoes a Unity Euler rotation (applied z, then x, then y) */
const toBoxFrame = (shape: Extract<EnvironmentVolumeShape, { kind: 'box' }>, v: Vec3): Vec3 => {
	const [rx, ry, rz] = shape.rotation.map((degrees) => (degrees * Math.PI) / 180);
	let [x, y, z] = v;
	// inverse yaw
	[x, z] = [x * Math.cos(ry) - z * Math.sin(ry), x * Math.sin(ry) + z * Math.cos(ry)];
	// inverse pitch
	[y, z] = [y * Math.cos(rx) + z * Math.sin(rx), -y * Math.sin(rx) + z * Math.cos(rx)];
	// inverse roll
	[x, y] = [x * Math.cos(rz) + y * Math.sin(rz), -x * Math.sin(rz) + y * Math.cos(rz)];
	return [x, y, z];
};

/** @returns the distance from (x, z) to the polygon's nearest edge inside it, or 0 outside */
const distanceInPolygon = (points: readonly (readonly [number, number])[], x: number, z: number): number => {
	let inside = false;
	let nearest = Infinity;
	for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
		const [xi, zi] = points[i];
		const [xj, zj] = points[j];
		if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
			inside = !inside;
		}
		const ex = xi - xj;
		const ez = zi - zj;
		const t = Math.max(0, Math.min(1, ((x - xj) * ex + (z - zj) * ez) / (ex * ex + ez * ez || 1)));
		nearest = Math.min(nearest, Math.hypot(x - (xj + t * ex), z - (zj + t * ez)));
	}
	return inside ? nearest : 0;
};
