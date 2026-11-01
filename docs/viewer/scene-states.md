# scene states

how the viewer evaluates and presents the conditional content that
[game-data/scene-states.md](../game-data/scene-states.md) describes. the package's controls and
conditional sets are in [package-format.md](../package-format.md#conditions).

## evaluation

[`viewer.ts`](../../packages/viewer/src/viewer.ts) resolves every control's value when a pick
changes (`resolveSceneValues`), recomputes `conditionVisible` for every set (`conditionResults`) and
turns the results into the shown visibility groups (`groupsShown`), which go to the instance
selector, the local lights, the water renderer, the irradiance regions and the environment blend.

### stream areas

unless the user picks a value, the viewer sets each `area:<id>` control from the camera: it runs the
game's trigger test ([stream areas](../game-data/world.md#stream-areas)) at the eye (`zonesAt`,
`areasShownIn`) and gives the areas shown there 1 and the others 0 (`streamAreaValues`). the
controls' stored default (shown) only holds without a camera.

## the scene conditions panel

[`scene-controls.tsx`](../../packages/viewer/src/ui/scene-controls.tsx) shows the "Scene conditions"
panel:

- **scene states**: a select per state, "Follow game (on/off)" for derived states, else on/off
- **quests and missions**: quests run in order, so progress is picked as a story point rather than
  per quest ([`story.ts`](../../packages/package-format/src/story.ts)). "Main story progress" lists
  the main story's missions in id order (episode, mission, decimal) with a point at each mission's
  start and at each step a listed quest sits at; picking one completes every quest and mission
  before it, sets that step and its mission in progress and leaves the rest not started. each
  mission below, grouped by quest log tab (with chapter, episode and where it takes place), has the
  same "Progress" select over its own steps, and its quests' individual state selects under
  "Quests". rules elsewhere show quests by mission and quest name instead of id. since a mission's
  quests can switch scenery of other levels
  ([quest and mission labels](../game-data/scene-states.md#quest-and-mission-labels)), the panel
  lists a quest for the levels it gates and shows where its mission takes place
- **variables**: a select of ranges, the default marked "(initial)"
- **progression**: one select per progression, "Level n", "Visual form n" or "Group level n";
  facility forms are labelled "Visual form", not "Level", because form numbers aren't gameplay
  levels ([facility visual forms](../game-data/scene-states.md#facility-visual-forms))
- **Dijiang**: a Control Nexus level select, a checkbox per cabin slot, built or empty, and a level
  select for the growth chamber
- **doors**: a checkbox per door, open or closed, or "Follow game" for a cabin's door
- **stream areas**: a select per area, "Follow camera (shown/hidden)", shown or hidden
- **harvest**: standing or felled
- **script / event scenery**, **logic-gate previews**: checkboxes, or "Follow game (on/off)" for a
  script group derived from its scripts' quest checks; a script group lists its drivers ("Shown when
  the player uses …", "Hidden by quest progress: …"), with "Go" flying to a driver's place
- **lighting / environment volumes**: volumes owned by the shown level or reaching into it. a volume
  follows its scene-state condition unless ticked or unticked here, which overrides it.
  scripted-blend volumes (blend mode 3) are off unless ticked. packed volumes carry
  `activation: 'unknown'` because their script enablement isn't recovered (see
  [environment.md](../game-data/environment.md))

every row shows the control's rule and the assumption behind its default. controls are listed where
their `levelTags` include 0 or the shown level's tag. "Reset" drops every pick. the settings panel's
"stream areas at camera" toggle switches every area that follows the camera between following it and
showing. conditional detail ignores HLOD refinement and stops streaming once its tile is below the
screen error threshold ([streaming](streaming.md)).
