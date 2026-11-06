# sky and fog

how the viewer draws the sky, the layers beyond the atmosphere and the fogs that
[game-data/sky-and-fog.md](../game-data/sky-and-fog.md) describes. the passes are listed in
[frame.md](frame.md) and [post-processing.md](post-processing.md#post-chain).

## sky

[`shaders/atmosphere.wgsl`](../../packages/viewer/src/render/shaders/atmosphere.wgsl) builds the
transmittance, multiple-scattering and per-frame sky-view LUTs of the
[atmosphere model](../game-data/sky-and-fog.md#sky). the game's LUT scale (`skyViewScale` in
[`render/environment.ts`](../../packages/viewer/src/render/environment.ts)) is applied when
[`shaders/sky.wgsl`](../../packages/viewer/src/render/shaders/sky.wgsl) samples the LUT rather than
when it's rendered, which comes to the same.

the cloud panorama is drawn in the celestial pass (see
[beyond the atmosphere](#beyond-the-atmosphere)), with contrast and rotation applied as authored.
its tint goes in raw, as the game passes it; decoding it from sRGB made some skies near-black.

## sun disc

the disc is drawn in
[`shaders/celestial.wgsl`](../../packages/viewer/src/render/shaders/celestial.wgsl), following the
[game's lobe](../game-data/sky-and-fog.md#sun-disc).

## beyond the atmosphere

where the game shades these layers inside its one sky-dome draw, the viewer renders them per sky
pixel in a pass of its own
([`shaders/celestial.wgsl`](../../packages/viewer/src/render/shaders/celestial.wgsl), packed by
[`render/celestial.ts`](../../packages/viewer/src/render/celestial.ts)), and the composite puts them
over the atmosphere's sky before fogging it: `sky · (1 − cover) + layers`. the cloud panorama is
drawn in the same pass so it can sit between the layers in the
[game's order](../game-data/sky-and-fog.md#beyond-the-atmosphere).

- **the ray-traced planet**: `render/celestial.ts` copies its parameters from the
  `HGRP/Planet/PlanetBillboard` material, linearising the colours. its light's brightness is taken
  as the viewer's pre-exposed sun, unchecked against a shot.
- **sky planets**: the body's frame hands its right vector to the shader as "forward" and its
  forward as "right", as the game does. the viewer always adds the planets on top; the game's blend
  modes, and the planets' ring thinning the stars, are unchecked against a shot.

## fog

the analytic fogs are applied in
[`shaders/sky.wgsl`](../../packages/viewer/src/render/shaders/sky.wgsl) by the composite (opaque
surfaces and sky) and water passes. the height fog's packed base-2 units are `FOG_UNIT` in
[`render/environment.ts`](../../packages/viewer/src/render/environment.ts).

the volumetric fog's froxels are computed each frame by a compute pass
([`render/volumetric-fog.ts`](../../packages/viewer/src/render/volumetric-fog.ts)). the game's grid
size, depth distribution and history weight aren't recovered, so the viewer takes Unreal's defaults:
slices spaced logarithmically in view depth, and 90 % history. its sky term takes the ambient probe
without the native diffuse-ambient scale.

- the height fog's start distance and inscatter colour belong to the far fog while the volumetric
  fog is on; drawing the height fog alone with them puts a hard, bright fog wall at the start
  distance inside caves.
- where the last frame's grid didn't cover a froxel, the viewer takes this frame's sample alone; the
  game averages several jittered samples there instead.
- without the history, a sun shadow edge turns each froxel (a dozen pixels across on a
  2000-pixel-wide view) fully lit or fully dark, and the temporal antialiasing can't average a
  pattern that coarse.

## flow noise

the viewer sways the fog in the composite, on opaque surfaces only (not the sky), where the game
does it in its deferred lighting after all the fog. the noise texture comes packed once in the
manifest's `heightFogFlowNoise`.

the "drifting fog" toggle turns it off. it drifts by the viewer's animation clock, so it pauses when
the view idles or "animate" is off ([performance](performance.md)).
