# materials

the game's HGRP surface shaders: Lit and its optional layers, alpha testing, emission, foliage,
glass, decals, matte paintings and erosion rock. a material's serialized state is in
[assets.md](assets.md#material-and-shader), the light the surfaces receive in
[lighting.md](lighting.md), and the `HGRP/Effect/*` shaders in [effects.md](effects.md).

## texture layouts

the Lit families (`HGRP/Lit`, `HGRP/LitTransparent`, `HGRP/LitEffect`) and `HGRP/Foliage/Trunk` come
in two texture layouts, picked by `_BaseTextureMapCount` (from the `_TWO_BASEMAP` keyword when the
float is absent: 2 with it, 0 without). LitEffect declares a subset of Lit's properties plus
dissolve and disturb effects; trunks declare no property Lit lacks:

- **MRO layout** (0): a separate `_MROMap` holds metallic in R, roughness in G and occlusion in B,
  and the normal map is stored `RAG` (x is R times A, as in DXT5nm).
- **two-basemap layout** (1 or 2, most materials): the normal map holds the normal in RG, roughness
  in B and occlusion in A. metallic is the base colour's alpha with 1, `_Metallic` with 2.

foliage normal maps hold roughness in B the same way. roughness read from a map is remapped between
`_RoughnessMin` and `_RoughnessMax`.

## base colour

the Lit, LitTransparent and foliage shaders start from the base colour map times the linearized
`_BaseColor`, times `_BaseColorBrighterScale`, clamped to 1, then blend toward `_BaseColor` by
`_BaseColorTintCover`. the tint matters: Dijiang's black floors and walls are a light grey map
tinted by about 0.3. `HGRP/LitHLOD` ignores the tint.

## alpha testing

alpha-tested HGRP Lit materials (`_ALPHATEST_ON`) test the alpha `_AlphaMaskChannel` picks against
`_AlphaClipThreshold`: 0 for the base colour's, 1 for the normal map's. map01 has 26 materials on
channel 1, all in the two-basemap layout, where the base alpha is metallic; testing that instead
cuts the Hub's white container walls down to their grime streaks.

## emission

HGRP Lit materials emit through one of their `_EMISSIVE_*` keywords. `_EmissiveColor` is an HDR
colour, which Unity's HDR picker authors in linear space (`base × 2^intensity`), so it's used as
stored, unlike the gamma-encoded LDR colours. the result is added to the lit colour without
pre-exposure: the Hub's white ceiling panels store about 24, enough to read near-white with their
grid still visible.

| keyword           | emission                                                                                |
| ----------------- | --------------------------------------------------------------------------------------- |
| `_EMISSIVE_MAP`   | the colour times `_EmissiveMap`'s R channel                                             |
| `_EMISSIVE_MASK`  | the colour times a channel of the material's own maps, picked by `_EmissiveMaskChannel` |
| `_EMISSIVE_NOMAP` | only ships with the sweep animation (`_EMISSIVE_ANIM_SWEEP`)                            |

`_EMISSIVE_ANIM` makes the emission pulse: each cycle it rises smoothly from
`_EmissiveMinBrightness` to full and falls back, over the share of the cycle `_EmissiveAnimInterval`
gives it. `_EmissiveAnimSpeed` sets the rate, `_EmissiveAnimRandom` offsets the phase and
`_EmissiveColor`'s alpha sets how deep the pulse goes. the cycle runs on Unity's `_Time.x`, assumed
to be seconds / 20 (unchecked against the game), so the white lamp cubes on Wuling's and Marker
Stone's towers (`M_module_tylight+1_001_03`, speed 40) pulse about every 3 s.
`_EnableEmissiveAnimFlicker` swaps the pulse for random on/off flicker; no map02 material sets it.

each draw also carries a runtime emission colour in its per-draw data, which replaces
`_EmissiveColor` by its alpha. the static scenery's files store it as zero, yet those tower cubes
glow green at Wuling and red at Marker Stone in the game, always, whatever the story state or time
of day, where each reads as a white cube with a coloured glow (likely a saturated colour too bright
for the tonemapper to keep its hue; unverified), so something sets it while the game runs. the
client's known setters work on GameObject renderers: interactives' emissive configs and VFX-driven
emission. none of them covers static scenery, and the client declares no level- or environment-wide
emission setting, so the source is unknown.

the mask channel is 0 for no emission, 1 for the base colour's alpha, 2 for the normal map's B
(two-basemap layout) or the base alpha (MRO layout), and 3 or more for the normal map's alpha
(two-basemap) or the MRO map's alpha; the channel is remapped by `saturate((m − 0.05) / 0.9)`. the
Hub's ceiling panels use mask channel 3. emission is multiplied by the albedo unless
`_AlbedoAffectEmissive` is 1. `_IgnorePostExposure` emitters (nearly all) divide out the post
exposure ([auto exposure](post-processing.md#auto-exposure)), so they keep their brightness however
the exposure adapts.

## lit layers

these optional Lit layers come from the game's shader for these keywords. each map samples UV set 0
or 1 as a float of its own says: `_BaseUVSet` for the base colour, `_BasePbrMapUVSet` for the normal
and MRO maps, `_DetailUVSet`, `_MaskUVSet` and `_EmissiveUVSet`. the slot's `m_UVSetIndex` stays 0
on hundreds of materials whose maps sample UV set 1, such as Power Plateau's concrete walls, whose
tri-channel mask spreads weathering streaks over UV set 1. the originium crystals' base colour and
detail map tile ×5 over UV set 1.

- **`_TRI_CHANNEL_MASK`** (~450 map01 materials, mostly rock): each channel of `_MaskMap` becomes a
  weight `saturate(s/2 + mix(−s, 1, m + offset)) · _MaskAlbedo*.a`, with contrast `s` from
  `_Mask*Scale` and the offset from `_Mask*Offset`. albedo, roughness and metallic then blend toward
  `_MaskAlbedo*` (an LDR colour, linearized), `_MaskRoghness*` and `_MaskMetallic*`, B first and R
  last. the originium crystals are grey rock tinted brown at strength 0.5 where R is set. the
  `_TRI_CHANNEL_MASK_SWITCH_TEXTURE*` variants take G and B from extra textures.
  `_UseMaskRUVSetAndTilingScale` samples the mask's R from `_MaskRUVSet` tiled by
  `_MaskRTilingScale`; no map01 material sets it.
- **`_DETAIL_MAP`**: a weight from `_DetailMaskMode` (1, the detail's alpha, the base colour's
  alpha, or the normal map's B or A) fades out with view depth between `_DetailFalloffStart` and
  `…End`. the detail normal (`× _DetailNormalIntensity`) is reoriented onto the base normal.
  `_DetailMode` 1 blends roughness toward the detail's B and multiplies occlusion by its alpha; mode
  0 overlays `_DetailOverlayColor` where the detail's B is dark, and blends roughness toward its
  alpha. both blends are scaled by `_DetailPBRIntensity`.
- **`_PARALLAX_MAP`** (the originium crystals' glow): the view ray, in the geometric tangent frame,
  steps `trunc(_ParallaxMarchNum)` times (at most 20) through `_ParallaxNoiseMap` (tiled by
  `_ParallaxNoiseMapTilling`) as a height field `_ParallaxStrength` deep, and the hit is refined
  between the last two steps. at the hit, `_ParallaxMap`'s G (tiled by `_ParallaxTilling`; both maps
  ignore their `_ST`) picks between `_ParallaxColorDark` and the HDR `_ParallaxColor`, both times
  `_ParallaxIntensity`. the result is emission: times the mask channel squared
  (`_ParallaxMaskChannel`, numbered like the emission mask minus one), times `N·V` to the power
  `floor(_ParallaxFresnelStrength)`, and times a pulse
  `cos(0.05 · _ParallaxAnimSpeed · t + _ParallaxAnimRandom · (x + y + z))` remapped to
  `[_ParallaxMinBrightness, 1]`, where `x + y + z` is the object's world position. with
  `_ParallaxCharPos` set, `_ParallaxBrightStrength` times a smoothstep from
  `_ParallaxBrightOuterRadius` down to `…InnerRadius` of the distance to the player is added to the
  pulse. on map01 seven crystal materials use it, mostly with strength 20 within 3–25 m; one stores
  a glow colour of only 0.75, so it glows almost only near the player. `_ParallaxIgnorePostExposure`
  divides out the post exposure as emission does.
- **`_LAYERBLEND_TOP`** (moss and sand on rock tops; ~220 map02 materials, 33 on map01): a second
  material covers the surface by `saturate((up − _TopBlendThreshold) / _TopBlendSmoothness)`, where
  `up` is the world Y of the vertex normal, blended toward the normal-mapped one by
  `_TopBlendWithBumpMap`. with `_LayerBlendHeight`, the base's height and `_Layer1BaseMap`'s alpha,
  each weighted by its coverage, compete within `_LayerBlendHeightTransition`. the layer's colour is
  desaturated by `_Layer1Saturation`, tinted by `_Layer1TintColor`, brightened by
  `_Layer1ColorBrighterScale`, and replaces the albedo (`_Layer1BaseColorBlendMode` 0) or adds to it
  (1, times `_Layer1BaseColorAdditiveIntensity`). roughness blends toward `_Layer1BumpMap`'s B,
  occlusion toward its A (by `_Layer1AOStrength`, or 1 with `_LayerAOType`), metallic toward
  `_Layer1Metallic` or the layer's alpha (`_LayerMetallicType`), and the layer's normal (×
  `_Layer1BumpScale`) is reoriented onto the base's by `_Layer1BaseNormalIntensity`. it applies
  after the detail map and the tri-channel mask. both maps sample one coordinate picked by
  `_LayerBlendUVType` (UV set 0, world XZ, or UV set 2), times `_Layer1Tilling` plus
  `_Layer1Offset`, ignoring their `_ST`. no mesh map02 draws with a UV-set-2 layer has that set, and
  the game reads a missing UV set as set 0 (an in-game shot of a Jingyu moss rock shows the moss
  tiling over UV set 0; see [open](#open)). two all-moss rock materials have no base colour map, so
  their base is white and the layer is all they show.
- **`_LAYERBLEND_MASK`** (~200 map02 materials): the same layer, covering by a mask instead of
  facing up: `_LayerBlendMaskMap`'s R, sampled untiled from UV set 0 (UV set 1 when
  `_LayerBlendMaskUVType` is 0, whatever the slot's own set), or with `_LayerBlendMaskType` 1 to 4
  the layer bump map's alpha, the base colour's alpha, the normal map's alpha, or 1.
- **`_LAYERBLEND_MOSS`** (with either layer; the rabbit-hole resource mounds): shades the layer as
  moss. with `f = 1 − N·V` of the blended normal and the raw coverage `c` (the mask, or the top
  coverage before the height blend), the edge term
  `e = saturate(1 − (c − _Layer1FuzzyEdgeShadowOffset)² / _Layer1FuzzyEdgeShadowRange)` darkens the
  layer's colour by `_Layer1FuzzyEdgeShadowIntensity`; the colour is then scaled by
  `mix(1 − _Layer1FuzzyCoreDarkness, 1, f^_Layer1FuzzyDarkPower)` and brightened towards the
  silhouette by `_Layer1FuzzyEdgeBrightness` times twice its luma, by `f^_Layer1FuzzyBrightPower`
  (both powers at least 0.1). the world normal tips down by `e · _Layer1FuzzyNormalStrength`.

## foliage

the game lights foliage with its own deferred model, fed by what each foliage shader writes into the
GBuffer: a sun shadow term, the diffuse N·L, a transmission amount and a subsurface amount. per unit
of the sun's illuminance, before the shadow map and cloud shadow:

- diffuse: albedo × the stored N·L / π, with no `(1 − F)`
- specular: the usual GGX, times `mix(sat(n·v + 0.2) · sat(sat(v·l) + 0.5), 1, sat(v·l + 1))`, which
  dims it only for views from behind the leaf
- transmission: the albedo divided by its largest channel, × the transmission × `sat(0.5 − n·l)` × a
  GGX lobe of α² = 0.36 about the direction to the sun (peaking for a viewer looking at the sun),
  over π
- wrap: albedo × `(sat(n·l + subsurface) − sat(n·l))` / π
- all four are multiplied by the sun shadow term

`HGRP/Foliage/Leaf` fills the inputs from its material and the mesh's vertex colours (R ambient
occlusion, A height in the canopy):

| input                                                        | effect                                                                                                                                                                                   |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_OcclusionShadow`                                           | sun shadow × `mix(1, R, _OcclusionShadow)`                                                                                                                                               |
| `_FakeDirectionalShadowStrength`, `…Pow`                     | sun shadow × `sat(1 − pow(n·d · 0.5 + 0.5, pow) · strength)` with `d` the sun's direction of travel: leaves facing away from the sun darken                                              |
| `_DiffuseUseVertexNormal`                                    | the diffuse N·L takes the mesh's vertex normal as stored (not turned towards the viewer) instead of the normal-mapped one                                                                |
| `_OcclusionStrength`                                         | material occlusion `mix(1, R, strength)`, on ambient only                                                                                                                                |
| `_Transmission`, `_TransmissionDistanceFade`                 | transmission × (1 − the normal map's alpha), faded out between 50 and 60 m from the object with the fade on                                                                              |
| `_SubsurfaceIntensity`                                       | the wrap amount                                                                                                                                                                          |
| `_AoAffect{Transmission,Subsurface}{Start,Range}`            | transmission and subsurface × a smoothstep of the material occlusion over the range                                                                                                      |
| `_CANOPY_COLOR_RAMP`: `_CanopyRamp{Color,Intensity,Range,…}` | albedo blends toward the colour (times the albedo, brightened, or covering it) by `smoothstep(range + transition, range, A)` × (1 − normal alpha) × intensity; `…StartAtTop` reads 1 − A |
| `_Reflectance`                                               | F0 `0.08 · (0.5 + 0.75 · r)`, `r` quantized to 3 bits                                                                                                                                    |

on the cherry trees of Marker Stone's pits, whose phases ship an 80–100 klx sun, this is what keeps
the blossoms from blowing out.

`HGRP/Foliage/Grass` and its card LOD `HGRP/Foliage/Grass Cardmesh Lod` fill the same inputs. `h` is
the vertex's height, measured from a point tens of metres below the root, which over a blade comes
to the same as its object-space height:

| input                                                       | effect                                                                                                                                                                          |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_BendNormalUpward` (grass only)                            | the normal map's XY blends toward tangent-space +Y, up the blade, before `_NormalScale` scales it; the shading normal and N·L both take the bent normal, so blades shade evenly |
| `_TwoSidedNormal` (grass only)                              | back faces flip only the surface normal, so the bent normal still points up the blade                                                                                           |
| `_AoParams` (x, y, z)                                       | material occlusion `mix(z, 1, sat((h − x) · y))`: darker at the root                                                                                                            |
| `_DirParams` (x, y, z)                                      | a sun mask `d = mix(z, 1, sat((h − x) · y))`                                                                                                                                    |
| `_MaskOnDiffuse`, `_MaskOnTransmission` (grass only)        | the diffuse and transmission masks are `d · mix(1, a, …)` with `a` the normal map's alpha; the sun shadow is their maximum and transmission × (1 − their difference)            |
| `_Transmission`                                             | transmission × 0.5                                                                                                                                                              |
| `_SubsurfaceIntensity`                                      | the wrap amount                                                                                                                                                                 |
| `_USE_CAMERA_BASED_TILLING`: `_CameraBasedTillingIntensity` | each vertex moves `h` × intensity metres along the camera's up vector flattened onto the ground: blades lean away from the camera and cover more ground seen from above         |

both write a reflectance of 4/7. the card LOD decodes its normal map differently and masks by its B.
the grass grids also carry a per-instance colour ([world](world.md#foliage-grids)): the second
parameter vector's RGB, covering the albedo by its A.

## glass

`HGRP/LitTransparent` is the glass shader (16 materials on map01: windows and glass walls such as
the Originium Science Park offices). its materials alpha-blend (`_EnableAlphaBlend`, source alpha
over one minus source alpha, queue 3000, no depth write) and use Lit's texture layouts. Fresnel
opacity (`_UseFresnel`) is off on every map01 material.

## decals

`HGRP/DecalLit` is the scenery's projected decal: moss, sand, stains, cracks and tyre tracks laid
over floors and rocks (the green floor of Power Plateau's grass cave, map01_lv007 near unity −102,
147, 524, is nine moss decals over grey concrete). each is a rect decal entity
([world](world.md#initchunkdata-layout)): a box whose matrix maps a unit cube, the decal's material,
and per placement a UV scale and offset, an RGBA8 colour and an intensity. the game draws the box
into its GBuffer after the opaque scenery, overlapping decals in their `_DrawOrder`. each covered
pixel finds the surface from depth, and only points inside the box take the decal, which projects
down the box's y. the decal pass tests the stencil (reference 0, read mask 32, equal), which the
scenery's GBuffer pass fills with each material's `_StencilRef` (`HGRP/Lit`, the foliage shaders and
their card LODs; `HGRP/LitHLOD` writes 0 whatever its material says), so surfaces whose
`_StencilRef` has bit 32 never take a decal. most foliage has it (map02's grass and leaves 33,
trunks 32), so the blight's erosion decals (`M_rdecal_com_effect_erosion…`, whose base map is an
iridescent oil-slick pattern) colour the ground and rocks of Sword Vault Dale but not the grass and
trees on them. the compare is read from the pass's shared stencil state; its per-face states say
always.

- UV: `(local.xz + 0.5) · scale + offset`, for `_BaseColorMap` and `_SampleTex1` (the PBR map:
  normal RG, roughness B; with `_SampleTex1UVSet` it takes its own `_ST` of the box's UVs instead)
- albedo: the placement's colour as stored (not gamma-decoded) × its intensity × the base map's RGB;
  with `_BaseTexChannel` the base map is the PBR map and the colour stands alone
- alpha: the base map's alpha × the colour's alpha × `_DecalOpacity`, and with `_NORMAL_ANGLE_BLEND`
  × `sat(y · N)^_AngleBlendFallOff` with `y` the box's axis and `N` the surface's normal, so walls
  the box reaches stay clean
- roughness: `mix(_RoughnessMin, _RoughnessMax, B)`
- normal: the PBR map's RG × `_NormalScale` in the box's frame (x tangent, y normal), or towards the
  surface's by `_BlendSceneNormal`; the result blends from the surface's normal by `_AffectNormal`
- metallic and occlusion: `_Metallic` or a channel of `_SampleTex1` by `_MetallicChannel` (2–5 pick
  R–A), occlusion a channel by `_OcclusionChannel` (1–4) applied by `_OcclusionStrength`

each target blends by the alpha, and the material's colour masks pick what's written: `_ColorMask3`
the albedo, `_ColorMask2` the normal (RG) and roughness (B), `_ColorMask1` metallic (R) and
occlusion (G). the editor derives them from `_AffectNormal`, `_AffectRoughness` and the like; the
moss writes albedo and roughness only. some decals write no albedo at all: they roughen or bump the
surface beneath (Wuling City's terraces), or make it look wet.

`_BLEND_EMISSIVE` decals also glow, as Deep Dale Street's purple patches do (dung02_rdg008 near
unity 13, 92, −21). the GBuffer's emission target is always written, its RGB laid over by the same
alpha, whatever the colour masks: `_EmissiveColor` × a channel picked by `_EmissiveChannel` (0–3
`_SampleTex1`'s R–A, 4 the base map's alpha) × the albedo above, or 1 with `_AlbedoAffectEmissive`;
under `_IgnorePostExposure` it's divided by the post exposure.

`_BLEND_WATER_FLOW` is the wet rock beside waterfalls (Jingyu Valley's falls near unity −1075, 207,
−1414). it writes only normal and roughness, from `_WaterNormalTex` sampled at world positions
rather than the box's UVs:

- the map is projected along x (at world zy) and along z (at world xy), each times its `_ST` scale,
  and the two blend by the surface normal's squared x and z, normalized to sum to 1
- two layers scroll down the world's y: UV scale `_UVMovement.z` with speed `.x`, and `.w` with `.y`
  (in UVs per second); steep walls push both further by `steep · _NormalFactor`, where
  `steep = (1 − |N.y|)^_AngleBlendFallOff2`
- the four samples' normals (decoded like the PBR map's) sum, their xy times `_WaterNormalScale`,
  into the box's or the surface's frame as above
- roughness: `_WaterRoughness` × the mean of the first layer's two B samples
- alpha: the base map's alpha × the colour's alpha × `_DecalOpacity` × `steep`, so level ground
  stays dry

## matte paintings

`HGRP/MattePainting` draws the painted mountain ranges on the horizon: a few alpha-tested ring
segments, 600–1000 m from their origin and 1000 m tall, carrying one wide texture (map01's is
4096×512). they're unlit: the colour is `_MainTex` times `_TintColor · _TintColorIntensity`, plus
`_ExpIntensity` times whatever exceeds `_ExpThreshold`, in pre-exposed units unless
`_IgnorePostExposure` is set. alpha is the texture's times `_TintColor.a · _TintColorAlpha`, clamped
to 1 and tested against `_AlphaClipThreshold`. the shader has no shadow pass, so they don't cast
shadows.

## erosion

`HGRP/Erosion` draws the dark blight rock that grows over the Originium Science Park and other map01
areas. it has no base colour map; the colour comes from its other maps:

- `_MetalMixMap` R is 0 where the surface is metal. there the colour becomes `_MetallicColor`, the
  roughness 0.01 and the metallic `_Metallic · (metal − _MetallicOffset)`; elsewhere it's
  `_BaseColor`, with roughness `_Roughness` times the map's A, blended toward the detail map's alpha
  by `_DetailRoughnessCover`. G is occlusion (by `_OcclusionStrength`) and B masks the flow band.
- a noise layer: `_NoisePatternMap`, shifted by one parallax step `_NoiseStrength` deep, tinted by
  `_NoisePatternTintColor` and the base normal map's alpha, scaled by `max(N·V, _NoiseMin)` and
  faded out by distance over `_DistanceBlend` metres. it's added to the colour and, times
  `_NoiseEmissiveStrength`, to emission.
- a flow band: `_FlowRampMap` read along the object-space height (`× _FlowNormalTilling`, plus the
  metal map's G `× _FlowNoiseStrength` and `_FlowSpeedOffset`, scrolling by `_FlowNormalSpeed`),
  coloured `_FlowBottomColor` below the height `_FlowColorOffset` and `_FlowTopColor` above it. it
  adds `_FlowColorStrength` of itself to the colour where the metal map's B is set,
  `_FlowColorEmissiveStrength` to emission elsewhere, and lowers roughness by `_FlowRoughness` times
  its brightness.
- the base and detail normal maps (each with its own scale) are summed; metal flattens the bitangent
  component.

every map samples UV set 0 and tiles by its own `*Tilling` property rather than its `_ST`. the
metal, noise and flow colours are HDR and used as stored, like `_EmissiveColor`. the shader also
blends softly into whatever lies behind (`_ObjectBlend*`, which reads the scene depth).

`HGRP/ErosionDynamic` (animated, glowing) is used only by the `P_erosion_map01_dynamic…` prefabs,
the erosion patches the player clears. their load gate shows them while a map variable is not 2
([variable gates](scene-states.md#dynamic-load-gates)).

## open

- the parallax pulse's and the erosion flow's clock is assumed to tick in seconds.
- the detail map's channels per `_DetailMode` (roughness from B in mode 1, from the alpha in mode 0)
  are unchecked against a shot.
- the layers' UV set 2 is read as set 0 on the strength of map02's meshes and one in-game shot.
