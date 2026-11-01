# post-processing

how the viewer draws the passes after the main pass that
[game-data/post-processing.md](../game-data/post-processing.md) describes. pass order, resolutions
and targets are in [frame.md](frame.md).

## post chain

[`render/post-process.ts`](../../packages/viewer/src/render/post-process.ts) runs, after the main
pass:

| pass                                                                                                                                               | inputs                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| GTAO, half resolution, depth-aware upsample ([`gtao.wgsl`](../../packages/viewer/src/render/shaders/gtao.wgsl))                                    | post `ambientOcclusion`: see [below](#ambient-occlusion)                                        |
| screen-space reflections into last frame's scene ([`ssr.wgsl`](../../packages/viewer/src/render/shaders/ssr.wgsl))                                 | post `screenSpaceReflection`: see [lighting](../game-data/lighting.md#screen-space-reflections) |
| celestial: nebula, stars and planets at the sky pixels                                                                                             | `celestial`, `star`: see [beyond the atmosphere](sky-and-fog.md#beyond-the-atmosphere)          |
| composite: reflections, AO on the ambient part, sky, transparent layers, fog, glow                                                                 | see [sky and fog](sky-and-fog.md)                                                               |
| water                                                                                                                                              | see [water.md](../game-data/water.md)                                                           |
| light shafts: thresholded far pixels near the sun, radial blur ([`light-shafts.wgsl`](../../packages/viewer/src/render/shaders/light-shafts.wgsl)) | `lightShaft`: see [below](#light-shafts)                                                        |
| lens flare: quads around the sun, faded by its occlusion ([`lens-flare.wgsl`](../../packages/viewer/src/render/shaders/lens-flare.wgsl))           | `lensFlare`: see [below](#lens-flare)                                                           |
| temporal antialiasing, upsampling to the output size ([`taa.wgsl`](../../packages/viewer/src/render/shaders/taa.wgsl))                             | see [frame.md](frame.md)                                                                        |
| auto exposure histogram ([`auto-exposure.wgsl`](../../packages/viewer/src/render/shaders/auto-exposure.wgsl))                                      | `autoExposure`: see [below](#auto-exposure)                                                     |
| bloom: thresholded mip chain, scattered upsample ([`bloom.wgsl`](../../packages/viewer/src/render/shaders/bloom.wgsl))                             | post `bloom`: see [below](#bloom)                                                               |
| tonemap ([`tonemap.wgsl`](../../packages/viewer/src/render/shaders/tonemap.wgsl)): exposure, bloom, vignette, grading, curve, sRGB encode          | post `vignette`; `colorGrading`; the auto exposure and the viewer's exposure compensation       |

the viewer's toggles for sky, height fog, atmosphere fog, AO, reflections, bloom and vignette, and
its debug views (albedo, normals, roughness, ambient only, raw cloud panorama), turn passes off
without touching the profile.

## ambient occlusion

the march follows the [game's GTAO](../game-data/post-processing.md#ambient-occlusion) at its high
tier, with the reach capped at 48 half-resolution pixels and the falloff radius shrunk to match. the
composite applies the result to the ambient part of the radiance.

the viewer derives normals from depth and filters with one depth-aware blur while upsampling, where
the game reads GBuffer normals and filters temporally and twice spatially.

## light shafts

[`render/light-shafts.ts`](../../packages/viewer/src/render/light-shafts.ts) follows the
[game's light shaft bloom](../game-data/post-processing.md#light-shafts). the occlusion term and the
cloud mask aren't drawn.

## lens flare

[`render/lens-flare-layout.ts`](../../packages/viewer/src/render/lens-flare-layout.ts) lays the
[game's flare](../game-data/post-processing.md#lens-flare) out on the CPU each frame, and
[`render/lens-flare.ts`](../../packages/viewer/src/render/lens-flare.ts) draws it. the per-light
curves (radial screen attenuation, distance) take SRP core's directional-light defaults, and Unity's
mapping of random bits onto `Random.Range` is assumed.

at Origin Lodespring's overview the viewer's flare is fainter than the game's: the crystal mountain
behind the sun occludes it in the viewer's depth buffer.

## auto exposure

[`render/exposure.ts`](../../packages/viewer/src/render/exposure.ts) and
[`render/auto-exposure.ts`](../../packages/viewer/src/render/auto-exposure.ts) follow the
[game's metering](../game-data/post-processing.md#auto-exposure). the viewer reads the histogram
back a frame or two late, as the game does, renders while the exposure moves, and jumps straight to
the first reading after loading or switching levels. the stats panel shows the adjustment; the "auto
exposure" toggle holds it at 0 EV. since the viewer meters the same image the game does, a uniform
EV offset against an in-game shot points at a difference in scene content rather than in metering.

## bloom

the viewer follows the [game's bloom](../game-data/post-processing.md#bloom) with the profile's
high-quality tier, in its pixel-shader variant.

## colour grading and tonemapping

the tonemap pass multiplies the scene by the exposure, adds bloom, then applies URP's vignette in
HDR before grading, in the order of the game's uber pass.

[`render/color-grading.ts`](../../packages/viewer/src/render/color-grading.ts) packs
`colorGradingConfig` as [described](../game-data/post-processing.md#colour-grading-and-tonemapping).
where the game bakes grading and curve into a LogC LUT, the viewer evaluates them per pixel. it also
offers Khronos PBR Neutral and a clamp, for separating lighting errors from grading.
