# assets: meshes, textures, materials and prefabs

the Unity assets that world data points at: how a StringPathHash key or PPtr names exactly one
object across bundles, the mesh, texture, material and transform classes, how prefabs and the
dynamic ECS scene place renderers, and where interactives' models come from. where entity data comes
from is in [world.md](world.md); which structures a progression, quest or scene state shows is in
[scene-states.md](scene-states.md); how materials shade is in [materials.md](materials.md).

## Unity objects

Endfield ships Unity 2021.3 SerializedFiles (format version 22) with TypeTrees embedded, so
Hypergryph's added fields are described in each file like Unity's own.

a `PPtr` is `(m_FileID, m_PathID)`: file 0 is the same SerializedFile, `n ≥ 1` is
`externals[n − 1]`, path id 0 is null.

## resolving assets

world data names assets two ways:

- **StringPathHash keys** (InitChunkData draws, StreamingChunkData properties, dynamic model rows,
  LevelConfig `levelDataPathHashes`). the key is a 64-bit hash of the lowercased path. paths are
  `<container path>` or, for a sub-asset of an FBX, `<container path>##<sub-asset name>`.
- **PPtrs**, inside a prefab, material or renderer once an object has been reached.

names don't identify objects: sub-asset names repeat across FBX containers, LOD meshes and collision
meshes (`*_COL*`) sit beside render meshes with near-identical names, and prefab variants share
renderer names. the identities the game uses are hash → bundle → container and PPtr → CAB → path id.

### lookup tables

| file                                                                                        | maps                                                                                                                               |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `Data/ExtendData/Main/StringPathHash.bin`, `Data/ExtendData/Initial/InitStringPathHash.bin` | hash → path, in a main and an initial table                                                                                        |
| `Data/Bundles/Windows/manifest.hgmmap`                                                      | hash → `AssetInfo` (bundle index, size, compressed path); bundle → name, direct dependencies and the transitive dependency closure |

### how a reference reaches an object

- **hash → bundle.** the manifest's `AssetInfo` rows for the hash give the bundles holding it.
- **path → object.** in such a bundle, the `AssetBundle` object's container maps the lowercased
  container path to a main-asset PPtr and a preload range. a sub-asset is the main asset or one of
  the preload pointers, with the matching class and an `m_Name` equal to the sub-asset name
  case-insensitively; it ships in its container's bundle, so the preloads that matter stay inside
  that bundle.
- **PPtr → object.** an external's CAB name (`archive:/CAB-<hex>/CAB-<hex>`) isn't derivable from
  bundle names, but it's always inside the referencing bundle's dependency closure, and so is the
  `m_StreamData` (`.resS`) file of an object. Unity's built-in resources (`library/…`,
  `resources/…`) ship in the player rather than in a bundle.

## asset classes

### mesh

`Mesh` (class 43) stores vertex channels and streams, the index buffer and submeshes, with vertex
data in `m_StreamData` when present.

- **packed normals.** most meshes pack the normal into one 32-bit word; the channel's dimension byte
  reads `0x31` (low nibble = real dimension 1, high nibble = packing flag 3). bits 0–19 are two
  signed 10-bit octahedral coordinates (÷511). bits 20–31 hold a third signed 10-bit field (bits
  20–29), a bit that is always set (30) and the bitangent sign (31), which the game's vertex shader
  uses for the tangent frame.
- **tangents.** meshes with plain f32 normals carry f32×4 tangents (w = bitangent sign).
  packed-normal meshes have no tangent channel of their own (unverified across the install); their
  tangent frame comes from the packed word.
- other channels seen: uv0/uv1 f32×2; vertex colour unorm8×4; uv2/uv3 snorm8×4 with dimension byte
  `0x24` (high nibble 2, meaning unknown).
- **compression.** `m_MeshCompression` is only an import setting: a mesh with a non-zero value and
  an empty `m_CompressedMesh` keeps its vertices in the ordinary channels.
- skinned meshes carry weights, bone indices and bind poses.

### texture

the texture classes are `Texture2D`, `Cubemap`, `Texture2DArray`, `CubemapArray` and `Texture3D`.
`Texture2D`-family classes name their format with `TextureFormat` and their colour space with
`m_ColorSpace` (1 = sRGB); array and 3D classes use `GraphicsFormat`, which encodes sRGB itself.
sRGB-ness belongs to the texture, not to the material slot. scenery textures are overwhelmingly BC7
with full mip chains, plus BC5 normals, a few BC1 and RGBAHalf vertex-animation textures. alpha-only
textures (`TextureFormat` Alpha8, `GraphicsFormat` 54) store one byte per texel.

### material and shader

a `Material`'s serialized state holds its shader PPtr, keywords, custom queue, tags, texture slots
with scale/offset and HGRP's per-slot `m_UVSetIndex`, floats and colours. the Lit shader declares
UV-set floats of its own ([lit layers](materials.md#lit-layers)). a shader's name, first-subshader
tags and declared properties are in its `m_ParsedForm`. besides Unity's queue boundaries (≥2450
alpha test, ≥3000 transparent), HGRP materials carry their own surface, blend, alpha-test and cull
properties.

### transform

Unity Euler angles (degrees) apply Z, then X, then Y; dynamic model rows store rotations this way.

## prefabs

a prefab is a GameObject hierarchy reached through PPtrs, placed by its root.

- a GameObject draws only if it and all its ancestors are active. an active skinned mesh can use
  bones under an inactive GameObject.
- enabled `MeshRenderer`s (with a `MeshFilter`'s mesh) and enabled `SkinnedMeshRenderer`s draw, as
  do particle systems ([below](#particle-systems)).
- an enabled `LODGroup` (class 205) picks one of its LODs' renderers at a time.
- material slots keep their order: a null slot draws nothing for that submesh, and slots past the
  last submesh draw the last submesh again. `m_CastShadows` 3 or 4 (Unity's `ShadowsOnly`,
  `ShadowsOnlyTwoSided`) marks a shadow-only renderer.
- a skinned renderer's pose is each bone's prefab-space matrix times its bind pose.

prefabs can also hold environment volumes ([environment.md](environment.md#prefab-volumes)).

### particle systems

a `ParticleSystemRenderer`'s `m_RenderMode` is 4 for meshes, otherwise a quad: billboard 0,
stretched 1, horizontal 2, vertical 3. the fields its systems use, as the game's effects set them:

- **cap.** some systems store a cap (`maxNumParticles`) of 0 yet show in game, such as the tilted
  torch flames (`P_fxmap_common_tiltedflame_2501`), so the game must size them itself.
- **scaling.** under `scalingMode` Shape the transform's scale moves particles but leaves their
  size.
- **Limit Velocity.** with `dampen` 0 the speed limit does nothing, and the module only applies its
  drag: an amount, optionally scaled by the particle's size and by its speed squared. the splashes
  at the foot of Jingyu Valley's falls (`shuihua` in `P_fxmap_common_splashes_middle_2501`) rely on
  it to hang in the air rather than drop under their 2–6× gravity.
- **ring buffer.** `ringBufferMode` 1 holds a particle at its end until a newer one replaces it, 2
  replays `ringBufferLoopRange`.
- **texture sheet.** `UVModule` in grid mode plays the whole sheet or one row (fixed, random or by
  mesh), timed over the lifetime by `frameOverTime` and `cycles` or by `fps`, offset by
  `startFrame`, on the UV sets of `uvChannelMask`.
- **meshes.** each particle draws one of up to four meshes (`m_Mesh` … `m_Mesh3`), evenly or by
  `m_MeshWeighting*` when `m_MeshDistribution` is 1.

examples:

- Wuling City's threads swirling over the pillar array (`p_fxmap_lv002_fangyuzhenlie_*`) are single
  particles kept past their lifetime by a ring buffer, without a texture sheet.
- the floating rocks over Origin Lodespring's crater (`Rock02` in `P_fxmap_common_brokentree_01/02`)
  draw four rock meshes each.
- the campfire flames (`fire01`/`fire02` in `P_fxmap_common_damagefire_small_2501`) are one
  ring-buffered particle stepping through an 8×8 flipbook every loop.
- the spray and stretched mist cards at the foot of falls are `shuihua` and `shuiwu`.

### billboards

an enabled `VFXBillBoard` MonoBehaviour (HG's effect billboard, recognised by its `billboardMode`,
`rotateInLateTick` and `rotation` fields) sets its GameObject's world rotation from the camera every
frame, carrying everything under it along. by `billboardMode`:

- 0: the camera's rotation times `rotation` (Euler degrees, the offset)
- 1: the offset with the camera's heading (its Euler y) added to its y
- 2: forward along the camera's forward with the part along the GameObject's initial up removed, up
  along that axis; no offset
- 3: as 2 about the parent's up axis, times the offset

the snapshot points' yellow light column (`int_system_snapshot_postmodel`, in Dijiang) and the glare
at the centre of the corroded planet seen from Dijiang's deck
(`P_fxmap_base01_lv001_planetcorrode_01`) are billboards.

## dynamic structures

the dynamic ECS scene (`Data/DynamicStreaming/PC/Scene/<scene>/`) holds scenery that appears,
changes or disappears with progression: initial structures, their alternative forms, and gated
props.

### fb_main grids

each `fb_main_<L>_<i>_<j>` file is a FlatBuffer of grids. a grid stores component vectors; an entity
is a `RootComp` row whose component slice lists `DataIndex` entries `(type, grid, index)`.
referenced rows may sit in another grid of the same file. the components with established meaning
for visuals and selection:

| component                                        | content                                                                                                                                                                             |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ResourceComp`                                   | a slice of resource groups                                                                                                                                                          |
| resource group                                   | a typed slice of model (5), effect (6) or ECS (7) rows, possibly in another grid; `logicState` mask; `levelNum` (LevelConfig `idNum`); scene-state and stream-area visibility lists |
| `IdComp`                                         | the entity's global id                                                                                                                                                              |
| settlement / factory-region / POI control        | what drives the entity's logic state (its progression level)                                                                                                                        |
| mission / global-variable / map-variable control | load gates                                                                                                                                                                          |
| script control                                   | default load flag for script-enabled entities                                                                                                                                       |

a resource group with `logicState` 0 ignores logic state; otherwise bit `n` shows it while the
entity's logic state is `n`. how these masks, gates and scene-state lists decide visibility is in
[scene-states.md](scene-states.md).

### payloads

- **model rows** (type 5, 96 bytes): prefab StringPathHash key, position, Unity Euler rotation and
  scale. the row places the prefab under that TRS.
- **effect rows** (type 6, grid vector 8, 144 bytes): Unity position at +12, Euler rotation at +24,
  scale at +36 and the prefab's StringPathHash key at +48, followed by bounds and the position again
  at +116. they place their prefab like model rows. on map02 all 8596 name prefabs, among them
  Wuling City's pillar-array threads.
- **ECS rows** (type 7): `(sceneIndex, chunk, index)` naming component group `index` of the paired
  `fb_init_<ss>_<chunk>` / `fb_streaming_<ss>_<chunk>` files. `fb_init` holds the component groups,
  in InitChunkData's layout ([world.md](world.md#initchunkdata-layout)), and `fb_streaming` the
  matching entity ids.

one model or ECS group can be referenced by several resource groups, and some ECS entities also
appear in static chunks.

## interactives

interactives are the placed gameplay objects: switches, doors, chests, campfires, collectibles,
harvestable plants, shops. their models come from four sources:

1. LevelData files (from LevelConfig `levelDataPathHashes`) place them. the sequential prefix up to
   the interactive list holds, per interactive: interactive id, `createState`, position, rotation,
   scale, `modelScale` (0 = no override), and the per-component parameters (keyed by the game's
   interactive component type). `createState` 0 means created with the level.
2. `Data/Json/Interactive/InteractiveTable.json` maps each interactive id to a template and each
   template to its data file. many ids share one template: the Wuling switch variants all
   instantiate `int_switch_wuling`.
3. the template `Data/Json/Interactive/InteractiveData/data_<template>.json` (pooled MemoryPack).
   its leading component is the model component (model id and scale). its last members are the
   variant table, keyed by interactive id, whose entries can override the model id.
4. `Data/Json/GameplayConfig/ModelTable.json` maps each model id to a prefab path and `scaleFactor`.

a placement's model is its variant's, else the template's. templates without a model (triggers,
logic) have nothing to draw. a model that is a doodad-group shell draws nothing itself; one form per
group level attaches to it instead ([scene-states.md](scene-states.md#doodad-groups)).

four facility templates (`int_system_domain_shop`, `int_system_domain_depot`,
`int_doodad_core_recycle`, `int_system_kite_station`) have a model-upgrade component
(`InteractiveModelLevelUpComponentData`), which lists model ids in visual-form order and contains
the base model id ([scene-states.md](scene-states.md#facility-visual-forms)).

### interactive doors

a model's runtime looks are view states:
`Data/Json/Interactive/ModelViewStateControllerData/<model id>.json` (MemoryPack, root
`MVSCModelViewStateControllerData`) holds, per animator (`modelName`, `$$ROOT$$` for the prefab
root) and layer, a state machine. each state names an AnimationClip, behaviours (`SetActive`
switches a GameObject by name on or off; others play effects, audio or navmesh changes) and
transitions that wait on blackboard keys. `clipAssetInfos` gives each clip's StringPathHash.

a door's template has a door component (`InteractiveDoorCommonComponent`, or Dijiang's
`SpaceshipRoomDoorSystem`), and its model's states include a settled state (a clip, and every
transition waits on a condition) whose clip is an open idle (`…openidle…`). its closed state is
where the open one returns to: its one transition, then any unconditional states, up to the next
settled one. a Dijiang room door goes `built` → `built_to_unlocked` → `unlocked`; a Power Plateau
gate `on_idle` → `on_to_off` → `off_idle`.

a settled state's look is its clip's end pose plus its `SetActive` switches. a generic clip's muscle
clip stores every animated value's start and stop (`m_ValueArrayDelta`) in the order of its bindings
(`m_ClipBindingConstant.genericBindings`): three values per position or scale binding, four per
rotation, one per other float, none per PPtr curve. a binding's `path` is the CRC32 of the
GameObject path below the Animator's own, `/`-joined (`Root/Bone001`), 0 for the Animator's
GameObject.

### the variant table

between the model component and the variant table sit hundreds of component and action-graph types.
the table is followed only by the template's temporary properties and two flags, and its keys are
exactly the InteractiveTable ids that name this template, other than the template's own id, which is
never a key (this holds for every shipped template). variant entries are 14-member objects in name
order; `Optional<T>` is an object of (enabled, value) for managed `T` and a raw struct (enabled,
padding, value) for unmanaged `T`.

### the LevelData format

LevelData is a sequential format that stores no field lengths, so a field can only be passed by
reading it, and misreading one misframes every later row. polymorphic fields are MemoryPack unions
whose tag indexes the subclasses in name order, with each subclass's members also in name order.
gameplay tags are unmanaged four-byte values.

## open

- the meaning of the uv dimension byte's high nibble 2
- the path hash function: it diverges from XXH3 at 128 UTF-8 bytes (see AnimeStudio's
  `EndfieldVfsHash`)
