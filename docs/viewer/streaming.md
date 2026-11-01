# streaming and selection

each frame that does work runs one traversal (`#traverseAndPrepare` in `viewer.ts`):

1. `Selector.run` walks the tile tree for terrain patches and instance row ranges.
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
- until everything a refinement needs is resident, the node keeps drawing its own HLOD, so streaming
  never opens holes. disabled HLOD tiers are refined past.
- conditional content has no HLOD stand-in, so it follows its own rule: drawn, while `detail` is on,
  while its tile spans more than `maxSse` pixels.
- manifest `global` refs are pinned and drawn whenever they're resident, never requested.
- every ref is drawn only while its visibility group shows. the viewer evaluates `groupsShown` (see
  [package-format.md](../package-format.md#visibility-groups)) whenever the level, a scene value or
  the stream areas at the camera change, and hands the same array to the selector, the water and the
  local lights, which is how one level is shown alone over the shared terrain and how scene states
  switch content.

## terrain selection

terrain is CDLOD; how its pages shade is in [terrain](terrain.md). each level's distance range comes
from its sample spacing and `terrainPixels` (default 3 px per sample). a node subdivides while the
next finer range reaches it; a quadrant whose child page isn't resident is drawn from the parent
page while the child is requested, and vertices morph to the coarser grid over the last 30% of a
level's range (the coarsest level never morphs). every selected page quadrant is an instance of one
shared grid, so terrain is a single draw
([`render/terrain-renderer.ts`](../../packages/viewer/src/render/terrain-renderer.ts)).

each visited node also wants its surface page at the same priority. a patch is shaded from the
finest resident surface page at or above its node, magnified when it's an ancestor's, so the ground
keeps its colours while finer pages stream. the shader draws the pages as stored: albedo, normal,
roughness and occlusion ([world.md](../game-data/world.md#terrain)). patches with no resident page,
or with `terrainSurface` off or no BC textures, fall back to stand-in colours by slope.

leaves within `DETAIL_DISTANCE` (160 m) also want their splat page. once it and all of the package's
layer textures (pinned at load) are resident, the shader blends the leaf's close-up layers as
[world.md](../game-data/world.md#close-up-layers) describes, with a smooth triplanar projection in
place of the game's random one, and fades them into the baked page between 96 and 144 m. the layers
sample with explicit gradients so slots and planes without weight are skipped. `terrainSplat` turns
this off. one measurement on an Apple M-series GPU at 1600×1000 showed about 7 ms added GPU time
over open ground; the blend's individual costs remain unprofiled.

## per-instance LOD

[`streaming/mesh-selection.ts`](../../packages/viewer/src/streaming/mesh-selection.ts) runs on the
CPU over the selected row ranges. per instance it:

1. culls by projected bounding-sphere radius (`minBoxPixels`, default 1.5 px) and by frustum planes;
2. computes Unity's LODGroup metric (object size relative to screen height) and picks every chain
   draw whose `(minSquared, maxSquared]` band contains it. an instance past the chain's smallest
   threshold, or with nothing drawn in its band, is culled, matching the game;
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
sky, reflection and water textures are streamed whole (`streamWholeTexture`).

the output (a visible row list plus per-bucket ranges) has the shape a GPU cull pass would write
next to indirect draw arguments ([optimization candidates](performance.md#optimization-candidates)).

## priority

priority is SSE (or projected pixels for geometry and textures). content in the focused level's
cells is boosted 8×. nodes outside the frustum are requested at 0.1× where the traversal still
reaches them: terrain children of a node in view (prefetch around the camera) and instance tiles in
the shadow casters' volume; shadow-only geometry is requested at 0.1× of its pixel height. a
texture's pieces are requested at the bucket's priority divided by one plus the piece's index, so
coarse levels come first. irradiance cells and whole-streamed textures (sky, reflection) use fixed
priorities above all scenery.

## residency and budgets

[`streaming/stream-manager.ts`](../../packages/viewer/src/streaming/stream-manager.ts) owns each
blob's lifecycle (`idle → queued → fetching → decoding → uploading → ready`, or `failed`, which
isn't retried).

- **wanting.** the traversal calls `want(blob, priority)` every frame. a resident blob that's wanted
  counts as used, even when a coarser stand-in is drawn, so a refinement in progress isn't evicted
  and refetched.
- **pinning.** the core archive's height pages and instance blocks (coarse terrain, every HLOD
  block, global scenery) are pinned at load, plus, where BC textures are supported, its surface
  pages and the terrain layer textures. pinned blobs come first (core ones are read from memory at
  once), upload first and are never evicted. pinned height pages keep their samples on the CPU for
  ground-height queries (the first pose).
- **fetching.** at most 32 range reads in flight (`maxRequests`): a dense view wants thousands of
  blobs averaging ~60 KiB, so latency, not bandwidth, bounds loading. from the dev server, 32
  instead of 8 brought Wuling's first views from 9–12 s to 3–4 s; 64 gained little more, neither did
  dispatching freed request slots between frames, and coalescing more widely saved less while
  fetching up to 75% more bytes. queued blobs are sorted by priority, and each seed coalesces
  neighbours in the same archive (gaps ≤ 64 KiB, span ≤ 2 MiB, ≤ 96 blobs) into one range read. core
  blobs are read from memory without a request slot. requests whose blobs nobody wanted for more
  than 2 frames are aborted; queued blobs not wanted this frame return to idle.
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
