# world: maps, levels, streaming and terrain

how Endfield lays out its worlds: streaming scenes and their coordinate frames, levels as exact sets
of 128 m cells, entity level tags, the static and dynamic streaming files, stream areas, terrain
tiles, and the game's LOD/HLOD data. which scenery a scene state, quest or variable switches on is
covered in [scene-states.md](scene-states.md).

## scenes, maps and levels

the game has three units:

- a **scene** is a streaming scene (`Data/Streaming/PC/<scene>/`, described by a
  `StreamingSceneConfig` asset): `map01`, `map02`, `base01_lv001` (Dijiang), `indie_dg007`, and
  about a hundred more. each scene has one Unity coordinate frame. LevelConfig rects, entity
  matrices, terrain tiles and MapRegion shapes are all in that frame, and nothing is relocated per
  level.
- a **map** is a MapConfig (`mapIdStr`): the ownership grid and scene states of a playable space.
  the open-world maps `map01` and `map02` share their scene's name; their `domainName` (`domain_1`,
  `domain_2`) is the region the game shows as Valley IV and Wuling.
- a **level** (`map02_lv001`, …) is a LevelConfig: an area inside a map, not a separate scene.
  open-world levels share their map's streaming scene and are `isSeamless`. a non-seamless level is
  usually its own map but streams another level's scene (`dung02_gdg001` streams `map02`,
  `base01_lv003` streams `base01_lv001`), so a level's scene comes from
  `defaultState.exportedSceneConfigPath`, never from its `mapId`. interiors, arenas and Dijiang are
  separate scenes with their own frames (some interiors sit at world-like coordinates but still
  stream from their own scene).

### scene names

scene ids follow `<owner>_<kind><number>`. the owner says what the scene belongs to: `map01` and
`map02` are the open-world regions, `base01` is Dijiang, `dung01`/`dung02` are instances tied to
region 01 or 02, and `indie` instances belong to neither. `blackbox01/02_dg001` hold the AIC
tutorials. the kind is not stored anywhere, but `Data/TableCfg/DungeonTable` maps each dungeon entry
(`dungeonId`) to its `sceneId` (or `levelId`) and a `dungeonCategory`, and the kinds line up with
the categories:

| kind    | `dungeonCategory`                         | what it is                                                          |
| ------- | ----------------------------------------- | ------------------------------------------------------------------- |
| `dg`    | `dungeon_story`, `dungeon_train`, or none | story interiors and cities; base01 training rooms                   |
| `cdg`   | `dungeon_challenge`, `dungeon_actmonster` | puzzle and mechanic stages                                          |
| `rdg`   | `dungeon_char`, a few `dungeon_story`     | operator story dungeons, e.g. `dung02_rdg008` is `dung_lizhiyan_01` |
| `bdg`   | `dungeon_bossrush`                        | boss-rush arenas                                                    |
| `gdg`   | `dungeon_archery`                         | archery stages                                                      |
| `rcdg`  | `dungeon_wuling_racing`                   | Wuling tracks                                                       |
| `sdg`   | `dungeon_resource`                        | Protocol Space resource stages                                      |
| `ssdg`  | none (`dungeon_ss` rows point at levels)  | Protocol Space advanced progression                                 |
| `ttdg`  | `dungeon_takestwo`                        | wave arena                                                          |
| `swdg`  | `dungeon_gamblingdungeon`                 | Arena of Games                                                      |
| `wrdg`  | `dungeon_weeklyraid`                      | weekly raid                                                         |
| `hdg`   | `dungeon_highdifficulty`                  | high-difficulty boss arenas                                         |
| `ccdg`  | `dungeon_contract`                        | Contingency Contract                                                |
| `check` | `dungeon_worldlevel`                      | Zoetic Session level checks                                         |
| `race`  | `dungeon_race`                            | race                                                                |
| `tower` | `dungeon_seasontower`                     | season tower                                                        |

the number counts up within an owner and kind; it carries no other meaning. a scene can serve
several dungeon entries (`indie_tower001` serves 60) and some scenes have none: story quests can
send the party to a scene directly, and each mission's
`Data/Json/MissionRuntimeAsset/<mission>.json` names the scenes it uses (`sceneId`, `_mapId`), so
`e11m5` is how the main story reaches `dung02_rdg008`. a dungeon and a puzzle stage can share a
display name with a quest (`dung02_cdg005` and quest `e11m7` are both "Homecoming").

### LevelConfig

`Data/Json/LevelConfig/<level>.json` is a binary MemoryPack-style payload with strings pooled in
`Data/Json/StringPool/StringPool<n>.byte`, despite its extension. the root has 18 members and
`defaultState` 3, and the payload ends exactly at EOF. fields with known meaning:

| field                                             | meaning                                                                                                                                 |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `idNum`                                     | string id and the numeric id MapConfig's grid stores                                                                                    |
| `mapId`                                           | the level's map (stored as `mapIdStr`), e.g. `map02`; not always its streaming scene, see above                                         |
| `defaultState.exportedSceneConfigPath`            | streaming scene asset, e.g. `map02/map02_streaming.asset`                                                                               |
| `defaultState.sourceSceneName`                    | the level's art sub-scene, e.g. `map02_lv001_art`                                                                                       |
| `levelGrids`                                      | the 128 m cells the level owns                                                                                                          |
| `levelDataPathHashes`                             | StringPathHash keys (stored as `levelDataPaths`) of the level's LevelData files (interactives, see [assets.md](assets.md#interactives)) |
| `rectLeftBottom`, `rectRightTop`, `playerInitPos` | the level's playable rect and the player's spawn point                                                                                  |

### MapConfig and the ownership grid

`Data/Json/MapConfig/<map>.json` is plain JSON (UTF-8 with BOM). `levelIds` is a row-major
`sideGridNum × sideGridNum` grid of LevelConfig `idNum`s centred on the origin, 0 meaning no level.
cell `(x, z) = (floor(worldX / 128), floor(worldZ / 128))` is at index `(z + N/2)·N + (x + N/2)`.
map02's grid is 32² (4096 m), map01's 16² (2048 m). MapConfig also carries `sceneStates` and
`sceneStateConditions`, which [scene-states.md](scene-states.md) covers.

### the level partition

three sources describe level membership:

1. MapConfig `levelIds`: which level owns each cell
2. LevelConfig `levelGrids`: the same cells, listed per level
3. the entity id's top 5 bits (`id >>> 27`), the **level tag**: which level authored the entity

the two cell sources agree exactly on map01 and map02.

the tag is the 1-based ordinal of the level among the map's grid-owning levels sorted by id, not the
`lvNNN` number. in map02 these coincide because lv001–lv010 all exist; map01 has no lv004, so
lv005–lv007 carry tags 4–6. tag 0 is a small map-wide shared set and tag 31 holds generated
colliders. a single-level scene (a dungeon, Dijiang) tags everything 0, so there the one level owns
tag 0. a majority vote of the cells where each tag's entity pivots fall confirms the rule, with
backdrop cells left out, since their skyline props would outvote small levels.

**content ownership follows the tag, not position.** a level's scenery can sit in a neighbour's cell
or in a cell no level owns (backdrop and skyline; map02 has more such cells than owned ones). border
cells hold several levels' entities without duplicating them, and an entity spanning cells repeats
by id in each cell's chunk. so:

- a level's content is its tag's entities; its cells and rect don't bound it, and clipping by them
  cuts real scenery
- unowned cells hold content of their tag's level
- MapRegionTable polygons are UI overlays (mist, toasts). they don't tile the level and overhang its
  cells

## static scenery: InitChunkData and StreamingChunkData

static scenery streams per 128 m cell:

```
Data/Streaming/PC/<scene>/Streaming/InitChunkData_<x>_<z>_<sceneState>_<area>.bytes
Data/Streaming/PC/<scene>/Streaming/InitChunkData_Global_<sceneState>_<area>.bytes
Data/Streaming/PC/<scene>/Streaming/StreamingChunkData_…   (same suffixes)
```

the suffixes are the game's `GridIdentifier` fields (`pos`, `sceneStateId`, `areaId`); the game
calls the 128 m cell a grid.

- `<x>_<z>` is the cell. most entity pivots fall inside their file's cell; large objects are filed
  by bounds and repeat in each cell they touch. the `Global` file has no cell; that its content is
  always resident is unchecked, since it also holds the HLOD clusters the game streams by distance
  ([LOD and HLOD](#lod-and-hlod)).
- `<sceneState>` is 0 for always-loaded content and `n` for content shown only while MapConfig scene
  state `n − 1` is active (see [scene-states.md](scene-states.md)).
- `<area>` is a stream-area id from `FBStreamArea` (below); 0 is the default area.

every file is a u32 clear size and an inverted-LZ4 block (the HG payload envelope) around a
FlatBuffer.

### InitChunkData layout

the root table has 8 slots: version (47 and 49 seen), the chunk origin (`x·128, z·128`; Global
stores `INT32_MAX, INT32_MIN`), the object rows (ids, union kinds and tables, each row's field 0
being the full object name), and parallel vectors of per-group entity ids and **component groups**.

a component group is an ECS archetype stored column-major: a descriptor list of
`(component id, stride)` and one blob of `count · Σ stride` bytes. component ids are anonymous
column selectors; the ones with established meaning:

| id    | content                                                                                                                                                                                                                                                                                                   |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0–5   | world AABB, centre xyz then extents xyz (f32 each)                                                                                                                                                                                                                                                        |
| 8–14  | draw infos for capacity `2^(id − 8)`: count, 24-byte infos (the game's `RendererInfo`: submesh, `renderFlags`), then `(max², min²)` LOD bounds                                                                                                                                                            |
| 18    | 256-byte instance constants starting with the object-to-world matrix                                                                                                                                                                                                                                      |
| 21    | 64-byte name prefix (root object names win when present)                                                                                                                                                                                                                                                  |
| 27    | rect decal constants (160 bytes): matrix, inverse, UV scale and offset, RGBA8 colour, intensity, an angle, flags; material in StreamingChunkData under `0xff010000` ([materials](materials.md#decals))                                                                                                    |
| 28    | terrain decal constants in 27's layout (matrix, inverse, params, packed colour); material in StreamingChunkData, `HGRP/TerrainDecalLit`                                                                                                                                                                   |
| 30    | a water surface placement ([water](water.md#placements-initchunkdata-component-30))                                                                                                                                                                                                                       |
| 31    | water decal constants (172 bytes, unread); StreamingChunkData names the render pipeline's cube under `0xff000000` and its material under `0xff010000` (map02's `P_waterdecal_01`: 248, all Global)                                                                                                        |
| 42    | a local light's runtime data, zero-filled in the file (244 bytes); the values are in the object row (below)                                                                                                                                                                                               |
| 44    | on collider-only entities (`…_COL1`, `P_box_collider`, `MergedCollider_…`), always with 21 alone (27k on map02); content unread                                                                                                                                                                           |
| 61    | an oriented box (44 bytes): u32 0, centre xyz, a size xyz (half or full unchecked), rotation quaternion xyzw; with 21 and the 1-byte 62 on map02's 61 `shadowOC_CAVE_*` entities, the only ones seen                                                                                                      |
| 54    | a constant spin (92 bytes): speed (rad/s, non-negative), unit axis, pivot (world), six floats not checked (a local box, by their values), then the stored position, rotation quaternion xyzw and scale; only on Qingbo Stockade's waterwheels' renderers ([spinning scenery](assets.md#spinning-scenery)) |
| 63    | the same light's settings, zero-filled (448 bytes)                                                                                                                                                                                                                                                        |
| 67    | LOD ranges: LOD count and cumulative draw count per LOD                                                                                                                                                                                                                                                   |
| 68–74 | draw refs for capacity `2^(id − 68)`: `(u64 material hash, u64 mesh hash, …)`                                                                                                                                                                                                                             |

object row kinds by census: 1 = GameObjects the client rebuilds as MonoBehaviours (environment and
post volumes, probes, water, terrain root), 2 = component-group entities, 3 = proxies: audio, grass
and tree grids ([below](#foliage-grids)) and surface data. kind 1's volumes and water are described
in [environment.md](environment.md) and [water.md](water.md).

local lights are kind-2 entities in groups with columns 42 and 63. their row's slot 3 is a keyed
property table in kind 1's layout, holding two blobs, a 236-byte runtime block and a 448-byte
settings block. map01 has 1,025 and map02 2,153; [lighting.md](lighting.md#local-lights) covers how
they shade.

### StreamingChunkData

the sibling of each InitChunkData file. it shares the root layout and object ids and adds, per
object, a keyed property table whose values point at assets by StringPathHash key. keys read as
`component << 24 | field << 16 | index`. a kind-1 object's properties are split, per component,
between its Init and Streaming rows.

### foliage grids

most small vegetation isn't placed as entities. it sits in kind-3 proxy objects named
`GrassGrid_<x>_<z>#<level tag>_<id>` and `TreeGrid_…`, one per 64 m cell and file, whose row slot 2
holds the game's `ProxyEntityType` (7 grass, 9 tree). each is a batch of ECS archetypes the client
instantiates itself, serialized into the row's keyed property table:

| key                    | file      | content                                                                                     |
| ---------------------- | --------- | ------------------------------------------------------------------------------------------- |
| `0xff000000`           | Init      | archetype count                                                                             |
| `0xff01xxxx`           | Init      | archetype bounds                                                                            |
| `0xff02xxxx`           | Init      | entity count                                                                                |
| `0xff03xxxx`           | Init      | column descriptors, 8 bytes each: `u16 component id, u16 stride, u32 0`                     |
| `0xff04xxxx`           | Init      | the column-major blob, as a component group's                                               |
| `0xff050000`           | Streaming | batch table length                                                                          |
| `0xff06xxxx`–`0xff09…` | Streaming | per batch entry: u32 key (value code 3), material, mesh (StringPathHash assets) and submesh |

archetypes reuse the bounds (0–5) and draw-info (8–14) columns, but a draw names a batch entry
instead of holding asset keys: grass draws (`GrassRendererInfo`) carry the entry's key at byte 4, a
sparsity at 8 and the renderer flags at 12; tree draws carry the entry's index at 12 and the flags
at 16. there's no LOD-range column, so a draw's LOD is the rank of its upper threshold. instances
are a column-major object-to-world matrix and two vec4 parameters (96 bytes): a grass entity is a
cluster of nearby instances (column `37 + k`: a count and room for `4 · 2^k`), a tree entity one
instance (column 80). column 6 (20 bytes) starts with a point and a squared size; column 7 (24
bytes) isn't identified.

map02 holds about 981k grass and bush instances in 81k clusters and 17k trees, map01 376k grass
instances and no tree grids. grids repeat in every file they overlap, under one id. the game
measures a cluster's LOD by `rendererHalfSize` and thins grass by its sparsity at a quality setting;
the second instance parameter is the grass shader's per-instance colour
([materials](materials.md#foliage)).

## stream areas

`Data/DynamicStreaming/PC/Scene/<scene>/FBStreamArea.bytes` lists every area of a scene, the areas
visible by default (`RootVisible`), and trigger volumes: an XZ polygon with a box and height range
per area. while the streaming centre is inside one or more triggers, the client shows the union of
those areas' visible slices; otherwise it shows `RootVisible`. area ids are the `<area>` suffix of
chunk file names and the visibility groups of DynamicStreaming entities. root slots 7–9
(`HlodUnloadBounds`, `HlodUnloadTriggers`, `HlodUnloadPoints`) are HLOD-unload trigger volumes in
the same layout.

areas are not interiors only: a level can hold several versions of the same place's backdrop, each
shown from its own zone. map02's Si's Painting has a cliff and floating-rock backdrop (area
701638228 in one client build) that loads only inside a zone west of the inn; shown everywhere,
those rocks would stand in front of the inn's view.

of map01, map02, base01_lv001 and base01_lv002, only map02 has static content in non-default areas.
DynamicStreaming entities carry areas too
([scene-states.md](scene-states.md#where-states-are-referenced)): on map02, about 600 of their
11,504 area lists name one of 22 areas other than the default, among them the falls pouring over
Si's Painting's backdrop cliff.

## dynamic streaming

`Data/DynamicStreaming/PC/Scene/<scene>/` holds the dynamic ECS scene: `fb_main_<L>_<i>_<j>` grid
files (grid unique id `L << 16 | i << 8 | j`), paired `fb_init_*`/`fb_streaming_*` ECS chunks and
the stream-area table. it carries prefab placements, interactives, and scenery gated by progression,
quests and variables. its format and how structures are selected are in
[assets.md](assets.md#dynamic-structures).

## terrain

terrain lives in VFS group `F84BF5E6`:

```
Data/Terrain/PC/<scene>/Terrain_<level>_<x>_<z>_<H|N|T|A|S|C>.bytes
Data/Terrain/PC/<scene>/Layers/LAYER_<D|N|C>_<index>.bytes
```

each file is a u32 clear size and an inverted-LZ4 block (a few are stored raw), and the clear bytes
are a 20-byte `TRET` header (magic, version 1, width, height, mip count, Unity `GraphicsFormat`,
payload size) followed by one texture's mip chain, which fills the payload exactly.

tiles form a quadtree over the scene's terrain square: level `l` splits it into `2^l × 2^l` tiles,
`x` along +X and `z` along +Z. the finest tiles are 64 m (map02's leaf is level 6, map01's level 5).

| channel  | content                                                                                            |
| -------- | -------------------------------------------------------------------------------------------------- |
| `H`      | 65² heights, R8G8 read as little-endian u16, 1 m spacing; outer samples are shared with neighbours |
| `N`, `A` | baked normal and albedo pages, DXT5                                                                |
| `T`      | tint page, DXT5 sRGB                                                                               |
| `S`      | splat control, RGBA8                                                                               |
| `C`      | 34² cliff index, R8G8, driving the cliff projection                                                |

pages are 132² with a 2-texel border around a 128² core that covers the tile edge to edge, and have
one level. every tile with a height page has all six channels, at every level. layers are per-scene
material textures addressed by index ([close-up layers](#close-up-layers)): `D` diffuse (BC7 sRGB),
`N` normal (BC7), `C` cone maps for parallax (R8).

the baked `A` and `N` pages are what the game draws where its close-up layer blend doesn't reach:

| channel | r                   | g                   | b                    | a                          |
| ------- | ------------------- | ------------------- | -------------------- | -------------------------- |
| `A`     | albedo, linear      | albedo              | albedo               | subsurface curvature input |
| `N`     | world normal x ·2−1 | world normal z ·2−1 | perceptual roughness | occlusion                  |

`A` is linear despite its UNorm format, and the normal's y is `√(1 − x² − z²)`. the normal's
orientation was checked against normals from the height page (r = +X, g = +Z, rows along +Z).

the terrain's placement isn't in the tiles. it comes from the scene's `HGTerrainSurfacesData`
MonoBehaviour at
`assets/beyond/dynamicassets/scenes/pc/<scene>/terrain/hgterrainsurfacesdata.asset`:

- `terrainPosition`: world position of the square's minimum corner; `y` is the height of a zero
  sample
- `heightScale`: metres spanned by the 15-bit height range
- `terrainSize`: root edge length, a power-of-two multiple of 64 m
- `nodeData`: a complete breadth-first quadtree (`index = (4^l − 1)/3 + z·2^l + x`) with per-node
  min/max height and a `maxHeightError` (metres). despite its name, it isn't the error of drawing
  the node instead of its children: leaves, with nothing finer, carry up to 295 m on map02, and
  against the children's samples it runs 1.1–158× the measured error. it follows the node's page's
  largest step between neighbouring samples (per level, a median of 0.75–0.98 of it, rarely above).
  what the game uses it for isn't known
- `layerData`: the close-up material layers by ordinal; see below
- `sectorSplatInfo`: one u64 per 64 m sector, a bitmask of the layer ordinals the sector uses
  (checked against the index map on map02)

world Y of a sample is `position.y + (h & 0x7fff) · heightScale / 32768`. bit 15 marks a hole; holes
keep a plausible height in the low bits, which suits skirts and morphing but not drawing.

### close-up layers

near the camera the game draws a blend of tiling material layers instead of the baked pages. the
distance it switches at, and how it fades between the two, aren't recovered.

- **index**: `terrain/splatindexmap.tga`, an RGBA32 Texture2D of `terrainSize / 8` texels (row 0 at
  the minimum z), names 4 layer ordinals per 8 m cell, each stored times 4
- **weights**: the leaf's `S` page; rgb weight the cell's slots 0–2, slot 3 gets `1 − r − g − b`.
  the weights belong to that cell's layers
- **layers** (`layerData`): `splatST` (x: repeats across the terrain square, y: texture index, zw:
  uv offset), `packedSplatInfo` (mean albedo, normal xy scale), `diffuseRemapScale` (rgb multiplier,
  height-blend border in w), `maskMapRemapScale`/`Offset` (scale and offset for occlusion in y,
  height in z, roughness in w; the offset's x is a surface type id)
- **textures**: `LAYER_D` is sRGB albedo with height in alpha; `LAYER_N` is tangent-space normal xy,
  roughness in b, occlusion in a. on map02 they are 1024² BC7 with 11 levels and repeat every 2–9 m
- **blend**: with weighted heights `wh = w · h`, each slot gets
  `w · (max(0, wh − max(wh) + border) + ε)`, normalized. albedo is the blended
  `diffuse · diffuseScale`, plus `(tint − mean) · a⁴` from the leaf's `T` page, `mean` being the
  blended mean albedos. the blended tangent normal is oriented on the baked normal, with tangent
  `cross(n, +Z)`
- **projection**: world position times the layer's repeats per metre, on the x, y and z planes. the
  game picks one plane per pixel at random

### puddles

the `S` page's alpha is a puddle level, independent of weather. water stands where it rises above
the ground: close up the ground is the layers' heights weighted by the splat weights (`Σ w · h`, the
same `w` as above), far away a flat 0.5. with `w = sat((S.a − ground) / 0.46)`:

- albedo × `1 − 0.35 w`
- roughness → 0 and occlusion × `1 − 0.1 w`
- the normal bends towards straight up by `0.98 w`

layers with parallax enabled use a parallax-weighted height instead of `Σ w · h`.

## LOD and HLOD

the game ships per-entity LODs and three tiers of HLOD clusters with their own materials and
atlases.

- **per-entity LOD chains.** every static draw carries its LOD index and a
  `(minSquared, maxSquared]` range of squared screen-relative height, as in Unity's LODGroup.
  `maxSquared` is `FLT_MAX` on the nearest LOD; a negative `minSquared` means never culled by size.
  the negative values seen are all `−k²` with `k` between 0.005 and 0.05 (−0.000225 on 9,189 map02
  draws, −0.0001 on every map02 HLOD cluster, −0.0025 on every indie_dg005 one, −0.0004, −0.000025),
  so they may be ordinary cull heights stored negated rather than a "never" sentinel.
- **foliage cards.** imposter card meshes (`…_cardmesh`) appear as ordinary LODs, usually the last
  but not always: 4,162 map02 card draws are an earlier LOD with a size cull (LOD 3 of 5, 4 of 6).
- **shadow proxies.** draws with `renderFlags` bit 10 only cast shadows.
- **HLOD clusters.** auto-generated per-level clusters in three tiers, placed as ordinary entities
  named `HLOD<tier>_<i>_<j>_Cluster_<hash>…`, `i`/`j` being the tier's grid cell, with negative
  coordinates clamped to 0 (west and south of the grid origin every cluster is named on cell 0). one
  large member can stretch a cluster's bounds hundreds of metres past its cell. their draw range is
  unbounded, so HLOD visibility is decided by the HLOD/streaming system, not by LODGroup. they occur
  only in always-loaded (scene state 0) Global chunk files (every scene of the install), and only
  the `pc` HLOD platform variant ships. Jingyu's tiers hold 469 meshes / 451k triangles (HLOD0), 177
  / 226k (HLOD1) and 69 / 45k (HLOD2). the number after a cluster's hash (`_250`, `_600`) is its
  height rounded to 50 m, not a switch distance.
- **HLOD grids.** each tier's cells double the previous tier's, but the tier-0 cell and the grid
  origin vary by scene, and where the game stores them isn't found. fitted to cluster names (the
  origin most cluster centres agree with, 95–99.7 % per axis): HLOD0 cells are 64 m with the origin
  on the terrain square's corner in map01, map02, indie_dg002, indie_dg016 and the 1024 m dungeons
  except dung02_rdg008, whose origin is (−256, −256) inside its (−512, −512) square. dung02_dg002's
  is (−1664, −832) on a 4096 m square, and indie_dg005's cells are 128 m from (−1728, −832), so its
  cells and dung02_dg002's HLOD1 cells are offset from the terrain quadtree by half a cell.

the game streams HLOD as the streaming layers `HLOD0`–`HLOD2`, each with its own load radius
(`hlod0LayerLoadRadius`, …, set in its streaming settings), and calls a tier an HLOD level. the
switch distances themselves are unknown. the other layers are `Default`, `Persistent`, `Collider`,
`Tiny`, `Water`, `Lighting`, `Audio` and `RendererWithCollider`; every one but `Persistent` has a
load radius setting, and the game's grid identifiers carry a layer next to the scene state, area and
cell, while the chunk file names carry none. so an entity likely streams by its layer's radius
wherever its file puts it, Global included, and detail would then drop out where the HLOD layer
shows; where an entity's layer is stored isn't found (the InitChunkData schema is native).

## open

- the meaning of the `renderFlags` bits other than shadow-only, and of a negative `minSquared`:
  never culled by size, or culled below `√−minSquared`
- the size the LODGroup thresholds are authored against (the object's bounds, a LODGroup size, …)
- HLOD switch distances, and the HLOD generated-material channel layout
- where a scene's HLOD grid (tier-0 cell and origin) is defined, and why it leaves the terrain
  quadtree in some scenes
- whether HLOD clusters stand in for Global chunk content: indie_dg005 has every static renderer in
  its Global chunk (14k, 9k of them inside an HLOD0 cluster's bounds) and none in cell files, so
  there the clusters can only stand in for Global content
- the cell size of `fb_main` grids; the levels are known from file names, the metric size is unknown
- `farmod` far-field assets: whether they form a layer outside HLOD
- whether dungeon levels that reuse an open-world scene add content of their own beyond LevelData
  and DynamicStreaming
