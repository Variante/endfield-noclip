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
- **the dimension byte's high nibble** beyond the above: 3 on HLOD cluster meshes' snorm8×4 normals,
  2 on unorm16×4 bone weights, 1 or 2 on uint8×4 bone indices (perhaps the influences used per
  vertex). all read as their format says; the decoder rejects any other channel, format and nibble.
- **compression.** `m_MeshCompression` is only an import setting: a mesh with a non-zero value and
  an empty `m_CompressedMesh` keeps its vertices in the ordinary channels.
- skinned meshes carry weights, bone indices and bind poses.

#### built-in meshes

some prefabs use Unity's built-in meshes from `library/unity default resources`, which no bundle
holds: the Quad (path id 10210; the collectible marker `int_collection_common_postmodel`'s icon and
glow cards) and the Cube (10202; the balloons, `int_balloon_postmodel*`). the render pipeline
bundles its own copies (`Packages/com.hg.render-pipelines/Runtime/RenderPipelineResources/Mesh/`
`Quad.fbx` and `Cube.fbx`), which the extractor reads in their place. the quad has the built-in's
geometry: 1 m in the XY plane, facing −Z, UV = position + 0.5. the cube is a 1 m cube with each
face's UVs spanning 0–1; whether its faces' UV orientation matches the built-in's is unchecked.

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

- a UI GameObject, such as a world-space `Canvas` (class 223, `m_RenderMode` 2) and the Images and
  Text under it, has a `RectTransform` (class 224) in place of a `Transform`. it keeps the same
  local position, rotation, scale and children, so it nests like any other node; a prefab can mix
  both, as Dijiang's weapon wall displays do with their counter canvas.
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

- **cap.** without a ring buffer, the cap (`maxNumParticles`) only limits emission: each emission,
  by rate or burst, makes at most the cap minus the live particles, none when the system is full,
  and the skipped ones aren't made up later. live particles are never cut short to make room. the
  Very Large Rift's ripple rings (`wenli_02` and the others in
  `p_fxmap_dung02_dg005_boss_semicircle_ripple_01`) rely on this: a burst every 0.1 s loop with a
  cap of 1 lets in one ring per 6 s lifetime. some systems store a cap of 0 yet show in game, such
  as the tilted torch flames (`P_fxmap_common_tiltedflame_2501`), though the engine reads 0 as no
  particles; why isn't traced.
- **scaling.** `scalingMode` picks the scale that sizes particles: Hierarchy the whole hierarchy's,
  Local the system's own transform's, and Shape none, where the scale moves particles but leaves
  their size. effects stretch a spawn box this way: Jingyu Valley's bird flock
  (`p_fxmap_map_bird_03`) sits under a parent scaled 363 × 150 × 148 m, in Shape mode, so its birds
  stay their start size.
- **pivot.** the renderer's `m_Pivot` offsets each particle's mesh from the particle's position, in
  the particle's turned frame, in multiples of the particle's size. in mesh mode it is also measured
  in the mesh's own size, per axis twice the farthest its bounds reach from the origin
  (`2·(|centre| + extent)`), as the renderer's bounds code sizes it. Dijiang's robot lamps
  (`P_fxmap_common_robot_lamp_802`) offset their eyes, a 0.1 m plane, by ±0.95 of it: each eye sits
  7 cm off centre under the eyes' 30× scaled parent, not 70 cm.
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
- **speed modifier.** each frame the engine reads Velocity over Lifetime's `speedModifier` at the
  particle's age over its lifetime (the time the linear velocity curves are read at; two constants
  pick a random value per particle) and moves the particle by its whole velocity, its own plus the
  velocity-over-lifetime part, times that value. a curve thus scales the start speed as much as the
  module's own terms. the floating stones of Valley's Aberrants (`floatstone01` in
  `p_fxmap_map01_lv001_floatstone_*`) rise at 0.5–1.5 m/s under a modifier ramping from 0.39 to 1
  over their 5–10 s. whether gravity's part of the velocity is scaled too isn't traced.
- **ring buffer.** `ringBufferMode` 1 holds a particle at its end until a newer one replaces it, 2
  replays `ringBufferLoopRange`.
- **texture sheet.** `UVModule` in grid mode plays the whole sheet or one row (fixed, random or by
  mesh), timed over the lifetime by `frameOverTime` and `cycles` or by `fps`, offset by
  `startFrame`, on the UV sets of `uvChannelMask`.
- **meshes.** each particle draws one of up to four meshes (`m_Mesh` … `m_Mesh3`), evenly or by
  `m_MeshWeighting*` when `m_MeshDistribution` is 1.
- **render alignment.** `m_RenderAlignment` is Unity's: View 0, World 1, Local 2, Facing 3 and
  Velocity 4, which points a particle's +z along its motion. the accelerate mushroom's arrows
  (`dajiantou02`/`03` in `int_acceleratemushroom_postmodel`) are flat arrow meshes pointing along
  their +z, launched straight up a cone of angle 0 and lifted by a slightly negative gravity, so
  Velocity alignment stands them upright as they rise, spun about the vertical by their rotation
  over lifetime. how Unity rolls a velocity-aligned particle about its motion isn't traced.
- **stretched quads.** with `m_FreeformStretching` off, a stretched particle is a streak from the
  particle back along its velocity, `size.y · m_LengthScale` (times the emitter's x scale) plus
  `speed · m_VelocityScale` long, with the camera's velocity times `m_CameraVelocityScale` taken off
  the velocity first. its width, `size.x`, runs across the velocity as seen from the camera's
  position (the cross product of the velocity and the camera-to-particle direction), flattened onto
  the view plane; the particle's rotation and `m_RotateWithStretchDirection` don't enter. turning
  the camera in place thus barely moves it. Suiming's rising fog (`smoke` in
  `p_fxmap_map02_lv007_windice01`) is such a streak, twice its size long. the maximum particle size
  narrows only the width, never the length. the freeform path isn't traced.
- **rotation over lifetime.** `RotationModule`'s rates (`curve` about z, and `x`, `y` with
  `separateAxes`) are angular velocities read at the particle's age over its lifetime, so curves
  speed up or slow the spin. the mushroom's wind sheets (`wind01`/`wind02`) start spinning at up to
  60°/s either way, between two curves, and slow to a stop.
- **donut shape.** `ShapeModule.type` 17 emits from a torus: `radius` around the shape's z,
  `donutRadius` the tube's, `radiusThickness` the tube's outer part used, each particle leaving
  outwards from the tube's centre line, as Unity documents it (not checked against the engine). the
  mushroom's coin motes (`lizi1`) burst from one stretched tall by the shape's scale.

examples:

- Wuling City's threads swirling over the pillar array (`p_fxmap_lv002_fangyuzhenlie_*`) are single
  particles kept past their lifetime by a ring buffer, without a texture sheet.
- the floating rocks over Origin Lodespring's crater (`Rock02` in `P_fxmap_common_brokentree_01/02`)
  draw four rock meshes each.
- the campfire flames (`fire01`/`fire02` in `P_fxmap_common_damagefire_small_2501`) are one
  ring-buffered particle stepping through an 8×8 flipbook every loop.
- the spray and stretched mist cards at the foot of falls are `shuihua` and `shuiwu`.

### spline movers

Beyond's `HGSplineMovingObjects` MonoBehaviour emits whole prefabs along a spline, simulated in
native code rather than by a `ParticleSystem`. the cargo crates riding up and down Dijiang's central
shaft are such movers: ten of them in `p_fxmap_base01_lv001_zmdlogistics_02_01` (and `_01_01` for
the other scene state), placed with the shaft's effects in base01_lv001. it is recognised by its
`desc`, `knotData` and `fixedPostion` fields. `desc` holds Unity `MinMaxCurve`s in their managed
form (`m_Mode`, `m_ConstantMin/Max`, `m_CurveMultiplier`, `m_CurveMin/Max`), and the game:

- **emits** `emissionRateOverTime` objects per second of the mover's own time, the frame's time
  times `simulateSpeed` (the logic clock's with `useLogicDeltaTime`). an object emitted partway
  through a frame starts aged by the rest of it. each picks one of `lodGroups` at random and draws
  that LOD group's renderers as one object.
- **places** an object `d` metres along `knotData`, cubic Bézier segments (`p0`–`p3`) laid end to
  end, each taking up its stored `length`. the segment's parameter is `d`'s share of that length, so
  the speed along the curve follows the control points' spacing: the shaft's straight segments, with
  their handles on their ends, ease objects in and out. `d` grows by `velocityOverLifeTime`, read at
  the object's age over its lifetime, times the step. past the last segment the object is removed.
  with `emissionType` 0 it starts at a random point of the `aabb` box, an offset added to every
  spline point.
- **lives** `startLifeTime` clamped to 0–1, times a span the game derives per mover: a fraction of
  the trip, so the shaft's descending crates (lifetime 5) ride the whole 60 m and the rising ones
  (0.6–0.75) stop part of the way up. the span read as the spline's length over the speed is
  unverified.
- **sizes and turns** it: uniform scale `startSize` times `sizeOverLifeTime`, Euler angles in
  degrees from `startRotationX/Y/Z` in Unity's order (only z without `has3dStartRotation`), plus
  rotation over lifetime with `hasRotation` and a noise offset with `hasNoise`; the shaft's movers
  use neither. the object's matrix is the mover's `objectToWorld`, updated from its transform.
- **fades** with `hasAlphaControl`: an object whose `alphaOverLifeTime` falls below
  `transparentAlpha` draws transparent at that alpha. the shaft's movers set `transparentAlpha` 0,
  so they stay opaque.

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

### effect LOD tables

an enabled `EffectSetting` lists GameObjects in its `lodSetting` table, each with a `gameobject`, a
quality level and per-distance `_distanceLodInfos` (`isActive`, `speedPercent`). the first time the
table is applied it records each GameObject's saved activity, and from then on it shows a GameObject
only when its LOD entry is on and it was saved on; the only other switch it makes is off. so a
GameObject the table lists and that is saved off never shows through the table, even with `isActive`
1 at every distance, and the table's next refresh switches it back off if something else switched it
on. the Very Large Rift (dung02_dg005) places two `p_fxmap_map02_lv002_qinshihuoyan_middle_01_half`
walls whose `dither` layer (a `VFXDitherAlpha` sheet) is one, beside the drawn `caihong`, `wenli`
and `trans` layers on the same mesh.

the table can list the setting's own GameObject, even a prefab's root. effects placed by dynamic
structures are instantiated as saved and have their table applied when they load, and nothing on
that path switches the root on, so a root saved off and listed in its own table never shows. in
map02 there's one such prefab: `p_fxmap_lv002_fangyuzhenlie_middle_01`, eleven ungated placements of
thread particles and stream meshes along Wuling City's pillar array, beside the drawn `_high_03`,
`_middle_02` and `_middle_03` streams.

with `isUseDistanceLod` set, the setting picks a distance band from the camera's distance to its own
GameObject, whenever either moves. `distanceLodCfgList` holds each band's `distance`; the band is
the last one whose distance the camera is beyond (strictly), else the first, and each listed
GameObject is on in band `i` while its `_distanceLodInfos[i].isActive` is 1. an entry switches its
whole GameObject, so its subtree with it. past `cullDis` the setting stops picking bands, and with
`_isCullDisable` set it switches its own GameObject off, hiding the whole effect, until the camera
comes back within it. `lodFadeTime` fades between bands.

the collectible marker (`int_collection_common_postmodel`, whose view states only switch it off once
collected) is one: bands from 0, 30 and 60 m, culled at 80 m. within 30 m it shows everything: the
triangle icon, its glow card, two line trails, sparks and rings; from 30 to 60 m the icon and the
rings; from 60 to 80 m the icon alone.

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
  matching entity ids and, in StreamingChunkData's layout, their property tables: rect decals bind
  their material there under `0xff010000` as in static chunks (all 1786 of map02's, among them
  Jingyu Valley's cliff moss, 64 materials).

one model or ECS group can be referenced by several resource groups, and some ECS entities also
appear in static chunks.

### spinning scenery

Qingbo Stockade's waterwheels (map02_lv003) turn. each is a dynamic structure: its ECS renderers
carry a spin component (InitChunkData column 54, [layout](world.md#initchunkdata-layout)) and a
model row places a collider prefab at the wheel's hub whose GameObject has a
`DynamicSceneSimpleRotate` (a `TickableMono` with one field, `angleSpeed`, in degrees per second).
that component sets its transform's world rotation (`Transform.rotation`, so the row's own rotation
is overridden) to `Euler(0, 0, TimeManager.gameplayTime · angleSpeed)` on enable and every tick: an
absolute angle from the gameplay clock, so the wheel's phase doesn't depend on when it loaded. the
renderers' column 54 holds the same spin as `|angleSpeed|` in radians per second about ±z, the axis
taking the sign, through the hub:

| wheel                                             | hub                                                                    | collider prefab `angleSpeed`                            | column 54               | renderers |
| ------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------- | --------- |
| `sfwaterwheel+1_002`, three (owner `23300000004`) | −278.5, 292.9, −1403.6; −233.4, 303.6, −1426.2; −237.2, 300.3, −1359.3 | −3 (`…sfwaterwheel_collider_effect+1_002_01_postmodel`) | 0.0524 about (0, 0, −1) | 151 each  |
| the large wheel above them (`sfwaterwheel+1_001`) | −233.8, 438.9, −1408.0                                                 | 2 (`p_igroup_map02_sfwaterwheel+1_001_01_col`)          | 0.0349 about (0, 0, 1)  | 569       |

no other scene's static or dynamic chunks have column 54. the native system that turns column 54
entities isn't read: that it turns them `speed · gameplayTime` about the axis through the pivot,
from their stored pose, is inferred from the data agreeing with the collider's script. the small
wheels load with their owner's script group (default on,
[script groups](scene-states.md#script-groups)).

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

a placement's model is its variant's, else the template's. a variant whose model override is enabled
but empty has no model of its own, rather than the template's. templates without a model (triggers,
logic) have nothing to draw. a model that is a doodad-group shell draws nothing itself; one form per
group level attaches to it instead ([scene-states.md](scene-states.md#doodad-groups)).

six of the install's 332 interactive templates have a model-upgrade component
(`InteractiveModelLevelUpComponentData`), which lists model ids in visual-form order and contains
the base model id: `int_system_domain_shop`, `int_system_domain_depot`, `int_doodad_core_recycle`,
`int_system_kite_station`, `int_system_farm_terminal` (placed in map02_lv002 and map02_lv010) and
`int_system_simulation_training` (map02_lv006)
([scene-states.md](scene-states.md#facility-visual-forms)). templates carry no display name, only
their id.

### interactive view states

a model's runtime looks are view states:
`Data/Json/Interactive/ModelViewStateControllerData/<model id>.json` (MemoryPack, root
`MVSCModelViewStateControllerData`) holds, per animator (`modelName`, `$$ROOT$$` for the prefab
root) and layer, a state machine. each state names an AnimationClip, behaviours (`SetActive`
switches a GameObject by name on or off; others play effects, audio or navmesh changes) and
transitions that wait on blackboard keys. `clipAssetInfos` gives each clip's StringPathHash.

a model whose `ModelTable` row sets `hasModelViewData` and names another model in
`dependModelViewDataId` has no file of its own and uses that model's view states (the field sits on
the table's `ModelData` and on the interactive model component). eight rows do: the small campfire
(`int_campfire_smaller`, the full campfire's prefab at 0.8 scale, placed by the
`int_campfire_v2_smaller` variant in Dijiang's central hall at 0, 0.9, 57.1), recycling station
forms 2–4, the long erosion pops 2–4 and the common chest (`int_trchest_common_normal`, on
`int_trchest_common_low`'s states). all but the campfire borrow states written for a different
prefab.

a layer starts in its `isStartingNode` state and takes the first transition whose conditions all
hold (`comparison` 0 =, 1 >, 2 <, 3 ≥, 4 ≤ against a bool, float, int or trigger value, `isInvert`
negating it); a transition without conditions is taken when its state's clip ends. a layer comes to
rest in a state none of whose transitions holds. later layers of one animator override earlier ones.

a settled state's look is its clip's end pose plus its `SetActive` switches, unless the clip loops
(`m_MuscleClip.m_LoopTime`): then it keeps playing, as the balloon's tube sways through its 14 s
idle (`A_interactive_balloon+1_001_01_idle_01`). a facility's visual forms are models with view
states of their own: the monitoring terminal's forms 1–4 (`int_system_kiteStation_<n>_postmodel`)
rest in an `Initial` state whose loop (`A_anm_fac_syspoikitestation+1_001_01a`…`01d`) flies the
kites, and form 0 has no clip. when each placement's loop starts is unknown. a generic clip's muscle
clip stores every animated value's start and stop (`m_ValueArrayDelta`) in the order of its bindings
(`m_ClipBindingConstant.genericBindings`): three values per position, scale or Euler-rotation
binding (attributes 1, 3 and 4), four per rotation (2), one per other float, none per PPtr curve.
Euler angles are in degrees, applied in the Unity `RotationOrder` the binding's `customType` holds:
0 XYZ (x first, then y, then z), 1 XZY, 2 YZX, 3 YXZ, 4 ZXY (`Quaternion.Euler`'s), 5 ZYX. the
locked chest (`int_trchest_lock_postmodel`) rests in a clip whose 35 Euler bindings are all XYZ;
read as ZXY, a third of its bones turn wrong and the chest sinks into the floor. a binding's `path`
is the CRC32 of the GameObject path below the Animator's own, `/`-joined (`Root/Bone001`), 0 for the
Animator's GameObject. a GameObject binding (class 1) whose attribute is the CRC32 of `m_IsActive`
switches that GameObject on (1) or off (0). effect clips switch whole groups of effects this way; in
their subtree, what the clip leaves alone keeps its saved activity, so a node saved off stays off.

playing a clip needs its curves (`m_MuscleClip.m_Clip.data`), whose scalars follow the same binding
order: the streamed block's first, then the dense block's, then the constant block's. the streamed
block is Unity's: frames of a time, a key count and per key the curve index and a cubic's
coefficients, evaluated from the key's time to the curve's next key, with a frame at −FLT_MAX for
the values before the first key and one at +∞ to end. the game's dense blocks leave `m_SampleArray`
empty and store `m_ACLType` 16 instead: `m_ACLArray` holds a u16 per frame and curve, frame-major,
decoding to `(u16 − 32767.5) / 32767.5` times the curve kind's factor (`m_PositionFactor`,
`m_ScaleFactor`, `m_EulerFactor`, `m_FloatFactor`; 1 for rotations, which are quaternion
components). sampled at the clip's start and stop, this matches `m_ValueArrayDelta` to within one
16-bit step on the balloon's clips (positions, rotations and scales). the balloon's clips leave the
ACL buffer (`m_AclCompressedBuffer`) empty; other clips keep their curves there instead
([ACL-compressed clips](#acl-compressed-clips)).

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

### scenery animators

a prefab placed without view states can carry its own Animator with an AnimatorController. Unity
plays each layer's default state (`m_DefaultState`) from load: the base layer at full weight
whatever its saved `m_DefaultWeight`, later layers at theirs. a state whose blend tree has one node
plays the clip `m_ClipID` indexes in the controller's `m_AnimationClips`, at the state's `m_Speed`;
a clip that doesn't loop then holds its end pose.

Wuling City's spinning cube (`p_anm_map02_machine+1_002_01`, at -1442, 330, -336 in map02_lv002,
placed by mission `e6m1`'s level data) is one: its controller `AC_anm_map02_machine+1_002_01` has
one state, `idle_loop`, playing the looping 53.3 s clip `A_anm_map02_machine+1_002_01` (1602 frames
at 30 fps) on 15 Transforms of a skinned mesh: four of them turn a full circle over the loop. its
curves are [ACL-compressed](#acl-compressed-clips).

Qingbo Stockade's octagonal waterwheels (`p_igroup_map02_sfwaterwheel+2_004_01`, two in map02_lv003
at -530.4, 246.9, -1074.6 and -551.8, 247.5, -1103.8, model rows of a dynamic structure gated by
script group `23300000004`) are another, built of plain mesh renderers rather than a skinned one:
the root's controller `AC_imod_map02_sfwaterwheel+2_004_01` has one state, `on_idle`, looping
`A_imod_map02_sfwaterwheel+2_004_01_openidle_01` (25 s, streamed curves at 60 fps, no ACL). three
Euler bindings (ZXY) turn the wheel's Transforms about their z: two from 0° to −360°, one from 45°
to 360°, which wraps by an eighth of a turn and so looks seamless on the eight-sided wheel. the same
clip also sets a value on two water-sheet MonoBehaviours, switches three GameObjects and sets
renderer material properties.

#### ACL-compressed clips

many clips leave their muscle clip's streamed and dense blocks empty (`m_DenseClip.m_ACLType` 0) and
keep their curves in `m_AclCompressedBuffer` instead: `TransformBufferData` holds the Transform
curves, `FloatBufferData` other float curves (the cube's Animator parameters) and
`RootMotionBufferData` root motion. each is a stock buffer of the
[Animation Compression Library](https://github.com/nfrechette/acl) 2.1 (`compressed_tracks`, tag
`0xac11ac11`, version 10, whose hash checks out; the record's `Header.Version` repeats the 10):
upstream ACL decodes the cube's three buffers as 15 transform tracks (qvvf), 21 and 14 float tracks,
1600 samples at 30 Hz, wrapping (the last sample interpolates into the first, so 1600 samples last
the clip's 53.3 s). the game's buffers drop rotations' w (`quatf_drop_w_variable`), quantize
translations (`vector3f_variable`), and strip keyframes, which playback interpolates.

the buffer's tracks map to the clip's bindings through `TransformSubTrackMasks`: three bit sets, one
each for position, rotation and scale, of `⌈OutputTrackCount / 8⌉` bytes, most significant bit first
for track 0, the whole padded to 4 bytes. the k-th position binding (in `genericBindings` order) is
the k-th track whose position bit is set, and likewise for rotations and scales; a Transform with
only a rotation binding is a track without its position bit. bindings whose index `m_ConstantIndexs`
lists take their values from `m_ConstantValues` instead (in listing order, three or four values per
Transform binding, one per other float), and a track can disagree with them: four car clips
(`A_actor_car_e2m5_1_007` and kin) hold a different position in the ACL track than the clip's start
and stop. checked over the first 3000 ACL clips of the install: decoding every one and sampling it
this way gives `m_ValueArrayDelta`'s start and stop values within 1e-2 for 2977 of them (most within
3e-4), and 23 character run and sprint loops within 0.06 at their stop only, where wrapping replaces
the last frame with the first. none had Euler bindings. what the root motion buffer and
`RootPosIndex`, `RootRotIndex` and `RootTrackCount` add isn't traced.

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

### Wuling bridges

the `int_bridge_wuling` template covers two kinds of bridge. its own model,
`int_bridge_wuling_90_postmodel`, and the `_78` and `_102` variants' models are drawbridges: a leaf
that an animator raises and lowers (`closeidle`, `<angle>_open`, `<angle>_openidle`, `<angle>_close`
clips on `int_door_base_layer`, keyed by the int `state` property). the `_12m`, `_18m`, `_24m`,
`_24m_02` and `_94m` variants are magic bridges that appear with an effect: each variant's model
override is enabled but empty, and its `Comp_InteractiveCommonPerform` diff properties set
`use_dynamic_res` true (and a `model_id` naming `int_bridge_wuling_<length>_postmodel`, which
nothing in that component reads). the bridge itself is a DynamicStreaming prefab row of that model
at the placement; with `use_dynamic_res` set, the interactive's common-perform component takes its
view controller from the DynamicStreaming entity named by its `dynamic_entity_id` property instead
of its own model, so its `state` switches that row's `on`/`off` states (`SetActive` on the deck
copies, effects on the way). the magic bridge's model has no clips.

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
