# water

how the viewer draws the open-world water that [game-data/water.md](../game-data/water.md)
describes: [water-renderer.ts](../../packages/viewer/src/render/water-renderer.ts) and
[water.wgsl](../../packages/viewer/src/render/shaders/water.wgsl).

## placements

surfaces are resident in the game, so the whole water table is in the core archive and every surface
is always available. each frame the viewer selects the surfaces whose visibility group shows (the
shown level's or tag 0's, with its scene states active) and whose geometry entry is ready. each
wants its geometry blob at a priority falling with horizontal distance from the camera; resident
ones inside the frustum are drawn, up to 4096.

## surface meshes

the vertex stage reads the dequantized `unorm16x4` positions and, for proxy-only surfaces whose mesh
has them, its octahedral normals. LOD surfaces face straight up, since the game shades them through
its grid ([shading](../game-data/water.md#shading)); this also hides the polygon meshes'
downward-facing triangles. transforms are made eye-relative on the CPU.

## `Global_Water_Config`

the wave-normal array, the global flow map and the caustic map are streamed whole.

## shading

the viewer computes the [game's shading](../game-data/water.md#shading) per fragment in one pass,
where the game writes a G-buffer and lights it full-screen after the opaque scene:

- **pass**: drawn in the post chain after compositing, over a copy of the HDR scene, and only in the
  `lit` debug view. both faces are drawn so water reads from below.
- **effects over it**: the composite has already added the transparent pass's glow (additive effects
  such as the mist) to the copy. the game draws effects after its water, so the water takes the glow
  back out of what it refracts and adds the glow over its own colour. the glow has no depth, so
  additive effects below the surface also show over it, unattenuated.
- **lighting**: the pass binds the main pass's frame group, so water is lit like the rest of the
  scene: the sun through its shadow maps, the irradiance volume, and the level's sky reflection.
- **reflection**: the game reflects water through its screen-space reflection pass, with water
  written into its inputs. water draws after the composite here, so it marches separately, with the
  same march ([`ssr-trace.wgsl`](../../packages/viewer/src/render/shaders/ssr-trace.wgsl)).

## WaterProxy and WaterDecal

the mesh renderer skips the map02 river meshes that carry
[`HGRP/WaterProxy`](../game-data/water.md#waterproxy-and-waterdecal), since none of its passes draws
in the main view.
