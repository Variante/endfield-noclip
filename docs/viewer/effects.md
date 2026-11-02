# scene effects

how the viewer draws the effects [game-data/effects.md](../game-data/effects.md) describes:
VFXBaseV2, VFXDecal, the [solid effects](#solid-effects), the [waterfalls](#waterfalls) and the
[mist](#mist) ([`effect-looks.ts`](../../packages/viewer/src/render/effect-looks.ts),
[`shaders/effect.wgsl`](../../packages/viewer/src/render/shaders/effect.wgsl)). effects on particle
meshes play through the [particles](particles.md#particles); what's left out is in
[status](../status.md).

## VFXBaseV2 and VFXDecal

- VFXBaseV2's sixth sample texture takes the vertex offset's slot, and the vertex stage samples the
  offset texture from the look's seventh slot.
- [`_BlendMode` 1](../game-data/effects.md#vfxbasev2-and-vfxdecal) materials draw into the
  transparent pass's glow, unfogged, as additive mist does; drawn over, the glare at the corroded
  planet's centre (seen from Dijiang's deck) was a dark square.
- VFXDecal boxes draw their back faces without a depth test, so they still show with the camera
  inside. each covered pixel reconstructs the main pass's surface from the depth buffer, and
  `_USE_NORMALBLEND` reads its normal from the main pass's packed surface normal.

## portals

[portals](../game-data/effects.md#portals) draw with a stencil buffer
([`materials.ts`](../../packages/viewer/src/render/materials.ts), `LookStencil`). an opaque mask
writes only the stencil, at the end of the main pass, tested against the depth there, and isn't
shaded or written to depth. in the transparent pass, effects that write the stencil draw before the
rest, and each effect's stencil state and depth test pick a pipeline variant.

## solid effects

VFXDitherAlpha shades through the opaque mesh path
([`materials.ts`](../../packages/viewer/src/render/materials.ts), `ditherAlphaLook`). its
[dither](../game-data/effects.md#solid-effects) is an alpha test in the cutout depth pass
(`fs_cutout_depth` in `shaders/mesh.wgsl`), for materials without `_USE_MAIN2` in the default
`_DitherAlphaMode`; with `_UseMainTexAsAlpha` only unlit ones, which test the texture through the
normal slot. drawn without the test, Power Plateau's `blackspot` was a dark square.

## waterfalls

VFXWater sheets are drawn by `fs_effect` (`water_sheet` in `shaders/effect.wgsl`; `vfxWaterLook` in
[`effect-looks.ts`](../../packages/viewer/src/render/effect-looks.ts)). `_BlendMode` 1 sheets draw
into the glow. the [post-exposure division](../game-data/effects.md#waterfalls) applies to the unlit
share only, since on the lit share it darkens sheets in dark places, such as Jingyu's cave falls,
far below the game's. the normal map's frame comes from the UVs' screen derivatives rather than mesh
tangents.

## mist

the [mist](../game-data/effects.md#mist) cards and boxes draw by their own entry points in
`shaders/effect.wgsl` (`fs_mist_card`, `fs_mist_volume`). lit cards take the sun over π. boxes draw
their back faces without a depth test, like the decals, and take the thickness from the nearer of
the surface behind and the back face. a box's 3D noise is the look's `volumeTexture`, streamed whole and bound beside
the slots (a zeroed placeholder leaves boxes without it unchanged); the box waits for it like an
effect's other textures. additive cards and boxes draw into the transparent pass's glow, which the
composite adds unfogged after the fog ([frame](frame.md)); premultiplied cards join the weighted
blend. at Sword Vault Dale the cards make the haze that the fog alone left clear.

## blending

effects join the transparent pass's weighted blend ([glass](materials.md#glass)). those the game
[fogs](../game-data/effects.md#blending) the composite fogs like glass, as if at the surface behind.
the rest add their weight to the glow target's alpha too, which nothing else writes, and the
composite keeps that share of the layers' mean colour out of the fog, laid over the fogged scene and
hiding as much of the fog's inscatter as it covers. effects cast no shadows and wait until all their
textures are resident.
