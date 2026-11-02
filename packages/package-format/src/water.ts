import type { TextureRef } from './textures.ts';
import type { Bounds, Color, Vec2, Vec4 } from './values.ts';

/**
 * `tables/water.json`: the scene's open-world water. every surface is resident (the game keeps them in its
 * Global chunks), so the table is loaded with the core. a viewer shows the surfaces whose group shows, like
 * instances, and shades them with their config and the global maps
 */
export interface WaterTable {
	/** the scene's global water, or `null` if the scene has none or the package holds no surface */
	global: WaterGlobal | null;
	/** surface configs, deduplicated; {@link WaterSurfaceEntry.config} indexes this list */
	configs: WaterConfigEntry[];
	surfaces: WaterSurfaceEntry[];
	/**
	 * gameplay water volumes; their surfaces are in {@link surfaces}, naming them by
	 * {@link WaterSurfaceEntry.volume}
	 */
	volumes: WaterVolumeEntry[];
}

/**
 * a gameplay water volume (LevelData `waterVolumes`): a polygon of water whose surface level scripts raise
 * and lower. its surface sits at `base + heightMax · fraction`; its {@link WaterSurfaceEntry} is packed at
 * {@link initial}, and a viewer moves it and the volume's {@link floaters} vertically by the difference
 */
export interface WaterVolumeEntry {
	/** the game's id, decimal */
	id: string;
	/** the volume's floor, world y */
	base: number;
	/** metres from {@link base} to a full volume */
	heightMax: number;
	/** the fill (0–1) the level authors it at, before any script runs */
	initial: number;
	/** metres per second the surface moves at between fills, as scripts move it */
	fillSpeed: number;
	/**
	 * fills the scene's level scripts set the volume to, ascending and deduplicated, each with what sets it;
	 * {@link initial} is always listed
	 */
	levels: WaterVolumeLevel[];
	/**
	 * instance rows (by `InstanceBlock.entityIds`) of interactives that float on the volume: they follow its
	 * surface up and down
	 */
	floaters: number[];
}

/** a fill a water volume can be at */
export interface WaterVolumeLevel {
	/** 0–1 of {@link WaterVolumeEntry.heightMax} */
	fraction: number;
	/**
	 * metres per second the surface moves at on its way here: the speed a script sets before moving it here,
	 * else {@link WaterVolumeEntry.fillSpeed}
	 */
	speed: number;
	/** what sets it, e.g. "authored", "scripts 46300000013 (moves here)" */
	label: string;
}

/** the scene's `Global_Water_Config`: maps shared by every surface. textures are the game's, unchanged */
export interface WaterGlobal {
	/** edge of the square the global flow map and the sector grid cover, metres */
	mapSize: number;
	/** edge of one sector, metres */
	sectorSize: number;
	/** world x, z the grid is centred on (`sceneCenterOffset`) */
	center: [x: number, z: number];
	/** metres per texel of a sector tile */
	flowmapPrecision: number;
	/**
	 * flow over the whole grid, at `uv = (world.xz - center) / mapSize + 0.5`: RG direction (green negated), B
	 * foam, A wave amplitude
	 */
	flowMap: TextureRef;
	causticMap: TextureRef;
	/** a `2d-array` of wave normals: RG normal, B height, A foam shape (read on the small-wave layer only) */
	normalMaps: TextureRef;
	rainMap: TextureRef;
	/**
	 * high-resolution flow tiles, like {@link flowMap} at {@link flowmapPrecision} m/texel. sector `(x, z)`
	 * covers world `[center.x + x·sectorSize, +sectorSize) × [center.z + z·sectorSize, +sectorSize)`. only the
	 * sectors that have data and overlap a packed surface are listed; elsewhere use {@link flowMap}
	 */
	sectors: WaterSector[];
}

/** one flow-map tile of the sector grid */
export interface WaterSector {
	x: number;
	z: number;
	texture: TextureRef;
}

/** a surface `WaterConfig` */
export interface WaterConfigEntry {
	/** asset name, e.g. `Config_water_Map02_15` */
	name: string;
	values: WaterConfig;
}

/**
 * a surface `WaterConfig`'s numeric fields under the game's serialized names: scalars as numbers (flags as
 * 0/1), vectors as `[x, y(, z, w)]`, colours as {@link Color}s as authored. the fields named here are those a
 * renderer needs; every other numeric field (character ripples, displacement, TAA tweaks, …) is kept under
 * its own name too
 */
export interface WaterConfig {
	[field: string]: number | number[];
	// optics
	/** Rayleigh scattering per metre, rgb (`w` unused) */
	waterRayleighScatteringMeter: Vec4;
	/** absorption per metre in deep water, rgb (`w` unused) */
	waterRayleighAbsorptionMeter: Vec4;
	/** absorption per metre in shallow water, rgb, blending to the deep one by {@link safeFullAbsorpDistance} */
	waterRayleighAbsorptionMeter2: Vec4;
	absorptionTint: Color;
	absorptionTint2: Color;
	absorptionScale: number;
	scatterTint: Color;
	scatterScale: number;
	/** depth (m) past which the water is fully absorbed */
	safeFullAbsorpDistance: number;
	envLightIntensity: number;
	sceneColorEnvInfluence: number;
	rayleighMieLerpFactor: number;
	distanceEdgeBlendFactor: number;
	// appearance
	roughness: number;
	specular: number;
	/** screen-space refraction distortion strength, not an index of refraction */
	waterIOR: number;
	envLightSpecularIntensity: number;
	punctualLightSpecularIntensity: number;
	/** metres over which the waves fade with distance (sooner at grazing angles) */
	distanceFade: number;
	/** the large waves' strength once faded */
	distanceNormalMinStrength: number;
	/** the wave normals' mip offset despite its name: bias `(0.5 − value) · 10` */
	envSpecularDesaturation: number;
	/** vertical scale of the normal the sun's highlight takes */
	dirSpecNormalScaler: number;
	flowBaseColor: Color;
	/** the foam's colour */
	foamColorG: Color;
	foamOpacity: number;
	foamRoughness: number;
	foamShapeOffset: number;
	foamFadeDistance: number;
	waterBaseColorSubsurfaceScaler: number;
	emissiveStrength: number;
	// caustics
	causticTilling: number;
	causticOpacity: number;
	causticDistort: number;
	causticSpeed: number;
	causticStartDepth: number;
	causticEndDepth: number;
	// flow and waves
	/** 1 to follow the flow maps, 0 to flow along {@link flowDirectionVector2} */
	useFlowMap: number;
	/** 1: the flow map's alpha masks the surface instead of scaling the waves */
	FlowmapOption: number;
	flowDirectionVector2: Vec2;
	flowSpeed: number;
	flowFullCycle: number;
	normalTilling: number;
	normalScale: number;
	/** layer of {@link WaterGlobal.normalMaps} for the small waves */
	smallWaveNormalType: number;
	/** layer of {@link WaterGlobal.normalMaps} for the large waves */
	largeWaveNormalType: number;
	largeWaveFlowSpeed: number;
	largeWaveNormalTilling: number;
	largeWaveNormalScale: number;
	flowFullCycleLarge: number;
	largeWaveInvDir: number;
}

/** one water surface */
export interface WaterSurfaceEntry {
	/** the game's entity id */
	id: number;
	/**
	 * index into `StatesInfo.groups`: the owning level and the scene states that load the surface (map02's
	 * paddy-field pools load with some)
	 */
	group: number;
	/**
	 * geometry-table id. only positions are needed (the shading works in world x, z), and some meshes have no
	 * UVs; no tangents are generated
	 */
	geometry: number;
	/**
	 * object-to-world, rows3x4 as in {@link InstanceBlock.transforms} but absolute. many river and polygon
	 * meshes are authored in world space and have an identity transform; quads and planes are 0.1 m and scaled
	 * up
	 */
	transform: number[];
	/** world bounds, from the game */
	bounds: Bounds;
	/** index into {@link WaterTable.configs} */
	config: number;
	/** bit mask of the game's `HGWaterRenderType` (1 `Proxy`, 2 `LOD`) */
	renderTypeMask: number;
	/**
	 * the game's per-surface `param1`: (wetness offset (m), height layer 0–3, 1 to sort by distance, 1 to wet
	 * the ground around it); see `docs/game-data/water.md#placements-initchunkdata-component-30`
	 */
	param1: Vec4;
	/** index into {@link WaterTable.volumes} for a water volume's surface, `null` for a placed surface */
	volume: number | null;
}
