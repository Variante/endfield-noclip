# viewer

the viewer (`packages/viewer`) is a React shell around a WebGPU renderer. the package layout is in
[package-format.md](../package-format.md). driving and profiling it from an agent is in
[driving-the-viewer.md](../driving-the-viewer.md).

the entry points are [`src/app.tsx`](../../packages/viewer/src/app.tsx) (UI, URL state) and
[`src/viewer.ts`](../../packages/viewer/src/viewer.ts) (`Viewer`: device, frame loop, camera, loaded
scene). the UI drives the viewer through `setOptions`, `showLevel`, `flyToLevel` and
`setSceneValue`, and reads `stats` through `subscribe`.

implementation pages link to the corresponding [game-data](../game-data/lighting.md) findings:

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

known gaps are indexed in [status](../status.md); rendering costs and optimization candidates are in
[performance](performance.md).
