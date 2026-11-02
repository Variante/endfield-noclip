import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Aabb } from '@endfield-noclip/formats/unity/values';
import type { Bounds } from '@endfield-noclip/package-format/values';
import type { WaterGlobal, WaterTable } from '@endfield-noclip/package-format/water';

import type { LevelWaterVolume } from '../game/water-volumes.ts';

import { finishWater, sectorsOverlapping, selectSurfaces, volumeEntry, type WaterPlan } from './water.ts';

describe('volumeEntry', () => {
	// Suiming's receding pit: authored half full, scripts snap it and move it down at their own speeds
	const volume: LevelWaterVolume = {
		id: '46300000002',
		levelId: 'indie_dg016',
		levelTag: 0,
		pivot: [79.57, 51.187, -43.87],
		points: [
			[0, 0],
			[1, 0],
			[0, 1],
		],
		heightMax: 110,
		fraction: 0.5,
		amountMax: 100,
		fillSpeed: 0.11,
		configHash: 1n,
		source: 'indie_dg016_lv_data.json#46300000002',
	};

	it('merges the authored fill with script fills, taking the speed scripts move it at', () => {
		const entry = volumeEntry(
			volume,
			[7, 8],
			[
				{ volume: volume.id, script: '13', kind: 'fraction', value: 0.5, smooth: false, speed: null },
				{ volume: volume.id, script: '13', kind: 'fraction', value: 0.37, smooth: true, speed: 0.1192 },
				{ volume: volume.id, script: '13', kind: 'fraction', value: 0.37, smooth: false, speed: null },
				{ volume: volume.id, script: '2', kind: 'amount', value: 8, smooth: true, speed: null },
				{ volume: 'other', script: '2', kind: 'fraction', value: 0.9, smooth: false, speed: null },
			],
		);
		assert.equal(entry.base, 51.187);
		assert.equal(entry.initial, 0.5);
		assert.deepEqual(entry.floaters, [7, 8]);
		assert.deepEqual(entry.levels, [
			{ fraction: 0.08, speed: 0.11, label: 'moved to by script 2' },
			{ fraction: 0.37, speed: 0.1192, label: 'moved to by script 13; set by script 13' },
			{ fraction: 0.5, speed: 0.11, label: 'authored; set by script 13' },
		]);
	});
});

const surface = (levelTag: number, x: number, z: number, extent = 1): { levelTag: number; bounds: Aabb } => ({
	levelTag,
	bounds: { center: [x, 10, z], extents: [extent, 0, extent] },
});

describe('selectSurfaces', () => {
	it('applies the subset predicate to the level tag and bounds centre', () => {
		const surfaces = [surface(1, 5, 5, 100), surface(1, 50, 5), surface(2, 5, 5)];
		const inLevelOneRect = (tag: number, x: number, z: number) =>
			tag === 1 && x >= 0 && x < 10 && z >= 0 && z < 10;
		// the first reaches far past the rectangle, but its centre is inside
		assert.deepEqual(selectSurfaces(surfaces, inLevelOneRect), [surfaces[0]]);
		assert.equal(selectSurfaces(surfaces, () => true).length, 3);
	});
});

describe('sectorsOverlapping', () => {
	const global: Pick<WaterGlobal, 'center' | 'sectorSize'> = { center: [100, -100], sectorSize: 128 };
	const box = (minX: number, minZ: number, maxX: number, maxZ: number): { bounds: Bounds } => ({
		bounds: { min: [minX, 0, minZ], max: [maxX, 0, maxZ] },
	});

	it('keeps sectors whose square, offset by the centre, overlaps a surface', () => {
		const sectors = [
			{ x: 0, z: 0 },
			{ x: -1, z: 0 },
			{ x: 0, z: -1 },
			{ x: 3, z: 3 },
		];
		// sector (0, 0) is [100, 228) × [-100, 28); (-1, 0) is [-28, 100) × [-100, 28)
		assert.deepEqual(sectorsOverlapping(sectors, global, [box(110, -90, 120, -80)]), [{ x: 0, z: 0 }]);
		assert.deepEqual(sectorsOverlapping(sectors, global, [box(90, -90, 110, -80)]), [
			{ x: 0, z: 0 },
			{ x: -1, z: 0 },
		]);
		// touching an edge isn't overlapping
		assert.deepEqual(sectorsOverlapping(sectors, global, [box(228, 28, 240, 40)]), []);
		assert.deepEqual(sectorsOverlapping(sectors, global, []), []);
	});
});

describe('finishWater', () => {
	it('maps planned texture indices to texture-table ids and survives JSON', () => {
		const table: WaterTable = {
			global: {
				mapSize: 4096,
				sectorSize: 128,
				center: [0, 0],
				flowmapPrecision: 0.5,
				flowMap: 0,
				causticMap: 1,
				normalMaps: 2,
				rainMap: null,
				sectors: [
					{ x: -1, z: 2, texture: 3 },
					{ x: 0, z: 2, texture: 4 },
				],
			},
			configs: [],
			surfaces: [],
			volumes: [],
		};
		const plan: WaterPlan = {
			surfaceOwners: [],
			table,
			textures: [],
			debug: {
				surfaces: { scene: 0, packed: 0 },
				volumes: { scene: 0, packed: 0 },
				global: null,
				sectors: { scene: 2, packed: 2 },
				rows: [],
				errors: [],
			},
		};
		const finished = finishWater(plan, [10, 11, 12, 13, null]);
		assert.deepEqual(
			{ ...finished.global, sectors: finished.global?.sectors },
			{
				mapSize: 4096,
				sectorSize: 128,
				center: [0, 0],
				flowmapPrecision: 0.5,
				flowMap: 10,
				causticMap: 11,
				normalMaps: 12,
				rainMap: null,
				sectors: [
					{ x: -1, z: 2, texture: 13 },
					{ x: 0, z: 2, texture: null },
				],
			},
		);
		assert.deepEqual(JSON.parse(JSON.stringify(finished)), finished);
	});

	it('passes a table without global water through', () => {
		const plan: WaterPlan = {
			surfaceOwners: [],
			table: { global: null, configs: [], surfaces: [], volumes: [] },
			textures: [],
			debug: {
				surfaces: { scene: 3, packed: 0 },
				volumes: { scene: 0, packed: 0 },
				global: null,
				sectors: { scene: 0, packed: 0 },
				rows: [],
				errors: [],
			},
		};
		assert.deepEqual(finishWater(plan, []), { global: null, configs: [], surfaces: [], volumes: [] });
	});
});
