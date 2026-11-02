# lighting

how the viewer lights what [game-data/lighting.md](../game-data/lighting.md) describes.

## units

like the game, the viewer lights in physical units, pre-exposed:
`preExposure = 1 / (1.2 · 2^directEV100)`, and the sun, ambient probe and fog colours are all
pre-exposed, so shaded values reach the tonemapper around 0–2.

where the game's CPU packing of a profile field is known, the viewer follows it; where it isn't, the
viewer approximates it; see [unknown packings](../game-data/lighting.md#open).
[`render/environment.ts`](../../packages/viewer/src/render/environment.ts) (`deriveEnvironment`)
turns a blended profile into the renderer's `Environment`; packages without profiles get a built-in
default look.

## sun

the sun's pre-exposed illuminance is `light.directLux · preExposure`, computed rather than read from
the config's `directIntensity`, which some phases carry stale. every effect's direction comes from
its pitch, yaw and mode (`effectPitchYaw` in `render/environment.ts`), never from the shading sun
alone or from the `rotation*` quaternions, so the [blend](environment.md#blending-at-the-camera) can
lerp directions as angles ([sun](../game-data/lighting.md#sun)).

direct sun lighting is GGX with height-correlated Smith visibility and Lambert diffuse in
[`shaders/frame.wgsl`](../../packages/viewer/src/render/shaders/frame.wgsl), with the sun's colour
taken as illuminance and diffuse divided by π. the game's CPU scaling is unknown, so this may
under-light the sun by π ([sun units](../game-data/lighting.md#open)). foliage uses the game's
two-sided model.

## shadows

the viewer draws the game's four layers ([shadows](../game-data/lighting.md#shadows)) as 2048²
`depth32float` layers fitted to bounding spheres of frustum slices and snapped to world texels so
edges don't crawl ([`render/shadow-map.ts`](../../packages/viewer/src/render/shadow-map.ts)).
turning the camera doesn't change a sphere's fit. casters are what the main pass draws that frame,
plus instances outside the view within 250 m whose shadows can reach it: the view frustum's planes
are swept 250 m towards the sun, and instances inside the swept planes draw into the shadow layers
only. off-screen casters smaller than 16 px (as if on screen) are skipped, and terrain outside the
view doesn't cast. shadow-only renderers draw into the shadow layers only, in view or not. they cull
back faces like any material, which is enough for Dijiang's roof.

- a point uses the first cascade sphere containing it, dithered with the next one over the outer
  tenth of the sphere's radius.
- the sharp cascades filter like the game's, in the game's 2 × 2 atlas uv.
- the sharp cascades fade into the far layer between 64 and 80 m by squared distance to the camera.
  the far layer is a 3×3 grid of bilinear comparisons, standing in for the game's tent-filtered
  cached map.
- against acne, receivers move along the normal by about a texel and casters take a slope-scaled
  depth bias, rather than the game's push towards the sun.
- the `shadow` section's fields apply as the game's do.

### cloud shadows

the cloud shadow darkens the sun on surfaces and the volumetric fog's sun
([cloud shadows](../game-data/lighting.md#cloud-shadows)). the fog's matters: without it, the haze
over places where a phase sets the alpha to 1, such as Marker Stone's caves, reads near-white.

## ambient

- the ambient probe is `sky.skyAmbientSH` scaled by `light.indirectDiffuseFactor`, converted to
  Unity's `ShadeSH9` vectors (`shaderSh`) and stored pre-exposed. how the game combines these is
  unknown, so ambient brightness is approximate ([unknown packings](../game-data/lighting.md#open)).
- the irradiance volume is sampled from the viewer's three clipmaps
  ([irradiance](irradiance.md#clipmaps)), blended between levels near each level's edge, with the
  game's validity fill-in and vertical correction term, but without its jitter or forward shift.
- AO's multi-bounce fit uses the albedo's luminance rather than fitting per channel.
- specular occlusion comes from material occlusion only, without GTAO.

the environment BRDF is an analytic split-sum fit. until a profile's reflection cubemap streams in,
specular ambient samples the ambient probe instead.

### screen-space reflections

the viewer runs the game's screen-space reflections
([screen-space reflections](../game-data/lighting.md#screen-space-reflections)) in
[`ssr.wgsl`](../../packages/viewer/src/render/shaders/ssr.wgsl) and
[`screen-space-reflections.ts`](../../packages/viewer/src/render/screen-space-reflections.ts), as
fullscreen passes rather than compute kernels. it reprojects through the depth buffer and the
previous camera instead of motion vectors (the scenery is static), and needs no rain-wetness
variant: the viewer's surfaces already carry the wet roughness
([environment](../game-data/environment.md#wetness)), so only the variant's ripple normals are
missing.

## local lights

the package's `lights` table ([JSON tables](../package-format.md#json-tables)) feeds
[`render/local-lights.ts`](../../packages/viewer/src/render/local-lights.ts), and `local_lighting`
in [`shaders/frame.wgsl`](../../packages/viewer/src/render/shaders/frame.wgsl) follows the game's
lobe ([local lights](../game-data/lighting.md#local-lights)), without its multiple-scattering term.
lights load under their file's, structure's or placement's visibility; a light the chunk files also
hold keeps its files' conditions.

each frame `local-lights.ts` takes the shown level's lights (and tag 0's) whose condition holds,
that are within their culling distance and in the view, sorts them by camera distance then priority
and keeps the nearest 256, the game's hard maximum; its quality-dependent cap is unknown. it bins
them into the game's tiles and slices using conservative bounding spheres on the CPU. the volumetric
fog lights each froxel with the same lists.
