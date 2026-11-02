# environment

how the viewer blends the environment that [game-data/environment.md](../game-data/environment.md)
describes at the camera, and applies its wetness.

## environment phases

the package's [phase sections](../extraction.md#environments) retain the game's field names. `wind`
is packed but unused; the other sections feed lighting, sky, fog and post-processing.

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

- start from every section of the shown level's base phase, inactive ones included, plus its post
  profile (`seedProfile`). the scene's global volume and the level's base volume then apply as
  volumes like any other.
- visit volumes in ascending priority, then shape kind (global, box, prism). the game's order among
  equal priorities isn't known, so this tie-break is an assumption. the order and the shape tests
  are
  [`package-format/environment-volumes.ts`](../../packages/package-format/src/environment-volumes.ts),
  which the extractor's [base-environment vote](../extraction.md#the-levels-base-environment)
  shares.
- time-mode factors are kept per camera in `EnvironmentFades`.
- manual volumes stay off unless ticked in the scene-conditions panel, which previews them at full
  strength, since the scripts that drive them aren't recovered.
- a factor ≥ 1 copies the section. below that, numbers and colours lerp, mode/type fields and
  references switch at ½. the cloud panorama, height-fog flow noise and lens flare follow the game's
  special cases; its other per-section special cases (the precipitation transitions, for one) aren't
  followed.
- where the game's lerp of a plain field isn't known
  ([blending](../game-data/environment.md#blending-at-the-camera)), the viewer picks one that keeps
  the value meaningful: the sun's and every effect's direction lerp as pitch and yaw (the yaw the
  short way round), each effect starting from the direction in effect on its side, so directions
  stay unit vectors; the other integer fields (sample counts, the cloud rotation) lerp and round; a
  fog whose `rayleighScatteringScale` defers to the atmosphere's (negative) takes its atmosphere's
  scale before lerping against one that doesn't.

the "volumes at camera" toggle turns blending by position off: the scene-wide global volumes and the
level's base volume apply fully wherever the camera is, giving the level's own look. a pinned phase
goes over that look instead of the volume blend. per-volume checkboxes override the scene-state
decision either way; `volumeApplies` is the one place that decides whether a volume may apply.

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
