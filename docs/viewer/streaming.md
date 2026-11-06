# streaming and selection

each frame that does work runs one traversal (`#traverseAndPrepare` in `viewer/viewer.ts`):

1. `Selector.run` walks the tile tree for terrain patches and instance row ranges, and the selected
   blocks' spinning rows are turned ([per-instance LOD](#per-instance-lod)).
2. `MeshSelector.run` culls and LOD-selects instances in those ranges and buckets them for drawing.
3. sky textures, water surfaces and irradiance cells are requested.
4. `StreamManager.update` cancels, dispatches, uploads and evicts; `TextureStore.commit` applies
   texture shrinks.
5. if the frame renders, the renderers write their per-frame buffers (`prepare`).

## tile tree

[`scene/tile-tree.ts`](../../packages/viewer/src/scene/tile-tree.ts) links the package's quadtree
nodes to their children and splits each node's content refs by kind: one terrain height page, one
terrain surface page, a leaf's terrain splat page, HLOD refs (with a tier), detail refs and
conditional refs. each node at or below the cell level records its cell id, for level focus.

## instance selection

[`streaming/selection.ts`](../../packages/viewer/src/streaming/selection.ts) uses 3D Tiles-style
REPLACE refinement on screen-space error, `geometricError · pixelFactor / distance`:

- a node draws its HLOD while SSE ≤ `maxSse` (default 12 px), otherwise its children; a node with no
  shown HLOD always refines. with `detail` on, a leaf refines into its detail blocks, even when it
  has none: some clusters stand for scenery filed under neighbouring leaves or as global scenery,
  which draws anyway, so keeping the cluster would overlay it.
- a node's geometric error is the packer's placeholder (1/16 of its edge) for the game's unknown
  HLOD switch distances ([LOD and HLOD](../game-data/world.md#lod-and-hlod)), so `maxSse` is what
  tunes where clusters give way to detail.
- until everything a refinement needs is resident, the node keeps drawing its own HLOD, so streaming
  never opens holes. disabled HLOD tiers are refined past.
- conditional content has no HLOD stand-in, so it follows its own rule: drawn, while `detail` is on,
  while its tile spans more than `maxSse` pixels.
- manifest `global` refs are pinned and drawn whenever they're resident, never requested. they have
  no tile to refine, so where an HLOD cluster covers global scenery both draw until the cluster's
  tile refines.
- every ref is drawn only while its visibility group shows. the viewer evaluates `groupsShown` (see
  [package-format.md](../package-format.md#visibility-groups)) whenever the level, a scene value or
  the stream areas at the camera change, and hands the same array to the selector, the water, the
  local lights and the irradiance volume, which is how one level is shown alone over the shared
  terrain and how scene states switch content.

## terrain selection

terrain is CDLOD, with the viewer's own LOD rule: the game's per-node `maxHeightError` isn't an
error bound ([terrain](../game-data/world.md#terrain)). each level's distance range comes from its
sample spacing and `terrainPixels` (default 3 px per sample). a node subdivides while the next finer
range reaches it; a quadrant whose child page isn't resident is drawn from the parent page while the
child is requested, and vertices morph to the coarser grid over the last 30% of a level's range (the
coarsest level never morphs). every selected page quadrant is an instance of one shared grid, so
terrain is a single draw
([`render/terrain/terrain-renderer.ts`](../../packages/viewer/src/render/terrain/terrain-renderer.ts)).

each visited node also wants its surface page at the same priority. a patch is shaded from the
finest resident surface page at or above its node, magnified when it's an ancestor's, so the ground
keeps its colours while finer pages stream. leaves within `DETAIL_DISTANCE` (160 m) also want their
splat page, which the [close-up layers](terrain.md#close-up-layers) need along with every layer
texture (pinned at load). `terrainSurface` and `terrainSplat` turn the two off; without BC textures
neither loads.

## per-instance LOD

before it runs, the selected blocks' [spinning rows](../package-format.md#instance-block-inst-efin)
are turned to the viewer's clock (`turnRows` in
[instance-rows.ts](../../packages/viewer/src/content/instance-rows.ts)): their transform and bounds
centre are rewritten from the stored ones in the CPU copy, and the runs of rows holding them (runs
bridge gaps of up to 8 still rows) are written to the GPU again. while any selected block has
spinning rows, frames that render traverse again, as with particles, so the shadows follow. every
wheel starts from its stored pose at the clock's zero; the game's phase is its gameplay clock's.

[`streaming/mesh-selection.ts`](../../packages/viewer/src/streaming/mesh-selection.ts) runs on the
CPU over the selected row ranges, with the sphere and shadow layer tests of
[`instance-culling.ts`](../../packages/viewer/src/streaming/instance-culling.ts) and the chain slots
and buckets of [`mesh-buckets.ts`](../../packages/viewer/src/streaming/mesh-buckets.ts). per
instance it:

1. culls by projected bounding-sphere radius (`minBoxPixels`, default 1.5 px) and by frustum planes;
2. computes Unity's LODGroup metric (object size relative to screen height, the size being twice the
   largest half-extent of its world bounds; unverified, see
   [chains](../package-format.md#binary-encodings)), or for a `CameraDistance` chain the squared
   distance to its distance origin, and picks every chain draw whose `(minSquared, maxSquared]` band
   contains it. an instance past the chain's smallest threshold, or with nothing drawn in its band,
   is culled, matching the game;
3. if all picked geometries are resident, appends the row to a bucket keyed by (geometry, submesh,
   material, mirrored). otherwise it requests the geometry at a priority of its projected pixel
   height and draws the nearest LOD whose geometry is all resident (coarser first on ties), which is
   usually the one it drew before the switch. that stand-in is kept from eviction but not requested;
   only an instance with no resident LOD draws its box (particle emitters and shadow-only instances
   never do). an instance is mirrored when its transform's determinant is negative, which flips its
   triangles' winding.

meshes cull the faces their material culls (front faces are clockwise, as Unity's are), with front
and back swapped for mirrored buckets. each mesh phase, shadows included, has a pipeline per face
culling and UV format, and draws are sorted by both. the vertex shader dequantizes 16-bit UVs with
per-draw transforms, so the fragment shader sees one kind of UV.

materials the game draws nothing visible with are dropped from the chain once, when it's first used
(the rest draw, the ones the viewer can't as [unsupported](materials.md#unsupported-materials)), as
are shadow-only draws whose material casts no shadow; the other shadow-only draws go to cast-only
buckets even for instances in view. textures are then requested per bucket, coarse to fine, down to
the mip that gives about one texel per pixel across the largest on-screen use, scaled by the UV
tiling, then `textureBias` levels coarser (0 by default; each level quarters the textures' memory).
sky, reflection and water textures are streamed whole (`streamWholeTexture`; both ways are in
[`texture-requests.ts`](../../packages/viewer/src/streaming/texture-requests.ts)).

the output (a visible row list plus per-bucket ranges) has the shape a GPU cull pass would write
next to indirect draw arguments ([optimization candidates](performance.md#optimization-candidates)).

## priority

priority is SSE (or projected pixels for geometry and textures). content in the focused level's
cells is boosted 8×. nodes outside the frustum are requested at 0.1× where the traversal still
reaches them: terrain children of a node in view (prefetch around the camera) and instance tiles in
the [off-screen casters'](lighting.md#shadows) volume, whose instances' geometry is requested at
0.1× of its pixel height. a texture's pieces are requested at the bucket's priority divided by one
plus the piece's index, so coarse levels come first. irradiance cells and whole-streamed textures
(sky, reflection) use fixed priorities above all scenery.

## residency and budgets

[`streaming/stream-manager.ts`](../../packages/viewer/src/streaming/stream-manager.ts) owns each
blob's lifecycle (`idle → queued → fetching → decoding → uploading → ready`, or `failed`, which
isn't retried). it doesn't know the kinds of content: each kind (`heights`, `surface`, `splat`,
`layer`, `instances`, `geometry`, `texture`, `irradiance`) has a handler
([`streaming/residency.ts`](../../packages/viewer/src/streaming/residency.ts)) that uploads its
decoded blobs and frees them, and may build its decode job (instance blocks add their row kinds,
from [`content/row-kinds.ts`](../../packages/viewer/src/content/row-kinds.ts)). `openScene`
([`viewer/scene-loader.ts`](../../packages/viewer/src/viewer/scene-loader.ts)) wires the handlers to
the renderers and stores that own the GPU side; their residency shapes are in
[`streaming/resident.ts`](../../packages/viewer/src/streaming/resident.ts).

- **wanting.** the traversal calls `want(blob, priority)` every frame. a resident blob that's wanted
  counts as used, even when a coarser stand-in is drawn, so a refinement in progress isn't evicted
  and refetched.
- **pinning.** the core archive's height pages and instance blocks (coarse terrain, every HLOD
  block, global scenery) are pinned at load
  ([`streaming/core-blobs.ts`](../../packages/viewer/src/streaming/core-blobs.ts)), plus, where BC
  textures are supported, its surface pages and the terrain layer textures. pinned blobs come first
  (core ones are read from memory at once), upload first and are never evicted. pinned height pages
  keep their samples on the CPU for ground-height queries
  ([`scene/ground.ts`](../../packages/viewer/src/scene/ground.ts)), which place a level's first view
  ([`scene/level-pose.ts`](../../packages/viewer/src/scene/level-pose.ts)).
- **fetching.** at most 32 range reads in flight (`maxRequests`): a dense view wants thousands of
  blobs averaging ~60 KiB, so latency, not bandwidth, bounds loading. measured from the dev server
  on Wuling's first views: 32 takes 3–4 s where 8 took 9–12 s; 64, dispatching freed slots between
  frames, and wider coalescing (up to 75% more bytes fetched) gain little or nothing. queued blobs
  are sorted by priority, and each seed coalesces neighbours in the same archive (gaps ≤ 64 KiB,
  span ≤ 2 MiB, ≤ 96 blobs) into one range read
  ([`streaming/coalesce.ts`](../../packages/viewer/src/streaming/coalesce.ts)). core blobs are read
  from memory without a request slot. requests whose blobs nobody wanted for more than 2 frames are
  aborted; queued blobs not wanted this frame return to idle.
- **uploading.** pinned first, then by priority, until the frame has uploaded 24 MiB. decoded
  content nobody has wanted for 30 frames is dropped instead. a full pool evicts up to 16 resident,
  unpinned blobs of the same kind that weren't used this frame and have no higher priority, oldest
  first, and retries.
- **budget.** resident bytes of all kinds count against `budgetMiB` (default 768, since the densest
  views, such as Wuling City at street level, want 550–700 MiB). over budget, the least recently
  used unpinned blobs not used this frame are evicted. if the budget is still exceeded by content in
  use, the manager is _saturated_: unpinned fetches and uploads pause (queued blobs return to idle
  and decoded ones are dropped) until something falls out of use, because evicting fresh uploads
  only to refetch them would thrash.
- `version` is bumped on every upload and eviction; the frame loop redraws on a change.
