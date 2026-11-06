# interactives

the placed gameplay objects: switches, doors, chests, campfires, collectibles, harvestable plants,
shops. this page covers where their models come from and the looks their view states settle in. how
clips store their poses is in [animation.md](animation.md); what sets an interactive's runtime state
(server, scripts, progression) is in [scene-states.md](scene-states.md).

## placements and models

an interactive's model comes from four sources:

1. LevelData files (from LevelConfig `levelDataPathHashes`) place them. the sequential prefix up to
   the interactive list holds, per interactive: interactive id, `createState`, position, rotation,
   scale, `modelScale` (0 = no override), and the per-component parameters (keyed by the game's
   interactive component type). `createState` 0 means created with the level.
2. `Data/Json/Interactive/InteractiveTable.json` maps each interactive id to a template and each
   template to its data file. many ids share one template: the Wuling switch variants all
   instantiate `int_switch_wuling`.
3. the template `Data/Json/Interactive/InteractiveData/data_<template>.json` (pooled MemoryPack).
   its leading component is the model component (model id and scale). its last members are the
   [variant table](#the-variant-table), keyed by interactive id, whose entries can override the
   model id.
4. `Data/Json/GameplayConfig/ModelTable.json` maps each model id to a prefab path and `scaleFactor`.

a placement's model is its variant's, else the template's. a variant whose model override is enabled
but empty has no model of its own, rather than the template's. templates without a model (triggers,
logic) have nothing to draw. a model that is a doodad-group shell draws nothing itself; one form per
group level attaches to it instead ([doodad groups](scene-states.md#doodad-groups)). templates carry
no display name, only their id.

six of the install's 332 interactive templates have a model-upgrade component
(`InteractiveModelLevelUpComponentData`), which lists model ids in visual-form order and contains
the base model id: `int_system_domain_shop`, `int_system_domain_depot`, `int_doodad_core_recycle`,
`int_system_kite_station`, `int_system_farm_terminal` (placed in map02_lv002 and map02_lv010) and
`int_system_simulation_training` (map02_lv006)
([facility visual forms](scene-states.md#facility-visual-forms)).

### the variant table

between the model component and the variant table sit hundreds of component and action-graph types.
the table is followed only by the template's temporary properties and two flags, and its keys are
exactly the InteractiveTable ids that name this template, other than the template's own id, which is
never a key (this holds for every shipped template). variant entries are 14-member objects in name
order; `Optional<T>` is an object of (enabled, value) for managed `T` and a raw struct (enabled,
padding, value) for unmanaged `T`.

### the LevelData format

LevelData is a sequential format that stores no field lengths, so a field can only be passed by
reading it, and misreading one misframes every later row. polymorphic fields are MemoryPack unions
whose tag indexes the subclasses in name order, with each subclass's members also in name order.
gameplay tags are unmanaged four-byte values.

## interactive view states

a model's runtime looks are view states:
`Data/Json/Interactive/ModelViewStateControllerData/<model id>.json` (MemoryPack, root
`MVSCModelViewStateControllerData`) holds, per animator (`modelName`, `$$ROOT$$` for the prefab
root) and layer, a state machine. each state names an AnimationClip, behaviours (`SetActive`
switches a GameObject by name on or off; others play effects, audio or navmesh changes) and
transitions that wait on blackboard keys. `clipAssetInfos` gives each clip's StringPathHash. an
Animator without a controller of its own takes its clips from these states. a model's `effectIds`
name prefabs its states' `EffectBehavior`s play.

a model whose `ModelTable` row sets `hasModelViewData` and names another model in
`dependModelViewDataId` has no file of its own and uses that model's view states (the field sits on
the table's `ModelData` and on the interactive model component). eight rows do: the small campfire
(`int_campfire_smaller`, the full campfire's prefab at 0.8 scale, placed by the
`int_campfire_v2_smaller` variant in Dijiang's central hall at 0, 0.9, 57.1), recycling station
forms 2–4, the long erosion pops 2–4 and the common chest (`int_trchest_common_normal`, on
`int_trchest_common_low`'s states). all but the campfire borrow states written for a different
prefab.

a layer starts in its `isStartingNode` state and takes the first transition whose conditions all
hold (`comparison` 0 =, 1 >, 2 <, 3 ≥, 4 ≤ against a bool, float, int or trigger value, `isInvert`
negating it); a transition without conditions is taken when its state's clip ends. a layer comes to
rest in a state none of whose transitions holds. later layers of one animator override earlier ones.

a settled state's look is its clip's end pose plus its `SetActive` switches, unless the clip loops:
then it keeps playing, as the balloon's tube sways through its 14 s idle
(`A_interactive_balloon+1_001_01_idle_01`). a facility's visual forms are models with view states of
their own: the monitoring terminal's forms 1–4 (`int_system_kiteStation_<n>_postmodel`) rest in an
`Initial` state whose loop (`A_anm_fac_syspoikitestation+1_001_01a`…`01d`) flies the kites, and form
0 has no clip. when each placement's loop starts is unknown. how clips store poses, switches and
material values is in [animation clips](animation.md#animation-clips).

### keys the player sets

some blackboard keys follow the player:

- **`Distance`**: an interactive with a main-character interest component
  (`MainCharacterInterestComponent`) measures, every frame, the distance from the player's position
  to its entity and sets `Distance` true while it's at most the component's
  `main_character_interest_distance` (talosites: 15 m), false beyond; it sets it once when it starts
  too. that the distance is a plain 3D one is assumed; the helper measuring it isn't read.
- **`InZone`**: a campfire sets it while the player is inside its trigger (the template's
  `TriggerObserverComponent`, a sphere of `radius` 2.5 m), but only once it's activated. inside, it
  swaps the trigger's radius for a second value held at runtime, so leaving takes another distance.

keys that only fights or the server set (`InBattle`, `isDead`) have no offline value.

### template animator parameters

an interactive's template can set its model's [Animator](animation.md#scenery-animators) parameters
as it loads: a simple-animator component (`SimpleAnimatorComponentData`) and, in the template's
action map, an on-start chain (`OnEntityStart`) of `SetAnimatorBool` actions whose value is a
constant (`paramSource` 0), a config property (200) or a saved property (300). six templates have
such a chain.

The Hub's comm terminal (`int_001_comm_terminal`, row `2100130029` in
`map01_lv001_lv_data_sub_e1m3`, under the hanging sculpture at −26.4, 98, −373.6) is the only one
with a saved bool placed in The Hub: it sets `seamless` from its config property (false) and `fixed`
from its saved property (false in the template), then fires `switchState`, which plays a one-shot
transition on the second layer. the base layer of `int_001_comm_terminal_controller` starts on
`error_idle`, the red crosses on the pedestal, and rests on `normal_idle` while `fixed` holds
(`seamless` selects a third pair). no mission, level script or table names the terminal or sets
`fixed`, so the server sets it; the user reports it's fixed once the story is done.

## talosites

the talosites (`int_collection_trstar_postmodel`, white; `int_collection_trstar_high_postmodel`,
blue; template `int_collection_trstar`, a `TreasureStar` component) are effect prefabs: three
crystal shards (mesh particles holding one particle each), a 2D star icon, billboard glows, a light
column and a ground glow. their `FX` layer rests in `IdleLoop` while the player is beyond 15 m, and
plays `InteractStart` into `InteractLoop` within it (`Distance`), returning through `InteractEnd`.
idle dims the glows below their saved values (the blue bubble `glow02` to a third of its
`_TintColorAlpha`) and holds the shards' pivots at 0, so they cluster; near brightens the glows and
moves the shards' pivots apart, and scales the star icon up 1.8×. the white model reuses the blue
model's clips but for its own activation start.

## campfires

a campfire's template has a campfire component (`InteractiveCampfireComponent`). its model
(`int_campfire_postmodel_v2`) has two animators with three layers between them, testing three keys:
`Enabled` (the player has activated it, from the player's saved activations), `InZone` (the player
stands in it) and `InBattle`.

| layer                                     | not activated        | activated, nobody near | player in it | in a fight  |
| ----------------------------------------- | -------------------- | ---------------------- | ------------ | ----------- |
| model (`P_interactive_campfire+1_003_01`) | `CloseIdle` (folded) | `Open_Idle` (unfolded) | `Open_Idle`  | `Open_Idle` |
| color (same animator, VAT clips)          | `Empty`              | `Empty`                | `On`         | `Off`       |
| effect (`P_interactive_campfire_effect`)  | `Locking`            | `Working`              | `Using`      | `Stopping`  |

the effect prefab holds one group per look: `moren` (the locked look: red and blue rings, a text
ring, a glow column), `shouquan` (two slowly turning rings), `yunzhuan` and `duankai`, plus
`qiehuan*` bursts for the transitions between them. the prefab as saved has every group switched on,
so drawn as saved it shows all of them at once, including the transition bursts' heat-haze cylinders
(`HGRP/Effect/VFXRefract`). `Locking` leaves only `moren`'s resident effects on; `Working` only
`shouquan`'s rings (its `lizi` sparks and, in `yunzhuan/qiehuan2`, the leftover of the switch burst,
are particles).

## interactive doors

a door's template has a door component (`InteractiveDoorCommonComponent`, or Dijiang's
`SpaceshipRoomDoorSystem`), and its model's states include a settled state (a clip, and every
transition waits on a condition) whose clip is an open idle (`…openidle…`). its closed state is
where the open one returns to: its one transition, then any unconditional states, up to the next
settled one. a Dijiang room door goes `built` → `built_to_unlocked` → `unlocked`; a Power Plateau
gate `on_idle` → `on_to_off` → `off_idle`. what opens each door is in
[doors](scene-states.md#doors).

## telescopic bridges

`int_telescopic` is a bridge that extends out of a wall in pieces. its template's logic controller
has `logicType` 8, an int `state` property (0 retracted, 1 extended) and a `pieces` config property
(3; a placement's own `pieces` would override it, but no map01 placement sets one). its prefab's
root has a MonoBehaviour (`InteractiveTelescopicPostmodelMono`) naming four children: the start
port, the end port, the horizontal track and a platform piece, plus the piece's length (4 m), width
and thickness. the piece is switched off in the prefab: the game draws copies of it, never the piece
itself, so its saved position (5.3 m out) means nothing.

all offsets are along the prefab root's +z, with n pieces of length L:

| part       | retracted (`state` 0)       | extended (`state` 1)               |
| ---------- | --------------------------- | ---------------------------------- |
| start port | as saved                    | as saved                           |
| end port   | at the start port (0, 0, 0) | (0, 0, n·L)                        |
| track      | switched off                | switched on, local scale (1, 1, n) |
| copies     | switched off                | copy i at (0, 0, i·L), unrotated   |

each copy's Animator plays its open idle state when extended, which raises the piece's rails (bones
below the piece), and its close idle state when retracted. the prefab as saved is neither: its end
port sits 13.35 m out with no pieces between. what sets `state` is in
[telescopic bridges](scene-states.md#telescopic-bridges).

## Wuling bridges

the `int_bridge_wuling` template covers two kinds of bridge. its own model,
`int_bridge_wuling_90_postmodel`, and the `_78` and `_102` variants' models are drawbridges: a leaf
that an animator raises and lowers (`closeidle`, `<angle>_open`, `<angle>_openidle`, `<angle>_close`
clips on `int_door_base_layer`, keyed by the int `state` property). the `_12m`, `_18m`, `_24m`,
`_24m_02` and `_94m` variants are magic bridges that appear with an effect: each variant's model
override is enabled but empty, and its `Comp_InteractiveCommonPerform` diff properties set
`use_dynamic_res` true (and a `model_id` naming `int_bridge_wuling_<length>_postmodel`, which
nothing in that component reads). the bridge itself is a DynamicStreaming prefab row of that model
at the placement; with `use_dynamic_res` set, the interactive's common-perform component takes its
view controller from the DynamicStreaming entity named by its `dynamic_entity_id` property instead
of its own model, so its `state` switches that row's `on`/`off` states (`SetActive` on the deck
copies, effects on the way). the magic bridge's model has no clips. that the empty model override
alone keeps the game from loading the template's drawbridge there is inferred from the data; the
model component's loading isn't read.
