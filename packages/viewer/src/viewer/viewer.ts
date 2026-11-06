import {
	conditionResults,
	groupsShown,
	resolveSceneValues,
} from '@endfield-noclip/package-format/conditions';
import type { IrradianceRegionInfo, IrradianceTable } from '@endfield-noclip/package-format/irradiance';
import type { LevelInfo, PackageManifest } from '@endfield-noclip/package-format/manifest';
import { proximityValues } from '@endfield-noclip/package-format/proximity';
import {
	areasShownIn,
	streamAreaValues,
	zonesAround,
	zonesAt,
} from '@endfield-noclip/package-format/stream-areas';
import type { Vec3 } from '@endfield-noclip/package-format/values';
import type { WaterSurfaceEntry } from '@endfield-noclip/package-format/water';

import { markBillboardRows, ROW_BYTES, ROW_WORDS, turnRows } from '../content/instance-rows.ts';
import { instanceRowKinds } from '../content/row-kinds.ts';
import type { AppliedVolume } from '../environment/blend.ts';
import { windClockRate } from '../environment/environment.ts';
import { type GfxDevice, createGfxDevice } from '../gfx/device.ts';
import { GpuProfiler } from '../gfx/gpu-profiler.ts';
import { PipelineCache } from '../gfx/pipeline-cache.ts';
import { UniformRing } from '../gfx/uniform-ring.ts';
import { materialLooks } from '../looks/material-looks.ts';
import { DecodePool } from '../package/decode-pool.ts';
import type { PackageSource } from '../package/package-source.ts';
import { type ViewerPackage, openViewerPackage } from '../package/viewer-package.ts';
import { ParticleField } from '../particles/particle-rows.ts';
import { type BindLayouts, createBindLayouts } from '../render/frame/bind-layouts.ts';
import { FrameBindings } from '../render/frame/frame-bindings.ts';
import {
	FRAME_UNIFORM_BYTES,
	FrameOffsets,
	writeFrameUniforms,
} from '../render/frame/frame-uniform-writer.ts';
import { RenderTargets } from '../render/frame/render-targets.ts';
import { InstanceRenderer } from '../render/instances/instance-renderer.ts';
import { IrradianceVolume } from '../render/lighting/irradiance-volume.ts';
import { type LocalLightFrame, LocalLights } from '../render/lighting/local-lights.ts';
import { MeshRenderer } from '../render/meshes/mesh-renderer.ts';
import { PostProcess } from '../render/post/post-process.ts';
import type { PostSettings } from '../render/post/settings.ts';
import { SETTLE_FRAMES } from '../render/post/temporal-aa.ts';
import { SHADOW_LAYERS, ShadowMap, offscreenCasters } from '../render/shadows/shadow-map.ts';
import { VolumetricFog } from '../render/sky/volumetric-fog.ts';
import { TerrainRenderer } from '../render/terrain/terrain-renderer.ts';
import { TextureStore } from '../render/textures/texture-store.ts';
import { WaterRenderer } from '../render/water/water-renderer.ts';
import { volumesForLevel } from '../scene-states/listing.ts';
import { WaterLevels, type WaterVolumeState } from '../scene-states/water-levels.ts';
import { Camera, type Plane } from '../scene/camera.ts';
import type { GroundSource } from '../scene/ground.ts';
import { levelCellIds, levelPose, overviewPose } from '../scene/level-pose.ts';
import { type CameraPose, NoclipControls } from '../scene/noclip-controls.ts';
import { type TileTree, buildTileTree } from '../scene/tile-tree.ts';
import { coreBlobs } from '../streaming/core-blobs.ts';
import { type MeshSelection, MeshSelector } from '../streaming/mesh-selection.ts';
import type { ResidentInstances } from '../streaming/resident.ts';
import { type InstanceRange, Selector } from '../streaming/selection.ts';
import { StreamManager } from '../streaming/stream-manager.ts';

import { EnvironmentState } from './environment-state.ts';
import { DEFAULT_OPTIONS, type ViewerOptions } from './options.ts';
import { updateSkyTextures } from './sky-textures.ts';
import { type ViewerStats, FrameTimes, STATS_INTERVAL, collectStats, emptyStats } from './stats.ts';

/** what the level list needs */
export interface LevelEntry {
	id: string;
	name: string;
	instances: number;
}

const TERRAIN_SLOTS = 4096;
const INSTANCE_ROWS = 1_500_000;
/** the irradiance volume of a package without one */
const EMPTY_IRRADIANCE = { keys: new Uint32Array(), blobs: new Uint32Array(), groups: new Uint32Array() };
/** the frame uniforms' local lights while they're off */
const NO_LOCAL_LIGHTS: LocalLightFrame = { count: 0, tilesX: 1, tilesY: 1 };

interface LoadedScene {
	pkg: ViewerPackage;
	tree: TileTree;
	stream: StreamManager;
	/** ground height queries over the resident coarse terrain */
	ground: GroundSource & { manifest: PackageManifest };
	selector: Selector;
	/** per-instance LOD selection, when the package has converted geometry */
	meshes: MeshSelector | null;
	textures: TextureStore;
	/** the package's converted geometries, and how many of them converted */
	geometries: { ready: number; total: number };
	levels: LevelEntry[];
}

/** the running viewer */
export class Viewer {
	readonly camera = new Camera();
	readonly controls: NoclipControls;
	readonly options: ViewerOptions = structuredClone(DEFAULT_OPTIONS);
	stats: ViewerStats;
	/** bumped when the package, the options or the shown level change; a cheap snapshot for the UI */
	stateRevision = 0;
	/** bumped when {@link stats} change */
	statsRevision = 0;
	scene: LoadedScene | null = null;

	#gfx: GfxDevice;
	#targets: RenderTargets;
	#layouts: BindLayouts;
	#pipelines: PipelineCache;
	#ring: UniformRing;
	/** group 0 for the main and shadow passes */
	#bindings: FrameBindings;
	#shadows: ShadowMap;
	readonly #lights: LocalLights;
	#profiler: GpuProfiler;
	#terrain: TerrainRenderer;
	#instances: InstanceRenderer;
	#meshes: MeshRenderer;
	#post: PostProcess;
	#fog: VolumetricFog;
	/** the loaded package's irradiance volume; an empty one without a package */
	#irradiance: IrradianceVolume;
	#water: WaterRenderer;
	/** the systems whose GPU pools and targets the stats sum */
	readonly #pools: readonly { readonly bytes: number }[];
	#waterLevels = new WaterLevels();
	/** the shown level's environment, blended at the camera */
	readonly #environment = new EnvironmentState();
	#pool: DecodePool;
	#listeners = new Set<() => void>();
	#raf = 0;
	#frame = 0;
	#lastTime = 0;
	#lastStats = 0;
	#statsKey = '';
	#dirty = true;
	/**
	 * redraws when the page is shown again: Firefox re-shows a hidden tab's last frame with red and blue
	 * swapped, and an idle view would otherwise never present a new one
	 */
	readonly #onVisibilityChange = (): void => {
		if (document.visibilityState === 'visible') {
			this.#dirty = true;
		}
	};
	/** the stream version the last traversal saw */
	#seenVersion = -1;
	/** compiled pipelines when the last frame began */
	#seenPipelines = 0;
	readonly #times = new FrameTimes();
	#visited = 0;
	/** the traversal's frustum planes, rewritten each traversal */
	#planes: Plane[] = [];
	#focusCells: Set<string> | null = null;
	/** the level being shown; `null` when the package has no level with content, which shows everything */
	#level: LevelInfo | null = null;
	/**
	 * the first view after loading, when it was posed before the coarse terrain was resident (at the spawn
	 * height); it's re-posed over the ground once that lands, unless the camera moved first
	 */
	#unsettledPose: CameraPose | null = null;
	#lastDraws = 0;
	/** frames still to render so the temporal antialiasing settles after the view stopped changing */
	#settleFrames = 0;
	/** whether the last mesh selection drew particles, which frames of a still view re-evaluate */
	#particlesShown = false;
	/** whether the last selection held spinning rows, which turn by the clock while the view holds still */
	#spinsShown = false;
	/** the clock each resident block's spinning rows were last turned to */
	#spinTimes = new WeakMap<ResidentInstances, number>();
	/** whether the shadow layers need drawing: the casters changed, or they weren't drawn last frame */
	#shadowsStale = true;
	/** each shadow layer's render matrix when it was last drawn */
	#shadowFits = new Float32Array(16 * SHADOW_LAYERS);
	/**
	 * the animation time everything that moves by the clock reads, s. it advances only on rendered frames while
	 * `animate` is on, so animation pauses when the view idles and resumes where it stopped
	 */
	#time = 0;
	/** the wind clock (`Frame.wind.x`), which advances with {@link #time} at the wind's rate */
	#windClock = 0;

	private constructor(gfx: GfxDevice, canvas: HTMLCanvasElement) {
		this.#gfx = gfx;
		const device = gfx.device;
		this.#targets = new RenderTargets(
			device,
			canvas,
			gfx.presentationFormat,
			gfx.features.depth32floatStencil8,
		);
		this.#layouts = createBindLayouts(device);
		this.#pipelines = new PipelineCache(device);
		// the main pass's frame plus one per shadow layer
		const alignment = device.limits.minUniformBufferOffsetAlignment;
		this.#ring = new UniformRing(
			device,
			Math.ceil(FRAME_UNIFORM_BYTES / alignment) * alignment * (1 + SHADOW_LAYERS),
			3,
		);
		this.#shadows = new ShadowMap(device);
		this.#irradiance = new IrradianceVolume(device, this.#pipelines);
		this.#lights = new LocalLights(device);
		this.#bindings = new FrameBindings(device, {
			layout: this.#layouts.frame,
			uniforms: this.#ring.buffer,
			shadows: this.#shadows,
			irradiance: this.#irradiance,
			lights: this.#lights,
		});
		this.#profiler = new GpuProfiler(device, gfx.features.timestampQuery);
		const format = this.#targets.format;
		this.#terrain = new TerrainRenderer(device, this.#layouts, this.#pipelines, format, {
			capacity: TERRAIN_SLOTS,
			bc: gfx.features.textureCompressionBc,
		});
		this.#instances = new InstanceRenderer(device, this.#layouts, this.#pipelines, format, INSTANCE_ROWS);
		this.#meshes = new MeshRenderer(device, this.#layouts, this.#pipelines, this.#instances, format);
		this.#fog = new VolumetricFog(device, this.#pipelines, this.#layouts.frame);
		const { environment } = this.#environment.look;
		this.#fog.setEnvironment(environment, this.camera.near);
		this.#post = new PostProcess(device, this.#pipelines, gfx.presentationFormat, environment, this.#fog);
		this.#water = new WaterRenderer(device, this.#pipelines, {
			frame: this.#layouts.frame,
			...this.#post.skyLayouts,
		});
		this.#pool = new DecodePool(Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) >> 1)));
		this.#pools = [
			this.#terrain,
			this.#instances,
			this.#meshes,
			this.#targets,
			this.#post,
			this.#fog,
			this.#shadows,
		];
		this.controls = new NoclipControls(this.camera, canvas);
		this.stats = emptyStats(gfx);
	}

	/**
	 * @param canvas the canvas to render into
	 * @param onLost called if the GPU device is lost
	 * @param signal abandons the creation; once aborted, the canvas is left untouched
	 * @returns a running viewer
	 * @throws {GfxUnsupportedError} without WebGPU
	 * @throws the signal's reason when aborted
	 */
	static async create(
		canvas: HTMLCanvasElement,
		onLost: (reason: string) => void,
		signal: AbortSignal,
	): Promise<Viewer> {
		const gfx = await createGfxDevice(onLost);
		// a canvas has one WebGPU context, shared by every viewer made on it. an abandoned viewer built anyway
		// would reconfigure that context and then unconfigure it on destroy, blacking out the viewer that
		// replaced it, so drop the device before touching the canvas
		if (signal.aborted) {
			gfx.device.destroy();
			throw signal.reason;
		}
		const viewer = new Viewer(gfx, canvas);
		viewer.#raf = requestAnimationFrame((time) => viewer.#tick(time));
		document.addEventListener('visibilitychange', viewer.#onVisibilityChange);
		return viewer;
	}

	// #region package

	/**
	 * opens a package and starts streaming it, replacing any loaded one.
	 *
	 * @param source where the package lives
	 * @param initialLevel id of the level to show first; when absent from the package, the first level with
	 *   content is shown
	 * @param onProgress loading phases for the UI
	 */
	async load(
		source: PackageSource,
		initialLevel: string | null,
		onProgress: (phase: string) => void,
	): Promise<void> {
		this.unload();
		const pkg = await openViewerPackage(source, onProgress);
		const tree = buildTileTree(pkg.manifest, pkg.tree);

		const textures = new TextureStore(this.#gfx.device, pkg.textures, {
			bc: this.#gfx.features.textureCompressionBc,
		});
		this.#setIrradiance(pkg.irradiance, pkg.manifest.irradianceRegions);
		const irradiance = this.#irradiance;
		const particles = new ParticleField(pkg.particles, this.#instances);
		const rowKinds = instanceRowKinds(tree, pkg.manifest.global);
		const terrain = this.#terrain;
		const stream = new StreamManager(
			pkg,
			this.#pool,
			{
				heights: {
					upload: (_blob, decoded, { pinned }) => terrain.upload(decoded, { keepSamples: pinned }),
					release: (_blob, resident) => terrain.release(resident),
				},
				surface: {
					upload: (_blob, decoded) => terrain.uploadSurface(decoded),
					release: (_blob, resident) => terrain.releaseSurface(resident),
				},
				splat: {
					upload: (_blob, decoded) => terrain.uploadSplat(decoded),
					release: (_blob, resident) => terrain.releaseSplat(resident),
				},
				layer: {
					upload: (blob, decoded) => terrain.uploadLayer(blob, decoded),
					// pinned for the package's lifetime; its array goes with the next `setSplat`
					release: () => {},
				},
				instances: {
					job: (blob, stored) => ({ kind: 'instances', ...stored, rowKinds: rowKinds.get(blob) ?? [] }),
					upload: (blob, decoded) => {
						// the decode worker doesn't hold the chains
						markBillboardRows(decoded, pkg.chains);
						const resident = this.#instances.upload(decoded);
						if (resident !== null) {
							this.#waterLevels.track(resident, blob);
						}
						return resident;
					},
					release: (_blob, resident) => {
						particles.release(resident);
						this.#waterLevels.untrack(resident);
						this.#instances.release(resident);
					},
				},
				geometry: {
					upload: (blob, decoded) => this.#meshes.upload(blob, decoded),
					release: (_blob, resident) => this.#meshes.release(resident),
				},
				texture: {
					upload: (blob, decoded) => textures.upload(blob, decoded),
					release: (blob) => textures.release(blob),
				},
				irradiance: {
					upload: (_blob, decoded) => irradiance.upload(decoded),
					release: (_blob, resident) => irradiance.release(resident),
				},
			},
			{ budgetBytes: this.options.budgetMiB * 2 ** 20, maxRequests: 32, uploadBytesPerFrame: 24 * 2 ** 20 },
		);
		this.#terrain.setSplat(pkg.manifest.terrain?.splat ?? null);
		stream.pin(coreBlobs(pkg, { surfaces: this.#terrain.surfaces }));

		const manifest = pkg.manifest;
		const selector = new Selector(tree, stream, manifest.global, manifest.tree.rootSize);
		const geometries = pkg.geometries.entries;
		const geometriesReady = geometries.reduce((sum, entry) => sum + (entry.status === 'ready' ? 1 : 0), 0);
		const scene: LoadedScene = {
			pkg,
			tree,
			stream,
			ground: {
				manifest,
				tree,
				heights: (blob) => {
					const resident = stream.get(blob)?.resident;
					return resident?.kind === 'heights' ? resident.samples : null;
				},
			},
			selector,
			meshes:
				geometriesReady > 0
					? new MeshSelector({
							chains: pkg.chains,
							geometries,
							looks: materialLooks(pkg.materials),
							stream,
							textures,
							particles,
						})
					: null,
			textures,
			geometries: { ready: geometriesReady, total: geometries.length },
			levels: manifest.levels.map((level) => ({
				id: level.id,
				name: level.name ?? level.id,
				instances: level.instances,
			})),
		};
		this.scene = scene;
		this.#scenePicks = {};
		const showable = manifest.levels.filter((level) => level.instances > 0);
		const level = showable.find((candidate) => candidate.id === initialLevel) ?? showable[0] ?? null;
		this.#level = level;
		this.#post.resetExposure();
		this.#water.setTable(pkg.water);
		this.#waterLevels.setVolumes(pkg.water.volumes);
		this.#lights.setLights(pkg.lights.lights);
		this.#updateVisibility();
		this.#applyEnvironment();
		if (level === null) {
			this.#setPose(overviewPose(manifest));
		} else {
			this.#focusCells = levelCellIds(manifest, level);
			const { pose, settled } = this.#levelPose(scene, level);
			this.#setPose(pose);
			this.#unsettledPose = settled ? null : pose;
		}
		this.#dirty = true;
		this.#emitState();
		onProgress('streaming');
	}

	/** drops the loaded package and its GPU content */
	unload(): void {
		this.scene?.stream.destroy();
		this.scene?.textures.destroy();
		this.#meshes.releaseMaterials();
		// the destroyed store's sky textures
		this.#post.clearSkyTextures();
		this.#bindings.setReflection(null, 1);
		this.#bindings.set('shadowRamp', null);
		this.scene = null;
		this.#scenePicks = {};
		this.#sceneValues = {};
		this.options.environmentPin = null;
		this.#environment.fades.reset();
		this.#setIrradiance(EMPTY_IRRADIANCE, []);
		this.#water.setTable(null);
		this.#waterLevels.setVolumes([]);
		this.#lights.setLights([]);
		this.#terrain.setSplat(null);
		this.#level = null;
		this.#unsettledPose = null;
		this.#focusCells = null;
		this.#applyEnvironment();
		this.#dirty = true;
		this.#emitState();
	}

	/** swaps in a package's irradiance volume and rebinds the frame groups */
	#setIrradiance(table: IrradianceTable, regions: readonly IrradianceRegionInfo[]): void {
		this.#irradiance.setPackage(table, regions);
		this.#bindings.rebuild();
	}

	/** lights the scene with the shown level's environment, or the defaults */
	#applyEnvironment(): void {
		this.#environment.setBase(this.#level?.environment ?? null);
		this.#blendEnvironment({ force: true, dt: 0 });
	}

	/**
	 * re-blends the environment volumes at the camera when it moved, a fade is running or the options changed,
	 * and relights the scene if the result differs
	 *
	 * @param options.force blend even if nothing changed
	 * @param options.dt seconds since the last frame, which time-faded volumes advance by
	 */
	#blendEnvironment({ force, dt }: { force: boolean; dt: number }): void {
		const look = this.#environment.update(
			{
				manifest: this.scene?.pkg.manifest,
				eye: this.camera.position,
				volumes: this.options.environmentVolumes,
				pinnedPhase: this.options.environmentPin,
				loaded: this.#conditionResults,
				dt,
			},
			{ force },
		);
		if (look === null) {
			return;
		}
		this.#post.setEnvironment(look.environment, look);
		this.#fog.setEnvironment(look.environment, this.camera.near);
		this.#dirty = true;
		this.#emitState();
	}

	/** @returns the name of the environment profile lighting the shown level, or `null` for the defaults */
	get environmentName(): string | null {
		return this.#environment.look.environment.name;
	}

	/** @returns the environment volumes applied at the camera, in order */
	get appliedVolumes(): readonly AppliedVolume[] {
		return this.#environment.applied;
	}

	/** @returns the phases the volumes listed for the shown level apply, for pinning one: index and name */
	environmentPhases(): { index: number; name: string }[] {
		const manifest = this.scene?.pkg.manifest;
		const level = this.#level;
		if (manifest === undefined || level === null) {
			return [];
		}
		const indices = new Set<number>();
		for (const { volume } of volumesForLevel(manifest, level)) {
			if (volume.phase !== null) {
				indices.add(volume.phase);
			}
		}
		return [...indices]
			.map((index) => ({ index, name: manifest.environmentPhases[index].name }))
			.toSorted((a, b) => a.name.localeCompare(b.name));
	}

	/** @returns the loaded package's levels (the same array until the package changes) */
	levels(): LevelEntry[] {
		return this.scene?.levels ?? [];
	}

	// #endregion

	// #region camera and levels

	#levelInfo(id: string): LevelInfo | undefined {
		return this.scene?.pkg.manifest.levels.find((candidate) => candidate.id === id);
	}

	/** @returns {@link levelPose} under the current options and scene values */
	#levelPose(scene: LoadedScene, level: LevelInfo): { pose: CameraPose; settled: boolean } {
		return levelPose(scene.ground, level, {
			environmentVolumes: this.options.environmentVolumes,
			loaded: this.#conditionResults,
		});
	}

	#setPose({ position, yaw, pitch }: CameraPose): void {
		this.camera.position = [...position];
		this.camera.yaw = yaw;
		this.camera.pitch = pitch;
		// a cut: the last frames show somewhere else
		this.#post.reset();
		this.#fog.reset();
	}

	/** re-poses the first view over the ground once the coarse terrain lands; drops it if the camera moved */
	#settleFirstPose(): boolean {
		const pending = this.#unsettledPose;
		const level = this.#level;
		const scene = this.scene;
		if (pending === null || level === null || scene === null) {
			return false;
		}
		const camera = this.camera;
		if (
			camera.yaw !== pending.yaw ||
			camera.pitch !== pending.pitch ||
			camera.position.some((value, axis) => value !== pending.position[axis])
		) {
			this.#unsettledPose = null;
			return false;
		}
		const { pose, settled } = this.#levelPose(scene, level);
		if (!settled) {
			return false;
		}
		this.#setPose(pose);
		this.#unsettledPose = null;
		return true;
	}

	/**
	 * flies to view a point from the south, above and behind it
	 *
	 * @param target Unity-space point to look at
	 * @param distance how far back to stand, in metres
	 */
	flyToPoint(target: Vec3, distance: number): void {
		const back = Math.max(distance, 10);
		const up = back * 0.6;
		this.controls.flyTo({
			position: [target[0], target[1] + up, target[2] - back],
			yaw: 0,
			pitch: -Math.atan2(up, back),
		});
		this.#dirty = true;
	}

	/**
	 * flies to a vantage point over a level and prioritises its cells.
	 *
	 * @param id level id
	 */
	flyToLevel(id: string): void {
		const level = this.#levelInfo(id);
		if (level !== undefined && this.scene !== null) {
			this.#flyOver(this.scene, level);
		}
	}

	#flyOver(scene: LoadedScene, level: LevelInfo): void {
		this.controls.flyTo(this.#levelPose(scene, level).pose);
		this.#focusCells = levelCellIds(scene.pkg.manifest, level);
		this.#dirty = true;
	}

	/** @returns the shown level's id, or `null` when the package has no level with content */
	get level(): string | null {
		return this.#level?.id ?? null;
	}

	/** @returns the shown level's manifest entry, or `null` when the package has no level with content */
	get shownLevel(): LevelInfo | null {
		return this.#level;
	}

	/** @returns the loaded package's manifest, or `null` without a package */
	get manifest(): PackageManifest | null {
		return this.scene?.pkg.manifest ?? null;
	}

	/** @returns the loaded package's water surfaces; none without a package */
	get waterSurfaces(): readonly WaterSurfaceEntry[] {
		return this.scene?.pkg.water.surfaces ?? [];
	}

	/**
	 * shows one level, whole and alone over the shared terrain, and flies over it. other levels' content stops
	 * being drawn and is evicted as the budget needs.
	 *
	 * @param id level id
	 */
	showLevel(id: string): void {
		const level = this.#levelInfo(id);
		const scene = this.scene;
		if (level === undefined || scene === null) {
			return;
		}
		this.#level = level;
		this.#updateVisibility();
		this.#post.resetExposure();
		this.#applyEnvironment();
		this.#flyOver(scene, level);
		this.#emitState();
	}

	// #endregion

	// #region options and stats

	/** values the user picked, by control id */
	#scenePicks: Record<string, number> = {};
	/** every control's value, from the picks and the package's defaults and derived controls */
	#sceneValues: Record<string, number> = {};

	/** @returns every scene control's current value */
	get sceneValues(): Readonly<Record<string, number>> {
		return this.#sceneValues;
	}

	/** @returns the values the user picked, by control id; other controls follow their default or formula */
	get scenePicks(): Readonly<Record<string, number>> {
		return this.#scenePicks;
	}

	/**
	 * @param id a scene control's id
	 * @param value one of its values, or `null` to drop the pick so it follows its default or formula again
	 */
	setSceneValue(id: string, value: number | null): void {
		this.setSceneValues({ [id]: value });
	}

	/**
	 * sets several controls at once, re-evaluating visibility once
	 *
	 * @param values by control id, one of its values or `null` to drop the pick; unknown controls and values
	 *   are ignored
	 */
	setSceneValues(values: Readonly<Record<string, number | null>>): void {
		const controls = this.scene?.pkg.manifest.states.controls;
		if (controls === undefined) {
			return;
		}
		const picks = { ...this.#scenePicks };
		for (const [id, value] of Object.entries(values)) {
			const control = controls.find((entry) => entry.id === id);
			if (
				control === undefined ||
				(value !== null && !control.values.some((entry) => entry.value === value))
			) {
				continue;
			}
			if (value === null) {
				delete picks[id];
			} else {
				picks[id] = value;
			}
		}
		this.#scenePicks = picks;
		this.#updateVisibility();
		this.#emitState();
	}

	/** @returns every gameplay water volume of the package, with its fill now and the fill it's moving to */
	get waterVolumes(): WaterVolumeState[] {
		return this.#waterLevels.states;
	}

	/** restores scene control and environment preview defaults for the current package */
	resetSceneValues(): void {
		this.#scenePicks = {};
		this.#waterLevels.reset();
		this.options.environmentPin = null;
		this.#environment.fades.reset();
		this.#updateVisibility();
		this.#emitState();
	}

	/** per conditional set of the loaded package, whether the selected scene values satisfy it */
	#conditionResults: boolean[] = [];

	/** @returns per conditional set of the loaded package, whether the selected scene values satisfy it */
	get conditionResults(): readonly boolean[] {
		return this.#conditionResults;
	}

	/** stream areas the conditions were last evaluated with, or `null` for every area */
	#visibleAreas: ReadonlySet<number> | null = null;
	/** camera position {@link followStreamAreas} last tested */
	#areasEye: Vec3 = [Number.NaN, 0, 0];

	/**
	 * @returns the stream areas shown at the camera, or `null` when every area shows (the option is off or the
	 *   package has no stream areas)
	 */
	get visibleStreamAreas(): ReadonlySet<number> | null {
		return this.#visibleAreas;
	}

	/** @returns the stream areas to show at the camera, or `null` for every area */
	#streamAreasAtCamera(): ReadonlySet<number> | null {
		const info = this.scene?.pkg.manifest.states.streamAreas ?? null;
		if (info === null || !this.options.streamAreas) {
			return null;
		}
		const eye = this.camera.position;
		let zones = zonesAt(info, eye);
		if (zones.size === 0) {
			// above or below every trigger the game falls back to the root areas, which hides most of a zone's
			// level from an overview, so a free camera keeps the zones whose footprint it's over
			zones = zonesAround(info, eye);
		}
		return areasShownIn(info, zones);
	}

	/** proximity control values the conditions were last evaluated with */
	#proximity: Record<string, number> = {};

	/** @returns the proximity controls' values at the camera, which stands in for the player */
	#proximityAtCamera(): Record<string, number> {
		return proximityValues(this.scene?.pkg.manifest.states.proximities ?? [], this.camera.position);
	}

	/**
	 * re-evaluates visibility when the camera moved into a different set of stream areas, or nearer to or
	 * further from an interactive than its proximity radius
	 */
	#followStreamAreas(): void {
		const eye = this.camera.position;
		const last = this.#areasEye;
		if (eye[0] === last[0] && eye[1] === last[1] && eye[2] === last[2]) {
			return;
		}
		this.#areasEye = [...eye];
		const visible = this.#streamAreasAtCamera();
		const current = this.#visibleAreas;
		const same =
			visible === null || current === null
				? visible === current
				: visible.size === current.size && visible.isSubsetOf(current);
		const proximity = this.#proximityAtCamera();
		const sameProximity = Object.entries(proximity).every(([id, value]) => this.#proximity[id] === value);
		if (!same || !sameProximity) {
			this.#updateVisibility();
		}
	}

	/**
	 * re-evaluates conditions and visibility groups for the shown level, scene values and stream areas at the
	 * camera, for every consumer
	 */
	#updateVisibility(): void {
		const scene = this.scene;
		const states = scene?.pkg.manifest.states;
		this.#visibleAreas = this.#streamAreasAtCamera();
		this.#areasEye = [...this.camera.position];
		const areas = states?.streamAreas ?? null;
		this.#proximity = this.#proximityAtCamera();
		// stream areas and proximities follow the camera unless pinned, so the camera's values go under the picks
		const picks = {
			...(areas === null ? {} : streamAreaValues(areas, this.#visibleAreas)),
			...this.#proximity,
			...this.#scenePicks,
		};
		this.#sceneValues = states === undefined ? {} : resolveSceneValues(states, picks);
		const values = this.#sceneValues;
		// water volumes move to the fill their `waterLevel` control picks, at the game's speed times the rate
		this.#waterLevels.follow(values);
		this.#conditionResults = states === undefined ? [] : conditionResults(states, values);
		const shown =
			states === undefined ? [] : groupsShown(states, this.#level?.tag ?? null, this.#conditionResults);
		scene?.selector.setGroupsShown(shown);
		this.#water.setGroupsShown(shown);
		this.#lights.setGroupsShown(shown);
		this.#irradiance.setGroupsShown(shown);
		this.#dirty = true;
	}

	/** @param patch options to change */
	setOptions(patch: Partial<ViewerOptions>): void {
		Object.assign(this.options, patch);
		this.#targets.renderScale = Math.min(1, Math.max(0.25, this.options.renderScale));
		this.#post.setAntialiasing(this.options.antialiasing);
		if (patch.debugView !== undefined || patch.antialiasing !== undefined) {
			this.#post.resetAntialiasing();
		}
		if (patch.streamAreas !== undefined) {
			this.#updateVisibility();
		}
		if (this.scene !== null) {
			this.scene.stream.options.budgetBytes = this.options.budgetMiB * 2 ** 20;
		}
		this.#dirty = true;
		this.#emitState();
	}

	/**
	 * @param listener called when {@link stateRevision} or {@link statsRevision} change (stats at most about
	 *   four times a second)
	 * @returns unsubscribe
	 */
	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	#emitState(): void {
		this.stateRevision++;
		this.#notify();
	}

	#notify(): void {
		for (const listener of this.#listeners) {
			listener();
		}
	}

	// #endregion

	// #region frame loop

	#tick(time: number): void {
		this.#raf = requestAnimationFrame((next) => this.#tick(next));
		const dt = this.#lastTime === 0 ? 1 / 60 : Math.min(0.1, (time - this.#lastTime) / 1000);
		this.#lastTime = time;
		this.#times.begin();

		const moved = this.controls.update(dt) || this.#settleFirstPose();
		const watered = this.#waterLevels.update(dt, this.options.waterLevelRate);
		this.#waterLevels.applyFloaters((resident, row) =>
			this.#instances.writeRows(
				resident.alloc.start + row,
				new Uint32Array(resident.rowsF32.buffer, row * ROW_BYTES, ROW_WORDS),
				1,
			),
		);
		this.#followStreamAreas();
		const resized = this.#targets.update();
		this.#blendEnvironment({ force: false, dt });
		this.#times.span('controls');
		const scene = this.scene;
		const options = this.options;
		// pipeline variants compile on first use (stencil effects), and draw once ready
		const compiled = this.#pipelines.size !== this.#seenPipelines;
		this.#seenPipelines = this.#pipelines.size;
		const changed =
			this.#dirty ||
			moved ||
			watered ||
			resized ||
			options.continuous ||
			compiled ||
			(scene !== null && scene.stream.version !== this.#seenVersion);
		this.#dirty = false;
		// the temporal antialiasing converges over a few more jittered frames of the same view
		let settling = false;
		if (changed) {
			this.#settleFrames = options.antialiasing ? SETTLE_FRAMES : 0;
		} else if (this.#settleFrames > 0) {
			this.#settleFrames--;
			settling = true;
		}
		// keep rendering while the exposure adapts. it meters only while the view changes or settles: water and
		// particles change what it meters every frame, so a meter that kept running would never let it settle
		const post = this.#postSettings();
		const adapting = this.#post.adaptExposure(post, dt, { metering: changed || settling });
		const render = changed || settling || adapting;
		if (render && options.animate) {
			this.#time += dt;
			this.#windClock += windClockRate(this.#environment.look.environment.wind) * dt;
		}
		// frames that only settle or adapt reuse the last selection, unless it holds particles, which move by
		// the clock like the effects' scrolling textures. with nothing rendering and nothing loading, the
		// traversal would repeat the last frame's
		const traverse =
			scene !== null &&
			((render && (changed || this.#particlesShown || this.#spinsShown)) || !scene.stream.idle);
		if (scene !== null && traverse) {
			this.#frame++;
			this.#traverseAndPrepare(scene, { prepare: render });
		}
		if (render) {
			this.#lastDraws = this.#render(scene !== null, post);
			this.#times.rendered(dt);
		}
		if (render || traverse) {
			this.#times.worked();
		}

		if (time - this.#lastStats > STATS_INTERVAL) {
			this.#lastStats = time;
			this.#publishStats();
		}
	}

	/**
	 * turns the spinning rows of the selected blocks to the clock and rewrites them
	 *
	 * @param ranges the selected instance ranges
	 * @returns whether any selected block has spinning rows
	 */
	#turnSpinningRows(ranges: readonly InstanceRange[]): boolean {
		let shown = false;
		for (const { item } of ranges) {
			const resident = item.resident;
			if (resident?.kind !== 'instances' || resident.spins === null) {
				continue;
			}
			shown = true;
			if (this.#spinTimes.get(resident) === this.#time) {
				continue;
			}
			this.#spinTimes.set(resident, this.#time);
			turnRows(resident.rowsF32, resident.spins, this.#time);
			const runs = resident.spins.runs;
			for (let r = 0; r < runs.length; r += 2) {
				const first = runs[r];
				const count = runs[r + 1] - first;
				this.#instances.writeRows(
					resident.alloc.start + first,
					new Uint32Array(resident.rowsF32.buffer, first * ROW_BYTES, count * ROW_WORDS),
					count,
				);
			}
		}
		return shown;
	}

	/** selects and streams this frame's content, and when `prepare` is set, writes it for the renderers */
	#traverseAndPrepare(scene: LoadedScene, { prepare }: { prepare: boolean }): void {
		const options = this.options;
		const stream = scene.stream;
		stream.beginFrame(this.#frame);
		this.#seenVersion = stream.version;
		// screen-space sizes are measured in output pixels, so the render scale trades shading only, not detail
		const aspect = this.#targets.outputWidth / this.#targets.outputHeight;
		const planes = this.camera.frustumPlanes(aspect, this.#planes);
		const shadows = options.shadows && options.debugView === 'lit';
		const { environment, celestial } = this.#environment.look;
		const view = {
			camera: this.camera,
			planes,
			pixelFactor: this.camera.pixelFactor(this.#targets.outputHeight),
			casters: shadows ? offscreenCasters(planes, environment.sunDirection) : null,
		};
		const selection = scene.selector.run(
			view,
			{
				...options,
				terrainSurface: options.terrainSurface && this.#terrain.surfaces,
				terrainSplat: options.terrainSplat && this.#terrain.surfaces,
			},
			this.#focusCells,
		);
		this.#visited = selection.visited;
		// spinning rows turn before instances are culled and listed by where they are
		this.#spinsShown = this.#turnSpinningRows(selection.instances);
		this.#times.span('tree');
		// per-instance LOD selection also requests geometry, so it runs before the stream update
		let meshSelection: MeshSelection | null = null;
		if (shadows) {
			// mesh selection groups instances by the shadow layers they reach; #render fits the same layers again,
			// which changes nothing while the camera holds still
			this.#shadows.fit(this.camera, aspect, environment.sunDirection);
		}
		if (scene.meshes !== null && options.instances) {
			meshSelection = scene.meshes.run(selection.instances, {
				eye: this.camera.position,
				planes: view.planes,
				pixelFactor: view.pixelFactor,
				viewportHeight: this.#targets.outputHeight,
				minPixels: options.minBoxPixels,
				textureBias: options.textureBias,
				unsupportedMaterials: options.unsupportedMaterials,
				missingContent: options.missingContent,
				casters: view.casters,
				shadowLayers: shadows ? this.#shadows.volumes : null,
				// particles move by the clock the effects' shaders scroll by
				particles: {
					time: this.#time,
					eye: this.camera.position,
					widthPerDepth: 2 * Math.tan(this.camera.fovY / 2) * aspect,
					right: this.camera.right(),
					up: this.camera.up(),
					forward: this.camera.forward(),
				},
			});
		}
		this.#particlesShown = meshSelection?.particles ?? false;
		this.#times.span('mesh select');
		updateSkyTextures(
			{ stream, textures: scene.textures, flowNoise: scene.pkg.manifest.heightFogFlowNoise ?? null },
			{ environment, celestial, flowNoise: options.flowNoise },
			{ post: this.#post, bindings: this.#bindings },
		);
		if (options.water) {
			this.#water.prepare({
				eye: this.camera.position,
				planes: view.planes,
				stream,
				geometries: scene.pkg.geometries.entries,
				textures: scene.textures,
				sun: environment.sunRaw,
				volumeOffsets: this.#waterLevels.offsets,
			});
		} else {
			this.#water.clear();
		}
		this.#times.span('sky, water');
		this.#irradiance.prepare(stream, this.camera.position);
		stream.update();
		scene.textures.commit();
		this.#times.span('stream');
		if (!prepare) {
			return;
		}

		const eye = this.camera.position;
		this.#terrain.prepare(options.terrain ? selection.patches : [], eye);
		this.#instances.rebase(eye);
		if (meshSelection === null) {
			this.#instances.prepareRanges(options.instances && options.boxes ? selection.instances : []);
			this.#meshes.clear();
		} else {
			const spans = this.#instances.prepareList(
				options.boxes ? meshSelection.boxes : [],
				meshSelection.buckets,
			);
			this.#meshes.prepare(meshSelection.buckets, spans, scene.textures);
		}
		this.#shadowsStale = true;
		this.#times.span('prepare');
	}

	/**
	 * @param hasScene whether a package is loaded
	 * @param post this frame's post settings
	 * @returns the draws encoded
	 */
	#render(hasScene: boolean, post: PostSettings): number {
		const device = this.#gfx.device;
		const ring = this.#ring;
		ring.beginFrame();
		const { environment, wetness } = this.#environment.look;
		const shadows = hasScene && this.options.shadows && this.options.debugView === 'lit';
		if (shadows) {
			this.#shadows.fit(this.camera, this.#targets.width / this.#targets.height, environment.sunDirection);
		}
		const lit = hasScene && this.options.localLights && this.options.debugView === 'lit';
		const lights = lit
			? this.#lights.prepare(this.camera, this.#targets.width, this.#targets.height)
			: NO_LOCAL_LIGHTS;
		const uniforms = ring.allocate(FRAME_UNIFORM_BYTES);
		const { width, height, outputWidth, outputHeight } = this.#targets;
		writeFrameUniforms(uniforms.f32, uniforms.u32, {
			camera: this.camera,
			jitter: this.#post.nextJitter(width, height, outputHeight),
			width,
			height,
			outputWidth,
			outputHeight,
			time: this.#time,
			windClock: this.#windClock,
			environment,
			wetness,
			exposure: this.#post.exposure(post),
			bindings: this.#bindings,
			terrain: this.scene?.pkg.manifest.terrain,
			shadowMap: this.#shadows,
			shadows,
			irradiance: this.#irradiance.centers(),
			lights,
			options: this.options,
		});
		// each cascade's frame: the main one with the cascade's view-projection
		const cascadeOffsets: number[] = [];
		if (shadows) {
			for (const layer of this.#shadows.layers) {
				const block = ring.allocate(FRAME_UNIFORM_BYTES);
				block.f32.set(uniforms.f32);
				block.f32.set(layer.render, FrameOffsets.viewProj);
				cascadeOffsets.push(block.offset);
			}
		}
		ring.flush();
		this.#times.span('uniforms');

		const encoder = this.#profiler.instrument(device.createCommandEncoder({ label: 'frame' }));
		this.#irradiance.encode(encoder);
		const skinned = hasScene && this.#meshes.animate(encoder, this.#time);
		let draws = 0;
		// the layers hold what they drew last until the casters or a layer's fit change; frames that only settle
		// the antialiasing or drift the fog redraw nothing there
		if (shadows) {
			const fits = this.#shadowFits;
			this.#shadows.layers.forEach((layer, i) => {
				if (layer.render.some((value, k) => value !== fits[i * 16 + k])) {
					fits.set(layer.render, i * 16);
					this.#shadowsStale = true;
				}
			});
		}
		// an animated caster moves whenever the clock does
		const drawShadows = this.#shadowsStale || skinned;
		// pipelines still compiling would leave casters out
		this.#shadowsStale = !shadows || this.#pipelines.compiling > 0;
		(drawShadows ? cascadeOffsets : []).forEach((offset, i) => {
			const pass = encoder.beginRenderPass({
				label: `shadow layer ${i}`,
				colorAttachments: [],
				depthStencilAttachment: {
					view: this.#shadows.views[i],
					depthClearValue: 1,
					depthLoadOp: 'clear',
					depthStoreOp: 'store',
				},
			});
			pass.setBindGroup(0, this.#bindings.shadow, [offset]);
			if (this.options.terrain) {
				draws += this.#terrain.encodeShadow(pass);
			}
			draws += this.#meshes.encodeShadow(pass, i);
			pass.end();
		});
		// after the shadow layers, which it reads
		const froxels =
			hasScene &&
			this.options.heightFog &&
			this.options.debugView === 'lit' &&
			this.#fog.encode(encoder, {
				frameGroup: this.#bindings.main,
				frameOffset: uniforms.offset,
				camera: this.camera,
				aspect: this.#targets.width / this.#targets.height,
				frame: this.#frame,
			});
		const { colors, depth } = this.#targets.mainPassAttachments();
		const pass = encoder.beginRenderPass({
			label: 'main',
			colorAttachments: colors,
			depthStencilAttachment: depth,
		});
		if (hasScene) {
			pass.setBindGroup(0, this.#bindings.main, [uniforms.offset]);
			// the meshes' depth first, so the terrain and the meshes shade only what stays visible
			draws += this.#meshes.encodePass('prepass', pass);
			draws += this.#terrain.encode(pass);
			draws += this.#meshes.encodePass('main', pass);
			draws += this.#instances.encode(pass);
			draws += this.#instances.encodeOutlines(pass);
			if (this.options.wireframe) {
				draws += this.#terrain.encodeWireframe(pass);
			}
		}
		pass.end();
		if (hasScene) {
			const relight = encoder.beginRenderPass({
				label: 'decal relight',
				colorAttachments: [{ view: this.#targets.scene.radiance, loadOp: 'load', storeOp: 'store' }],
			});
			relight.setBindGroup(0, this.#bindings.main, [uniforms.offset]);
			draws += this.#meshes.encodeEffectPass('relight', relight, this.#targets.scene);
			relight.end();
		}
		// always run, so the composite reads cleared targets when nothing is transparent
		{
			const attachments = this.#targets.transparentPassAttachments();
			const transparent = encoder.beginRenderPass({
				label: 'transparent',
				colorAttachments: attachments.colors,
				depthStencilAttachment: attachments.depth,
			});
			if (hasScene) {
				transparent.setBindGroup(0, this.#bindings.main, [uniforms.offset]);
				draws += this.#meshes.encodeEffectPass('transparent', transparent, this.#targets.scene);
			}
			transparent.end();
		}
		this.#post.encode(encoder, {
			scene: this.#targets.scene,
			swapchain: this.#targets.swapchainView(),
			camera: this.camera,
			width: this.#targets.width,
			height: this.#targets.height,
			outputWidth: this.#targets.outputWidth,
			outputHeight: this.#targets.outputHeight,
			settings: post,
			time: this.#time,
			frame: this.#frame,
			froxels,
			water: this.#water,
			waterFoam:
				hasScene && this.#meshes.has('waterFoam')
					? (foamEncoder, { waterDepth, target }) => {
							const foamPass = foamEncoder.beginRenderPass({
								label: 'water foam',
								colorAttachments: [
									{ view: target, clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'store' },
								],
								depthStencilAttachment: this.#targets.readOnlyDepthAttachment(),
							});
							foamPass.setBindGroup(0, this.#bindings.main, [uniforms.offset]);
							draws += this.#meshes.encodeEffectPass('waterFoam', foamPass, {
								...this.#targets.scene,
								depth: waterDepth,
							});
							foamPass.end();
						}
					: null,
			screenEffects: (screenEncoder, target, copy) => {
				if (!hasScene) {
					return;
				}
				const scene = this.#targets.scene;
				const meshes = this.#meshes;
				const begin = (label: string): GPURenderPassEncoder => {
					const screenPass = screenEncoder.beginRenderPass({
						label,
						colorAttachments: [{ view: target, loadOp: 'load', storeOp: 'store' }],
						depthStencilAttachment: this.#targets.readOnlyDepthAttachment(),
					});
					screenPass.setBindGroup(0, this.#bindings.main, [uniforms.offset]);
					return screenPass;
				};
				if (meshes.has('multiply')) {
					const multiply = begin('effect multiply');
					draws += meshes.encodeEffectPass('multiply', multiply, scene);
					multiply.end();
				}
				if (meshes.has('refract')) {
					// refraction samples the scene as the multiplies left it
					copy();
					const refract = begin('effect refract');
					draws += meshes.encodeEffectPass('refract', refract, { ...scene, background: scene.radiance });
					refract.end();
				}
			},
			frameGroup: { group: this.#bindings.main, offset: uniforms.offset },
		});
		this.#profiler.resolve(encoder);
		this.#times.span('encode');
		device.queue.submit([encoder.finish()]);
		this.#profiler.afterSubmit();
		this.#post.afterSubmit();
		this.#times.span('submit');
		return draws;
	}

	/** the post chain's settings, from the options; auto exposure needs a scene */
	#postSettings(): PostSettings {
		const options = this.options;
		return {
			exposure: options.exposure,
			autoExposure: options.autoExposure && this.scene !== null,
			tonemapper: options.tonemapper,
			sky: options.sky,
			heightFog: options.heightFog,
			atmosphereFog: options.atmosphereFog,
			flowNoise: options.flowNoise,
			ao: options.ao,
			reflections: options.reflections,
			bloom: options.bloom,
			vignette: options.vignette,
			debugView: options.debugView,
		};
	}

	/** refreshes {@link stats}, notifying subscribers only if something changed */
	#publishStats(): void {
		const stats = collectStats(this.stats, {
			times: this.#times,
			profiler: this.#profiler,
			post: this.#post,
			terrain: this.#terrain,
			instances: this.#instances,
			meshes: this.#meshes,
			terrainShown: this.options.terrain,
			draws: this.#lastDraws,
			visited: this.#visited,
			scene: this.scene,
			pools: this.#pools,
			camera: this.camera,
			speed: this.controls.effectiveSpeed,
		});
		const key = JSON.stringify(stats);
		if (key === this.#statsKey) {
			return;
		}
		this.#statsKey = key;
		this.stats = stats;
		this.statsRevision++;
		this.#notify();
	}

	/** stops the loop and frees everything */
	destroy(): void {
		cancelAnimationFrame(this.#raf);
		document.removeEventListener('visibilitychange', this.#onVisibilityChange);
		this.unload();
		this.controls.destroy();
		this.#post.destroy();
		this.#fog.destroy();
		this.#lights.destroy();
		this.#irradiance.destroy();
		this.#water.destroy();
		this.#meshes.destroy();
		this.#instances.destroy();
		this.#terrain.destroy();
		this.#shadows.destroy();
		this.#pool.destroy();
		this.#targets.destroy();
		this.#gfx.device.destroy();
	}

	// #endregion
}
