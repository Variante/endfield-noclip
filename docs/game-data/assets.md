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
  it to hang in the air rather than drop under their 2–6× gravity. with `dampen` above 0 the engine
  runs the module right after Velocity over Lifetime each frame and limits the whole speed `s`, the
  particle's own velocity plus the velocity-over-lifetime part: above the limit `L` (`magnitude`,
  read at the particle's age; two constants pick a random value per particle) the speed becomes
  `s + (L − s)·k` with `k = 1 − (1 − dampen)^(30·dt)`, frame-rate independent against 30 fps, and
  the excess comes out of the particle's own velocity alone, so the velocity-over-lifetime part is
  added in full again next frame. a particle moved only by velocity over lifetime thus builds up an
  opposing velocity of its own and settles at the limit. the challenge start point's rising rock
  cards (`stone` in `int_challenge_start_point_once_postmodel`) start still, are pushed up at 0.2–1
  m/s and limited to 0.1–1 m/s with a dampen of 0.1.
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

### one-shot effects

a prefab can carry its own view-state controller (`PostModelViewStateController`, recognised by its
`stateList` and `animatorNode` fields). each state's `effectPlayConfigs` can name an `effectNode`, a
GameObject the state plays as an effect; with `controlActive` set, playing it switches the node on.
an `EffectSetting` MonoBehaviour (recognised by `effectLogicCfg`) under the node says whether the
effect loops (`isLoop`) and for how long it plays (`duration`, in seconds).

a node that is switched off as saved, and whose `EffectSetting`s all have `isLoop` 0, is a burst: it
shows only for the moments after its state plays it, and never at rest. the challenge start point
(`int_challenge_start_point_once_postmodel`) is one: its `OneShot` node, a 3 s ring of expanding
spheres, 40 m decal boxes, a radial blur and smoke, plays when the challenge starts
(`SwitchToRunning`).

the controller's states drive an Animator in the prefab, whose clips switch GameObjects on and off
(`m_IsActive` bindings). a GameObject switched off as saved that every clip animating it starts and
ends off is never shown by any state. the one-time and repeatable challenge points share an effect
block: in the repeatable one (`int_challenge_start_point_postmodel`) its rising motes
(`dotAdd3stages`) and blue decal are part of the idle and running looks, while the one-time point's
clips hold both off in every state.

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

### interactive view states

a model's runtime looks are view states:
`Data/Json/Interactive/ModelViewStateControllerData/<model id>.json` (MemoryPack, root
`MVSCModelViewStateControllerData`) holds, per animator (`modelName`, `$$ROOT$$` for the prefab
root) and layer, a state machine. each state names an AnimationClip, behaviours (`SetActive`
switches a GameObject by name on or off; others play effects, audio or navmesh changes) and
transitions that wait on blackboard keys. `clipAssetInfos` gives each clip's StringPathHash.

a layer starts in its `isStartingNode` state and takes the first transition whose conditions all
hold (`comparison` 0 =, 1 >, 2 <, 3 ≥, 4 ≤ against a bool, float, int or trigger value, `isInvert`
negating it); a transition without conditions is taken when its state's clip ends. a layer comes to
rest in a state none of whose transitions holds. later layers of one animator override earlier ones.

a settled state's look is its clip's end pose plus its `SetActive` switches. a generic clip's muscle
clip stores every animated value's start and stop (`m_ValueArrayDelta`) in the order of its bindings
(`m_ClipBindingConstant.genericBindings`): three values per position, scale or Euler-rotation
binding (attributes 1, 3 and 4; Euler angles in degrees, applied z, then x, then y), four per
rotation (2), one per other float, none per PPtr curve. a binding's `path` is the CRC32 of the
GameObject path below the Animator's own, `/`-joined (`Root/Bone001`), 0 for the Animator's
GameObject. a GameObject binding (class 1) whose attribute is the CRC32 of `m_IsActive` switches
that GameObject on (1) or off (0). effect clips switch whole groups of effects this way; in their
subtree, what the clip leaves alone keeps its saved activity, so a node saved off stays off.

clips also set renderer values (mesh renderer class 23, skinned 137, particle system renderer 199):

- **material properties** (`customType` 22) apply to the renderer's materials. the attribute's low
  28 bits are the low 28 bits of the CRC32 of the property's name; its top four bits pick a vector's
  x to w (0–3), a colour's r to a (4–7) or a float (8). the talosites' clips set `_TintColorAlpha`
  and `_BlendTint`; the campfire's effect clips set a vector's components (kinds 0–3).
- **other renderer properties** (`customType` 0) are named by the CRC32 of their path, such as the
  particle pivot's `m_Pivot.x`.

an Animator without a controller of its own takes its clips from these states. a model's `effectIds`
name prefabs its states' `EffectBehavior`s play.

#### keys the player sets

some blackboard keys follow the player:

- **`Distance`**: an interactive with a main-character interest component
  (`MainCharacterInterestComponent`) measures, every frame, the distance from the player's position
  to its entity and sets `Distance` true while it's at most the component's
  `main_character_interest_distance` (talosites: 15 m), false beyond; it sets it once when it starts
  too.
- **`InZone`**: a campfire sets it while the player is inside its trigger (the template's
  `TriggerObserverComponent`, a sphere of `radius` 2.5 m), but only once it's activated. inside, it
  swaps the trigger's radius for a second value held at runtime, so leaving takes another distance.

#### talosites

the talosites (`int_collection_trstar_postmodel`, white; `int_collection_trstar_high_postmodel`,
blue; template `int_collection_trstar`, a `TreasureStar` component) are effect prefabs: three
crystal shards (mesh particles holding one particle each), a 2D star icon, billboard glows, a light
column and a ground glow. their `FX` layer rests in `IdleLoop` while the player is beyond 15 m, and
plays `InteractStart` into `InteractLoop` within it (`Distance`), returning through `InteractEnd`.
idle dims the glows below their saved values (the blue bubble `glow02` to a third of its
`_TintColorAlpha`) and holds the shards' pivots at 0, so they cluster; near brightens the glows and
moves the shards' pivots apart, and scales the star icon up 1.8×. the white model reuses the blue
model's clips but for its own activation start.

### campfires

a campfire's template has a campfire component (`InteractiveCampfireComponent`). its model
(`int_campfire_postmodel_v2`) has two animators with three layers between them, testing three keys:
`Enabled` (the player has activated it), `InZone` (the player stands in it) and `InBattle`.

| layer                                     | not activated        | activated, nobody near | player in it | in a fight  |
| ----------------------------------------- | -------------------- | ---------------------- | ------------ | ----------- |
| model (`P_interactive_campfire+1_003_01`) | `CloseIdle` (folded) | `Open_Idle` (unfolded) | `Open_Idle`  | `Open_Idle` |
| color (same animator, VAT clips)          | `Empty`              | `Empty`                | `On`         | `Off`       |
| effect (`P_interactive_campfire_effect`)  | `Locking`            | `Working`              | `Using`      | `Stopping`  |

the effect prefab holds one group per look: `moren` (the locked look: red and blue rings, a text
ring, a glow column), `shouquan` (two slowly turning rings), `yunzhuan` and `duankai`, plus
`qiehuan*` bursts for the transitions between them. the prefab as saved has every group switched on,
so drawn as saved it shows all of them at once, including the transition bursts' heat-haze cylinders
(`HGRP/Effect/VFXRefract`). `Locking` leaves only `moren`'s resident effects on; `Working` only
`shouquan`'s rings (its `lizi` sparks and, in `yunzhuan/qiehuan2`, the leftover of the switch burst,
are particles).

### interactive doors

a door's template has a door component (`InteractiveDoorCommonComponent`, or Dijiang's
`SpaceshipRoomDoorSystem`), and its model's states include a settled state (a clip, and every
transition waits on a condition) whose clip is an open idle (`…openidle…`). its closed state is
where the open one returns to: its one transition, then any unconditional states, up to the next
settled one. a Dijiang room door goes `built` → `built_to_unlocked` → `unlocked`; a Power Plateau
gate `on_idle` → `on_to_off` → `off_idle`. each is drawn in its
[settled look](#interactive-view-states).

### telescopic bridges

`int_telescopic` is a bridge that extends out of a wall in pieces. its template's logic controller
has `logicType` 8, an int `state` property (0 retracted, 1 extended) and a `pieces` config property
(3; a placement's own `pieces` would override it, but no map01 placement sets one). its prefab's
root has a MonoBehaviour (`InteractiveTelescopicPostmodelMono`) naming four children: the start
port, the end port, the horizontal track and a platform piece, plus the piece's length (4 m), width
and thickness. the piece is switched off in the prefab: the game draws copies of it, never the piece
itself, so its saved position (5.3 m out) means nothing.

all offsets are along the prefab root's +z, with n pieces of length L:

| part       | retracted (`state` 0)       | extended (`state` 1)               |
| ---------- | --------------------------- | ---------------------------------- |
| start port | as saved                    | as saved                           |
| end port   | at the start port (0, 0, 0) | (0, 0, n·L)                        |
| track      | switched off                | switched on, local scale (1, 1, n) |
| copies     | switched off                | copy i at (0, 0, i·L), unrotated   |

each copy's Animator plays its open idle state when extended, which raises the piece's rails (bones
below the piece), and its close idle state when retracted. the prefab as saved is neither: its end
port sits 13.35 m out with no pieces between.

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
