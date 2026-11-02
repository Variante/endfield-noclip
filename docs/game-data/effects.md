# scene effects

scenery effects are meshes placed like any other renderer, mostly in dynamic structures, with
`HGRP/Effect/*` materials. the magenta blight around Jingyu Valley's corrupted shrine (map02_lv001,
near unity −905, 228, −1505) is one: `VFXDecal` boxes stain the ground and `VFXBaseV2` cards rise
from it as red and blue smoke, all in script group `script:458752:41` with the shrine's damaged
pieces (on by default). particle systems whose meshes carry effects are in
[assets.md](assets.md#particle-systems).

## VFXBaseV2 and VFXDecal

both are unlit and premultiplied (one, one minus source alpha), and build their colour from a stack
of textures by role:

- **disturb**: the texture's red channel, remapped by `_Bi_Disturb`, shifts the UVs of the textures
  sampled after it by `_DisturbU/VIntensity1` (or `…2` for the second), each texture taking the
  share its `*UseDisturb` sets (mostly 0–1, often fractional). the rising mist puffs of
  `M_fxmap_dung02_rdg005_camille_range_smoke_01_1102` (Si's Painting, map02_lv010) shift their main
  texture by a tenth: shifted fully, their 2×2 sheet's neighbouring puffs reach the quads' edges
- **weight**: scales that shift (`_WeightTexIntensity · _DisturbUseWeight`) and the dissolve
  threshold
- **mask**: multiplies the main texture's colour and alpha
- **blend**: adds `blend · saturate((alpha + blend.a) · _BlendTint.a) · _BlendTint.rgb`
- **dissolve**: alpha survives where the texture's red exceeds a threshold that sweeps from −1.01 to
  1.01 with `_DissolveScheduleOffset`, sharpened by `_DissolveEdgeSharp`; a band
  `_DissolveEmissiveEdge` wide takes `_DissolveEmissiveColor`

each texture's UVs scroll by its `*UVSpeed` per second, rotate about the texture's centre, then take
an `_ST`; `*AsAlpha` turns a texture's red channel into its alpha. colour properties marked HDR are
used as stored, the others are converted to linear. colours ignore the post exposure when
`_IgnorePostExposure` is set, as emission does. the near camera fade (`_UseNearCameraFade`) fades a
layer in between `_NearCameraFadeDistanceStart` and `…End` metres of view depth, and out between
`…Start2` and `…End2`.

**VFXBaseV2** takes the main texture plus up to six `_SampleTexN`, each playing the role its
`_SampleTexNUseWeightK` property selects (0 disturb, 1 second disturb, 2 weight, 3 mask, 4 blend, 5
dissolve), with the `_ST` of that role's own texture property (`_DisturbTex1`, `_DisturbTex2`,
`_WeightTex`, `_MaskTex`, `_BlendTex`, `_DissolveTex`). each texture's UVs start from its
`*UVWeights` times UV0, UV1, polar and screen UVs (materials set one weight). polar UVs are computed
with `_USE_POLARUV` and `_UsePolarUV`: about UV0's centre, the angle from +v as a fraction of a turn
and twice the distance. screen UVs, with `_USE_SCREENUV` and `_UseScreenUV`, are the pixel's
position, centred and divided by half the width, v optionally the world height
(`_UsePosYAsScreenV`), times the object origin's view depth past the near plane
(`_ScreenUVUseDepth`, on by default); `_LocalPivortSpace` makes them relative to the object. a
source that isn't computed is zero, so a texture weighted to it only scrolls. the sixth sample
texture's UVs come from UV0 or UV1 alone and scroll by the first's `_SampleTex0UVSpeed`. a sample
texture its keyword switches on samples the property's default (white for every `_SampleTexN`) when
the material binds none: the white talosite's shards switch on a mask that way, so it masks nothing.
with `_USE_LIGHTING` the colour is an albedo lit by the irradiance volume, the shadowed sun and
local lights, at the vertex normal turned towards the camera or at the world's up
(`_RotateNormalToWorldUp`), and divided by the post exposure under `_IgnorePostExposure`. the mist
cards rising at the foot of falls are lit so. the colour starts from
`_TintColor · _TintColorIntensity` times the vertex colour, alpha from
`_TintColor.a · _TintColorAlpha`; it's brightened by `_ExpIntensity` above `_ExpThreshold`. a
material without a main texture samples the shader's default, white (the base ring of Origin
Lodespring's crater column is one). alpha fades by a Fresnel term
(`saturate(N·V + _FresnelBias)^_FresnelPower`, flipped by `_FresnelFlip`, applied by
`_FresnelAffectOpacity`) and, with `_USE_SOFTBLEND`, where the surface comes within `_SoftDistance`
metres of what lies behind it. the shader writes its alpha times `1 − _BlendMode`, so under
`_BlendMode` 1, the shader's default, the premultiplied colour adds to what lies behind instead of
covering it; about a quarter of the scenery's VFXBaseV2 materials are such, among them the glare at
the corroded planet's centre seen from Dijiang's deck. `_BlendMode` 2 writes
`lerp(1, colour, alpha)` for a `Blend DstColor Zero` state, which multiplies what lies behind by it.

`_USE_VERTOFFSET` moves each vertex along `_OffsetDir` (`_OffsetSwitchDir` 0: object space, 1: world
space, 2: the vertex normal) by `_OffsetIntensity · (r · (1 + _Bi_Offset) − _Bi_Offset)`, where r is
`_OffsetTex`'s red channel at UV set 0 (set 1 with `_OffsetUVSet`), after its `_ST`, scrolled by
`_OffsetSpeed` per second. `_UseVertexColorAlphaAsVertOffsetWeight` weights it by the vertex alpha,
and every vertex is also pulled towards the camera by up to `_VertCameraOffset` metres (plus 1 mm).
the whole offset is scaled by `1 − _InParticle`, so a mesh material left at the default
`_InParticle` of 1 doesn't move. `_USE_BRIGHT` with `_BrightType` 0 and no `_BrightCenter` (w 0)
adds `_BrightColor` and a UV wobble within `_OuterRadius` of the player. the teal streams winding
between Wuling City's floating pillars (`M_fx_map02_zhenlie_*`, map02_lv002) use both.

`_USE_WATER_BLEND` fades the colour as if seen through water below `_WaterHeight`: it absorbs by
`_WaterAbsorption`/`_WaterAbsorption2` and adds inscattered light over the distance the view ray
travels under that height, and changes nothing above it. the vertex stage is unaffected. a
`VFXWaterBlendConfig` component on the effect sets these from water surfaces it enters (from its
fields and method names; its code isn't read). materials keep the authored `_WaterHeight` of −9999,
under every level, so placed effects out of water draw as without the keyword. the collectible
coins' glows (`int_collection_coin_*_postmodel`, e.g. in Aburrey Quarry near unity 364, 44, −700)
are such.

**VFXDecal** draws a unit box (`s_fx_particle_decal_cube`): each covered pixel finds the surface
behind from the scene depth and, if that point lies inside the box, projects the textures down the
box's y (UV = local xz + 0.5). its roles are fixed: `_MainTex`, `_MaskTex`, `_BlendTex`,
`_DisturbTex1/2`, `_WeightTex`, `_DissolveTex`, each only with its `_USE_*` keyword. a texture's
`*SwitchUV` swaps the box UVs for screen UVs (1: the pixel's position over the width) or polar UVs
(2: about the box's axis, as VFXBaseV2's), each computed only with its keyword and `_UseScreenUV` /
`_UsePolarUV`. the weight texture neither scrolls nor turns, and scales the distortion and the
dissolve by `1 − _WeightTexIntensity + red · _WeightTexIntensity` (`_DisturbUseWeight`,
`_DissolveUseWeight`). the rift in Power Plateau's grating (map01_lv007, near unity −129, 173, 593)
is two such decals around VFXBaseV2 rings and swirls on polar UVs. the colour is `_DecalBaseColor`,
alpha its alpha times `_TintColorAlpha`, faded towards the box's x and z faces (`_EdgeFadeX/Z`, over
`_EdgeFadeIntensity`), its top and bottom (`_HeightFade` around `_HeightFadeOffset`), and with
`_USE_NORMALBLEND` on surfaces facing away from the box's y (`N·up` to the power
`_AngleBlendFallOff`, N the surface's normal). the colour is premultiplied by the alpha twice.

## portals

VFXBaseV2 takes its stencil test and write (`_StencilComp`, `_StencilOp`, `_StencilRef`,
`_StencilReadMask`, `_StencilWriteMask`) and its depth test (`_ZTest`) from material properties, and
`_UseVFXPortal` materials use them to show one effect only through another. the glowing cracks in
the Hub's plaza (map01_lv001, near unity −365, 95, −439) are one: an opaque mask on the crack mesh
writes 7 (queue 2000), and the crack's glow and a cylinder of red chasm walls draw only where the
stencil equals 7, without a depth test, so the chasm shows below the ground through the crack. drawn
whole, the cylinder stands on the ground as a solid red ring. the opaque mask is also shaded and
writes its depth, but its effects cover it wherever it shows. other pairs write the stencil from a
transparent layer and draw a second layer only where it didn't (`NotEqual`).

## solid effects

`HGRP/Effect/VFXDitherAlpha` writes the G-buffer like an opaque surface, for effect meshes that are
solid, such as the rocks floating over Origin Lodespring's crater (mesh particles,
[assets](assets.md#particle-systems)). the colour is `_TintColor · _TintColorIntensity` times
`_MainTex` (the tint alone with `_UseMainTexAsAlpha`), times `_MainTex2Color` when `_USE_MAIN2`
takes only the alpha of `_MainTex2` (`_UseMainTex2AsAlpha`) and multiplies (`_MainTex2BlendMode` 0).
with `_UseLighting` it is the albedo, saturated as the G-buffer stores it, else emitted.
`_NORMAL_MAP` adds a tangent-space normal map (`_NormalScale`; x from alpha times red, as Unity
unpacks it); roughness and metallic are `_Roughness` and `_Metallic`. the shader has no shadow
caster pass. the rocks' material multiplies a gold mask by a tint twelve times over, so the
saturated albedo is black rock with gold veins.

its depth pass keeps a pixel where the alpha beats an interleaved gradient noise of the pixel
position times `_DitherTilling`, so a fraction of the pixels equal to the alpha survives. the alpha
is `_TintColor.a · _TintColorAlpha` times `_MainTex`'s alpha (its red with `_UseMainTexAsAlpha`),
saturated and raised to `_DitherAlphaExp`. this shapes the dark disc at the centre of Power
Plateau's sky vortex (`blackspot`), a quad whose texture's alpha is a soft round mask.

`_USE_DISTURB`, `_USE_DISSOLVE`, `_USE_POLARUV` and `_USE_SCREENUV` bring in VFXBaseV2's texture
stack: `_DisturbTex1` shifts the main and dissolve UVs (`_MainTexUseDisturb`,
`_DissolveTexUseDisturb`, both 1 by default), each texture's UVs start from its `*UVWeights` of UV0,
UV1, polar and screen UVs, and the dissolve multiplies the tested alpha and colours its edge as
VFXBaseV2's does. the vertex alpha and the near camera fade also scale the tested alpha. the walls
of the rift's ripples are such (below).

`_USE_MASK` exists only in the depth pass: `_MaskTex` multiplies the tested alpha by its alpha, or
its red under the default `_UseMaskTexAsAlpha`, and doesn't colour the surface. its UVs scroll,
rotate and take the distortion (`_MaskTexUseDisturb`) like the main texture's. the faint blue band
around the Very Large Rift's portal (`glow_04_line` in `p_fxmap_dung02_dg005_boss_semicircle_01`) is
a mask-only material.

`_USE_VERTOFFSET` moves the vertices as VFXBaseV2's does, in both passes, without the vertex alpha's
weight and the pull towards the camera. the rift's escaping trails
(`p_fxmap_dung02_dg005_boss_semicircle_escapism_trail_02`, children `blue02` and `red02`, placed
around the arena) are such: tall sheets pushed half a metre in along their normals by a scrolling
noise, dissolved and distorted into streaks.

## reflection-only effects

`HGRP/Effect/VFXReflectionPass` is never shaded into the image. its passes are `ForwardReflection`
and two ray-traced reflection passes. the deferred path collects `ForwardReflection` materials into
a draw list of their own, and only the
[screen-space reflection](lighting.md#screen-space-reflections) pass draws it, into the normal,
roughness and depth it marches from, as water does. the pass writes the mesh's normal with a
roughness of 1 wherever its alpha (VFXBaseV2's tint, vertex colour, `_MainTex` and near camera fade)
reaches `_ReflectionPassAlphaCutout`, so behind a transparent effect the reflections are traced from
the effect's surface instead of the opaque one. the Very Large Rift portal's `quan_ad_01` ring
(VFXBaseV2) has such a twin, `quan_ad_01_pass`. what this changes on screen behind the ring isn't
checked against the game.

## refraction

`HGRP/Effect/VFXRefract` draws in a pass of its own after the transparent effects, from a copy of
the scene drawn so far. each pixel shows that copy at its own screen position plus an offset:
`_RefractDir · r · _Intensity · _TintColorAlpha · vertex alpha`, in screen UVs, where r is
`_RefractTex`'s red remapped by `_Bi_Refract` (with `_RefractIsNormal`, the texture's xy as a normal
instead). `_MaskTex` (`_USE_MASK`) multiplies it, and its alpha, or its red under the default
`_UseMaskTexAsAlpha`, blends it over the scene (`Blend SrcAlpha OneMinusSrcAlpha`), faded by the
near camera fade. the vertex alpha scales only the offset, so a mesh whose particle fades out stops
distorting but still covers. both textures scroll by their `*UVSpeed`, rotate by `*UVRotate` degrees
and take UV0, or polar UVs with `_USE_POLARUV` and their `*SwitchUV` set.

`_USE_RBOFFSET` splits colours: the copy is sampled again at a further offset,
`_RBOffset.xy · 0.01 · _Intensity · vertex alpha` (times r, or the normal offset's length, under
`_UseMainTexAsMask`), and each channel keeps the brightest of the refracted sample times
`_RBMainColorMask` and the further one times `_RBOffsetColorMask`. `_USE_RGBOFFSET` does nothing
alone; with `_USE_RBOFFSET` it adds a third sample at `_GOffset` times the further offset, and the
two further samples take `_RBOffset1ColorMask` and `_RBOffset2ColorMask` instead. `_RBIntensity`
blends from the refracted sample to the split. `_USE_SOFTBLEND` fades the alpha over `_SoftDistance`
metres of view depth in front of the opaque scene.

Deep Dale Street (dung02_rdg008) uses a split for the heat haze of its fog walls
(`p_fxmap_map02_lv008_fogwall_01`, child `refract`): particle sheets whose red and blue are pushed
apart vertically.

### the Very Large Rift's ripples

in Wuling Very Large Rift (dung02_dg005), waves ripple out from the rift at unity 297, 100, 2: two
prefabs, `p_fxmap_dung02_dg005_boss_semicircle_ripple_01` and `…_ripple_01_ground`, in script groups
37000020004 and 37000020005. both load by default; a 3 m area at the arena's entrance (unity 23.6,
100, 18.7) and the server hide them, so they are the arena's look before the fight. each child is a
one-particle system that emits a mesh every 6 s and grows it over its life, so the rings spread:

- `wenli_02`: a 142 m cylinder of VFXDitherAlpha (dissolve, distortion and polar UVs), the rings'
  patterned walls
- `line_z`, `wai_noise1`: VFXBaseV2 cylinders
- `niuqu02`, and in the ground prefab two 300 m cylinders: VFXRefract, the distortion that travels
  with the rings
- `quan_ad_01`, `quan_ad_02`: half-second flashes at the centre, a VFXDitherAlpha disc and a
  `_BlendMode` 2 VFXBaseV2 quad that multiplies what lies behind

## waterfalls

a falls is a stack of prefab placements: the river surface running down the cliff behind it, one or
two VFXWater sheets (a flipbook sheet and a frothier outer one), WaterDecal foam boxes at its foot,
particle mist and splashes, and FogSimple cards around it. the sheets of falling water are
`HGRP/Effect/VFXWater` meshes (about 1800 placements on map02, in `P_fxmap_*waterfall*` prefabs).
per pixel:

- **colour and opacity.** `_TintColor · _TintColorIntensity` (alpha `· _TintColorAlpha`) times the
  vertex colour (unless `_DisableVertColor`), `_MainTex` and `_MaskTex` (`_USE_MASK`), each taking
  only its red as alpha under `_UseMainTexAsAlpha` / `_UseMaskTexAsAlpha`. UVs scroll, rotate about
  0.5 and take their `_ST` as in VFXBaseV2. `_WaterRandomUV` stretches and offsets the main UVs by
  the fractional sum of the object's position.
- **distortion.** `_USE_DISTURB`: `_DisturbTex1`'s red, remapped by `_Bi_Disturb`, times
  `_DisturbU/VIntensity1` (or its normal's xy with `_DisturbTex1Normal`), shifts the main, mask,
  normal map and dissolve UVs by their `_…UseDisturb` fractions. `_USE_DISSOLVE` eats the alpha
  below `_DissolveScheduleOffset`'s threshold, with a glowing edge.
- **flipbook.** `_USE_SEQUENCE_FRAME`: `_SequenceBaseColorMap` holds `_SequenceFrameSize` frames
  (columns by rows, from the top) played at `_PlaybackSpeed` per second, offset per object by
  `_RandomStartByPos`; two frames blend, each pushed along `_SequenceMotionVectorMap` towards the
  other by `_MotionVectorDistortionStrength`. the frame adds `rgb · _SequenceBaseColorMapTint · a`
  and the opacity becomes `saturate(alpha · a · s − _SequenceOpacitySdf) · s`
  (`s = _SequenceOpacityScale`).
- **fades.** the near camera fade, `_USE_SOFTBLEND` against what lies behind, the vertex alpha
  (`_UseVertexColorAsOpacity`) and `|N·V|^_FresnelStrength` (`_UseFresnelAsOpacity`).
- **lighting.** the `_UseLighting` share of the colour is an albedo. it takes the irradiance volume
  at the normal (the flipbook's `_SequenceNormalMap` or `_NORMAL_MAP`, scaled by `_FrameNormalScale`
  / `_NormalScale`), plus a subsurface colour
  (`HSV(_SubsurfaceHue, _SubsurfaceSaturation, _SubsurfaceValue · thickness · albedo red)`) times
  `_SubsurfaceIndirect`, desaturated by `_IndirectSaturation`. the sun adds diffuse, a GGX highlight
  (`_Roughness`, f0 `0.08 · _Specular`, `· _DirSpecularStrength`, divided by the opacity so it
  survives premultiplication) and the subsurface colour through a wrap lobe plus a see-through lobe
  towards the sun, the light that makes falls glow against a low sun.
- `_BlendMode` 1 adds the sheet to what lies behind, as VFXBaseV2's does.

under `_IgnorePostExposure` the colour, lit share included, is divided by the post exposure.

## mist

the drifting mist banks are effects too: `HGRP/FogSimple` cards (841 on map02, `SimpleFogCard*`) and
`HGRP/Effect/VFXFakeVolumeFog` boxes (69, `SimpleFakeVolumeFog*`):

- **cards.** alpha is `_MainTex`'s red times `(1 − _FogNoiseIntensity) + noise · _FogNoiseIntensity`
  (`_NoiseTex` red) times `_BaseColor.a`. with `_UseWind`, a second `_NoiseTex` sample at the UV ×
  `_WindScale` (× `_WindScaleX/Y` with `_UseSeparateScale`), scrolling by
  `(−_WindDirX, _WindDirY) · _WindSpeed` per second, remapped by `_WindNoiseContrast` and mixed in
  by `_WindNoiseIntensity`, scales both colour and alpha. the colour is `_BaseColor` (`[HDR]`, like
  `_IndirectColor`, so used as stored); with `_USE_LIGHTING` it's `_BaseColor` times the sun's light
  colour, mixed towards `_IndirectColor` away from the sun by `_LightFactor`. alpha then fades in
  over `_DistanceFadeStart…End` and out over `_NearCameraFadeDistanceStart…End` metres of view
  depth, upwards (`saturate(h · _TopFadeContract + _TopFadeOffset)`, where `h` is the world height
  below the card's origin divided by the length of its y axis, so a card placed upside down, like
  the 77 m one at Suiming's cave exit, still fades towards the sky rather than the ground), with
  `_USE_SOFTBLEND` within `_SoftDistance` metres of what lies behind, and is scaled by
  `_BaseAlphaIntensity`.
- **light through openings.** some cards fake daylight falling into a cave rather than mist. at
  Suiming's cave exit (near unity −145, 149, −188) a 77 m card, flipped so its mask
  (`T_fog_smoothradial_grad_01_M`, a half-radial glow brightest along v = 0) lights its top edge,
  glows at `_BaseColor` ≈ (16, 20, 30). from the ledge below it reads as a soft shaft through the
  gap; from above the cave's rocks its straight, nearly opaque top edge shows as a white wall.
- **boxes.** from the nearer of the surface behind and the box's far side, the fog's thickness is
  the distance along the view ray through the unit cube towards the camera (stopping at the camera
  inside it), and alpha is
  `_FogColor.a · _TintColorAlpha · (1 − 2^(−thickness · _FogExponent)) · _FogDensity`, faded within
  `_CubEdgeFade` of the box's axis line, above `_HeightOffset` by `_HeightFalloff`, between
  `_VerticalFalloffMin/Max`, close to boxes the camera can't walk into (`_NearFadeDistance`), out to
  `_FogIntensityFadeDistance` from the point (or the box's centre), and with `_FogDepthStart` in
  from the camera up to that distance, starting at the `_FogDepthEnd` fraction of it. the colour is
  `_FogColor`.
- **box noise.** with `_USE_NOISE3D`, `_NoiseTex3D`'s alpha `n` (a 64³ texture), sampled with repeat
  at the world position (or the box's own with `_NoiseTexUseWorldUVW` off) × `_NoiseTexTilling1`,
  scrolling by `_NoiseUVWDir1 · _NoiseUVWSpeed1` per second, scales alpha by
  `saturate(1 − n + i · n)`. the intensity `i` moves from `_NoiseIntensity` at the camera to
  `_NoiseFarIntensity` by `10 · _NoiseFar` metres. most map02 boxes set 0 near and about −0.3 far,
  so the noise only thins them, and more with distance: dense boxes read as broken drifting banks
  rather than a solid wall.

most cards and every box blend additively; the other cards are premultiplied. the cards' own fog
(`_USE_FOG`) is faded by `_FogIntensity` and `_FogIntensityFadeOutDistance`, and the boxes also
carry a depth prepass. at Sword Vault Dale (map02_lv006) the cards make the haze over the valley's
middle distance.

## blending

the game draws effects after its fog and its water, so mist in front of water covers it, and only
effects with `_USE_FOG` are fogged, at their own distance; the rest stay clear of the fog, as Origin
Lodespring's red light stripes along the crystal ridge (`M_fx_prop_connectline_*`) do.
