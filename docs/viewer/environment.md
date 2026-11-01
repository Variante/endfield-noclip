# environment

how the viewer blends the environment that [game-data/environment.md](../game-data/environment.md)
describes at the camera, and applies its wetness.

## environment phases

the viewer reads these [sections](../game-data/environment.md#environment-phases), by package key:

| package key     | used for                                                      |
| --------------- | ------------------------------------------------------------- |
| `light`         | sun, exposure, ambient scale, effect directions               |
| `sky`           | ambient SH, reflection cubemap, sky distance, sun disc        |
| `atmosphere`    | sky LUTs, fog absorption                                      |
| `fog`           | atmosphere (distance) fog                                     |
| `heightFog`     | height fog                                                    |
| `volumetricFog` | volumetric fog, and its own height-fog set used while it's on |
| `cloud`         | cloud panorama, cloud shadows                                 |
| `wind`          | —                                                             |
| `lightShaft`    | sun shafts                                                    |
| `colorGrading`  | grading                                                       |
| `autoExposure`  | auto exposure                                                 |
| `shadow`        | sun shadow softness, strength, penumbra ramp, sun-off         |
| `celestial`     | planets in the sky                                            |
| `star`          | star field and nebula                                         |
| `rain`          | rain wetness ([wetness](#wetness))                            |
| `lensFlare`     | the sun's lens flare                                          |

## environment volumes

`eyeInLevelVolume` moves a level's initial viewpoint along its view line until the base volume holds
it fully and no other level's volume does, because neighbours' volumes overlap a level's rectangle.

## scene states

the viewer skips a volume whose visibility group's condition the selected scene values don't
satisfy.

## blending at the camera

[`render/environment-blend.ts`](../../packages/viewer/src/render/environment-blend.ts) follows the
[game's blend](../game-data/environment.md#blending-at-the-camera). a "profile" here is a phase plus
the post profile, not a Unity `VolumeProfile`.

- start from the shown level's base profile.
- visit volumes in ascending priority, then shape kind (global, box, prism), since the game's order
  among equal priorities isn't known.
- time-mode factors are kept per camera in `EnvironmentFades`.
- manual volumes stay off unless ticked in the scene-conditions panel, which previews them at full
  strength, since the scripts that drive them aren't recovered.
- a factor ≥ 1 copies the section. below that, numbers and colours lerp, mode/type fields and
  references switch at ½. the cloud panorama, height-fog flow noise and lens flare follow the game's
  special cases; its other per-section special cases (the precipitation transitions, for one) aren't
  followed.

the "volumes at camera" toggle turns blending off (the base profile alone). a pinned phase replaces
the volume blend with that one phase over the base. per-volume checkboxes override the scene-state
decision either way.

## activation

the package marks every volume `activation: 'unknown'`, and the viewer treats a loaded, non-manual
volume as enabled and leaves the rest to the user's checkboxes and phase pin. keep it that way until
script activation is recovered: filtering volumes by name guesses wrong both ways
([activation](../game-data/environment.md#activation)), and showing an authored state as the default
misrepresents the game more than an honest manual toggle does.

## weather

### wetness

`rain_wet_surface` ([`shaders/frame.wgsl`](../../packages/viewer/src/render/shaders/frame.wgsl), fed
by [`render/wetness.ts`](../../packages/viewer/src/render/wetness.ts)) wets surfaces as the
[game's deferred lighting](../game-data/environment.md#wetness) does. the one-sided `enableWetness`
blend is `lerpRain` in
[`environment-blend.ts`](../../packages/viewer/src/render/environment-blend.ts).
