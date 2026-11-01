# irradiance volume

how the viewer samples what [game-data/irradiance.md](../game-data/irradiance.md) describes. the
package stores the base bake's cells in the game's GPU layout
([package-format.md](../package-format.md)), so the viewer uploads them unchanged; how the ambient
term uses the result is in [lighting](lighting.md#ambient).

## clipmaps

[`render/irradiance-volume.ts`](../../packages/viewer/src/render/irradiance-volume.ts) keeps three
3D clipmaps of 128 × 64 × 128 texels with probes 0.5, 2 and 8 m apart (A: L0 rgb; B: three slabs
along y for the L1 of each channel). per level it wants the window of cells its texels fall in,
streams them into one storage buffer (coarse levels first, ahead of scenery), and refills the level
with
[`shaders/irradiance-update.wgsl`](../../packages/viewer/src/render/shaders/irradiance-update.wgsl)
when the camera moves more than 4 texels from its centre or a cell arrives or leaves. levels refill
coarse to fine, and a refilled level refills every finer one, because their probe-less texels copy
it ([cells and probes](../game-data/irradiance.md#cells-and-probes)). the update pass looks cells up
in that window instead of the game's top-level hash. the clipmaps are sampled toroidally in
`ambient_irradiance` ([`frame.wgsl`](../../packages/viewer/src/render/shaders/frame.wgsl)).

## region bakes

the finest level also takes the [region bakes](../game-data/irradiance.md#region-bakes) that show
and overlap it: a texel inside a resident region's grid reads that region's probe instead of the
cells', and the level refills when that set changes. the coarser levels keep the scene's bake, so a
room seen from beyond the finest level's reach (about 29 m) is lit as if empty.
