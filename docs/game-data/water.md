# open-world water

open-world water uses surface placements, per-surface `WaterConfig` assets and a scene-wide
`Global_Water_Config`. for scene-state conditions see [scene-states.md](scene-states.md); the
lighting the water shares with surfaces is in [lighting.md](lighting.md), and waterfall sheets are
effects ([effects.md](effects.md)).

three sources join per surface: an InitChunkData row places it, the StreamingChunkData record with
the same entity id binds its mesh and config, and a per-level object binds the scene's global
config.

## placements: InitChunkData component 30

every water surface is an entity of a **Global** chunk (no cell chunk holds one in any shipped
scene), so water is resident. the groups holding them have the bounds columns 0–5, a 24-byte column
7 (see below), the name column 21 and component 30, whose rows are 104 bytes:

| offset | type   | field            | notes                                                                                        |
| ------ | ------ | ---------------- | -------------------------------------------------------------------------------------------- |
| 0      | u32    | render type mask | bits of the game's `HGWaterRenderType`: 1 proxy, 2 LOD (below)                               |
| 4      | i32    | runtime mesh id  | always 0: filled in at load                                                                  |
| 8      | f32×16 | object-to-world  | column-major, translation at floats 12–14, same convention as the renderer component         |
| 72     | f32×4  | param0           | (material index, 0, 0, 0); the index is filled in at load from the bound config, so 0 here   |
| 88     | f32×4  | param1           | (wetness offset (m), height layer 0–3, 1 to sort by distance, 1 to wet the ground around it) |

in every shipped row the mask is nonzero, every value is finite and both bindings are present.

every surface draws its own mesh; a **LOD** surface is also drawn top-down into the height layer
`param1.y` names and redrawn as a camera-centred grid displaced by the waves. map02's 872 LOD
surfaces are its open water; the 431 proxy-only ones are mostly paddy-field pools. the wetness
offset raises the surface when the game darkens the ground it touches. the 24-byte column 7 is the
generic render-object info every renderable entity carries: layer mask, flags, scene mask, an art
tag and a squared sorting distance.

surfaces have no materials of their own: the render pipeline draws them all with its own
`HGRP/WaterProxy` and `HGRP/WaterRendering` shaders, indexing the configs by material index.

the level tag is `id >>> 27` as for every entity; tag 0 is shared content shown with every level.

a surface can appear in several chunk files under the same id. a surface found in an always-loaded
file (scene state 0) is unconditional; otherwise it loads while any of its files' MapConfig scene
states is active. map02's paddy-field pools are the main example of scene-state water.

## bindings: StreamingChunkData

the StreamingChunkData sibling of each chunk file (same name with `StreamingChunkData_`) holds a
kind-2 record per surface id. its property table binds two u64 StringPathHash keys (property type
15):

| key          | binds                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------- |
| `0xff000000` | surface mesh                                                                                |
| `0xff010000` | surface `WaterConfig` MonoBehaviour                                                         |
| `0x20000000` | the scene's `Global_Water_Config`, on a kind-1 object named `Water#<tag>_…` (one per level) |

keys are `component << 24 | field << 16 | index`. the `0xff` component is archetype-specific: other
entity archetypes reuse those keys for their own bindings (rect decals bind their material under
`0xff010000`), so they are water bindings only on entities that carry component 30. `0x20` is the
HGWaterGlobalConfig streaming component bit.

## surface meshes

four kinds occur:

| mesh                                                          | transform                                    | notes                                 |
| ------------------------------------------------------------- | -------------------------------------------- | ------------------------------------- |
| `com/water/models/s_waterquad.fbx`                            | scales a 0.1 m quad up to the surface's size | 4 vertices, uv0                       |
| the render pipeline's `plane.fbx`                             | scales a 0.1 m Unity plane                   | 121 vertices; paddy fields            |
| `<map>/water/water_<map>_pcgwater…_lod0.fbx`, `s_river_*.fbx` | mostly identity: authored in world space     | river meshes, uv0                     |
| `<level>/Water/PolygonMeshes/S_polygon_water_*.asset`         | identity                                     | flat world-space polygons, **no UVs** |

the water shading works in world x, z, so positions are the only attribute it needs. some polygon
meshes have triangles whose normals point down.

## surface `WaterConfig`

a MonoBehaviour per look (`…/WaterData/WaterConfigs/Config_water_<Map>_<n>.asset`, plus the shared
`Config_paddy_filed_water.asset`). field groups:

- flow and waves: `useFlowMap`, `flowDirectionVector2`, `flowSpeed`, `flowFullCycle`,
  `normalTilling`, `normalScale`, `smallWaveNormalType`, `largeWaveNormalType`,
  `largeWaveFlowSpeed`, `largeWaveNormalTilling`, `largeWaveNormalScale`, `flowFullCycleLarge`,
  `largeWaveInvDir`, displacement scalers
- optics: `waterRayleighScatteringMeter`, `waterRayleighAbsorptionMeter`,
  `waterRayleighAbsorptionMeter2`, `absorptionTint(2)`, `scatterTint`, `absorptionScale`,
  `scatterScale`, `safeFullAbsorpDistance`, `envLightIntensity`, `sceneColorEnvInfluence`,
  `rayleighMieLerpFactor`, `distanceEdgeBlendFactor`
- appearance: `roughness`, `specular`, `waterIOR` (a screen-space distortion strength, not an index
  of refraction), `flowBaseColor`, `foam*`, `distanceFade`, `envLightSpecularIntensity`,
  `punctualLightSpecularIntensity`, `emissiveStrength`
- caustics: `causticTilling`, `causticOpacity`, `causticDistort`, `causticSpeed`,
  `causticStartDepth`, `causticEndDepth`
- character interaction (`interactive*`, `ripple*`)

a surface's config is the asset its StreamingChunkData record binds. the config's `materialIndex`
doesn't identify it: it is meant to index the global config's `hgWaterConfigs`, but the paddy config
isn't in that list and its index collides with another config's.

## `Global_Water_Config`

one per scene with water, at `…/<Map>/ReleaseData/WaterData/Global_Water_Config.asset`; every
level's binding names the same asset.

| field                                                                           | meaning                                                                                                                                                                         |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sceneCenterOffset` {x, y}                                                      | world x, z the grid is centred on                                                                                                                                               |
| `mapSize`                                                                       | edge of the square the global flow map and the sector grid cover, metres                                                                                                        |
| `sectorSize`                                                                    | edge of one sector, metres                                                                                                                                                      |
| `flowmapPrecision`                                                              | metres per texel of a sector flow tile                                                                                                                                          |
| `useSectorData`, `sectorDataPaths`, `sectorDataAssetHashes`, `sectorDataExists` | the sector grid, parallel arrays over every grid cell                                                                                                                           |
| `hgWaterConfigs`                                                                | PPtrs to surface configs (incomplete, see above)                                                                                                                                |
| `flowMap`                                                                       | 2D flow map over the whole grid, linear BC7, one mip                                                                                                                            |
| `causticMap`                                                                    | caustic pattern, sRGB BC7                                                                                                                                                       |
| `rainMap`                                                                       | rain ripple map, linear BC7                                                                                                                                                     |
| `normalMapArray`                                                                | Texture2DArray of wave normals (two layers), linear BC7                                                                                                                         |
| `lodNum`, `meshNumPerLOD`, `meshSize`, `heightMap*`                             | the game's camera-centred grid that LOD surfaces are redrawn on, displaced by the waves by `waveVertexDisplacementScaler` (mostly 0 on map02; map02: 4 rings of 16² cells, 2 m) |

a sector has data only where `sectorDataExists` is set. its `(x, z)` is in its path
(`…/Sector/T_<x>_<z>.asset`), and its `sectorDataAssetHashes` entry is the StringPathHash key stored
as a signed 64-bit integer. sector `(x, z)` covers world
`[center.x + x·sectorSize, +sectorSize) × [center.z + z·sectorSize, +sectorSize)`; this mapping
places more surface centres in sectors with data than swapped or flipped axes do. each sector
MonoBehaviour's `waterSectorTexture0` is a flow tile (256², linear BC7, one mip) holding the global
flow map's content at `flowmapPrecision`. near the camera the game reads the flow (and most authored
foam) from the sector tiles, blending to the global map at the edge of a 3 × 3 window of sectors.

## shading

the game writes water's normal, roughness and foam into its own G-buffer before the screen-space
reflections run, then lights it in one full-screen pass after the opaque scene, with the sun through
its shadow maps, the [irradiance volume](irradiance.md) and the sky reflection. LOD surfaces are
shaded through the grid, whose normals point up, so their mesh normals never show.

- **flow**: the global map at `uv = (world.xz − center) / mapSize + 0.5` holds the direction in rg
  (`· 2 − 1`, green negated so it points along −z), foam in b and the wave amplitude in a. without
  `useFlowMap` the direction is `flowDirectionVector2`, encoded the same way. the amplitude scales
  the waves unless `FlowmapOption` is 1, which makes the game read it as coverage; no map02 config
  sets it.
- **waves**: two layers from the normal array (rg the normal, a the small layer's foam shape), each
  at its tiling, speed and cycle; `largeWaveInvDir` reverses the large layer. with a flow map each
  cross-fades two phases that jump by a cycle-dependent offset; without one it scrolls continuously.
  the array is sampled with mip bias `(0.5 − envSpecularDesaturation) · 10`. a fade
  `1 − saturate(distance · saturate(1 − N·V) / distanceFade)` scales the small waves (also by N·V)
  and the large ones down to `distanceNormalMinStrength`, so far water flattens into a mirror; the
  layers combine by reoriented normal mapping around the mesh normal.
- **roughness and foam**: roughness falls from the config's towards 0.01 as the fade rises (a mirror
  near the camera) and moves to `foamRoughness` under foam. foam is the flow's b times the small
  layer's shape over `foamShapeOffset`, times `foamOpacity`, fading out over `foamFadeDistance`; its
  colour is `foamColorG` as authored. it takes the sun's diffuse light, a see-through glow when lit
  from behind (`waterBaseColorSubsurfaceScaler`), the irradiance volume, and `emissiveStrength`.
- **refraction**: the surface point is pushed sideways against the waves (their xz scaled by
  `waterIOR`) by at most 0.5 m, less near the screen's edges and the camera, and the water looks at
  the scene under the pushed point, unless that lies in front of the water. the column's view
  direction then follows the refracted ray, and so does its thickness, except beyond about 20 m,
  where water less than half a metre to a metre deep keeps the straight-through thickness.
- **water column**, between the surface and the ground below (at most 50 m): it absorbs and scatters
  with the per-metre coefficients, `waterRayleighAbsorptionMeter2` (shallow) blending toward
  `waterRayleighAbsorptionMeter` (deep) as the thickness approaches `safeFullAbsorpDistance`. light
  scattered towards the eye is integrated over the column, with each source's extinction lengthened
  by its slant: `1 + 1.394 |V.y|` for the ambient and, as the game writes it, `1 + 20 |V.y|` for a
  risen sun. sources are the irradiance volume (scaled by `envLightIntensity`) and the shadowed sun
  through a phase mix that `rayleighMieLerpFactor` moves from a Henyey–Greenstein lobe (g 0.854) to
  Rayleigh, with less sun let in at grazing incidence; the scene behind adds to both by
  `sceneColorEnvInfluence`. the column takes the sun the way the atmosphere fog does, raw colour
  times intensity. the sun's shadow is looked up 2 m off the surface along the waves' horizontal
  tilt, which dapples it.
- **caustics**: the caustic map, planar in world xz on the ground under the water, twice (the second
  mirrored in z) and distorted by the waves, brighten the scene behind by the fog's sun ·
  `causticOpacity` between `causticStartDepth` and `causticEndDepth` of thickness, fading out by 50
  m of view depth.
- **sun highlight**: GGX off a normal whose vertical part is scaled by `dirSpecNormalScaler`, which
  widens the glitter path, times the sun's specular intensity, aimed at the nearest point of the
  sun's disc, plus multiple scattering.
- **reflection**: water is written into the inputs of the game's
  [screen-space reflections](lighting.md#screen-space-reflections) and reflected through that same
  pass: the reflected ray is stretched to the screen's edge, so it has no reach limit in metres,
  with its edge and head-on fades. the sky reflection fills in (normalised the same way as on
  surfaces, scaled by `envLightSpecularIntensity`) where the march finds nothing. the environment
  BRDF weighs it, with f0 = 0.08 · `specular` and f90 = saturate(4 · `specular`).
- **fog and composition**: the surface's own light (highlight, foam, reflection, column) is fogged
  at the surface's distance; the scene behind, already fogged, shows through by the column's
  transmittance, and the fog's in-scatter covers the rest. where the march hits, the colour then
  leans towards the reflection by its weight times the column's opacity and the fog's transmittance,
  so deep water mirrors its surroundings.
- **shore**: `distanceEdgeBlendFactor` fades shallow water into what's under it; at a distance the
  thickness counts less at grazing angles.

## WaterProxy and WaterDecal

no static InitChunkData renderer uses an `HGRP/WaterProxy` or `HGRP/WaterDecal` material, so water
in static scenery is only the surfaces above. both arrive through prefab content. `HGRP/WaterProxy`
has only the water pipeline's passes (top-down prepass, wetness mask, depth, the water G-buffer),
none of which a scene renderer draws in the main view; ten map02 river meshes carry it
(`M_river_proxy_22`). WaterDecal boxes put foam on pools and channels at the foot of waterfalls.
