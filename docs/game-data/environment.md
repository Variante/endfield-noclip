# environment

how the game decides what a place looks like (sun, sky, fog, clouds, grading). the game has no
per-level environment setting: environment volumes placed in the world apply environment phases,
blended by priority at the camera. phases also contain weather settings; their activation is
described under [weather](#weather). how the renderer turns a blended phase into pixels is in
[lighting.md](lighting.md), [sky-and-fog.md](sky-and-fog.md) and
[post-processing.md](post-processing.md).

## environment phases

an `HGEnvironmentPhase` (`EnvParse/Env_*.asset`, a MonoBehaviour read through its embedded TypeTree)
is one complete look, stored as a list of `HG*Config` sections. each section carries `m_active`:
whether the phase sets that section at all. an inactive section leaves whatever is under it (a
lower-priority volume, or the scene's global phase) unchanged, even if its own fields hold plausible
values. read sections only after checking `m_active`.

| phase field           | holds                                                         |
| --------------------- | ------------------------------------------------------------- |
| `lightConfig`         | sun, exposure, ambient scale, effect directions               |
| `skyConfig`           | ambient SH, reflection cubemap, sky distance, sun disc        |
| `atmosphereConfig`    | sky LUTs, fog absorption                                      |
| `fogConfig`           | atmosphere (distance) fog                                     |
| `heightFogConfig`     | height fog                                                    |
| `volumetricFogConfig` | volumetric fog, and its own height-fog set used while it's on |
| `cloudConfig`         | cloud panorama, cloud shadows                                 |
| `windConfig`          | wind                                                          |
| `lightShaftConfig`    | sun shafts                                                    |
| `colorGradingConfig`  | grading                                                       |
| `autoExposureConfig`  | [auto exposure](post-processing.md#auto-exposure)             |
| `shadowConfig`        | sun shadow softness, strength, penumbra ramp, sun-off         |
| `celestialConfig`     | planets in the sky                                            |
| `starConfig`          | star field and nebula                                         |
| `rainConfig`          | rain, rain wetness ([wetness](#wetness))                      |
| `lensFlareConfig`     | the sun's [lens flare](post-processing.md#lens-flare)         |

the phase has other sections too (`snowConfig`, `volumetricCloudConfig`, …).

fields whose effect isn't known, with what shipped phases set (map01, map02 and the dungeon, base
and race scenes checked):

- `cloudConfig.cloudFlowType` is 1 or 2 in most phases with clouds, usually with a nonzero
  `flowSpeed`; type 2 phases also reference a `cloudFlowMap`. presumably they move the panorama.
- `skyConfig.skyMaterialType` is 1 in three phases (`Env_map01_lv006_art_boss_area_01`, which also
  references a `skyboxCubeMap`, `Env_dung02_rdg008_sword` and `Env_indie_race001_art_bossS1_end2`),
  0 elsewhere; 1 presumably swaps the procedural sky for the cubemap.
- `skyConfig.reflectionType` is 0 or 1, roughly evenly.
- `skyConfig.useCustomIVDefaultSH` is set in about a third of phases, with `customIVDefaultSH`
  holding an SH presumably used where the irradiance volume has no coverage
  ([lighting](lighting.md#open)).
- `heightFogConfig.enableVolumetricFog` is false in 46 phases (among them map02's base
  `Env_map02_lv003_global`), while `volumetricFogConfig.enable` is true wherever that section is
  active; which of the two switches the PC fog path isn't known.

colours are fed to the shaders raw (no sRGB decode; HDR colours exceed 1). `SphericalHarmonicsL2` is
27 numbers, channel-major. sections reference textures (the sky reflection cubemap in BC6H, the
cloud panorama, its flow map, the cloud-shadow texture), the celestial bodies' draw materials, and
the lens flare's `LensFlareDataSRP`, whose elements carry images
([lens flare](post-processing.md#lens-flare)). `*ForEdit` fields are editor-only previews.

## environment volumes

chunk volumes are tag-1 objects (the mono-object rows of InitChunkData, with asset references in
paired StreamingChunkData; see [world.md](world.md)). other sources are [prefabs](#prefab-volumes)
and [LevelData](#weather). a chunk volume is repeated, under the same object id, in every cell chunk
it overlaps. the level tag of the entity id says which level owns it (0 = scene-wide).

`HGEnvironmentVolume` component fields:

| field | type  | meaning                                                                            |
| ----- | ----- | ---------------------------------------------------------------------------------- |
| 0     | int   | `volumeType` (`EnvVolumeType`): 0 global, 1 box, 2 sphere, 3 poly area, 4 cylinder |
| 1     | int   | `blendMode` (`EnvBlendMode`): 0 none, 1 distance, 2 time, 3 manual                 |
| 2     | int   | priority                                                                           |
| 3     | float | blend distance (m)                                                                 |
| 4, 5  | float | fade-in / fade-out duration (s)                                                    |
| 6     | asset | the `HGEnvironmentPhase` (Streaming half only)                                     |
| 7     | blob  | polyline shape                                                                     |

shapes:

- **global**: applies everywhere.
- **box**: a unit cube under the object's transform (position, Euler rotation, scale). it has no
  shape blob.
- **prism** (`PolyArea`): the polyline blob is `u32 byteLength`, `f32×3` position, `f32×3` Euler
  rotation, `u32 n`, `n × (x, z)` relative to the position, an edge BVH, then `f32 height` and
  `f32 baseHeightOffset` as the last eight bytes. the points are in the volume's frame: rotated by
  the yaw and offset by the position, they're in world space. the prism spans
  `y ∈ [position.y + baseHeightOffset, + height]`; volumes are 3D, so a cave volume under a hill
  doesn't apply on the hilltop.

each scene has one global volume (tag 0). each level typically has one broad polygon or box volume
over most of its ground (usually priority 200, often named `*global*`), under dozens of smaller,
higher-priority ones for caves, interiors and set pieces. neighbouring levels' volumes overlap a
level's rectangle.

Unity post-processing `Volume`s (component `Volume`: `isGlobal`, priority, blend distance, weight, a
`VolumeProfile`) share the same rows; local ones carry a `BoxCollider`. every level has its own
global post volume.

## scene states

a volume present in scene state 0's chunk files always loads; otherwise it loads with any of the
MapConfig scene states whose files hold it. see [scene-states.md](scene-states.md).

## prefab volumes

some volumes sit in prefabs that DynamicStreaming entities place (model rows, see
[assets.md](assets.md#payloads)), so the entity's load gates switch them with the story. the prefabs
are named `P_lightingDeco_<entity id>_envvolume`. the volume is an `HGEnvironmentVolume`
MonoBehaviour on an active GameObject, serialized by Unity with the same fields as the chunk
component (`_volumeType`, `_blendMode`, `_priority`, `_blendDistance`, `_fadeIn/OutDuration`,
`_polyLineShape`, `_envPhase`). differences from chunk volumes:

- the phase is a reference to an `HGEnvironmentPhase` object, often stored in the prefab's own
  bundle, not a StringPathHash asset. phases embedded this way have names of their own.
- a box takes its GameObject's transform under the placement. the polyline is stored in world
  coordinates, as in chunk data (the GameObject's position doesn't move it).

each volume belongs to its placement's level and loads with the placement's visibility (its gates,
scene-state lists and script flag).

Power Plateau (map01_lv007) is the example. its chunk volume is a sunset phase,
`Env_map01_lv007_art`. two gated entities swap prefab volumes on mission `e3m5` (Undying Cinders):

- before it completes, `…_2800000002_envvolume` adds two local boxes.
- after, `…_2800000003_envvolume` adds a level-wide prism at priority 300 with
  `Env_map01_lv007_art_overcast_brightness`, the grey overcast that players see once the story moves
  on, plus local brightness boxes.

the sky vortex's meshes switch on the same mission.

## blending at the camera

the game's environment manager blends `HGEnvironmentPhase`s into an interpolated phase. it visits
volumes in ascending priority; each that applies and contains the camera blends its phase's active
sections in by a factor:

- **none (0)**: 1 inside.
- **distance (1)**: distance inside the shape over the blend distance, clamped to 1 (global volumes:
  1). for a prism the distance is the nearest of the 2D edge distance and the distances to the top
  and bottom (unverified).
- **time (2)**: a factor that rises over the fade-in duration while inside and falls over the
  fade-out duration after leaving. a camera move over 5 m in one frame (teleports, level switches)
  snaps the fades (unverified).
- **manual (3)**: scripts drive the factor.

the order among equal-priority volumes isn't known, nor how the plain fields lerp: whether integer
fields and enums switch or round, whether the effect directions (`<effect>PitchYaw` with their
modes, and the `rotation*` quaternions resolved from them) lerp as angles or rotations, and how a
fog's negative `rayleighScatteringScale` (which defers to the atmosphere's) blends against a
positive one. the per-section lerps have special cases. the cloud lerp crossfades the cloud panorama
through `cloudFadeAlpha`: the old texture fades out to ½, the new one in after. the height fog's
flow noise has its own rule ([flow noise](sky-and-fog.md#flow-noise)), as does the lens flare: a
flare on one side fades in by the factor with that side's settings, and two flares cross through
nothing at ½ without blending (unverified). the precipitation transitions are special cases too.

## wind

the blended phase's `windConfig` drives the shaders' main wind (`_WindGlobalParams0`), set per
camera from the renderer's wind manager: x is the main intensity, `speed · 0.25` (speed in m/s, 5–30
in map02's phases); y is the wind clock; z and w are `direction`'s X and Z, as stored. `direction`
is the unit vector `horizontalDirectionAngle` (degrees from +Z toward +X) and
`verticalDirectionAngle` give. each gameplay update advances the clock by the previous frame's
intensity times 0.08 times the frame time, so at a steady speed it runs at `speed · 0.02` per
second, and keeps the previous frame's values (`_LastWindGlobalParams0`) for motion vectors.
[swaying cloth](materials.md#swaying-cloth) reads it. wind motors (local wind sources the player and
scripts register) feed other parameters, not described here.

## activation

nothing in the default chunk data says whether a volume starts enabled; the stored rows carry no
enable field. level scripts toggle volumes at runtime (`EnvironmentEnable` actions), and quest-state
volumes (night, battle, destroyed-town looks) sit in the same lists as permanent ones. their names
(`night`, `zhandou`, `fight`, …) don't tell them apart: a name filter guesses wrong both ways.
examples of story-state volumes that outrank a level's regular look:

- map01's The Hub: a night volume covering the whole map and a destruction-state volume with the
  exact outline of the level's regular volume both outrank it.
- map02's Snowy Forest: a night-named whole-level volume has a higher priority than the level's
  global one.

map02's Si's Painting is several disjoint painting worlds, each with its own priority-200 global
volume.

## weather

precipitation is part of the environment phase. rain and snow are sections of their own
(`rainConfig`, `snowConfig`), blended with the rest. there is no evidence of an independent weather
schedule; a server or random weather controller has not been found.

field rules, from the authored data:

- `m_active` decides whether the section participates in blending. `enable` decides whether
  precipitation is on in that section. `intensity` is an authored 0–100 value. inactive sections can
  hold `enable` = 1 and intensity 100, and disabled sections can keep a nonzero intensity, so only
  the three together say whether it rains.
- wetness is separate (`enableWetness`, `wetness`) and can stay on in a dry section, without falling
  rain.
- art-named phases carry weather too: Marker Stone's dam-area art phases include an enabled
  heavy-rain phase over the lake islet and dry, disabled-rain overrides at the outposts. a phase
  name is no evidence of what its sections hold.

weather appears in two ways:

- **spatial overrides**: ordinary chunk volumes whose phases enable or disable precipitation, such
  as the Marker Stone lake-islet rain or Snowy Forest's snow with drier cave overrides.
- **dynamic volumes**: LevelData carries an environment-volume table (phase path, bounds and
  transform, priority, blend mode, fades) that `EnvironmentEnable` script actions load and unload.
  these never appear in chunk data. Marker Stone's outposts have such quest-driven rain volumes at
  higher priority than the dry outpost phase.

### wetness

the game's deferred lighting wets every surface it shades (not forward-shaded glass or effects) from
the blended rain section, whether or not rain falls:

- **blend.** with `enableWetness` on both sides, the fields lerp. with it on one side only, the
  result is wet with that side's settings and `wetness` fading in from 0.
- **coverage.** full out to the rain occlusion range around the camera (measured as the larger of
  the x and z distances), then fading to `farSceneWetnessValue` by `farSceneWetnessDistanceFactor`
  times that range. surfaces the rain can't reach take `baseWetnessLevel`, and vertical faces
  `verticalWetnessScalar` against 1 for faces looking up.
- **porosity** `= saturate(smoothness · wetnessPorosityFactor + wetnessBasePorosity)`, 1 for metal.
  porous surfaces darken, the albedo down to a quarter at `wetness` 1 (not metal, not faces looking
  down); the smoothness rises towards `mix(0.9, 0.6, porosity) + mix(−0.6, 0.4, √smoothness)`,
  capped at 0.99 and never lowered.
- **standing water.** with `rippleRoughnessMaskThreshold` above 0 (the game's high-quality wetness),
  flat ground facing straight up holds water: its normal turns up and its roughness drops to a
  tenth, a near mirror for the screen-space reflections. it fades out between 15 m and about 80 m of
  view depth, and needs the material occlusion to be high.

the game also keeps sheltered surfaces at `baseWetnessLevel` through a rain occlusion map, a depth
map rendered from above, whose range sits in a presetting asset not yet found. it breaks up the
coverage edges with jitter noise, adds rain ripples, splashes and water flowing down walls, and also
floods normal-mapped dips through a geometric-flatness test. Marker Stone's dam-side volumes keep
wetness on at 0.5–1 in both dry and rainy phases, so its stone floors read wet even without rain.

## open

- script activation of chunk volumes, and the starting state of each; which volumes are permanent vs
  story state.
- the game's precipitation enable/disable transition rules.
- where a `volumeType` 4 (cylinder) volume keeps its shape: map02's one, a waterfall volume, has no
  shape blob.
- the game's order among equal-priority volumes.
- the plain-field lerp: integers, enums, effect directions and the fog's deferred Rayleigh scale.
- what the cloud flow, `skyMaterialType`, `reflectionType`, `useCustomIVDefaultSH` and
  `heightFogConfig.enableVolumetricFog` do ([environment phases](#environment-phases)).
