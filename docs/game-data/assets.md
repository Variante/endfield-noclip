# assets: meshes, textures, materials and prefabs

the Unity assets that world data points at: how a StringPathHash key or PPtr names exactly one
object across bundles, the mesh, texture, material and transform classes, and how prefabs and the
dynamic ECS scene place renderers. where entity data comes from is in [world.md](world.md); which
structures a progression, quest or scene state shows is in [scene-states.md](scene-states.md); how
materials shade is in [materials.md](materials.md); interactives' models and view states are in
[interactives.md](interactives.md), and how clips and Animators move prefabs in
[animation.md](animation.md).

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
  vertex). all read as their format says.
- **compression.** `m_MeshCompression` is only an import setting: a mesh with a non-zero value and
  an empty `m_CompressedMesh` keeps its vertices in the ordinary channels.
- skinned meshes carry weights, bone indices and bind poses.

#### built-in meshes

some prefabs use Unity's built-in meshes from `library/unity default resources`, which no bundle
holds: the Quad (path id 10210; the collectible marker `int_collection_common_postmodel`'s icon and
glow cards) and the Cube (10202; the balloons, `int_balloon_postmodel*`). the render pipeline
bundles its own copies (`Packages/com.hg.render-pipelines/Runtime/RenderPipelineResources/Mesh/`
`Quad.fbx` and `Cube.fbx`). the quad has the built-in's geometry: 1 m in the XY plane, facing −Z,
UV = position + 0.5. the cube is a 1 m cube with each face's UVs spanning 0–1; whether its faces' UV
orientation matches the built-in's is unchecked.

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
  do particle systems ([particle systems](effects.md#particle-systems)).
- an enabled `LODGroup` (class 205) picks one of its LODs' renderers at a time, by each LOD's
  `screenRelativeHeight`; in Unity that height is the group's `m_Size` at its
  `m_LocalReferencePoint`, scaled by the quality setting's LOD bias, with an optional cross-fade
  (the game's bias and fade aren't checked).
- material slots keep their order: a null slot draws nothing for that submesh, and slots past the
  last submesh draw the last submesh again. `m_CastShadows` 3 or 4 (Unity's `ShadowsOnly`,
  `ShadowsOnlyTwoSided`) marks a shadow-only renderer.
- a skinned renderer's pose is each bone's prefab-space matrix times its bind pose.

prefabs can also hold environment volumes ([environment.md](environment.md#prefab-volumes)), and
effect components: particle systems, spline movers, one-shot effects and effect LOD tables
([effects.md](effects.md#particle-systems)).

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
  matching entity ids and, in StreamingChunkData's layout, their property tables: rect decals bind
  their material there under `0xff010000` as in static chunks (all 1786 of map02's, among them
  Jingyu Valley's cliff moss, 64 materials).

one model or ECS group can be referenced by several resource groups, and some ECS entities also
appear in static chunks. ECS renderers with a spin component turn
([spinning scenery](animation.md#spinning-scenery)).

## open

- the meaning of the uv dimension byte's high nibble 2
- the path hash function: it diverges from XXH3 at 128 UTF-8 bytes (see AnimeStudio's
  `EndfieldVfsHash`)
