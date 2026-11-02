/* oxlint-disable no-await-in-loop -- traverse in authored order with bounded bundle residency */
import { crc32 } from 'node:zlib';

import { FormatError } from '@endfield-noclip/formats/binary/binary-reader';
import type { ClipMaterialValue, ClipTransformValue } from '@endfield-noclip/formats/unity/animation-clip';
import { parseMaterial } from '@endfield-noclip/formats/unity/material';
import { UnityClass } from '@endfield-noclip/formats/unity/serialized-file';
import { multiplyMatrices, trsMatrix, transformBounds } from '@endfield-noclip/formats/unity/transform';
import type { TypeTreeObject } from '@endfield-noclip/formats/unity/type-tree';
import {
	aabbField,
	arrayField,
	asPPtr,
	booleanField,
	isObject,
	numberField,
	objectField,
	pptrField,
	stringField,
	type Aabb,
} from '@endfield-noclip/formats/unity/values';
import { ChainFlags } from '@endfield-noclip/package-format/instances';
import { ParticleRenderMode, type ParticleSystemInfo } from '@endfield-noclip/package-format/particles';

import { objectKey, type AssetResolver, type ObjectRef } from './assets.ts';
import { isBillboardType, type PrefabBillboard, readBillboard } from './billboard.ts';
import { frozenParticleMatrix, type LocalTransform, SCALING_SHAPE } from './particle-mesh.ts';
import { particleReach, readParticleSystem } from './particle-system.ts';
import { isSplineMoverType, splineMoverRenderers } from './spline-movers.ts';
import {
	animatorHiddenNodes,
	isOneShotEffect,
	isViewStateControllerType,
	playedEffectNodes,
} from './view-state-effects.ts';

/** one enabled mesh renderer in a prefab's highest-detail authored LOD */
export interface PrefabRenderer {
	name: string;
	matrix: Float32Array;
	bounds: Aabb;
	mesh: ObjectRef;
	materials: (ObjectRef | null)[];
	submeshes: number;
	shadowOnly: boolean;
	/** bone transforms including bind poses, when geometry must be baked into prefab space */
	pose: Float32Array[] | null;
	/**
	 * the particle system that draws the mesh once per particle, `null` for an ordinary renderer. the matrix is
	 * then the system's frame and the bounds everywhere its particles reach
	 */
	particles: ParticleSystemInfo | null;
	/**
	 * why the renderer can't draw as the game does, `null` when it can. it's then a stand-in: a particle system
	 * the viewer can't play draws its mesh once at the emitter (turned to the camera for quads), and a skinned
	 * mesh the reader can't pose draws unposed at its renderer, or posed without its blend shapes, and a
	 * renderer under a switched-off GameObject draws as it would once switched on
	 */
	unsupported: string | null;
	/**
	 * the billboard on the renderer's GameObject or its nearest ancestor with one, `null` when nothing turns it
	 * to the camera. skinned meshes and particle systems don't take it
	 */
	billboard: PrefabBillboard | null;
	/**
	 * per material slot, the saved values the pose's clips replace on this renderer, `null` where they replace
	 * none
	 */
	materialValues: (MaterialValues | null)[];
}

/** material values a pose sets on a renderer, by property name, replacing the material's saved ones */
export interface MaterialValues {
	floats: Record<string, number>;
	colors: Record<string, [number, number, number, number]>;
}

/** a ParticleSystemRenderer's `m_Pivot` components as clip bindings name them */
const PIVOT_ATTRIBUTES = ['x', 'y', 'z'].map((axis) => crc32(`m_Pivot.${axis}`) >>> 0);

/**
 * how a GameObject is switched off: `standIn` names why for a subtree drawn as stand-ins, and is `null` for
 * one the pose switches off, which draws nothing
 */
interface SwitchedOff {
	standIn: string | null;
}

/** a pose a prefab is drawn in instead of as saved: view states' clip end poses and the nodes they switch */
export interface PrefabPose {
	/** tells the poses of one prefab apart, for caching */
	key: string;
	/** clip end poses, one per Animator they bind below */
	clips: readonly PoseClip[];
	/** GameObjects the states switch on or off, by name */
	active: ReadonlyMap<string, boolean>;
}

/** what one Animator's clip leaves its subtree at */
export interface PoseClip {
	/** the GameObject whose Animator the clip binds below, by name; `null` for the prefab root */
	animator: string | null;
	/** Transform values by binding path (CRC32 of the path below the Animator) */
	transforms: ReadonlyMap<number, readonly ClipTransformValue[]>;
	/** GameObjects the clip switches on or off, by binding path */
	active: ReadonlyMap<number, boolean>;
	/** material properties the clip sets on renderers, by binding path */
	materials: ReadonlyMap<number, readonly ClipMaterialValue[]>;
	/** other renderer properties the clip sets, by binding path, then by attribute */
	renderers: ReadonlyMap<number, ReadonlyMap<number, number>>;
}

/** an Animator above a GameObject */
interface AnimatorScope {
	/** binding paths below the Animator its clips never show ({@link animatorHiddenNodes}) */
	hidden: ReadonlySet<number>;
	/** the GameObject's path below the Animator, `/`-joined; '' for the Animator's own */
	path: string;
}

const xyz = (value: TypeTreeObject): [number, number, number] => [
	numberField(value, 'x'),
	numberField(value, 'y'),
	numberField(value, 'z'),
];

/**
 * walks a prefab's hierarchy and resolves the active renderers' dependencies through their exact PPtrs. only
 * the first authored LOD is emitted; other LOD renderers are excluded by identity, never by name
 *
 * @param resolver bundle reader
 * @param root prefab GameObject
 * @param pose a pose to draw instead of the saved one, or `null`; the root's own Transform keeps the caller's
 *   placement
 * @param particleQuad the unit quad billboard particle systems draw, or `null` to skip them
 * @returns enabled mesh renderers relative to the prefab root; the caller supplies the root placement. those
 *   under GameObjects switched off as saved are stand-ins ({@link PrefabRenderer.unsupported}); those the
 *   pose switches off are left out
 * @throws {FormatError} on malformed hierarchy, missing references or unsupported renderer dependencies
 */
export const readPrefabRenderers = async (
	resolver: AssetResolver,
	root: ObjectRef,
	pose: PrefabPose | null,
	particleQuad: ObjectRef | null,
): Promise<PrefabRenderer[]> => {
	const candidates: {
		ref: ObjectRef;
		data: TypeTreeObject;
		matrix: Float32Array;
		name: string;
		mesh: ObjectRef;
		particles: ParticleSystemInfo | null;
		unsupported: string | null;
		billboard: PrefabBillboard | null;
		/** material values the pose's clips set on the renderer */
		posedMaterials: readonly ClipMaterialValue[];
	}[] = [];
	const excluded = new Set<string>();
	const firstLod = new Set<string>();
	const seen = new Set<string>();
	const transforms = new Map<string, Float32Array>();
	// GameObjects a view-state controller switches on to play an effect, found before their subtrees are visited
	const played = new Set<string>();
	const visit = async (
		go: ObjectRef,
		parent: Float32Array,
		isRoot: boolean,
		/** how the parent is switched off, `null` when it's drawn */
		parentOff: SwitchedOff | null,
		inherited: PrefabBillboard | null,
		/** per pose clip, the parent's path below that clip's Animator, `null` outside it */
		above: readonly (string | null)[],
		/** the Animators above the parent: what their clips never show, and the parent's path below each */
		animators: readonly AnimatorScope[],
	): Promise<void> => {
		const key = objectKey(go);
		if (seen.has(key)) {
			throw new FormatError(`cyclic prefab hierarchy at ${key}`);
		}
		seen.add(key);
		const data = await resolver.read(go);
		const name = stringField(data, 'm_Name');
		const scopes: AnimatorScope[] = animators.map((scope) => ({
			hidden: scope.hidden,
			path: scope.path === '' ? name : `${scope.path}/${name}`,
		}));
		// clip bindings name GameObjects by their `/`-joined path below the Animator's own, which is ''
		const below = (pose?.clips ?? []).map((clip, i): string | null => {
			const parentPath = above[i] ?? null;
			if (parentPath !== null) {
				return parentPath === '' ? name : `${parentPath}/${name}`;
			}
			return (isRoot ? clip.animator === null : name === clip.animator) ? '' : null;
		});
		// renderer values the pose's clips leave on this GameObject
		const posedMaterials: ClipMaterialValue[] = [];
		const posedRenderer = new Map<number, number>();
		for (const [i, clip] of (pose?.clips ?? []).entries()) {
			const path = below[i];
			if (path === null) {
				continue;
			}
			const binding = crc32(path) >>> 0;
			posedMaterials.push(...(clip.materials.get(binding) ?? []));
			for (const [attribute, value] of clip.renderers.get(binding) ?? []) {
				posedRenderer.set(attribute, value);
			}
		}
		// a switched-off subtree draws only stand-ins, since a script or view state can switch it on, unless the
		// pose switched it off: that pose's other states are placed on their own. skinned meshes can still use its
		// transforms as bones
		let off = parentOff;
		if (off === null) {
			let posed = pose?.active.get(name);
			// a settled clip that switches GameObjects owns its subtree's activity: what it leaves off stays off
			let switching = false;
			for (const [i, clip] of (pose?.clips ?? []).entries()) {
				const path = below[i];
				if (path !== null && path !== '') {
					posed = clip.active.get(crc32(path) >>> 0) ?? posed;
					switching ||= clip.active.size > 0;
				}
			}
			if (posed === false || (posed === undefined && switching && !booleanField(data, 'm_IsActive'))) {
				off = { standIn: null };
			} else if (posed === undefined && !booleanField(data, 'm_IsActive')) {
				// a one-shot effect a view state plays shows for a moment, never at rest; what the prefab's own
				// Animator only ever holds off never shows
				const neverShown = scopes.some((scope) => scope.hidden.has(crc32(scope.path) >>> 0));
				off =
					neverShown || (played.has(key) && (await isOneShotEffect(resolver, go)))
						? { standIn: null }
						: { standIn: 'switched off until a script or view state turns it on' };
			}
		}
		const standIn = off?.standIn ?? null;
		const wanted =
			off === null || standIn !== null
				? [
						UnityClass.Transform,
						UnityClass.MeshFilter,
						UnityClass.MeshRenderer,
						UnityClass.SkinnedMeshRenderer,
						UnityClass.ParticleSystem,
						UnityClass.ParticleSystemRenderer,
						// LODGroup
						205,
					]
				: [UnityClass.Transform];
		const components: { ref: ObjectRef; data: TypeTreeObject }[] = [];
		const movers: { ref: ObjectRef; data: TypeTreeObject }[] = [];
		let board: TypeTreeObject | null = null;
		for (const item of arrayField(data, 'm_Component')) {
			if (!isObject(item)) {
				throw new FormatError('prefab component is not an object');
			}
			const ref = await resolver.resolve(go, pptrField(item, 'component'));
			if (ref === null) {
				continue;
			}
			if (wanted.includes(ref.info.classId)) {
				components.push({ ref, data: await resolver.read(ref) });
			} else if (wanted.length > 1 && ref.info.classId === UnityClass.MonoBehaviour && isBillboardType(ref)) {
				board = await resolver.read(ref);
			} else if (
				wanted.length > 1 &&
				ref.info.classId === UnityClass.MonoBehaviour &&
				isSplineMoverType(ref)
			) {
				const moverData = await resolver.read(ref);
				if (booleanField(moverData, 'm_Enabled')) {
					movers.push({ ref, data: moverData });
				}
			} else if (ref.info.classId === UnityClass.MonoBehaviour && isViewStateControllerType(ref)) {
				for (const node of await playedEffectNodes(resolver, ref, await resolver.read(ref))) {
					played.add(node);
				}
			} else if (ref.info.classId === UnityClass.Animator) {
				const hidden = await animatorHiddenNodes(resolver, ref, await resolver.read(ref));
				if (hidden.size > 0) {
					scopes.push({ hidden, path: '' });
				}
			}
		}
		const transform = components.find((component) => component.ref.info.classId === UnityClass.Transform);
		if (transform === undefined) {
			throw new FormatError(`prefab GameObject ${key} has no Transform`);
		}
		const t = transform.data;
		const rotation = objectField(t, 'm_LocalRotation');
		// the root's own placement comes from the caller
		const local: LocalTransform = isRoot
			? { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }
			: {
					position: xyz(objectField(t, 'm_LocalPosition')),
					rotation: [...xyz(rotation), numberField(rotation, 'w')],
					scale: xyz(objectField(t, 'm_LocalScale')),
				};
		for (const [i, clip] of (pose?.clips ?? []).entries()) {
			const path = below[i];
			if (isRoot || path === null) {
				continue;
			}
			for (const value of clip.transforms.get(crc32(path) >>> 0) ?? []) {
				switch (value.kind) {
					case 'position': {
						local.position = value.value;
						break;
					}
					case 'rotation': {
						local.rotation = value.value;
						break;
					}
					case 'scale': {
						local.scale = value.value;
						break;
					}
				}
			}
		}
		const matrix = isRoot
			? parent
			: multiplyMatrices(parent, trsMatrix(local.position, local.rotation, local.scale));
		transforms.set(objectKey(transform.ref), matrix);
		// a billboard sets its GameObject's world rotation, so the nearest one up the hierarchy wins
		const billboard = (board && readBillboard(board, matrix)) ?? inherited;
		for (const component of components) {
			if (component.ref.info.classId !== 205 || !booleanField(component.data, 'm_Enabled')) {
				continue;
			}
			for (const [lod, value] of arrayField(component.data, 'm_LODs').entries()) {
				if (!isObject(value)) {
					throw new FormatError('invalid prefab LOD');
				}
				for (const renderer of arrayField(value, 'renderers')) {
					if (!isObject(renderer)) {
						throw new FormatError('invalid prefab LOD renderer');
					}
					const ref = await resolver.resolve(component.ref, pptrField(renderer, 'renderer'));
					if (ref !== null) {
						(lod === 0 ? firstLod : excluded).add(objectKey(ref));
					}
				}
			}
		}
		for (const component of components) {
			if (
				component.ref.info.classId === UnityClass.SkinnedMeshRenderer &&
				booleanField(component.data, 'm_Enabled')
			) {
				const mesh = await resolver.resolve(component.ref, pptrField(component.data, 'm_Mesh'));
				if (mesh !== null) {
					candidates.push({
						...component,
						matrix,
						name,
						mesh,
						particles: null,
						unsupported: standIn,
						billboard: null,
						posedMaterials,
					});
				}
			}
		}
		const filter = components.find((component) => component.ref.info.classId === UnityClass.MeshFilter);
		if (filter !== undefined) {
			const mesh = await resolver.resolve(filter.ref, pptrField(filter.data, 'm_Mesh'));
			if (mesh !== null) {
				for (const component of components) {
					if (
						component.ref.info.classId === UnityClass.MeshRenderer &&
						booleanField(component.data, 'm_Enabled')
					) {
						candidates.push({
							...component,
							matrix,
							name,
							mesh,
							particles: null,
							unsupported: standIn,
							billboard,
							posedMaterials,
						});
					}
				}
			}
		}
		const particles = components.find(
			(component) =>
				component.ref.info.classId === UnityClass.ParticleSystemRenderer &&
				booleanField(component.data, 'm_Enabled'),
		);
		const system = components.find((component) => component.ref.info.classId === UnityClass.ParticleSystem);
		if (particles !== undefined && system !== undefined) {
			// the pose can move the particles' pivot; a copy keeps the cached renderer as saved
			let rendererData = particles.data;
			if (PIVOT_ATTRIBUTES.some((attribute) => posedRenderer.has(attribute))) {
				const saved = objectField(rendererData, 'm_Pivot');
				const [x, y, z] = PIVOT_ATTRIBUTES.map(
					(attribute, i) => posedRenderer.get(attribute) ?? numberField(saved, 'xyz'[i]),
				);
				rendererData = { ...rendererData, m_Pivot: { x, y, z } };
			}
			// a switched-off system stands in at its emitter whatever it would play
			const particle = standIn === null ? frozenParticleMatrix(system.data, rendererData, local) : null;
			if (particle !== null) {
				const mesh = await resolver.resolve(particles.ref, pptrField(particles.data, 'm_Mesh'));
				if (mesh !== null) {
					candidates.push({
						...particles,
						matrix: multiplyMatrices(parent, particle),
						name,
						mesh,
						particles: null,
						unsupported: null,
						billboard: null,
						posedMaterials,
					});
				}
			} else {
				const read = readParticleSystem(system.data, rendererData);
				// the shape scaling mode scales the shape alone, leaving the particles' sizes
				const scale = numberField(system.data, 'scalingMode') === SCALING_SHAPE ? [1, 1, 1] : local.scale;
				const emitter = multiplyMatrices(parent, trsMatrix(local.position, local.rotation, scale));
				// a system a script starts is still there to see, so it gets a stand-in too
				let reason = standIn;
				if (reason === null && read === null) {
					reason = `doesn't play on awake`;
				} else if (reason === null && read !== null && 'reason' in read) {
					reason = read.reason;
				}
				if (reason !== null) {
					// a stand-in shows where the system would play: its first mesh, or a quad facing the camera
					let mesh: ObjectRef | null = null;
					if (numberField(particles.data, 'm_RenderMode') === ParticleRenderMode.Mesh) {
						mesh = await resolver.resolve(particles.ref, pptrField(particles.data, 'm_Mesh'));
					}
					const quad = mesh === null;
					mesh ??= particleQuad;
					if (mesh !== null) {
						candidates.push({
							...particles,
							matrix: emitter,
							name,
							mesh,
							particles: null,
							unsupported: reason,
							billboard: quad
								? { flag: ChainFlags.BillboardFacing, offset: [0, 0, 0, 1], frame: emitter }
								: null,
							posedMaterials,
						});
					}
				} else if (read !== null && 'info' in read) {
					// one emitter per mesh, each drawing the particles that picked it; quads have none of their own
					const meshes =
						read.meshes.length === 0
							? [particleQuad]
							: await Promise.all(read.meshes.map((pointer) => resolver.resolve(particles.ref, pointer)));
					for (const [i, mesh] of meshes.entries()) {
						if (mesh !== null) {
							candidates.push({
								...particles,
								matrix: emitter,
								name,
								mesh,
								particles: { ...read.info, mesh: i },
								unsupported: null,
								billboard: null,
								posedMaterials,
							});
						}
					}
				}
			}
		}
		for (const mover of movers) {
			// the objects draw their LOD groups' first-LOD renderers, which live in other prefabs
			for (const renderer of await splineMoverRenderers(resolver, mover.ref, mover.data, standIn)) {
				candidates.push({ ...renderer, matrix, name, billboard: null, posedMaterials: [] });
			}
		}
		for (const pointer of arrayField(t, 'm_Children')) {
			const child = await resolver.resolve(transform.ref, asPPtr(pointer));
			if (child !== null) {
				const childData = await resolver.read(child);
				const childGo = await resolver.resolve(child, pptrField(childData, 'm_GameObject'));
				if (childGo !== null) {
					await visit(childGo, matrix, false, off, billboard, below, scopes);
				}
			}
		}
	};
	await visit(root, trsMatrix([0, 0, 0], [0, 0, 0, 1], [1, 1, 1]), true, null, null, [], []);
	const result: PrefabRenderer[] = [];
	for (const candidate of candidates) {
		const key = objectKey(candidate.ref);
		if (excluded.has(key) && !firstLod.has(key)) {
			continue;
		}
		const materials: (ObjectRef | null)[] = [];
		for (const pointer of arrayField(candidate.data, 'm_Materials')) {
			// oxlint-disable-next-line no-await-in-loop -- preserve renderer slot order
			const ref = await resolver.resolve(candidate.ref, asPPtr(pointer));
			materials.push(ref);
		}
		// oxlint-disable-next-line no-await-in-loop -- mesh headers are cached by the resolver
		const mesh = await resolver.read(candidate.mesh);
		if (arrayField(mesh, 'm_SubMeshes').length === 0 || materials.length === 0) {
			continue;
		}
		let matrix = candidate.matrix;
		let bounds = aabbField(mesh, 'm_LocalAABB');
		if (candidate.particles !== null) {
			bounds = particleReach(
				candidate.particles,
				Math.hypot(...bounds.center) + Math.hypot(...bounds.extents),
			);
		}
		let skin: Float32Array[] | null = null;
		let unsupported = candidate.unsupported;
		if (candidate.ref.info.classId === UnityClass.SkinnedMeshRenderer) {
			// a skinned mesh the reader can't pose stands in unposed, at its renderer, rather than failing the prefab
			const posed = await poseSkin(resolver, candidate, mesh, bounds, transforms);
			if ('reason' in posed) {
				unsupported = posed.reason;
			} else {
				skin = posed.skin;
				bounds = posed.bounds;
				matrix = trsMatrix([0, 0, 0], [0, 0, 0, 1], [1, 1, 1]);
				// the mesh is baked without its blend shapes, so it isn't the shape the game draws
				if (arrayField(candidate.data, 'm_BlendShapeWeights').some((weight) => weight !== 0)) {
					unsupported ??= 'nonzero blend shape';
				}
			}
		}
		const materialValues: (MaterialValues | null)[] = [];
		for (const material of materials) {
			// oxlint-disable-next-line no-await-in-loop -- material reads are cached by the resolver
			materialValues.push(
				material === null ? null : await posedMaterialValues(resolver, material, candidate.posedMaterials),
			);
		}
		result.push({
			name: candidate.name,
			matrix,
			bounds,
			pose: skin,
			mesh: candidate.mesh,
			materials,
			materialValues,
			submeshes: arrayField(mesh, 'm_SubMeshes').length,
			// Unity's ShadowCastingMode: 3 ShadowsOnly, 4 ShadowsOnlyTwoSided
			shadowOnly: numberField(candidate.data, 'm_CastShadows') >= 3,
			particles: candidate.particles,
			unsupported,
			billboard: candidate.billboard,
		});
	}
	return result;
};

/** @returns property names by the hash clip bindings name them with: the low 28 bits of their CRC32 */
const byHash = (names: Iterable<string>): Map<number, string> =>
	new Map([...names].map((name) => [crc32(name) & 0x0fff_ffff, name]));

/**
 * resolves the material values a pose sets on a renderer against one of its materials. clips name properties
 * by a hash of the name, so a value whose property the material doesn't save is left out
 *
 * @returns the replaced values by name, or `null` when the pose replaces none of this material's
 */
const posedMaterialValues = async (
	resolver: AssetResolver,
	material: ObjectRef,
	values: readonly ClipMaterialValue[],
): Promise<MaterialValues | null> => {
	if (values.length === 0) {
		return null;
	}
	const record = parseMaterial(await resolver.read(material));
	const floatNames = byHash([...Object.keys(record.floats), ...Object.keys(record.ints)]);
	const colorNames = byHash(Object.keys(record.colors));
	const floats: Record<string, number> = {};
	const colors: Record<string, [number, number, number, number]> = {};
	for (const { nameHash, component, value } of values) {
		if (component === null) {
			const name = floatNames.get(nameHash);
			if (name !== undefined) {
				floats[name] = value;
			}
			continue;
		}
		const name = colorNames.get(nameHash);
		if (name !== undefined) {
			colors[name] ??= [...record.colors[name]];
			colors[name][component] = value;
		}
	}
	return Object.keys(floats).length + Object.keys(colors).length === 0 ? null : { floats, colors };
};

/**
 * bakes a skinned renderer's authored pose: each bone's prefab-space matrix times its bind pose
 *
 * @returns the bone matrices and the bounds every weighted position lies in, or why the skeleton can't be
 *   posed
 */
const poseSkin = async (
	resolver: AssetResolver,
	renderer: { ref: ObjectRef; data: TypeTreeObject },
	mesh: TypeTreeObject,
	meshBounds: Aabb,
	transforms: ReadonlyMap<string, Float32Array>,
): Promise<{ skin: Float32Array[]; bounds: Aabb } | { reason: string }> => {
	const bones = arrayField(renderer.data, 'm_Bones');
	const bindPoses = arrayField(mesh, 'm_BindPose');
	if (bones.length !== bindPoses.length || bones.length === 0) {
		return { reason: 'invalid skeleton' };
	}
	const skin: Float32Array[] = [];
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (const [i, pointer] of bones.entries()) {
		// oxlint-disable-next-line no-await-in-loop -- bones are few and their reads cached
		const bone = await resolver.resolve(renderer.ref, asPPtr(pointer));
		const boneMatrix = bone && transforms.get(objectKey(bone));
		const bind = bindPoses[i];
		if (!boneMatrix || !isObject(bind)) {
			return { reason: 'unresolved bone' };
		}
		const bindMatrix = new Float32Array(
			Array.from({ length: 16 }, (_, k) => numberField(bind, 'e' + (k % 4) + Math.floor(k / 4))),
		);
		const posed = multiplyMatrices(boneMatrix, bindMatrix);
		skin.push(posed);
		const transformed = transformBounds(meshBounds, posed);
		for (let axis = 0; axis < 3; axis++) {
			min[axis] = Math.min(min[axis], transformed.center[axis] - transformed.extents[axis]);
			max[axis] = Math.max(max[axis], transformed.center[axis] + transformed.extents[axis]);
		}
	}
	// weighted positions lie inside this union, including poses whose bones move beyond the bind bounds
	return {
		skin,
		bounds: {
			center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
			extents: [(max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2],
		},
	};
};
