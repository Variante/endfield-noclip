# environment

how the viewer blends the environment that [game-data/environment.md](../game-data/environment.md)
describes at the camera, and applies its wetness.

## environment phases

the package's [phase sections](../extraction.md#environments) retain the game's field names.
`wind` is packed but unused; the other sections feed lighting, sky, fog and post-processing.

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
volume as enabled. checkboxes and phase pinning override this assumption. volume names do not
establish activation ([activation](../game-data/environment.md#activation)).

## weather

### wetness

`rain_wet_surface` ([`shaders/frame.wgsl`](../../packages/viewer/src/render/shaders/frame.wgsl), fed
by [`render/wetness.ts`](../../packages/viewer/src/render/wetness.ts)) wets surfaces as the
[game's deferred lighting](../game-data/environment.md#wetness) does. the one-sided `enableWetness`
blend is `lerpRain` in
[`environment-blend.ts`](../../packages/viewer/src/render/environment-blend.ts).
