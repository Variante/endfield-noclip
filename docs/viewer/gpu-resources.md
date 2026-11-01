# GPU resource management

- **device** ([`gfx/device.ts`](../../packages/viewer/src/gfx/device.ts)): the mesh pipeline needs
  17 sampled textures per stage, exceeding WebGPU's default limit. without BC support, package BC
  textures cannot stream and materials use their untextured look. optional stencil support enables
  effect portals; timestamp queries enable GPU profiling.
- **range allocator**
  ([`gfx/range-allocator.ts`](../../packages/viewer/src/gfx/range-allocator.ts)): first-fit over
  units, with frees coalescing neighbours so streaming in and out doesn't fragment the space without
  bound. it sub-allocates the instance-row mega storage buffer (one range per block), the irradiance
  cell buffer and the terrain height page pool (one unit per page), all
  [`GrowableBuffer`s](../../packages/viewer/src/gfx/growable-buffer.ts): they start at 10, 32 and 8
  MiB and, when a range doesn't fit, copy themselves into a buffer twice the size, up to 1.5M rows
  (114 MiB), 192 MiB and 4096 pages (33 MiB). a level's view holds 2–5 MiB of rows, 20–40 MiB of
  cells and 4–7 MiB of heights, so they grow only as content from several views piles up under a
  large budget; they never shrink, since the budget bounds them. owners rebuild their bind groups
  when the buffer's `version` changes. surface pages use a pair of BC3 texture arrays, one layer per
  page (1024 layers, or the device's array-layer limit if lower; 34 MiB); splat pages use 256 slots
  of an RGBA8 control array, a BC3 tint array and an index buffer (22 MiB); the package's layer
  textures get two BC7 arrays sized at load. the surface and splat arrays are allocated at full size
  up front, since a texture array can't grow without copying every layer. geometry gets one vertex
  and one index buffer per blob.
- **uniform ring** ([`gfx/uniform-ring.ts`](../../packages/viewer/src/gfx/uniform-ring.ts)): one
  uniform buffer in 3 per-frame regions, sub-allocated at `minUniformBufferOffsetAlignment`. callers
  fill CPU views; `flush` uploads the frame's region in one `writeBuffer`, and draws bind group 0 at
  a dynamic offset. a frame needs the main block plus one per shadow layer.
- **bind layouts** ([`gfx/bind-layouts.ts`](../../packages/viewer/src/gfx/bind-layouts.ts)): group 0
  is the frame (uniforms, shadow map, reflection cubemap, irradiance clipmaps, shadow ramp, local
  lights and their bins, cloud shadow) for every family and the volumetric fog, so a pass binds it
  once; group 1 is per family; meshes add group 2 (per-draw parameters) and group 3 (material
  textures). shadow passes bind a placeholder in place of the shadow map they render into.
- **pipeline cache** ([`gfx/pipeline-cache.ts`](../../packages/viewer/src/gfx/pipeline-cache.ts)):
  modules by label, pipelines by a state key such as `mesh/opaque/x4`, compiled with
  `createRenderPipelineAsync`. renderers `prepare` the pipelines they use at construction, so
  streaming compiles nothing; only the stencil variants of effect pipelines compile on first use. a
  draw whose pipeline isn't ready yet is skipped, and the frame loop renders again once it is.
- **texture store**
  ([`render/texture-store.ts`](../../packages/viewer/src/render/texture-store.ts)): textures arrive
  as pieces, the mip tail first and then one blob per larger level. the GPU texture holds a
  contiguous run of levels from the finest integrated piece down to 1×1. integrating a finer piece
  creates a texture one step larger and copies the coarser levels over; releasing a piece shrinks it
  the same way at the next `commit`. a piece that arrives before its coarser neighbour waits. BC
  blocks upload as stored, without transcoding. replaced textures are destroyed one commit later,
  because bindings from before the swap are still in that frame's command buffer; bind groups
  rebuild when a binding's `version` changes.
