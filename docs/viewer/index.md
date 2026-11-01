# viewer

the viewer (`packages/viewer`) is a React shell around a raw WebGPU renderer. these pages cover how
it opens a package, picks and streams content each frame, encodes the frame, shades what the game
draws, manages GPU memory, and keeps idle frames free. the package layout it reads is in
[package-format.md](../package-format.md). driving and profiling it from an agent is in
[driving-the-viewer.md](../driving-the-viewer.md).

the entry points are [`src/app.tsx`](../../packages/viewer/src/app.tsx) (UI, URL state) and
[`src/viewer.ts`](../../packages/viewer/src/viewer.ts) (`Viewer`: device, frame loop, camera, loaded
scene). the UI drives the viewer through `setOptions`, `showLevel`, `flyToLevel` and
`setSceneValue`, and reads `stats` through `subscribe`.

how the viewer draws each part of the game, next to the [game-data](../game-data/lighting.md) page
of the same name that describes what the game does:

| page                                  | covers                                                                           |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| [loading](loading.md)                 | package sources, the dev package server, opening, decode workers, URL parameters |
| [streaming](streaming.md)             | the tile tree, instance and terrain selection, LOD, priority, residency          |
| [frame](frame.md)                     | the passes of a frame and their targets                                          |
| [GPU resources](gpu-resources.md)     | bind groups, pipelines, buffers and textures                                     |
| [performance](performance.md)         | how the frame stays cheap                                                        |
| [scene states](scene-states.md)       | evaluating scene controls and the scene conditions panel                         |
| [environment](environment.md)         | blending environment volumes at the camera                                       |
| [lighting](lighting.md)               | units, sun, shadows, ambient, reflections, local lights                          |
| [irradiance](irradiance.md)           | the irradiance clipmaps and room bakes                                           |
| [materials](materials.md)             | how materials become looks, and unsupported materials                            |
| [effects](effects.md)                 | scenery effects in the transparent pass                                          |
| [terrain](terrain.md)                 | terrain layers, puddles and foliage grids                                        |
| [water](water.md)                     | the water pass                                                                   |
| [sky and fog](sky-and-fog.md)         | sky, celestial layers, fogs                                                      |
| [post-processing](post-processing.md) | the post chain, AO, light shafts, lens flare, exposure, bloom, grading           |
| [particles](particles.md)             | billboards and particle evaluation                                               |

## open

- per-instance culling and LOD selection run on the CPU and dominate CPU time at dense views; a
  compute cull pass writing the visible list plus indirect arguments would replace them.
- shadow layers are kept only across frames that reuse the last selection; any new selection redraws
  every layer's casters, even a layer whose snapped fit didn't move. the terrain still draws whole
  into every layer. off-screen casters added about 14k rows and roughly 2–3 ms of CPU time at a
  street-level Wuling City view (unprofiled beyond that).
- the temporal antialiasing has no sharpening, and nothing handles moving surfaces beyond the
  neighbourhood clip: water waves and the GTAO noise pattern rely on it. with temporal smoothing in
  place, the terrain's close-up layers could sample one projection plane per pixel at random, as the
  game does, instead of blending all three.
- composite writes a separate `hdr scene` target: the main pass's radiance target can't hold it,
  because the next frame's screen-space reflections read it after the main pass rewrites radiance.
  the celestial pass already reuses the sky reflection target, which the reflections are done with.
- the AO blur's loads per pixel could be cut by packing depth with AO or using `textureGather`.
- terrain's GPU cost at high resolution is unexamined.
- the profiler times every pass whenever `timestamp-query` exists; gate it on the stats panel if it
  shows up in measurements.
- terrain surface pages swap with their level, without cross-fade. the close-up blend's cost is
  unprofiled; sampling one projection plane per pixel, as the game does, or fewer anisotropy taps
  are the obvious cuts, and layer tiling repeats visibly in open grass.
