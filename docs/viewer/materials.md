# materials

how the viewer draws the surface shaders [game-data/materials.md](../game-data/materials.md)
describes. each material's packed state becomes a look in
[`render/materials.ts`](../../packages/viewer/src/render/materials.ts), shaded in
[`shaders/mesh.wgsl`](../../packages/viewer/src/render/shaders/mesh.wgsl); what's left out is in
[status](../status.md).

## emission

[emission](../game-data/materials.md#emission)'s post exposure is the auto exposure times the
viewer's exposure option, so `_IgnorePostExposure` emitters divide out both.

`_EMISSIVE_ANIM`'s pulse runs on the animation clock, so like the parallax pulse it moves only while
frames render. it keeps its inputs in the parallax rows, which a look without parallax or layer maps
leaves free; an `_EMISSIVE_ANIM` look with parallax or layer maps doesn't pulse.

## lit layers

- **`_PARALLAX_MAP`**: the [pulse](../game-data/materials.md#lit-layers) moves only while frames
  render ([performance](performance.md); the `continuous` option keeps it moving), and the
  brightening near the player puts the player at the camera.
- **`_LAYERBLEND_TOP`** and **`_LAYERBLEND_MASK`**: a layer on UV set 2 samples UV set 0, and set 0
  is bound in place of a missing set 1, as the game reads a missing set.

## foliage

the viewer evaluates the game's [foliage model](../game-data/materials.md#foliage) per pixel
(`foliage_sun` in [`frame.wgsl`](../../packages/viewer/src/render/shaders/frame.wgsl)).
`HGRP/Foliage/Leaf`'s inputs come from
[`leafParams`](../../packages/viewer/src/render/materials.ts), and the grass shaders' from
[`grassParams`](../../packages/viewer/src/render/materials.ts), which take `h` as the vertex's
object-space height.

## glass

[glass](../game-data/materials.md#glass) is shaded like Lit, with the opacity taken from the alpha
`_AlphaMaskChannel` picks, times `_BaseColor.a`; with the map still streaming, the tint's alpha
alone. glass casts no shadows.

the transparent pass draws it after the main pass, tested against its depth, with weighted blended
order-independent transparency (McGuire and Bavoil 2013): one target sums each layer's premultiplied
radiance and alpha, both times a weight that falls off gently with distance so nearer panes show
more, and another multiplies `1 − alpha` into the revealage. the composite lays the layers' mean
colour over the opaque scene by `1 − revealage` before the atmosphere and height fog, which treat
the glass as if it lay at the opaque surface behind it, and doesn't fog glass in front of the sky. a
single layer resolves exactly; overlapping panes blend without sorting.

## decals

the viewer has no GBuffer, so it draws a [decal](../game-data/materials.md#decals) like the VFXDecal
boxes ([effects](effects.md#vfxbasev2-and-vfxdecal)): the box's back faces without a depth test, in
the transparent pass ([`decalLitLook`](../../packages/viewer/src/render/effect-looks.ts),
`fx_lit_decal` in [`effect.wgsl`](../../packages/viewer/src/render/shaders/effect.wgsl)). it takes
the surface's normal and roughness from the main pass where the masks keep them, shades the decal
like any surface, and lays it over by its alpha. each placement draws its own copy of the material,
carrying the placement's colour and UV transform, on the game's VFXDecal cube.

the game keeps lit decals off surfaces by a stencil bit. the viewer carries it in the main pass's
packed surface instead (bit 31, `SURFACE_NO_LIT_DECALS` in frame.wgsl), so it works without a
stencil buffer: looks whose shader writes `_StencilRef` and whose value has bit 32 set it
(`keepsLitDecalsOff` in [materials.ts](../../packages/viewer/src/render/materials.ts)), and
laid-over and relit decals skip those pixels. VFXDecal boxes ignore it.

decals that write no albedo can't be laid over the surface, because the main pass has already lit
it. a pass between the main and the transparent pass (`fs_decal_relight`) adds the change in the
surface's light instead: it lights the surface twice, with its own normal, roughness and occlusion
and with the decal's, and adds the difference times the decal's alpha to the radiance. the surface's
colour comes from the main pass's diffuse ambient divided by the ambient light at its normal, taken
as a dielectric's; its emission and everything else stay as drawn.

an emissive decal's glow is part of the decal's own shading when it's laid over; a relit one adds
it, times its alpha, on top of the surface's emission rather than replacing it. lit decals in
variants the viewer lacks are [unsupported](#unsupported-materials): drawn by the opaque path, their
box would show as a solid block.

## matte paintings

[matte paintings](../game-data/materials.md#matte-paintings) are drawn by
[`mattePaintingLook`](../../packages/viewer/src/render/materials.ts). the alpha scale is folded into
the threshold so the shared alpha-test depth pass still applies, fog comes from the composite like
everything else, and they're held back until their texture is resident.

## erosion

[erosion rock](../game-data/materials.md#erosion) is drawn by
[`erosionLook`](../../packages/viewer/src/render/materials.ts) and `erosion_surface` in
`shaders/mesh.wgsl`.

## unsupported materials

a material the viewer can't draw can show as an unlit checker of magenta and black, in half-metre
cells of world space, to mark where something is missing. two settings show it, both off by default
since the checker covers what lies behind: "unsupported materials" for meshes in materials the
viewer lacks, and "missing content" for the package's [stand-ins](../package-format.md#stand-ins)
for content it doesn't draw at all. off, those draws are skipped during
[mesh selection](../../packages/viewer/src/streaming/mesh-selection.ts) (`unsupportedLook` in
[`render/materials.ts`](../../packages/viewer/src/render/materials.ts)). it shows both faces, casts
no shadow and keeps its colour at any exposure. this covers effect shaders without a look of their
own ([effects](effects.md)), effect materials using keywords, blend modes, stencil operations or
texture combinations their look doesn't handle, lit decals in variants the viewer lacks or without a
placement or base colour map, additive materials outside the effects, since the opaque path can't
blend, shaders without a family (`HGRP/CharacterNPR`, `Hidden/HGRP/LitEffectBlend`,
`HGRP/Effect/VFXSmoke_SixWay` and the like, which `pack` lists per shader), and materials that
didn't convert. stand-ins (`DrawRole.Unsupported`) take the same look whatever their material.

the pack's `debug/assets.json` lists per material whether its shader has no look (`unsupported`),
the surface keywords the viewer doesn't draw (`keywordsNotDrawn`, from
[game/material-support.ts](../../packages/extractor/src/game/material-support.ts), which mirrors
what `render/materials.ts` reads) and the texture slots whose reference couldn't be followed
(`slotErrors`). effect materials rejected for a keyword or texture combination aren't listed there;
they show only as the checker.

only materials the game draws nothing visible with aren't drawn: `HGRP/WaterProxy`, whose passes all
feed the water pipeline ([water](../game-data/water.md#waterproxy-and-waterdecal)), and lit decals
that write nothing the viewer draws.
