# scene states and conditional content

everything that decides whether a piece of authored content is visible: MapConfig scene states and
their quest, mission and variable conditions; the load gates on DynamicStreaming entities;
progression levels (outposts, POI facilities, factory regions); facility visual forms, Dijiang's
cabins, doors and resource-node groups; script-loaded groups; and quest labels. spatial stream areas
(interiors, caves, off-map places) are a separate axis, covered in
[world.md](world.md#stream-areas). the dynamic ECS scene's format and the interactives' models are
in [assets.md](assets.md#dynamic-structures).

## the selectors at a glance

| selector                   | stored in                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| quest / mission state      | read by MapConfig conditions and mission gates                                                          |
| map / global variable      | read by MapConfig conditions and variable gates                                                         |
| MapConfig scene state      | `Data/Json/MapConfig/<map>.json`; referenced by static chunk file names and dynamic visible-state lists |
| mission gate               | `MissionControlComp` on a dynamic entity                                                                |
| variable gate              | `GlobalVarControlComp` / `MapVarControlComp` with `controlLoad` set                                     |
| progression                | resource-group `logicState` bitmask under a settlement / POI / factory-region controller                |
| facility visual form       | interactive template model-upgrade list                                                                 |
| doodad group level         | doodad-shell postmodel's form list                                                                      |
| Dijiang cabin slot         | `ExtraSceneSlot` entity; cabin scenes named by `SpaceshipCabinData.json`                                |
| growth chamber level       | `SpaceshipGrowCabinLvTable` planting fields; planting-box shutters                                      |
| door                       | interactive model view states                                                                           |
| tree harvest state         | resource-group `logicState` on tree entities                                                            |
| script group               | script-control component's default-load flag; level scripts                                             |
| controller-less logic gate | resource-group `logicState` on an entity with no controller                                             |

## MapConfig scene states

the MapConfig JSON has `sceneStates` (state name → index) and `sceneStateConditions`, an ordered
list of `{ stateName, condition }`. a condition is a serialized `ConditionRuntimeBase` identified by
its `$type`:

| `$type` (in `Beyond.Gameplay`)     | fields                                                          |
| ---------------------------------- | --------------------------------------------------------------- |
| `SimpleConditionCheckQuestState`   | `questId`, `compareOperator`, `compareTarget`                   |
| `SimpleConditionCheckMissionState` | `missionId`, `compareOperator`, `compareTarget`                 |
| `SimpleConditionCheckMapVar`       | `belongMapId`, `mapVarName`, `compareOperator`, `compareTarget` |
| `SimpleConditionCheckGlobalVar`    | `globalVarName`, `compareOperator`, `compareTarget`             |
| `CombinedConditionRuntime`         | `conditionOperator` (0 and, 1 or), `reverse`, `subConditions`   |

`CompareOperator`: 0 =, 1 ≠, 2 >, 3 ≥, 4 <, 5 ≤, applied as `value <op> target`. quest and mission
targets are `QuestState` / `MissionState` values: none 0, available 1 (missions only), processing 2,
completed 3, failed 4, disabled 5. `reverse` negates the combined result.

these five classes are the only ones the installed client uses.

### how the game applies them

the client always enables streaming scene state 0, then sets streaming state `index + 1` to each
condition entry's result. a state with no condition entry changes only when the game sets it by
name; dungeons and scripts that reuse the open-world map are the presumed writers. so a state can
be:

- **conditioned**: its value follows quest/mission/variable state
- **condition-less**: off unless something sets it by name, which client data doesn't show

the client holds no player state: quest and mission states and variable values come from the server.

example (map01 in one client build, for illustration):

| index | state                          | condition                    |
| ----- | ------------------------------ | ---------------------------- |
| 0     | `001_normal`                   | quest `e1m8_q#3` = completed |
| 1     | `001_damaged`                  | quest `e1m8_q#3` ≠ completed |
| 2     | `001_overcast_rainy`           | quest `e1m2_q#6` ≠ completed |
| 3     | `001_sunny`                    | quest `e1m2_q#6` = completed |
| 6     | `dung01_rdg008_006_liino`      | none                         |
| 7     | `dung01_rdg008_006_liino_hide` | mission `e0m2` = completed   |

map02's field and flower states read two variables, so they switch together through those, while its
lv009 day/night pair doesn't: day is map variable `State` = 0, and night has no condition.

### where states are referenced

- **static chunk files**: `InitChunkData_<x>_<z>_<sceneStateId>_<areaId>`. `sceneStateId` is the
  MapConfig index + 1, with 0 meaning always loaded; `areaId` is the stream area.
- **dynamic entities**: `RootComp` and each `ResourceGroupWithStateDesc` carry a visible-state list
  (a span of the grid's integer vector) holding MapConfig indices directly, without the +1. the
  resource group's separate `sceneState` field (offset 24) is a different value; the visible-state
  lists are what gate. each visible-state span is followed by a visible-area span in the same layout
  (`VisibleAreaGroup`: `RootComp` +60, resource group +64): stream area ids, any of which shows the
  entity; a list holding area 0, the default area, is shown everywhere.
- **irradiance volume**: besides the base bake, the irradiance index stores bakes for these states
  and combinations of them, which the game selects by its active scene-state mask (see
  [irradiance.md](irradiance.md)).

### what they gate

- **static renderers** in a non-zero scene-state file load while that file's state is on; an entity
  can sit in several files, and one in an always-loaded file always loads. HLOD clusters exist only
  in always-loaded files.
- **environment and post volumes** and **water surfaces** sit in chunk files the same way
  ([environment.md](environment.md), [water.md](water.md)). volumes in prefabs that dynamic entities
  place load with their placement instead ([prefab volumes](environment.md#prefab-volumes)).
- **dynamic entities**: the entity's list and the resource group's list each need one of their
  states on (an AND of two ORs), combined with the entity's other requirements.

### variables

variables are server state and the client ships no defaults for them (map02's
`mapVarClientDefaultValues` is empty), so variable-driven states have no offline value. a load gate
fails while its variable is unset.

at Origin Lodespring (map01_lv006) the crater's light column takes one effect prefab per value of a
global variable (0, 2, 3, 4), and an in-game shot matches 2. the red-ringed spires there are gated
on another variable equalling 9999, a value that reads as a sentinel; the game doesn't show them.
MapConfig names its variables (`mapVarName`, `globalVarName`) while gates use numeric game-variable
ids.

## dynamic load gates

every gate on an entity must pass.

- **mission gate** (`MissionControlComp`): a list of
  `MissionCondition { id, isQuest, state, isSame }`. a condition holds when the quest/mission state
  equals `state` (`isSame` 1) or differs from it (otherwise). `compareType` 0 needs all conditions,
  any other value one. the entity loads while the combined result equals `toBeTrue == 1`.
- **variable gate** (`GlobalVarControlComp`, `MapVarControlComp`): with `controlLoad` 1 the entity
  loads while `variable <compareType> compareValue` holds, and not while the variable is unset. with
  `controlLoad` 0 the variable doesn't gate loading; it drives the entity's level and animator state
  (e.g. a bridge raised or lowered in place).

variable keys are numeric client game-variable ids, not root strings. MapConfig's `mapVarName2NumId`
names a map's variables.

**outpost tiers.** some outposts' per-level scenery (Yinglung Pass's beacon beam, boards and screens
at `stm_hongs_3`) follows the outpost's level through map variables rather than logic-state masks:
one `ResourceWithIdControlByMapVar` owner per level, each loading while its variable equals 1
(`judianEffect1`–`4` on map02). the game sets them from the outpost's level, which client data
doesn't spell out. they share a layout: the outpost's owner id `u`, its factory region at `u + 1`,
then at least two such owners at `u + 2`, `u + 3`, … on consecutive variable ids.

other variable gates are set by the server. Yinglung Pass's energy point towers switch between a red
and a green set on map variable `defenceFnish` (#297, = 0 / = 1), presumably set when its defence
encounter is cleared; no client quest, script or scene state reads it, so it has no link to story
progress.

## progressions

settlements (outposts), POI facilities (Trial of Swordmancy, archery range, inn parts) and factory
regions are DynamicStreaming entities with a `SettlementControlComp`, `PoiControlComp` or
`FactoryRegionControlComp`. the controller's logic state is the progression's level. each
`ResourceGroupWithStateDesc` has a `logicState` bitmask: bit n set means the group is shown at level
n, and 0 means the group ignores logic state. `levelNum` is the LevelConfig idNum of the level the
group belongs to. all variants are stored side by side; nothing is a file swap. variants are mostly
exclusive per level, some groups span several levels, and group counts need not grow with level.

settlements have a main and a secondary controlling entity. whether bit 0 means "unbuilt" or "level
1" is unknown. the player's progress is per facility.

a resource group can carry a non-zero mask on an entity with no controller; nothing in client data
drives that entity's logic state.

trees (entity type 19, no controller) use bits 0/1 for standing/felled under the same mechanism;
that is harvest state, not progression, and the player fells each tree at runtime.

## facility visual forms

stock redistribution facilities (`int_system_domain_shop`), depots (`int_system_domain_depot`),
recycling stations (`int_doodad_core_recycle`) and environment monitoring terminals
(`int_system_kite_station`, in Wuling City and Marker Stone) are placed by LevelData interactive
rows rather than DynamicStreaming. their template's model component
(`InteractiveModelComponentData`) names the base model, and its model-upgrade component
(`InteractiveModelLevelUpComponentData`, `modelLevelList`) lists ModelTable ids in authored order;
each entry is one visual form with its own prefab (a terminal's five forms are its upgrades,
`int_system_kiteStation_<n>_postmodel`). a recycling station's base model is its form 1.

form numbers are positions in that list, not gameplay upgrade levels: how shop channel levels, depot
levels or terminal levels (`KiteStationLevelTable`) map onto the list isn't recovered.

every other interactive has one model (its variant's, else its template's; see
[assets.md](assets.md#interactives)): Dijiang's guest terminal desk and screens, for instance.
[doors](#doors) and [region walls](#dijiang-region-walls) follow runtime state. rows with another
`createState` aren't created from client data: Dijiang's Control Nexus terminal is one, so the
server creates it; its mission condition, `e1m9` completed, only locks interaction with it. some
templates have no data file of their own (the weapon-wall racks, some doors), and some templates
name no model.

## destructible props

map01 and map02's type-20 dynamic destructibles have one resource group with `logicState` 0 and no
controller. they store the intact model, with no destroyed variant to select; destruction removes
the prop at runtime. interactive destructibles are separate placements whose scripts can react to
destruction.

## Dijiang cabins

Dijiang (`base01_lv001`) has four cabin slots, `ExtraSceneSlot` entities (type 29) whose
`ExtraSceneComp` holds a box (corners stored swapped per axis), an origin and a direction; each slot
is stored on two entities with identical components. a cabin is a separately stored scene,
`Data/DynamicStreaming/PC/Extra/<scene>/fb_main_*` with model rows only, named per cabin type by
`Data/Json/SpaceshipCabinData.json` (`cabinSpawnInfos.<type>.dynamicSceneUniqueId`; manufacturing
cabins and growth chambers). a built cabin's rows go to the slot origin, turned by the direction in
quarter turns of yaw; with that convention each cabin's entrance (the start of its NPC walkway, at
local +x) meets the slot's door, and the medium slot's box holds the growth chamber exactly.

each slot holds one cabin type (the room tables allow one type per room). one of the small slots has
no door and no room-table row. a built cabin's room is lit by its own irradiance bake
([region bakes](irradiance.md#region-bakes)).

a growth chamber's level unlocks its planting boxes. each box is a model row whose prefab's script
names a shutter object (`nonTransparentPlate`) that closes the tank's lower half; the game hides it
once the box is unlocked. `SpaceshipGrowCabinLvTable` lists the planting fields each level unlocks
(`unlockPlantingField`: 1–3, 4–6, 7–9). unverified: the fields are numbered in the order the cabin
scene's entity lists the boxes in its resource groups; that order opens the three tanks facing the
console at level 1, as in game. a planted crop and the box's status bar are player state and runtime
UI. the room nameplate above a cabin door and the assigned-operator panel beside it are also
world-space UI, populated from the room's name, level, status and operators; they are not cabin
scene meshes. manufacturing cabins' levels change only runtime state.

## Dijiang region walls

Dijiang's "no entry" walls (`int_system_spaceship_region_wall`, a template with a
`SpaceshipRegionWall` component) each close off a construction area, named by the placement's
`system_inst_key` component parameter in LevelData. the game hides the wall's whole model once the
area is unlocked, and `SpaceshipAreaUnlockNeedCenterLvTable` gives the Control Nexus level that
unlocks each area (`construction_area_1` at 1, `construction_area_2` at 3). `construction_area_3`
and `_4` have no row, so their walls always show in this client.

## doors

door poses are in [assets.md](assets.md#interactive-doors). the game opens doors by gameplay and
server state the client doesn't hold (a Power Plateau gate opens when a level script hears an event
from a mission's cutscene and calls the server).

- a Dijiang cabin's door is open while its slot is built and closed (`unlocked`, its "to be
  constructed" panel showing) while it's empty. the slots don't name their doors; a small slot's
  door stands 9 m from its origin, the medium one's 10.2 m
- Dijiang's reception room door (`system_inst_key` `guest_room`) opens once the reception room is
  unlocked, and that unlock is server-only. the room's level-1 row in `SpaceshipRoomLvTable` has no
  condition, only the text "Progress through the main story to unlock this cabin"; the Control Nexus
  tables don't unlock it; the client gets its unlocked systems from the server, and no client table
  maps a mission to them. no mission or level script unlocks it either. mission `f1m22` (Control
  Nexus level 3) places an NPC in the room, so it's open by then, but that's no link to follow

## doodad groups

resource nodes (ore outcrops, rabbit-hole plant mounds, special stones) are the centres of doodad
groups, placed as interactives (`int_doodad_core_*` variants). their model is an empty shell: a
script on the prefab root names one ModelTable id per group level 1 to 4, and lists one slot
GameObject per level (slot 0 is empty) that the loaded form attaches under. every shell in the
install has identity slots. which slots the prefab leaves active varies (level 4 alone, or all
four), so it says nothing about the shown level. form postmodels carry the same script with every
form empty, so they aren't shells.

the game sets each group's level at runtime from progression that isn't recovered.

## script groups

an entity with a script-control component stores a default-load flag (0 or 1): 0 means a script must
explicitly enable it. the entity's global id (its IdComp `uniqueId`) is what level scripts use to
show and hide it. its leading digits are the idNum of the level that authored the entity (`228…` for
Wuling City, `404…` for a racing dungeon), not necessarily the level it stands in. event content
such as a limited-time race course is among these groups.

### what sets a script group

level scripts (`Data/Json/LevelScriptData/<level>/<script id>.json`) show and hide groups with
`ShowSceneDecorationNew` (also `…WithHandle`, `ForceShowDecorationWithHandle`): a constant
`targetDynamicEntity` (the group's entity id) and a `visible` flag. the client shows a group at the
value a script last set, else at its default-load flag. a script is a graph: `actionList` and
`headerList` nodes by `ID`, linked by `nextID`, `IfElseAction.onTrueID`/`onFalseID` (the guard is
its `condition` param), `CheckBoolIfTrue`/`CheckBoolIfFalse`'s `nextID` (taken only while its
`value` param is true or false, so it guards that edge), switch `caseIDList`/`defaultID` (guard
`value`), branch `idList` and other `…ID` fields. Wuling City's dragon eye glow (map02_lv002, entity
22800080003) is one: the script around it shows it on activation past a `CheckBoolIfTrue` on mission
e10m4 being complete. a header fires only while its `validate` param holds, so a non-constant
`validate` is a guard too. a param is a constant (`paramSource` 0), the current script (1002), a
getter node (`CheckMissionOrQuestIsComplete`, `CompareQuestState`, …) named by `idRef`
(`paramSource` -1), or a `$<id>@_<field>` path into another node's output. headers are the events:

- `ScriptEvent_OnScriptActive` (`…OnScriptStart`, `…OnScriptPreActive`): the script running. the
  server sets script state by progress, and a script runs while the player is inside its start or
  active shape (`startShapeList`/`activeShapeList`: `offset`, `radius`). `ManualStartLevelScript` in
  another script also starts it
- `ScriptEvent_OnLeaderEnterTriggerVolume` (and leave, list): the player entering one of the
  script's `triggerVolumes` (shape `position`, `radius`)
- `EntityEvent_*`: an interactive's event; `targetEntity` names a slot of the script's own
  `interactives` (template `entityDataIdKey`, `position`) or a LevelData placement by logic id
- `LevelEvent_OnQuestStateChanged` / `…OnMissionStateChanged`: a quest event (`filtedQuestId`)
- `ScriptEvent_OnCustomEvent` / `LevelEvent_OnCustomEvent`: raised by `RaiseCustomScriptEvent` (to a
  receiver script) or `RaiseCustomLevelEvent` (to the level) with the same key, so the raiser's own
  causes apply
- stage, property and other events: no client node sets script stages or properties; the server does

scripts of other levels can name a scene's group (dungeons reusing the open world, such as the
racing courses). missions whose objectives check a script (stage, property) drive its activation,
since the server runs such scripts as those missions progress.

### following quest checks on activation

some scripts set a group from quest state each time they run: Power Plateau's fortress gate scripts
show the open gate and hide the closed one on activation, guarded by `validate` = mission `e3m5`
complete, and another shows the plateau's construction props on activation if mission `e3m6` is
complete and hides them otherwise.

### level scripts

level scripts and other MemoryPack game data take their schema from the install's IL2CPP metadata
(`il2cpp_data/Metadata/global-metadata.dat`, version 29) and `GameAssembly.dll`: the generated
`<Type>ForMemoryPack` wrappers' setter properties give each object's members in order, and their
`MemoryPackUnion` attributes the union tags.

## quest and mission labels

missions are defined in `Data/Json/MissionRuntimeAsset/<missionId>.json` (plain JSON; a `_meta` file
beside each holds accept mode and reward). a quest id is its mission id, `_q#` and a step name
(`e1m8_q#3`, `e1m1_q#Deco_showLandslide`); a `d` in an id is a decimal point added later (`e1m9d5`
is mission 9.5). text keys resolve through `TextTable` (key → text id) and `I18nTextTable_EN` (id →
string, with `<@…>…</>` rich-text tags).

- **mission**: `missionName.key` names it; `missionType` (0 Main, 1 Char, 2 Factory, 4 Hide, 5 Misc,
  7 World, 8 WeekRaid, 9 FakeMain, 10 Side, 11 Activity, 12 TBCMain) gives the quest log tab, as the
  client's mission type table groups them (main, side, discovery, events; the rest as other).
  internal flag missions (`hidden*`, `dm*`) have no name. `levelId` is where it takes place; its
  quests can switch scenery of other levels (Valley Pass's fort mission switches The Hub's states).
- **chapter**: `missionChapterBitmask` bit 1 is chapter one, 2 chapter two (texts `chapter<n>_num`,
  `chapter<n>_name`); 4 is indie, without text. prologue missions (`e0m…`) carry chapter one's bit,
  so only their id marks them as `chapter0`.
- **episode**: nothing links a mission to an episode; main story ids `e<n>m…` match the episode
  texts `ep<n>_name`.
- **quest**: `questDic[<quest id>]` holds its objectives; `descriptionOverride` is the mission
  description it shows while running. `mainPathQuests` lists the main flow in order, hidden steps
  included, and gives the step number; a quest off it (`flowIndex` 1, a side branch) starts once its
  predecessors (`prevQuestIdList`) complete. hidden quests (`showMode` 1000, no objectives) exist
  only to drive scenery.
- some ids that conditions name are absent from the client (stale or unreleased), and event day
  locks (`a1m3_q#Day2Lock`) are stages the server times.

missions never change the world themselves: their actions are presentation (radio, guides, chapter
panels) and most objectives are evaluated by the server. the world reads quest state through scene
state conditions, mission gates and level scripts.

## open

- writers of condition-less states: presumably dungeons reusing the map (their own MapConfigs, e.g.
  `dung01_rdg010`, carry conditions) and level scripts setting or overriding states by name; not
  traced
- variable names and offline values: global variables have no known name table, and the server
  values are unavailable
- `ActivityControlComp` gates: on map01 and map02 every entity's component holds no conditions
  (compare type 255), and no level script reads activity state, so limited-time events reach the
  world only through missions and the scripts of event dungeons
- script groups with no client driver: groups whose id equals a level script's own id, ghost-wall
  module decorations (`GhostWallModuleData.outerEffectDecoId`), and ids that scripts reference only
  as animator or attach targets; what shows them isn't traced
- the gameplay-level → visual-form mapping for shops and depots, and the runtime state of other
  interactives
- meaning of progression bit 0 per controller kind, and which entity's state the server sets
