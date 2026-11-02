# status

what the extractor and viewer cover, where they knowingly differ from the game, and what is still
unknown. topic pages carry the detail; this page is the index of gaps. update it in the same commit
that closes or opens one.

map01 and map02 are the tested scenes. a scene listed by `world scenes` is not evidence that it
packs or renders correctly.

## covered

- container-aware asset resolution, conversion workers and the pack cache
  ([extraction](extraction.md))
- one level at a time over shared terrain, with level-owned streaming, LOD and HLOD
  ([world](game-data/world.md), [viewer](viewer/index.md))
- initial and alternative dynamic structures, active prefab hierarchies and skinned meshes in their
  authored pose ([assets](game-data/assets.md))
- quest, mission and variable state as preview controls, with scene states derived from them and
  dynamic load gates reading them; story progress picked per mission or across the main story;
  progressions, facility visual forms (shops, depots, recycling stations, monitoring terminals),
  Dijiang cabins and Control Nexus level (region walls), tree harvest state, stream areas and
  script/event groups as controls, each listed for the levels it gates; script groups list what sets
  them in game (quests, switches, areas, dungeons), from the level scripts, and follow the quests
  their scripts check when they run ([scene states](game-data/scene-states.md))
- static and dynamic stream areas switched by the camera through the game's trigger zones
  ([world](game-data/world.md#stream-areas))
- terrain heights, baked surface pages and the close-up layer blend
  ([world](game-data/world.md#terrain))
- environment profiles and volume blending, water, post-processing, base-bake irradiance (plus the
  bakes of Dijiang's rooms with a cabin built) and local point, spot and tube lights
  ([environment](game-data/environment.md), [lighting](game-data/lighting.md),
  [water](game-data/water.md))

## look and lighting

- baked GI brightness is unverified against in-game shots; the native ambient scale is missing, and
  the lighting lookup has no jitter or forward-shifted clipmap centres. next: compare GPU clipmap
  samples with the bake at one point, and check clipmap seams (L0 repeats, L1 clamps)
- several ambient and sky-LUT constants are computed in native engine code and not yet recovered
- irradiance: only the base bake and Dijiang's room bakes are packed, and room bakes reach only the
  finest clipmap; scene-state bakes, partial clipmap updates, the game's forward-shifted centres and
  jitter, fallback textures for cells without probes, the meaning of two index tables, and other
  index magics
- the game's own vignette (the viewer uses URP's); bloom's compute-shader variant, dirt, additive
  upsampling, character bloom and anamorphic stretch; colour curves in the phase sections are not
  packed ([bloom](game-data/post-processing.md#bloom))
- auto exposure can sit off in-game shots where characters or effects the viewer doesn't draw would
  count ([auto exposure](game-data/post-processing.md#auto-exposure))
- weather: snow isn't packed and precipitation (streaks, splashes, ripples) doesn't render; rain
  wetness ignores shelter, since the rain occlusion map isn't rendered, assumes a 100 m occlusion
  range, and has no jittered coverage edges, water running down walls or flooding of normal-mapped
  dips ([environment](game-data/environment.md#wetness)). the weather-script activation and property
  initialization are unknown, so weather stays a manual preview
- environment phases ([environment](game-data/environment.md#environment-phases)): `windConfig` is
  packed but unused, and `snowConfig`, `volumetricCloudConfig` and other sections aren't extracted;
  blending is a generic per-section lerp without the game's special cases (precipitation
  transitions)
- environment volume initial enablement and `EnvironmentEnable` script conditions, needed before any
  automatic gating: every loaded, non-manual volume counts as enabled, which is visibly wrong at The
  Hub (night and destruction volumes) and Snowy Forest (night volume), and the base-environment vote
  is wrong wherever level scripts switch volumes. dynamic LevelData volumes aren't extracted,
  cylinder volumes (`volumeType` 4) aren't packed, local post `Volume`s are read but not applied, a
  prefab prism volume under a non-identity placement is rejected, `world env` votes on chunk volumes
  only, and scenes without levels get no environment
  ([environment](game-data/environment.md#environment-volumes))
- sky ([sky](game-data/sky-and-fog.md#sky)): its absolute brightness is the viewer's `sky_scale`
  approximation; the sky planets are always added (the game's blend is unchecked), and their ring
  thinning the stars and the ray-traced planet's light brightness are unchecked
- volumetric fog: local fog volumes and the volumetric light's flow noise (`enableVLFlowNoise`)
  aren't drawn, the grid size, depth distribution and history weight are Unreal's defaults rather
  than the game's quality preset, and its sky term lacks the native diffuse-ambient scale. the
  height fog's [flow noise](game-data/sky-and-fog.md#flow-noise) is unchecked on water and glass,
  and its volume blend is read from the height-fog section's and assumed for the volumetric one
- local lights ([lighting](game-data/lighting.md#local-lights)): no shadows (on surfaces or in the
  volumetric fog), cookies, flicker or multiple-scattering term; directional, shadow-only and
  character-only lights aren't packed; [light beams](viewer/effects.md#light-beams) lack their 3D
  noise, a per-renderer scale and a global tint, and aren't checked against an in-game shot
- the sun may be π too dark against local lights and the game (the two conventions differ);
  unchecked
- interiors, in order of impact:
  - per-instance emission overrides aren't read
  - normal-map roughness is read only when the mesh has tangents; normals are transformed by the
    model matrix rather than its inverse transpose, and every material lights the side facing the
    camera
  - off-screen casters reach only 250 m, so the sun can leak past that reach, and `_ShadowCullMode`
    isn't read
  - outside the game's sun-off volumes, rooms get the outdoor sun wherever no drawn geometry shadows
    them
  - local reflection probes, GTAO in specular occlusion, contact shadows; the AO multi-bounce fit
    uses the albedo's luminance rather than each channel, and the specular ambient falls back to the
    ambient probe until the reflection cubemap streams in
  - the far shadow layer filters with a 3×3 bilinear grid rather than the game's tent, and acne is
    biased by a normal offset rather than the game's push towards the sun
    ([shadows](game-data/lighting.md#shadows))
  - GTAO takes normals from depth and one depth-aware blur instead of the game's temporal and two
    spatial filters ([ambient occlusion](game-data/post-processing.md#ambient-occlusion))
- the packed tangent frame isn't decoded; tangents are regenerated
- terrain close up: smooth triplanar replaces the game's random plane choice, and the cliff
  projection (`C` page) and cone-map parallax aren't drawn, nor the `A` page's subsurface curvature;
  the blend's GPU cost is unprofiled. `maxHeightError` is packed with each height page but unread
  ([world](game-data/world.md#terrain))
- puddles ([world](game-data/world.md#puddles)) stop past the leaf splat pages' load distance (only
  leaf `S` pages are packed), ignore the parallax layers' height (their settings aren't packed), and
  have no ripples
- screen-space reflections ([lighting](game-data/lighting.md#screen-space-reflections)): the rain
  wetness variant's ripple normals aren't drawn, the GPU cost is unprofiled, and off-screen
  reflections fall back to the sky cubemap.
  [reflection-only effects](game-data/effects.md#reflection-only-effects) don't write the normal,
  roughness and depth the reflections march from; two materials use them (the Very Large Rift
  portal's `quan_ad_01_pass` in dung02_dg005, `zhuangfangyi_shu_04_03_pass` in indie_dg005). next:
  compare the reflections behind the rift's portal ring with an in-game shot before drawing them
- glass ([glass](game-data/materials.md#glass)): refraction, Fresnel opacity and subsurface
  scattering aren't drawn, glass in front of water is lost, glass against the sky isn't fogged, and
  nothing checks whether the game lets glass cast shadows
- emission ([emission](game-data/materials.md#emission)): `_EMISSIVE_NOMAP` (the sweep animation)
  isn't drawn, the other animated variants are drawn still, and `_EmissiveType`'s extra G/B/A
  colours and the emission Fresnel term are left out
- foliage ([foliage](game-data/materials.md#foliage)): wind, the grass's per-instance colour and
  terrain albedo blend (`_BLEND_TERRAIN_ALBEDO`), the card LOD's normal decoding (so it takes
  neither the bend nor the masks), trunk ramps and vertex AO (trunks shade as Lit), sphere-shadow
  proxies, the vertical-normal AO boost, broadleaf indirect transmission, contact shadows and the
  per-instance leaf tint; layered materials. grass and tree grids
  ([world](game-data/world.md#foliage-grids)) draw every instance at the cluster's LOD, without the
  game's sparsity thinning; the cluster LOD measure (`rendererHalfSize`), the per-instance
  parameters and column 7 aren't read
- Lit layers ([lit layers](game-data/materials.md#lit-layers)): tri-channel switch textures (only R
  blends), the tri-channel mask on MRO-layout materials (untinted, sharing the MRO map's slot),
  `_UseMaskRUVSetAndTilingScale`, the parallax glow's global highlight, separate mask
  (`_UseParallaxMask`; such materials don't glow) and world-space, PBR and deform variants, the top
  layer's `_BaseHeightMap` (read as grey) and UV set 2, the noise and parallax mask blends, mask
  layers on emissive-mapped materials, and `_TERRAIN_BLEND`'s fade into the terrain
- matte paintings ([matte paintings](game-data/materials.md#matte-paintings)): `_UseMainTexAsAlpha`
  isn't read (no map01 material sets it)
- erosion rock ([erosion](game-data/materials.md#erosion)): the soft blend into what lies behind
  (`_ObjectBlend*`), fake translucency, and `HGRP/ErosionDynamic` (only on clearable patches, hidden
  by default; drawn as a flat tint)
- water ([water](game-data/water.md#global_water_config)): sector flow tiles (packed but unread;
  flow and foam come from the global map), each sector's `rippleLayerBuffer`, the LOD surfaces'
  displaced wave grid, the rain map (packed but unread), rain and character ripples and ground
  wetness around water; `FlowmapOption` 1's coverage is read as plain amplitude, the sun highlight
  isn't aimed at the nearest point of the sun's disc and has no multiple scattering, additive
  effects below the surface show over it ([viewer](viewer/water.md#shading)), and water entities'
  render-object column 7 isn't read. `HGRP/WaterDecal` foam at the foot of waterfalls shows as
  [unsupported](viewer/materials.md#unsupported-materials) (it most likely feeds the water's own
  foam rather than adding to the scene, and its per-placement `HGWaterDecalRenderer` values aren't
  packed); other fluid types are unverified
- water volumes ([viewer](viewer/water.md#water-volumes)): volumes that don't name a `WaterConfig`
  (54 of map02's 61, listed in `debug/water.json`) aren't drawn. the game draws them through a
  surface prefab per water type (`WaterVolumeManagerConfig.waterSurfaceSettingDict`,
  `…/GameMech/WaterVolumeSurface_<type>.prefab`), and per-volume
  `…/Gameplay/Water/<item type>#<volume id>_WaterSurface.asset` files exist but aren't read; sewage,
  acid and xiranite volumes are among them. moves are linear (no ease-in, and non-fixed-speed moves
  use the fill speed as metres per second); floaters keep their authored height above the surface
  rather than `surface_offset` and don't lag; `ground_distance`, `isPrototype`, flow speed and
  direction, amount-based volumes' transfers and the volumes' render type aren't read; each map02
  volume that coincides with a placed surface (five lv006 pools, lv010's 37900010002, several
  lv002/lv003 ones) draws twice, unverified against the game; Suiming's lily pads end 0.9 m under
  the pit's surface at the first stage, as the data says, unverified in game; a volume's surface has
  no shoreline wetness
- waterfalls missing: Jingyu's pool falls (near unity −763, 209, −1190) and the small cascades
  beside it show white in game, but the viewer's VFXWater sheet there sits inside the rocks in front
  of it, and the steep river surface running down the lip draws as clear water. what the game draws
  there is unknown
- scene effects ([scene effects](game-data/effects.md)): only VFXBaseV2, VFXDecal, the mist
  (FogSimple, VFXFakeVolumeFog), VFXWater's waterfall sheets, VFXDitherAlpha's plain variant and its
  unlit distortion, dissolve, red mask and polar or screen UV variants, with or without a vertex
  offset (blended rather than dithered, and writing no depth; the Very Large Rift's escaping trails
  are unchecked against an in-game shot), and VFXRefract's mask, polar UV, colour offset and soft
  blend variants draw; other effect shaders (VFXAdvance, …) and materials in these shaders' undrawn
  variants show as [unsupported](viewer/materials.md#unsupported-materials); reflection-only effects
  aren't drawn, as in the game (their part in the reflections is under screen-space reflections).
  VFXRefract's dissolve, blend, saturation, spread, Fresnel mask and trail aren't drawn, and its
  copy of the scene includes the water and fog, unchecked against the game's; Deep Dale Street's
  fog-wall haze isn't compared with an in-game shot. undrawn: for the first two, additive blend
  states, `_BlendMode` 2 outside a multiplying blend state, the vertex-offset mask, particle-data
  terms, the sixth sample texture together with a vertex offset, screen UVs relative to the object,
  brightening that is a scan line or centred on a fixed point (the player-centred one is left out),
  breathing, edge colour, vertex animation textures (Aurelyne collectibles' soft-body blob), water
  blending under a water height above the authored one, flipbook and particle inputs, and VFXDecal's
  lighting, parallax, 3D-texture and particle variants; local lights and the post-exposure division
  on lit effects; for VFXWater, `VFX_WATER_REFRACT`, `_VAT_SOFTBODY`, punctual lights, matcaps and
  the `VFX_WATER_SIMPLE_LIGHT` probe; VFXDitherAlpha's other keyword variants, and in its dither the
  vertex alpha, the near-camera fade, `_USE_MAIN2` and the edge mode. across effects: their own fog
  (`_USE_FOG`), the mist boxes' depth prepass and vertex colour, and the game's global scene-effect
  colour adjustment (`_VFXParams1`, set by native code; the Jingyu blight reads less saturated than
  in game, and Suiming's [cave-exit light card](game-data/effects.md#mist) is unchecked against an
  in-game shot). stencil [portals](game-data/effects.md#portals) draw without their masks' own
  colour and depth, stencil operations other than keep and replace are unsupported, and none draw
  unless the GPU has `depth32float-stencil8`
- particles ([particle systems](game-data/assets.md#particle-systems),
  [viewer](viewer/particles.md#particles)): mesh particles frozen in place lose their start colour
  and their drift and spin over lifetime, and take the midpoint of random start values. other
  systems, meshes and billboards alike, play without the force, noise, collision, trigger,
  sub-emitter, light, trail, custom-data and by-speed modules, from the viewer's own random values,
  and move only while frames render; systems that don't play on awake, or use velocity alignment, an
  per-axis speed limit or one alongside drag, drag or rate curves, orbital, radial, speed-modifier
  or rotation curves, sprite-mode sheets, sheet time modes other than lifetime or frames per second,
  or sheets over 64 tiles a side, show as one [stand-in](package-format.md#stand-ins) at the emitter
  (the swirling green motes around Qingbo Stockade's bamboo tubes use orbital and radial velocity
  curves). drag is approximated (it slows the start velocity and the fall alone), the maximum
  on-screen particle size isn't applied, stretched billboards are centred on the particle, and
  colours above 1 and custom data never reach the shaders. all copies of one flipbook step in phase.
  Marker Stone's low mist banks over the valley are still missing; their source is unknown.
  [spline movers](game-data/assets.md#spline-movers) (Dijiang's shaft cargo) take their lifetime
  span as the spline's length over the speed, which isn't verified, and draw each LOD group's
  renderers at the group's origin; those with noise, rotation over lifetime or an alpha fade stand
  in
- decals ([decals](game-data/materials.md#decals)): `HGRP/DecalLit` shows its wetness, sludge,
  footprint, UV-noise and arc variants, and placements without their colour and UV, as
  [unsupported](viewer/materials.md#unsupported-materials), and draws overlaps without the game's
  `_DrawOrder`; decals that write no albedo relight the surface from an estimate of its colour, as a
  dielectric, leave its screen-space reflections and ambient occlusion as they were, don't write
  metallic, and add their emission over the surface's instead of replacing it; under a laid-over
  decal that doesn't write them, the surface's own occlusion and metallic are taken as 1 and 0;
  terrain decals (`HGRP/TerrainDecalLit`, InitChunkData component 28) and `HGRP/DecalUnlit` aren't
  packed, and decals in dynamic structures are only [stand-ins](package-format.md#stand-ins)
- temporal smoothing of effects
- light shafts ([light shafts](game-data/post-processing.md#light-shafts)): the occlusion term and
  the cloud mask aren't drawn; unchecked against an in-game shot facing the sun. the
  [sun disc](game-data/sky-and-fog.md#sun-disc) is unchecked against one too
- lens flare ([lens flare](game-data/post-processing.md#lens-flare)): polygon elements, inverse SDFs
  and key weights aren't drawn, and the flare component's own settings (when the environment's flare
  is off) aren't known; per-light curves take SRP core's directional-light defaults. at Origin
  Lodespring's overview the viewer's flare is fainter than the game's: the crystal mountain behind
  the sun occludes it in the viewer's depth buffer (the game may not write it there), and Unity's
  random-number mapping is assumed
- the sky's celestial layers are unchecked against in-game shots, and the moon's sky-wide ring
  (`HG_RING`) and the aurora aren't drawn
  ([beyond the atmosphere](game-data/sky-and-fog.md#beyond-the-atmosphere)); `cloudBrightness`,
  `lightAffectCloud` and `enableFarCloudShadowTexture` are ignored
  ([sky](game-data/sky-and-fog.md#sky), [cloud shadows](game-data/lighting.md#cloud-shadows))
- HLOD/detail, LOD and mip swaps pop without cross-fade; ground-blend and decal meshes z-fight
  without the game's depth offsets

## renderer and performance

- GPU culling and indirect draws
- per-cascade shadow caster culling and cascade caching
- terrain pass cost, budget churn in dense areas
- temporal antialiasing sharpening
- per-subtree level masks in the tile tree so traversal skips other levels
- terrain outside the shown level is drawn bare; clipping or dimming it is undecided
- teleport points as viewpoints: where the game stores them is unknown

## coverage and conditional content

- separate scenes (interiors, offices, arenas) are unvalidated
- interactives ([assets](game-data/assets.md#interactives)) with view states
  (`ModelViewStateControllerData`) draw the pose their state machines settle in, and ignore
  per-placement component properties. [one-shot effects](game-data/assets.md#one-shot-effects) and
  the effects a state's `EffectBehavior` plays (the talosites' activation burst) aren't drawn, since
  the viewer can't play them, and a settled loop clip shows its last frame. looks the player's
  presence changes follow the camera
  ([keys the player sets](game-data/assets.md#keys-the-player-sets)); a campfire's `InZone` sphere
  uses the template's 2.5 m radius, though the game swaps the trigger's radius for runtime values
  once inside (unread), and the `Distance` measure is assumed to be a plain 3D distance (the helper
  isn't decompiled). keys only fights or the server set (`InBattle`, `isDead`) stay false. doors
  draw open or closed ([interactive doors](game-data/assets.md#interactive-doors)), closed by
  default except a Dijiang cabin's, since what opens each in game (a level script reacting to a
  mission's cutscene, the server) isn't followed. campfires draw not activated or activated
  ([campfires](game-data/assets.md#campfires)), not activated by default; their fight look and the
  color layer's VAT clips aren't drawn. telescopic bridges likewise draw retracted or extended
  ([telescopic bridges](game-data/assets.md#telescopic-bridges)), retracted by default. rows created
  later (`createState` ≠ 0) draw only with their level's "created during play" toggle, off by
  default; one toggle covers a level's rows, since which of them the server or a script creates
  isn't followed. interactives whose model id is missing from the model table, templates without a
  data file of their own (weapon-wall racks, some doors), templates where zero or several positions
  frame the variant table, door models with an ambiguous open-idle state (not drawn as doors), and
  LevelData with any populated field or condition the reader doesn't implement (the blackbox scenes'
  blackbox settings; LevelData members after the interactive list aren't decoded) are reported in
  `out/<map>/debug/unsupported-interactives.json`; those whose template or model wasn't found are
  [stand-ins](package-format.md#stand-ins), the rest omitted
- entities controlled only by `ActivityControlComp` aren't gated
  ([dynamic load gates](game-data/scene-states.md#dynamic-load-gates))
- resource nodes (doodad groups) share one level control per level; the game's per-group level and
  its source in LevelData aren't read ([scene states](game-data/scene-states.md#doodad-groups))
- interactive facilities are gathered from levels whose map is the packed scene, so a scene streamed
  by levels of other maps (`base01_lv001`, streamed by `base01_lv003` and `indie_dg014`) probably
  loses their facilities; select levels by `defaultState.exportedSceneConfigPath` instead
- variable ids are unnamed (MapConfig's `mapVarName2NumId` names map variables but isn't read);
  outpost tier variables are matched to their outpost's levels by layout, not by a recovered table
  ([outpost tiers](game-data/scene-states.md#dynamic-load-gates)); outpost level-up missions are
  read as complete above their level, unverified against whether completion raises the level or only
  unlocks it ([upgrade missions](game-data/scene-states.md#outpost-upgrade-missions)); variables
  that drive entity level or animator state (doors, bridges, puzzles: `ModelViewStateControllerData`
  state machines) aren't controls yet
- scene states that scripts set by name (`SetOverrideSceneState`) and map02's sprayable sludge
  aren't represented; script-driven water levels are picked by hand, not tied to the switches,
  clocks and quests that drive them; the shop, depot and terminal level → visual form mapping, and
  the resource-node level's link to regional development, aren't recovered
- script-group drivers are found from client scripts only: stages, properties and events the server
  sets show as "server", and groups no client script names have none
- story-state expressions and script relationships beyond what client data proves; event and server
  conditions may never be recoverable
- control labels still show internal identifiers or representative mesh names in many places
- runtime world-space UI, including Dijiang's cabin nameplates and assigned-operator panels, is not
  drawn ([cabins](game-data/scene-states.md#dijiang-cabins))
- animated poses and nonzero blend shapes (meshes with them are stand-ins); vertex-animation-texture
  meshes (`_vat`, e.g. floating rocks) draw their rest pose
- the game's HLOD-unload triggers (`FBStreamArea` root slots 7–9) and HLOD layer load radii
  (`hlod0LayerLoadRadius`, …) aren't read ([world](game-data/world.md#stream-areas))
- billboards turn only mesh renderers; skinned meshes and particle systems under a `VFXBillBoard`
  stay as authored; a renderer away from the `VFXBillBoard`'s origin turns in place instead of
  swinging around it, and modes 2–3 turn about the world's vertical rather than their own up, so
  tilted placements face wrong ([billboards](game-data/assets.md#billboards))
- the AIC buildable-grid data (`factorygrids/fbgrids_*.bytes`, a FlatBuffer of per-1 m column height
  spans and buildable/water flags on the 128 m cells) has no decoder
- some mesh/material references are missing from the install's path-hash table. failed exact lookups
  stay explicit

## packaging

- cache material conversion; remember failed conversions so a warm pack starts no worker; skip
  compressing duplicate textures
- the entities pass (~7 s on map02) re-reads every chunk file on a warm pack; it could be remembered
  like terrain and irradiance
- prefab renderers keep only LOD 0, with unbounded thresholds, so prefab content never switches LOD
  or culls by size
- a mesh or material reached both by path hash (static entities) and by object (prefabs) gets two
  table entries and converts twice
- a level's base environment is found by matching phase names; `LevelInfo` could name its volume
- texture zstd level and a max-texture-size option for a lite package (textures dominate package
  size)
- place global scenery by its own bounds instead of pulling it all into `assets/common`
- port the game's path hash so lookups stop reverse-scanning the path-hash table (about a second
  each)
- meshes: collision-only meshes (`m_CollisionMeshBaked`) and vertices in `m_CompressedMesh` are
  rejected, leaving their instances as streaming boxes; PPtrs into Unity's built-in resources don't
  resolve; prefabs that fail with a `FormatError` are listed in the unsupported-prefab report and
  drawn as [stand-in](package-format.md#stand-ins) cubes ([assets](game-data/assets.md#mesh))
- move the viewer's environment-agnostic package loading into `package-format` so packer tests read
  packages through the viewer's code
- the terrain shader assumes 65² pages

## open unknowns

- HLOD switch distances (the package uses a placeholder error) and the HLOD material/atlas mapping
- per-controller meaning of progression bit 0 ("unbuilt" versus "level 1")
- weather/time state ids
- runtime: BC texture support in Safari, the texture-array layer limit on Apple GPUs
