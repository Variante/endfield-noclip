# how the frame stays cheap

- **redraw only when dirty.** `#tick` renders when the camera moved, the canvas resized, an option
  or scene value changed (`#dirty`), the stream's `version` changed, a pipeline finished compiling,
  the auto exposure is still moving (or waiting on its first histogram), or `continuous` is on.
  after any of those it renders 32 more frames of the same view (`SETTLE_FRAMES`, reusing the last
  selection) so the temporal antialiasing converges, unless `antialiasing` is off. drifting fog
  ([flow noise](../game-data/sky-and-fog.md#flow-noise)) also renders every frame, reusing the last
  selection, while `flowNoisePlaying` is on and the environment has it; turning that off freezes its
  time. it traverses without rendering while streaming is in progress (`!stream.idle`), and does
  nothing at all when the view is still and streaming is idle. the environment re-blends only when
  the eye, its settings or a fade changed.
- **stats** publish every 250 ms and notify subscribers only when the JSON differs, so the React
  panels don't re-render on a still view.
- **one traversal, many passes.** selection runs once per frame; shadow layers reuse its buckets.
  frames that reuse the last selection (settling the antialiasing, drifting fog) keep the shadow
  layers from the frame that drew them, unless a layer's fit moved or pipelines were still
  compiling.
- **few draws.** terrain is one draw; each mesh bucket is one instanced `drawIndexed` over its slice
  of the visible list. depth-writing draws are sorted by pipeline, then nearest first, which early
  depth testing rewards; the rest by pipeline, geometry and material, so runs share bindings
  ([`render/mesh-renderer.ts`](../../packages/viewer/src/render/mesh-renderer.ts)).
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
- **no per-frame allocation on hot paths.** selections, buckets and plane arrays are reused across
  frames.
