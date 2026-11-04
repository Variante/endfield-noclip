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

the vertex stage reads the dequantized `unorm16x4` positions and, for surfaces whose `meshNormals`
is set and whose mesh has them, its octahedral normals; other surfaces face straight up. the packer
sets `meshNormals` on proxy-only surfaces only, since the game shades LOD surfaces through its grid
([shading](../game-data/water.md#shading)); this also hides the polygon meshes' downward-facing
triangles. transforms are made eye-relative on the CPU.

## `Global_Water_Config`

the wave-normal array, the global flow map and the caustic map are streamed whole.

## shading

the viewer computes the [game's shading](../game-data/water.md#shading) per fragment in one pass,
where the game writes a G-buffer and lights it full-screen after the opaque scene:

- **pass**: drawn in the post chain after compositing, over a copy of the HDR scene, and only in the
  `lit` debug view. both faces are drawn so water reads from below.
- **effects over it**: the game lights its water before drawing transparent things, and its camera
  depth holds the scene without the water ([game data](../game-data/water.md#waterdecal)), so they
  presumably show over the water even below its surface (unchecked against an in-game shot). before
  the composite, the water's surfaces lay down the nearest one's depth (`SceneTextures.waterDepth`,
  from `fs_water_depth`, less the fragments the shading drops behind the scene; where surfaces
  overlap the nearest wins, while the shading draws them all). the composite leaves the transparent
  layers out wherever that depth holds water, and the water lays them over its own colour, fogged as
  the composite would. the glow (additive effects such as the mist) is in the copy already, so the
  water takes it back out of what it refracts and adds it over itself.
- **lighting**: the pass binds the main pass's frame group, so water is lit like the rest of the
  scene: the sun through its shadow maps, the irradiance volume, and the level's sky reflection.
- **reflection**: the game reflects water through its screen-space reflection pass, with water
  written into its inputs. water draws after the composite here, so it marches separately, with the
  same march ([`ssr-trace.wgsl`](../../packages/viewer/src/render/shaders/ssr-trace.wgsl)).

## water volumes

[water-levels.ts](../../packages/viewer/src/render/water-levels.ts) holds each
[water volume](../game-data/water.md#water-volumes)'s fill. a volume's surface is packed at its
authored fill; the water renderer raises its transform and bounds by the difference, and the
floaters' instance rows (the package names each by block blob and row) move by the same amount, in
the CPU copy the selection culls with and on the GPU.

the "Water levels" section of the scene conditions panel
([water-levels.tsx](../../packages/viewer/src/ui/water-levels.tsx)) lists the shown level's volumes
that scripts move, each a select over its `waterLevel` scene control with what sets each fill. the
viewer moves each volume to the fill its control's value picks, linearly at the speed the scripts
move it at (else the volume's fill speed), so Suiming's stages take their two or three minutes;
"Movement" speeds that up or jumps. "Reset" drops the picks with every other control's, putting
every volume back at its authored fill.

it differs from the game in that:

- moves are linear: the game's ease over the last metres, and the eased moves of scripts that don't
  fix the speed, aren't reproduced
- floaters keep their authored height above the surface instead of settling to `surface_offset`, and
  follow it without lag
- nothing is triggered: the switches, clocks and quests that move volumes are listed by script id in
  the level labels, not run

## WaterProxy and WaterDecal

the mesh renderer skips the map02 river meshes that carry
[`HGRP/WaterProxy`](../game-data/water.md#waterproxy-and-waterdecal), since none of its passes draws
in the main view.

### foam boxes

[WaterDecal](../game-data/water.md#waterdecal) boxes are packed as `waterFoam` surfaces and drawn by
the mesh renderer's effect family (`fs_water_foam` in
[effect.wgsl](../../packages/viewer/src/render/shaders/effect.wgsl)), inside the water pass, when
the frame has any:

1. **water depth.** the nearest surface's depth, laid down before the composite (above).
2. **foam.** the boxes draw into an `rgba8unorm` target cleared to (0, 0, 0, 1), with the main
   pass's depth attached read-only for the game's `_ZTest` (`waterFoam` and `waterFoamBehind` looks,
   one phase each), each covered pixel projecting the box onto the water depth. rgb takes the box's
   premultiplied foam plus what's there times one minus its alpha, and alpha the product of those
   factors.
3. **shading.** the water reads the target at its pixel: foam colour `= rgb + saturate(own) · a`,
   saturated, the game's 8-bit clamp. the water's own foam is saturated too, with boxes or without.

it differs from the game in that the per-placement `HGWaterDecalRenderer` values aren't packed
(every map02 prefab has the neutral ones), the static boxes of InitChunkData component 31 aren't
packed, the soft blend's device depths use the viewer's near plane, and the game's mip bias
(`_MinMipLevel`, `_Bias`) is left out (0 on every map02 material).
