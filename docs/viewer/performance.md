# performance

- **redraw only when dirty.** `#tick` renders when the camera moved, the canvas resized, an option
  or scene value changed (`#dirty`), the stream's `version` changed, a pipeline finished compiling,
  or `continuous` is on. showing the page again also marks it dirty, because Firefox re-shows a
  hidden tab's last frame with red and blue swapped until a new one is presented. after any of those
  it renders 32 more frames of the same view (`SETTLE_FRAMES`) so the temporal antialiasing
  converges, unless `antialiasing` is off. it also renders while the auto exposure is still moving
  (or waiting on its first histogram), but meters new histograms only while the view changes or
  settles, so it eases to a fixed target and stops even though water and particles change what it
  would meter every frame. only loading keeps it rendering indefinitely; animated content (scrolling
  textures, water, clouds, particles, drifting [flow noise](../game-data/sky-and-fog.md#flow-noise))
  moves on the frames that render anyway and stops when they do. it all reads one animation clock
  that advances by the frame time only on rendered frames (and only with the `animate` option on),
  so it resumes where it stopped instead of jumping by the time the view idled. frames that only
  settle or adapt reuse the last selection, unless it drew particles, which are re-evaluated so they
  keep moving until the view idles. it traverses without rendering while streaming is in progress
  (`!stream.idle`), and does nothing at all when the view is still and streaming is idle. the
  environment re-blends only when the eye, its settings or a fade changed.
- **stats** publish every 250 ms and notify subscribers only when the JSON differs, so the React
  panels don't re-render on a still view.
- **one traversal, many passes.** selection runs once per frame; shadow layers reuse its buckets.
  frames that reuse the last selection (settling the antialiasing, adapting the exposure) keep the
  shadow layers from the frame that drew them, unless a layer's fit moved or pipelines were still
  compiling.
- **few draws.** terrain is one draw; each mesh bucket is one instanced `drawIndexed` over its slice
  of the visible list. depth-writing draws are sorted by pipeline, then nearest first, which early
  depth testing rewards; the rest by pipeline, geometry and material, so runs share bindings
  ([`render/meshes/draw-order.ts`](../../packages/viewer/src/render/meshes/draw-order.ts)).
- **each pixel shades once.** a depth prepass draws the opaque meshes' positions alone (no fragment
  work) before anything else; the terrain then skips what they cover, and the opaque meshes shade
  with `depthCompare: 'equal'`. the prepass and the shading compute positions through the same
  `@invariant` function, so their depths match exactly. on an RDNA 2 GPU at 2560×1600 this saved
  1.1–1.6 ms of 7–11 ms at dense views and cost about 0.1 ms where little overlaps.
- **early depth survives alpha testing.** a shader that may discard loses early depth and, on
  tile-based GPUs, hidden-surface removal. opaque meshes use non-discarding pipelines, and shadow
  pipelines for them have no fragment stage. alpha-tested meshes lay down cut-out depth first, then
  shade with `depthCompare: 'equal'` and a non-discarding shader, so overlapping leaf cards shade
  each pixel once. an alpha-tested material draws as opaque until the texture holding its alpha
  ([alpha testing](../game-data/materials.md#alpha-testing)) has streamed, since there's no alpha to
  test yet.
- **no MSAA.** at 2560×1600 on an Apple M-series GPU, a dense Wuling City view took ~46 ms of GPU
  time with 4× MSAA and ~16 ms with temporal antialiasing (the `taa` pass is under 1 ms), and the
  render targets shrank from ~440 to ~200 MiB. `renderScale` 0.5 brought the same view to ~5 ms.
- **AO at half resolution.** `ao depth` reduces the depth once into half-resolution view depth; GTAO
  marches that (keeping its scattered reads in cache) and the blur upsamples with depth weights.
- **cached work.** the transmittance and multiple-scattering LUTs render once per environment;
  irradiance clipmaps update only on re-centre or new cells.
- **no per-frame allocation on hot paths.** selections (their arrays and the instance range, terrain
  patch and surface objects in them), buckets and plane arrays are reused across frames, and texture
  requests per bucket allocate nothing. the stream manager evicts from a set of its ready, unpinned
  blobs rather than sweeping every blob it has seen, and reads each shard blob's byte range once.

## optimization candidates

- move per-instance culling and LOD selection to compute, writing the visible list and indirect draw
  arguments; these dominate CPU time in dense views.
- cache shadow layers across new selections when their fit and casters are unchanged; terrain still
  draws into every layer.
- reduce the AO blur's reads by packing depth with AO or using `textureGather`.
- profile terrain close-up blending; stochastic projection or fewer anisotropy taps may reduce cost.
- measure timestamp-query overhead before limiting profiling to the stats panel.

composite needs a separate HDR target: the next frame's reflections read it after the main pass
rewrites radiance. the celestial pass reuses the sky reflection target after reflections finish.
