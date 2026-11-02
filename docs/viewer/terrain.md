# terrain

how the viewer draws the terrain, foliage grids and far field that
[game-data/world.md](../game-data/world.md) describes. which pages a frame selects and streams is in
[streaming.md](streaming.md#terrain-selection); the shader is
[`render/shaders/terrain.wgsl`](../../packages/viewer/src/render/shaders/terrain.wgsl).

## terrain

the baked surface pages ([world](../game-data/world.md#terrain)) are drawn as stored; patches
without a resident surface page get a stand-in colour by slope
([streaming](streaming.md#terrain-selection)).

### close-up layers

on leaves whose splat page is resident, `detail_surface` blends the
[close-up layers](../game-data/world.md#close-up-layers) and fades them into the baked page by
distance.

- **distances**: the fade runs from 96 to 144 m (`DETAIL_FADE_START`/`END` in the shader), and
  leaves within 160 m load their splat page (`DETAIL_DISTANCE`,
  [streaming](streaming.md#terrain-selection)). these are the viewer's choices; the game's are
  unknown.

- **weights**: `sample_control` keeps its filtering half a texel inside the 8 m cell, since the
  weights belong to that cell's layers.
- **projection**: the three planes are blended by the baked normal's `|n|⁸` weights instead of the
  game's random per-pixel pick. planes and slots without weight aren't sampled.

### puddles

`wet_surface` applies the [puddle](../game-data/world.md#puddles) terms to the leaf's surface. the
ground the puddle level fills to moves from the layers' weighted height to the baked pages' flat 0.5
across the same distance fade as the close-up layers. the puddles' reflections come from the
viewer's screen-space reflections ([lighting](../game-data/lighting.md#screen-space-reflections)).

## foliage grids

grass and tree instances ([foliage grids](../game-data/world.md#foliage-grids)) arrive as ordinary
instance rows carrying their cluster's bounds, so a cluster culls and changes LOD as a whole, like
any other instance ([streaming](streaming.md#per-instance-lod)).

## LOD and HLOD

the package's per-node geometric error is a placeholder for the game's unknown HLOD switch distances
([LOD and HLOD](../game-data/world.md#lod-and-hlod)), so the SSE threshold `maxSse`
([streaming](streaming.md)) is what tunes where HLOD clusters give way to detail.
