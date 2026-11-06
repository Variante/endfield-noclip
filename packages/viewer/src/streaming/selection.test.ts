import assert from 'node:assert/strict';
import { it } from 'node:test';

import { ContentKind, type ContentRef } from '@endfield-noclip/package-format/tree';

import { Camera } from '../scene/camera.ts';
import type { TileNode, TileTree } from '../scene/tile-tree.ts';

import type { ContentItem } from './content-item.ts';
import { Selector, type SelectionOptions } from './selection.ts';

it('streams conditional scenery independently of coarse HLOD and never requests hidden variants', () => {
	// groups: 0 level 1 with condition 0, 1 level 1 with condition 1, 2 level 2 with condition 0, 3 level 1
	const ref = (blob: number, group: number): ContentRef => ({
		kind: ContentKind.Conditional,
		tier: 0,
		group,
		blob,
		first: 0,
		count: 1,
		param: 0,
	});
	const child: TileNode = {
		index: 1,
		level: 1,
		x: 0,
		z: 0,
		minX: 0,
		minZ: 0,
		size: 50,
		bounds: { min: [0, 0, 0], max: [50, 50, 50] },
		geometricError: 0,
		quadrants: [null, null, null, null],
		terrain: null,
		surface: null,
		terrainSplat: null,
		detail: [],
		hlod: [],
		conditional: [ref(1, 0), ref(2, 1), ref(3, 2)],
		cellId: null,
	};
	const root: TileNode = {
		...child,
		index: 0,
		level: 0,
		size: 100,
		quadrants: [child, null, null, null],
		conditional: [],
		hlod: [{ ...ref(9, 3), kind: ContentKind.Hlod }],
	};
	const tree: TileTree = {
		nodes: [root, child],
		roots: [root],
		byId: new Map(),
		terrainLeafLevel: -1,
		terrainRootLevel: Infinity,
	};
	const wanted: number[] = [];
	const selector = new Selector(
		tree,
		{
			want(blob) {
				wanted.push(blob);
				return null;
			},
			get() {
				return undefined;
			},
			markUsed() {
				return false;
			},
			isReady() {
				return false;
			},
		},
		[],
		100,
	);
	const options: SelectionOptions = {
		terrain: false,
		terrainSurface: false,
		terrainSplat: false,
		instances: true,
		detail: true,
		global: true,
		maxSse: 12,
		terrainPixels: 3,
		hlodTiers: [true, true, true],
	};
	const view = { camera: new Camera(), planes: [], pixelFactor: 100, casters: null };
	// level 1 shown, condition 0 holds
	selector.setGroupsShown([true, false, false, true]);
	selector.run(view, options, null);
	assert.deepEqual(wanted, [9, 1]);
	wanted.length = 0;
	// condition 1 holds instead
	selector.setGroupsShown([false, true, false, true]);
	selector.run(view, options, null);
	assert.deepEqual(wanted, [9, 2]);
	wanted.length = 0;
	selector.run(view, { ...options, detail: false }, null);
	assert.deepEqual(wanted, [9]);
	wanted.length = 0;
	// 50 m tiles 1 km away span 5 px at this pixel factor: under maxSse, so nothing conditional is requested
	const far = new Camera();
	far.position = [1050, 0, 0];
	selector.run({ ...view, camera: far }, options, null);
	assert.deepEqual(wanted, [9]);
});

it('drops the HLOD of a nearby leaf with no detail instead of overlaying the scenery it stands for', () => {
	const leaf: TileNode = {
		index: 0,
		level: 0,
		x: 0,
		z: 0,
		minX: 0,
		minZ: 0,
		size: 64,
		bounds: { min: [0, 0, 0], max: [64, 64, 64] },
		geometricError: 4,
		quadrants: [null, null, null, null],
		terrain: null,
		surface: null,
		terrainSplat: null,
		detail: [],
		hlod: [{ kind: ContentKind.Hlod, tier: 0, group: 0, blob: 9, first: 0, count: 1, param: 0 }],
		conditional: [],
		cellId: null,
	};
	const tree: TileTree = {
		nodes: [leaf],
		roots: [leaf],
		byId: new Map(),
		terrainLeafLevel: -1,
		terrainRootLevel: Infinity,
	};
	const item = { blob: 9 } as ContentItem;
	const selector = new Selector(
		tree,
		{
			want: () => item,
			get: () => item,
			markUsed: () => true,
			isReady: () => true,
		},
		[],
		100,
	);
	selector.setGroupsShown([true]);
	const options: SelectionOptions = {
		terrain: false,
		terrainSurface: false,
		terrainSplat: false,
		instances: true,
		detail: true,
		global: true,
		maxSse: 12,
		terrainPixels: 3,
		hlodTiers: [true, true, true],
	};
	const near = new Camera();
	near.position = [32, 32, -10];
	const view = { camera: near, planes: [], pixelFactor: 1000, casters: null };
	// 4 m of error 10 m away spans 400 px: the leaf refines into its (empty) detail
	assert.equal(selector.run(view, options, null).instances.length, 0);
	// with detail off the cluster is all there is to show
	assert.equal(selector.run(view, { ...options, detail: false }, null).instances.length, 1);
	const far = new Camera();
	far.position = [32, 32, -1000];
	assert.equal(selector.run({ ...view, camera: far }, options, null).instances.length, 1);
});

it('keeps drawing the HLOD in place of a refinement still loading, then the refinement', () => {
	const ref = (kind: ContentRef['kind'], blob: number): ContentRef => ({
		kind,
		tier: 0,
		group: 0,
		blob,
		first: blob * 10,
		count: blob,
		param: 0,
	});
	const node = (index: number, minX: number, size: number): TileNode => ({
		index,
		level: index === 0 ? 0 : 1,
		x: 0,
		z: 0,
		minX,
		minZ: 0,
		size,
		bounds: { min: [minX, 0, 0], max: [minX + size, 64, size] },
		geometricError: size / 16,
		quadrants: [null, null, null, null],
		terrain: null,
		surface: null,
		terrainSplat: null,
		detail: [],
		hlod: [],
		conditional: [],
		cellId: null,
	});
	const root = node(0, 0, 128);
	const left = node(1, 0, 64);
	const right = node(2, 64, 64);
	root.quadrants = [left, right, null, null];
	root.hlod = [ref(ContentKind.Hlod, 1)];
	left.detail = [ref(ContentKind.Detail, 2)];
	right.detail = [ref(ContentKind.Detail, 3)];
	const tree: TileTree = {
		nodes: [root, left, right],
		roots: [root],
		byId: new Map(),
		terrainLeafLevel: -1,
		terrainRootLevel: Infinity,
	};
	const resident = new Set([1, 2]);
	const items = new Map([1, 2, 3].map((blob) => [blob, { blob } as ContentItem]));
	const selector = new Selector(
		tree,
		{
			want: (blob) => (resident.has(blob) ? (items.get(blob) ?? null) : null),
			get: (blob) => items.get(blob),
			markUsed: (blob) => resident.has(blob),
			isReady: (blob) => resident.has(blob),
		},
		[],
		128,
	);
	selector.setGroupsShown([true]);
	const options: SelectionOptions = {
		terrain: false,
		terrainSurface: false,
		terrainSplat: false,
		instances: true,
		detail: true,
		global: true,
		maxSse: 12,
		terrainPixels: 3,
		hlodTiers: [true, true, true],
	};
	const camera = new Camera();
	camera.position = [64, 32, -10];
	const view = { camera, planes: [], pixelFactor: 1000, casters: null };
	const ranges = (): [blob: number, first: number, count: number][] =>
		selector.run(view, options, null).instances.map(({ item, first, count }) => [item.blob, first, count]);
	assert.deepEqual(ranges(), [[1, 10, 1]]);
	resident.add(3);
	assert.deepEqual(ranges(), [
		[2, 20, 2],
		[3, 30, 3],
	]);
	resident.delete(3);
	assert.deepEqual(ranges(), [[1, 10, 1]]);
});
