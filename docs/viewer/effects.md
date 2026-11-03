# scene effects

how the viewer draws the effects [game-data/effects.md](../game-data/effects.md) describes:
VFXBaseV2, VFXDecal, the [solid effects](#solid-effects), the [waterfalls](#waterfalls), the
[mist](#mist) and the [light beams](#light-beams)
([`effect-looks.ts`](../../packages/viewer/src/render/effect-looks.ts),
[`shaders/effect.wgsl`](../../packages/viewer/src/render/shaders/effect.wgsl)). the extractor reads
each effect material's properties and keywords into a [surface](../package-format.md#materials)
([game/material-effects.ts](../../packages/extractor/src/game/material-effects.ts)), or marks it
unsupported with the reason; the viewer packs the surface into the look's rows. effects on particle
meshes play through the [particles](particles.md#particles); what's left out is in
[status](../status.md).

## VFXBaseV2 and VFXDecal

- VFXBaseV2's sixth sample texture takes the vertex offset's slot, and the vertex stage samples the
  offset texture from the look's seventh slot.
- a sample texture switched on without one bound keeps its role over an unset slot, which binds
  white, when the shader's default is white; with another default it's left out.
- each slot's share of the distortion (`*UseDisturb`) rides in its slot bits above the low byte, in
  1/1024ths (`slotDisturb`), since the look's rows are full.
- [`_BlendMode` 1](../game-data/effects.md#vfxbasev2-and-vfxdecal) materials draw into the
  transparent pass's glow, unfogged, as additive mist does; drawn over, the glare at the corroded
  planet's centre (seen from Dijiang's deck) was a dark square.
- the [breathing](../game-data/effects.md#vfxbasev2-and-vfxdecal) runs on the viewer's clock, with
  the per-draw time scale and offset left at none (their values aren't traced), so every placement
  pulses in step. its values ride in the decal fade row, which only VFXDecal reads.
- [water blending](../game-data/effects.md#vfxbasev2-and-vfxdecal) is left out, which matches the
  game above the authored `_WaterHeight`. fragments below it show the unsupported checker
  (`waterBlendBelow`), since neither the blend nor the water a `VFXWaterBlendConfig` finds is
  followed; heights at or below −1000 are taken as under every level.
- [soft-body animations](../game-data/effects.md#vfxbasev2-and-vfxdecal) also take the vertex
  offset's slot for their position texture, its UV and scroll rows holding the UV1 scales and the
  playback's cycles per second and phase (a held frame is a still phase), and the offset rows the
  bounds, frame count and camera pull (`VertexMotion` in `effect-looks.ts`). the rotation texture
  isn't read: materials with lighting or a Fresnel term, which would read the turned normals, stay
  unsupported, as do those with a vertex offset, a sixth sample texture or particle-driven playback.
- VFXDecal boxes draw their back faces without a depth test, so they still show with the camera
  inside. each covered pixel reconstructs the main pass's surface from the depth buffer, and
  `_USE_NORMALBLEND` reads its normal from the main pass's packed surface normal.

## over the composited scene

effects whose blending the transparent pass's targets can't hold draw after compositing (and after
the water), into the composited scene with the main pass's depth attached read-only
(`MaterialLook.screen`, `encodeMultiply` and `encodeRefract` in
[`mesh-renderer.ts`](../../packages/viewer/src/render/mesh-renderer.ts)):

- `_BlendMode` 2 VFXBaseV2 layers multiply the scene (`fs_effect_multiply`).
- [VFXRefract](../game-data/effects.md#refraction) layers then sample a copy of the scene, taken
  after the multiplies into the main pass's radiance target, and blend over it (`fs_refract`). the
  copy holds the fog, the transparent layers and the water, which the game's copy may not. colour
  offsets take their further samples from the same copy, and the soft blend reads the main pass's
  depth. a dissolve samples slot 2 and scales the offset and alpha as the game's does.

unlit VFXDitherAlpha materials with a distortion, a dissolve, a mask or polar or screen UVs draw
through VFXBaseV2's texture stack (`describeDitherEffect`, `stackLook`), fogged, blended by the
alpha the game dithers with rather than dithered, which the temporal antialiasing would average to
the same coverage. that alpha is raised to `_DitherAlphaExp` as the game's is, which thins the Very
Large Rift's red sky ring (`wenli_01_red` in `p_fxmap_dung02_dg005_boss_semicircle_sky_02`,
exponent 3) to streaks. unlike the game's, they don't write depth, so they don't hide effects behind
them. the stack's mask scales the colour as well as the alpha, so a mask draws only as its red
(`_UseMaskTexAsAlpha`, the default), where its colour is white. their vertex offset fills the same
rows as VFXBaseV2's, leaving out VFXBaseV2's vertex-alpha weight and camera pull; `vs_effect` still
adds that pull's 1 mm. a vertex offset alone doesn't bring a material onto the stack, and those stay
unsupported.

[reflection-only effects](../game-data/effects.md#reflection-only-effects) aren't drawn, since the
game never shades them into the image. the viewer's screen-space reflections don't take their normal
and roughness either.

## portals

[portals](../game-data/effects.md#portals) draw with a stencil buffer
([`materials.ts`](../../packages/viewer/src/render/materials.ts), `LookStencil`). an opaque mask
writes only the stencil, at the end of the main pass, tested against the depth there, and isn't
shaded or written to depth. in the transparent pass, effects that write the stencil draw before the
rest, and each effect's stencil state and depth test pick a pipeline variant.

## solid effects

VFXDitherAlpha shades through the opaque mesh path
([`materials.ts`](../../packages/viewer/src/render/materials.ts), `ditheredLook`). its
[dither](../game-data/effects.md#solid-effects) is an alpha test in the cutout depth pass
(`fs_cutout_depth` in `shaders/mesh.wgsl`), for materials without `_USE_MAIN2` in the default
`_DitherAlphaMode`; with `_UseMainTexAsAlpha` only unlit ones, which test the texture through the
normal slot. drawn without the test, Power Plateau's `blackspot` was a dark square.

## waterfalls

VFXWater sheets are drawn by `fs_effect` (`water_sheet` in `shaders/effect.wgsl`; `waterSheetLook`
in [`effect-looks.ts`](../../packages/viewer/src/render/effect-looks.ts)). `_BlendMode` 1 sheets
draw into the glow. the [post-exposure division](../game-data/effects.md#waterfalls) applies to the
unlit share only, since on the lit share it darkens sheets in dark places, such as Jingyu's cave
falls, far below the game's. the normal map's frame comes from the UVs' screen derivatives rather
than mesh tangents.

## six-way smoke

[six-way smoke](../game-data/effects.md#six-way-smoke) draws through `fs_effect`, which hands it to
`six_way_smoke` in `shaders/effect.wgsl` (`sixWaySmokeLook` in
[`effect-looks.ts`](../../packages/viewer/src/render/effect-looks.ts)). the positive lightmap takes
slot 0 and the negative one slot 6, sampled at slot 0's UVs; the distortion, mask, blend and
dissolve take slots 1–5. the particle's frame is its normal turned towards the camera and its object
x axis made square to it. the sun takes the viewer's light colour over π, as Lit's diffuse does, and
the shadow is sampled per pixel without the game's ramp texture. the particles' custom data never
reaches the shader (as for every effect), so the dissolve schedule and custom UV scrolls stay at
their material values, and materials whose mask or dissolve read custom UVs stay unsupported.

## mist

the [mist](../game-data/effects.md#mist) cards and boxes draw by their own entry points in
`shaders/effect.wgsl` (`fs_mist_card`, `fs_mist_volume`). lit cards take the sun over π. boxes draw
their back faces without a depth test, like the decals, and take the thickness from the nearer of
the surface behind and the back face. a box's 3D noise is the look's `volumeTexture`, streamed whole
and bound beside the slots (a zeroed placeholder leaves boxes without it unchanged); the box waits
for it like an effect's other textures. additive cards and boxes draw into the transparent pass's
glow, which the composite adds unfogged after the fog ([frame](frame.md)); premultiplied cards join
the weighted blend. at Sword Vault Dale the cards make the haze that the fog alone left clear.

## light beams

[light beams](../game-data/lighting.md#light-beams) draw through `fs_effect`, which hands them to
`light_beam` (`lightBeamLook` in
[`effect-looks.ts`](../../packages/viewer/src/render/effect-looks.ts)). `vs_effect` shapes the cone
first (`beam_vertex`); the fragment stage takes the beam's own frame and the camera's from the
instance's inverse transform rather than extra varyings. additive beams draw into the glow,
unfogged; alpha-blended ones join the weighted blend, fogged by the composite under `VLB_USE_FOG`.
the 3D noise, the per-renderer scale and the global tint are left out, and the colour isn't scaled
by exposure, which the game's shader doesn't do either (unverified against an in-game shot).

## blending

effects join the transparent pass's weighted blend ([glass](materials.md#glass)). those the game
[fogs](../game-data/effects.md#blending) the composite fogs like glass, as if at the surface behind.
the rest add their weight to the glow target's alpha too, which nothing else writes, and the
composite keeps that share of the layers' mean colour out of the fog, laid over the fogged scene and
hiding as much of the fog's inscatter as it covers. effects cast no shadows and wait until all their
textures are resident.
