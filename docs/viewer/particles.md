# billboards and particles

how the viewer plays the billboards and particle systems that
[game-data/assets.md](../game-data/assets.md#particle-systems) describes.

## billboards

rows of a billboard chain ([assets](../game-data/assets.md#billboards)) turn to the camera on the
GPU. when an instance block is uploaded, `markBillboardRows`
([`render/instance-rows.ts`](../../packages/viewer/src/render/instance-rows.ts)) sets their
`RowBillboard` bits by chain run, and `row_basis` in `frame.wgsl` multiplies the stored rotation by
the camera's (`Facing`) or by its heading about the vertical (`Upright`) in every mesh and effect
vertex stage, shadows included. the cull and LOD tests use the stored bounds, which already hold
every orientation.

the package stores each row at its renderer's own position, so a renderer away from the billboard's
origin turns in place rather than swinging around it as the game's hierarchy would. billboard modes
1–3 all play as `Upright` about the world's vertical, which is their axis only on upright
placements.

## particles

a chain draw that names a particle system ([package format](../package-format.md#particles)) makes
its instance an emitter: the emitter culls and streams its geometry like any instance, but its
bucket takes the rows of its live particles instead of its own
([`render/particles.ts`](../../packages/viewer/src/render/particles.ts)). `ParticleField` keeps
`min(maxParticles, 1024)` rows per emitter in the instance buffer, using the emitter's block origin,
and rewrites them once per frame the emitter is selected. so every mesh shader draws particles
unchanged, and shadow and effect passes need nothing of their own. a system whose start colour isn't
white writes it into its rows (`ROW_COLORED` in
[`render/instance-rows.ts`](../../packages/viewer/src/render/instance-rows.ts)), where it multiplies
the mesh's vertex colours in the mesh and effect shaders. emitters take as many rows as one lifetime
of emission can hold, up to the cap. systems the packer froze into a single particle
([particle systems](../game-data/assets.md#particle-systems)) aren't emitters: they arrive as plain
mesh instances.

each particle follows in closed form from its emission time and random values hashed from the
emitter's place, the system and its index, so any moment can be evaluated on its own:

- emissions are the rate's steady stream (one every `1 / rate` seconds, a random rate taking its
  mean) and each loop's bursts (count rounded, each fired with its probability), within the window
  the longest lifetime reaches back; non-looping systems stop emitting after one duration. the
  newest live ones that fit the rows are kept. with a ring buffer a particle stays until newer ones
  replace it, so the window reaches back far enough for that many emissions; past its lifetime it
  shows its end (or replays its loop range).
- a texture sheet picks each particle's frame from its start frame plus its age (over its lifetime,
  or by frames per second), and its row at random, by mesh index or fixed, or plays the whole grid.
  the tile goes into the row's info word next to its kind (`rowInfo`), and `sheet_uv` in
  `frame.wgsl` remaps the mesh's UVs into it in the mesh and effect vertex stages; other rows carry
  a 1×1 sheet, which leaves UVs alone.
- start values read their curves at the emission's place in its loop. the shape gives the start
  position and direction (cones towards the matching point of their far end, volumes anywhere up to
  their length), placed by the shape's own transform.
- at age `a` a particle has moved `(start speed + linear velocity) · m · a`, where `m` is the
  velocity module's speed modifier and a world-space linear velocity is first turned into the
  emitter's frame, plus `½ g a²` down the world's y (Unity's gravity, 9.81 m/s² times the gravity
  modifier) and the radial push times `m`, then turned about the orbit's centre by `ω · m · a`.
  turning the whole path is exact when the rest of the motion runs along the orbit's axis. the mesh
  is then offset by the system's pivot, scaled by the particle's size and turned with it.
- size is the start size times the size over lifetime at `a / lifetime`; rotation is the start Euler
  angles (Unity's Z, X, Y order) plus the angular velocity times `a`, applied in the emitter's frame
  (Local), the world's (World) or the camera's (View, so the meshes turn with the camera, as the
  game's do).
- a renderer with several meshes is several emitters at one place; they share their random values,
  so each draws the particles that picked its mesh.
- a linear velocity curve is integrated over the age (Simpson's rule). drag slows the start velocity
  alone, by `k v` or `k v²` (k the amount, times the cross-section `π (size / 2)²` when it scales
  with size), and gravity falls towards the matching terminal speed; the velocity module's own terms
  and orbits aren't slowed, and the size is the start size.
- colour is the start colour (read at the emission's place in its loop) times the colour over
  lifetime, blended in the authored colour space, then made linear into the row's colour word.
- quads turn by the render mode: billboards with the camera (their rotation rolls them), vertical
  ones with its heading, horizontal ones lie flat facing up, and stretched ones lie in the view
  plane along the velocity as the camera sees it, their length the size times the length scale plus
  the speed times the velocity scale, centred on the particle. the transform's scale doesn't size
  the particles under the `Shape` scaling mode.

modules not listed above (forces, noise, collision, sub-emitters, trails, lights, custom data and
the by-speed modules) are ignored, so systems that enable them play without their effect rather than
not at all. systems the packer can't make playable at all arrive as stand-ins
([package format](../package-format.md#particles)): one mesh or camera-facing quad at the emitter in
the [unsupported](materials.md#unsupported-materials) checker.

the game's random sequence can't be reproduced, so particles start elsewhere than in the game with
the same distributions. looping systems are evaluated as if they had played since long before the
package opened; others start when their emitter is first selected. particles move by the time of the
frame that renders them, so they hold still while the view does, like the effects' scrolling
textures (`continuous` keeps them moving).
