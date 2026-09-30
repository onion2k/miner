# Linear caves

A plan for turning the one cave of five rooms round a hole into a run of
caves, one after another, each with its own hole or holes. Written on
Opus 5.5 against commit `8b8d0f6`, on the branch `linear-caves` in the
worktree `../pushminer-linear-caves`. Each part is marked as it lands.

## The aim

The game now is one grid, 104 by 64 tiles, with the Hollow and its hole in
the middle and four rooms out from it, north, south, east and west, behind
gates. That caps it at four ways out, and a bigger room is a longer drive
back to the one hole.

After this, the player clears a cave, drives into its way out, and arrives
in the next cave, with a new hole. The cave behind is gone; nothing of it is
kept or returned to. What that opens up, each a feature of its own once the
ground is laid: caves of any shape, bigger caves, several conveyors in one
cave, several holes in one cave, and new biomes.

## Words

- **cave**: one level. Today the word means the whole map; after Phase 2 it
  means one of a run.
- **room** or **area**: today, one of the five parts of the map behind a gate.
  After Phase 2 a cave has no gates inside it, and a cave is what is cleared.
- **run**: the caves in order, from the first to the last.
- **way out**: where a cleared cave is left from (see Phase 2 for how it
  looks, which is put to the user first).

## Decisions made

Taken on judgement, as asked; each can be put back to the user.

1. **Each cave is its own grid, its own world and its own `Game`.** Moving on
   builds the next cave from nothing. The old one is let go whole, so there is
   no sealing, and nothing about the old cave can grow without bound. The
   physics already takes a list of holes (`WorldOptions.holes`, in 0.1.0 and
   since), and a world is made for a grid of any size.
2. **What the player carries** from cave to cave: the bank, the engine, blade
   and magnet, the drones and everything cosmetic. **What stays with a cave:**
   its belts (bought for that cave, and left in it, as a sealed room's are
   now), its hidden chambers, walls, lamps, barrels, rubble and what is left of
   its heaps.
3. **Clearing is as now:** bank nine tenths of a cave's worth (`CLEAR_SHARE`)
   and its way out opens. The last tenth is the player's to chase or leave.
4. **Holes are a list.** Everything that now aims at "the hole" aims at the
   nearest one it can reach. The drones' flow field (`Nav.toDrop`) is already
   seeded from several places (the hole and the belts), so it takes more holes
   without change of kind.
5. **Belts are a list per cave**, each with an id, each bought on its own.
6. **A biome belongs to a cave**, not to a wing: `biomeAt` stops working out
   how far down a corridor a point is. A cave may later mix two, but not in
   this plan.
7. **The five rooms become the first five caves,** in the order they open now
   (Hollow, South Gallery, East Gallery, North Vault, West Gallery), each
   keeping its biome, heaps, gems, hidden chamber, side room, barrels and belt.
   The user chose to have each cave designed afresh round its own hole now,
   rather than re-laid as the hollow and one gallery (see Phase 2, the agreed
   spec), so the pacing gate is written again from scratch.
8. **Old saves are carried over** (Phase 2): the room being cleared becomes
   the cave of the same name, with what was left of it; what cannot be carried
   over (where rubble and barrels lay, in the old map's coordinates, and which
   lamps were broken) is put back fresh. Said in the commit as a known loss.
9. **The end is as now:** after the last cave its vein runs and its floor
   cracks. An endless run of generated caves is a possible later feature, not
   part of this.

## Phases

| Phase | What                                            | Changes play? | State   |
| ----- | ----------------------------------------------- | ------------- | ------- |
| 1     | The cave as a value, holes as a list (refactor) | no            | landed  |
| 2     | One cave after another                          | yes           | planned |
| 3     | Several holes and belts in a cave, in content   | yes           | planned |
| 4     | Cave shapes: carving beyond ellipses and boxes  | yes           | planned |
| 5     | Bigger caves, measured first                    | yes           | planned |
| 6     | New biomes, one feature each                    | yes           | planned |

Phase 1 is the foundation, built now. Phases 2 to 6 are each put through
`/feature`, with their spec agreed before they are built; what follows for
them is what their spec starts from.

---

## Phase 1: the cave as a value

A refactor that changes nothing a player, a test or a gate can see. It is what
every later phase stands on: today the grid's size, its corner, the hole and
all the content are constants that twenty modules import, so there is no way
to hand the game a second cave.

### What it does

1. **The grid and the holes come from the cave, not from constants.**
   `COLS`, `ROWS`, `ORIGIN_X`, `ORIGIN_Y` and `HOLE` stop being exported.
   `TILE` stays a constant: every cave's tiles are the same size.
2. **Every path that knew of one hole handles a list:** the physics world, the
   drones' flow field, the drones' and the autopilot's aim, the terrain's
   collar and rim, the drawn collar and pit, the hanging lamps over the hole,
   the lighting's hole light and pulse, where a drone is sent home to, and the
   bench and sim scripts.
3. **The content becomes a value, a `CaveSpec`, handed in.** `AREAS`, `WINGS`,
   `ORDER`, `HOLLOW`, `SECRETS`, `WALLS`, `STASHES`, the barrel counts and the
   hole move out of `cave.ts` into a new `src/caves.ts`, as one spec,
   `FIVE_ROOMS`, which is the cave as it is. `cave.ts` keeps the machinery:
   the types, the carving, `buildCave(spec)` and the questions asked of a
   cave (which area a point is in, where a gate is, and so on), each taking
   the cave or spec it is asked about.
4. **Only `main.ts`, the scripts and the tests import `caves.ts`.** The
   economy, the stock, the biomes and the rest are handed the spec, or the
   parts of it they need.

### Interfaces

In `src/cave.ts`:

```ts
/** Where a cave's tiles are: how many, and where the corner of the grid is in the world. */
export interface Grid {
  cols: number;
  rows: number;
  originX: number;
  originY: number;
}
export interface HoleSpec {
  x: number;
  y: number;
  radius: number;
  depth: number;
}

/** A cave, as content: everything `buildCave` needs, and everything the game asks of it. */
export interface CaveSpec {
  cols: number;
  rows: number;
  holes: HoleSpec[];
  hollow: typeof HOLLOW_SHAPE; // the hollow's size and alcoves, as now
  wings: Wing[];
  areas: Area[];
  order: number[];
  secrets: Secret[];
  walls: Wall[];
  stashes: Stash[];
  barrelsIn: number[];
}

export interface Cave {
  spec: CaveSpec;
  grid: Grid;
  holes: readonly HoleSpec[];
  cells: Uint8Array;
  lamps: Lamp[];
  barrels: BarrelSpot[];
  solid(unlocked: boolean[], revealed?: boolean[], broken?: boolean[]): Uint8Array;
}

export function buildCave(spec: CaveSpec): Cave;
export function tileCentre(grid: Grid, tx: number, ty: number): [number, number];
export function areaAt(spec: CaveSpec, x: number, y: number): number;
// pastGate, atGate, behindGate, sealPoint, gateTiles, gateCentre,
// stashCentre, chamberCentre, wallAlongX: the same, with the cave or spec first
export function nearestHole(holes: readonly HoleSpec[], x: number, y: number): HoleSpec;
```

The grid's corner is worked out as now, so tile `(cols / 2, rows / 2)` is
centred on the world's origin; `FIVE_ROOMS` has its one hole at the origin,
so every coordinate in the game is where it was.

Elsewhere, what each module is handed (the names are a guide; the builder
may choose better ones that read like the code round them):

| Module                               | Takes                                                                                          |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `physics.ts`                         | `makeWorld(capacity, solid, grid, holes, random?)`                                             |
| `nav.ts`                             | `new Nav(solid, grid, holes)`; seeds `toHole` and `toDrop` from every hole                     |
| `dozer.ts`                           | the grid, for its rock test                                                                    |
| `terrain.ts`                         | the cave (grid, holes, and `areaAt` through its spec)                                          |
| `lamps.ts`                           | `holeLamps(holes)` in place of `HOLE_LAMPS`: three round each hole                             |
| `lighting.ts`                        | the holes: a hole light and a pulse at each                                                    |
| `scene-static.ts`                    | a collar and a pit at each hole                                                                |
| `tools.ts`                           | the holes: a drone aims at the nearest; `STOP_AT` by that hole's radius                        |
| `autopilot.ts`                       | the cave: nearest hole, and the wings from its spec                                            |
| `biomes.ts`                          | the spec: `biomesOf(spec)` and `biomeAt(spec, x, y)`                                           |
| `impacts.ts`, `walls.ts`, `stock.ts` | the spec's secrets, walls and stashes                                                          |
| `economy.ts`                         | `new Economy(store, spec)`: sources, defaults and offers from it                               |
| `progress.ts`                        | the spec, for names and gates                                                                  |
| `invariants.ts`                      | the cave                                                                                       |
| `game.ts`                            | `new Game(economy, events, cave)`, the cave now required; `botHome(cave, j)` by the first hole |
| `debug.ts`                           | the cave, for the hole and the gates it reports                                                |
| `main.ts`                            | builds `buildCave(FIVE_ROOMS)` and an `Economy(browserStore, FIVE_ROOMS)` and hands them in    |

Scripts and tests take `FIVE_ROOMS` from `src/caves.ts`. A helper in
`test/helpers.ts` (say `newGame(save?)`) keeps the many tests that make a
game from each carrying the wiring.

Hot loops that read `grid.cols` and the like hoist it into a local first, so
the refactor costs the frame nothing.

### Acceptance criteria (written first, seen failing)

In `test/caves.test.ts`, with a small test cave, `TWO_HOLES`, defined in the
test (a single open room, 40 by 24 tiles, a hole at each end, one heap in the
middle, no gates):

1. `buildCave(TWO_HOLES)` gives a grid of 40 by 24 and two holes, and its
   cells match the spec.
2. A `Game` on it runs headless: a coin put over either hole and stepped is
   banked, and the bank goes up by its worth each time.
3. `Nav` on it: a tile beside each hole reads zero to the hole, and a tile
   nearer the second hole reads its distance to that one, not the first.
4. A drone loaded near the second hole aims at the second hole.
5. `holeLamps` gives three lamps round each hole; the terrain has a collar at
   each (floor height held flat inside each hole's collar).
6. `areaAt`, `tileCentre` and `nearestHole` on the test cave give its own
   answers, not `FIVE_ROOMS`'s.

And one that holds the structure:

7. No module in `src/` imports `./caves` but `main.ts` (a unit test that
   reads the sources), and `cave.ts` exports no `COLS`, `ROWS`, `ORIGIN_X`,
   `ORIGIN_Y` or `HOLE` (the typecheck holds that once they are gone).

Each is seen failing before the change: 1 to 6 cannot build or run on the
code as it is, and 7 fails while every module imports the content.

### The check that proves it is only a refactor

- **The figures are the same, not near.** Before starting, record the output
  of `npm run sim:check`, `npm run balance:check` and `npm run determinism`
  (and its hashes) on `8b8d0f6`. After, the same commands print the same
  numbers. The sim and balance gates play the same seeds through the same
  arithmetic, so any difference at all is a bug, however far inside the
  tolerance.
- **The pictures are not written again.** `npm run look` is green against the
  pictures as they are.
- `npm run check` green; `npm run fuzz -- --seeds 1-24` clean;
  `npm run leaks` green; the save corpus test unchanged (the save's shape
  does not change in this phase).
- **The bench** within its tolerance, timed in turn with `8b8d0f6` if the
  machine is busy, and no baseline written.
- **The frame:** `measureFrame` through `window.pushminer` in the hollow and
  room 1, before and after, the same within the wobble.

### Edge-case checklist, for this phase

- **the hole:** every hole collects, in the physics, the nav, the drones, the
  autopilot and the drawing; a cave with one hole behaves bit for bit as now.
- **rooms:** `FIVE_ROOMS` unchanged in every room and biome, the hollow too.
- **save:** unchanged in shape; the corpus loads as before.
- **drones:** sent home by the first hole; aim at the nearest.
- **scale, phone, the end, other features:** unchanged; held by the gates and
  pictures above.

### Mutation checks

Put each bug in, see its test fail, take it out:

- the physics given only `holes[0]`: criterion 2 fails.
- `Nav` seeded from only the first hole: criterion 3 fails.
- a drone aiming at `holes[0]` always: criterion 4 fails.
- `holeLamps` round only the first: criterion 5 fails.
- `lamps.ts` importing `./caves`: criterion 7 fails.

### Out of scope

The save's shape; anything a player sees; belts as a list; biome per cave;
moving on between caves; the physics version (another session is moving it
to 0.8.0 in the main checkout, uncommitted: its `makeWorld` gains a
`tuning` line, which will need keeping when this lands on top of it, a
small conflict in `src/physics.ts`). Nothing in the main checkout is touched.

### Status

- [x] Acceptance tests written and seen failing
- [x] Grid and holes as values, every hole path a list
- [x] Content moved to `caves.ts` as `FIVE_ROOMS`, handed in
- [x] Figures identical, pictures unchanged, check green
- [x] Mutation checks done

---

## Phase 2: one cave after another

The change the user asked for. Put through `/feature`; its spec starts here.

### Shown first

How the way out looks and how the move from one cave to the next plays are
matters of taste, so a mock goes to the user before anything is built. Three
to show, as before-and-after stills or short clips, a few minutes each:

- **a lift cage** at the cave's edge: drive in, the gate shuts, it goes down,
  the next cave is seen from the top of its shaft as the cage lands;
- **a tunnel mouth** that opens in the rock when the cave is cleared: drive
  down it, the screen goes dark along it, and the next cave comes up ahead;
- **down the hole itself**: the last push, the dozer goes over the lip and
  falls, and lands in the next cave. Cheapest; says "linear" plainly.

Also shown: the five rooms re-laid as caves standing alone, as maps.

**Chosen, 2026-09-30: the tunnel mouth.** The user was shown all three as a
storyboard and picked it. A stretch of the cave's edge cracks open when the
cave is cleared, much as a hidden chamber's rock breaks, with dust and
fallen rock, and the gold arrow points at it. The dozer drives down a short
tunnel lit only by its own headlights, and comes out into the next cave. The
lift cage is kept as an idea for a later treat, perhaps the way into the last
cave or a new biome.

**The in-engine mock, seen and agreed the same day.** The mock was drawn by
the game itself: a hidden chamber carved as a tunnel off the South Gallery,
broken open, and driven into and out of. The game has no ceilings, so from
its camera the tunnel is an open cutting through tall rock, and the user
chose to **keep it a cutting**, over narrowing it with taller walls or
roofing it over. What the build takes from the mock:

- **The mouth breaks like a chamber:** a rock burst, then dust.
- **The tunnel is bare.** It gets no biome dressing and no feature lights, so
  the headlights are all that light it. In the mock, the jungle's glowing
  mushrooms inside it lit it up until they were taken out.
- **The fade** goes to black deep in the cutting, over the whole page.

### What changes

- **`CaveSpec` loses the wings, gates and order**, and gains: `id` (a stable
  name, `'hollow'`, `'south-gallery'`, …), `name`, `blurb`, `biome`,
  `entry` (where and which way the machine arrives), `exit` (the way out),
  `belts[]` (each with an `id` and a `cost`), `vein`, `cracks`, and the
  carving (`shapes`: the ellipses and boxes of today, until Phase 4). A cave's
  heaps, chambers, side rooms, walls and barrels as now, with no area index.
- **`src/caves.ts` holds `RUN: CaveSpec[]`**, the five caves in order.
- **The save**, run-wide as now (bank, banked, engine, blade, magnet, drones,
  paint, body, horn, flag, done), and for the cave it is in: `cave` (the id),
  `open` (its way out is open), `belts` (ids bought here), `secrets`,
  `walls`, `wallDamage`, `rubble`, `barrels`, `lampsBroken` and `left`, each
  sized to that cave, emptied when it is left. The fields `room` and `areas`
  go. A save without `cave` is an old one and is carried over as decision 8
  says; a save of the new shape joins `test/saves/`.
- **`Game` is one cave.** Clearing opens the way out; driving into it starts
  the leaving, which plays out in game time (so a test steps through it), and
  ends with a `caveLeft(from, lost)` event. `main.ts` then lets the old
  `Game`, its static scene, terrain, track marks and effects go, and builds the
  next. The drones come along and stand by the entry.
- **The page's side:** the gold arrow points to the way out once it is open,
  and to the nearest hole otherwise if it is off screen; the progress line
  names the cave; the workshop sells this cave's belts.
- **The tools:** the balance script plays the run cave by cave, and its
  baseline is written again (a change meant to move it, said in the commit,
  checked on 12 seeds); `sim` takes `--cave <id>`, and its baseline is written
  again the same way; the fuzzer gains "drive to the way out" and rebuilds
  its game on `caveLeft`; `leaks` plays through caves and holds the page's
  GPU resources flat across twenty cave changes (a smoke test that counts
  the renderer's buffers); the invariants add: the save's cave is in the run,
  every per-cave list is the cave's size, nothing lies outside the grid, the
  way out is open exactly when enough is banked.
- **Pictures:** each cave, the way out open, and the leaving; the old ones of
  gates and sealing go.

### What goes

Gates, sealing, `pastGate`, `atGate`, `behindGate`, `sealPoint`, the wings,
the order, and every event and message about them.

### The agreed spec (2026-09-30)

Agreed with the user through `/feature`. It stands over anything above that
disagrees with it.

**The user's decisions**

- **Layout: each cave designed afresh**, round its own hole, from ellipses and
  boxes, with free placement and no wings. The user was shown sketch maps of all
  five and agreed them **with shorter hauls**: each cave keeps its shape and
  character, but is scaled so no heap is more than about 1.5 times today's
  distance from the hole (today about 30 in the Hollow, about 52 in the South
  Gallery and North Vault, and about 105 in the East and West Galleries).
  The West hall comes to about 110 tiles long, not 175. The sketches:
  1. **The Hollow**, plain: one oval with the hole in the middle and three
     heaps round it. Arrive from the west, leave to the east. Three barrels.
  2. **South Gallery**, jungle: two lobes with the hole at the waist between
     them, one heap in each lobe, the belt from the far lobe to the hole. The
     South Cellar lies behind its clay wall below the waist, and the hidden
     chamber off the west lobe. Arrive at the south-west, leave through the far
     lobe's top.
  3. **East Gallery**, lava: a ring round an island of rock, with lava pools as
     dressing only. The hole is on the west of the ring and the heaps on the
     east, top and bottom, with the belt along the top of the ring. The East
     Annex lies behind its stone wall off the east end, and the chamber off the
     south. Arrive from the west, leave through the north.
  4. **North Vault**, ice: two caverns joined by a narrow neck. The hole is in
     the first cavern and the heaps in the second, with the belt through the
     neck. The North Loft lies behind its stone wall off the second cavern's
     top, and the chamber off the first. Arrive from the west, leave through the
     east.
  5. **West Gallery**, future: a long hall with two rows of rock pillars. The
     hole is at the near end and the heaps at the far end, with the belt along
     the south wall. The West Annex lies behind its iron-bound wall off the far
     end's top, and the chamber off the south. The last cave: it has no way out,
     and its vein runs at the end.

  Heaps, gems, loot, wall grades, belt prices and barrel counts stay as they
  are today, so the cave still holds about 19,000 all told. Each cave has one
  hole; caves with two are Phase 3.

- **The biome fills the whole cave.** `biomeAt` loses the fade in along a
  wing, and the entry tunnel is the cave's biome too.
- **The swap is done in the dark.** The page fades to black deep in the
  tunnel, the next cave is built, and it fades back in. Measured on
  `8b8d0f6` in Node: building the cave takes 4 ms, its terrain about 300 ms
  and a new `Game` about 400 ms (mostly the 90 settling steps), about 0.7 s in
  all. The budget is under 1 s while the screen is black. Building ahead in a
  worker is the step to take if it feels like a loading pause.
- **The way out is at the far end of the cave** from the hole, as each map
  above says.

**Acceptance criteria**

1. The way out is solid rock until the cave is cleared. Ramming it does
   nothing: it is not a hidden chamber.
2. Clearing the cave opens it with an `exitOpened(faces)` event: rock bursts
   and dust, as a chamber's do. The arrow and the progress line point at it,
   and it stays open across a reload.
3. Passing the leaving line in the tunnel sends `caveLeft(from, lost)`. The
   next cave is built, and the dozer arrives at the inner end of its entry
   tunnel, facing in, at the speed it had.
4. What carries over: the bank, engine, blade, magnet, drones and
   cosmetics. What starts fresh in each cave: belts, chambers, walls and wall
   damage, rubble, barrels, broken lamps, and what is left of the heaps.
5. The last cave has no way out. Clearing it ends the game as now, with the
   vein running and the floor cracking.
6. Reloading keeps the player's place: mid-cave, with the way out open, and
   after leaving (they are in the next cave).
7. Every old save in `test/saves` loads into the cave of the room it was
   clearing, keeping what was left of that room, its chamber, wall, side room
   and belt. Rubble and barrels start afresh, since the old map's coordinates
   no longer mean anything, and so do broken lamps. A save in the new shape
   joins `test/saves/`.
8. The page fades to black in the tunnel and back after, timed by game time.
   The swap happens only while the screen is black.
9. Twenty cave changes in a row leave the physics world, the static scene's
   GPU groups, the track marks and the effects no bigger than one change
   does.

**Edge cases**

- **The hole:** holes stay in their own cave. Nothing crosses between
  caves.
- **Leaving with things left over:** whatever is left, lit barrels
  included, goes with the old cave and is counted as lost. A lit fuse never
  goes off in the next cave.
- **Save:** as criteria 6 and 7.
- **Drones:** they stop when the player leaves and are placed by the new
  cave's first hole. They are never put inside the tunnel.
- **Other features:** a blast or the horn next to the way out does not open
  it. Belts are bought per cave. Walls, chambers and lamps belong to their
  own cave.
- **Rock:** the tunnel is carved like any other rock, with no lamps in it.
  Nothing is left inside rock when the way out opens: whatever is on those
  tiles is pushed out, as when a chamber opens.
- **Rooms:** each of the five caves gets a test: open the way out, leave,
  arrive.
- **Scale:** as criterion 9.
- **Phone:** the touch controls drive through the tunnel. The arrow and the
  note fit a narrow screen.
- **The end:** as criterion 5.

**Performance.** The swap is under 1 s while the screen is black. Every
other frame stays inside its budget: `measureFrame` in each cave and in the
tunnel, against today's rooms. The West hall's frame, the drones'
pathfinding time and the camera's reach are measured before the cave is
called done.

**Tests**

- **Unit:** the way out as rock, then opening, then leaving. Moving between
  caves on the economy. Old saves carried over. What carries over and what
  resets. Nothing left inside rock.
- **Play-through smoke test:** `smoke/progress.spec.ts` clears the Hollow
  through `window.pushminer`, then drives the controls into the tunnel and out
  into the South Gallery.
- **Fuzzer:** a new action to drive to the way out and into it.
- **Invariants:** the save's cave is in the run, every per-cave list matches
  its cave, and the way out is open exactly when enough is banked.
- **Pictures:** each cave, the way out opening, inside the tunnel, and
  arriving, at desk and phone width. The gate pictures go.
- **Gates:** the pacing baseline is written again from scratch, played
  through all five caves and checked on 12 seeds, with the swing explained
  and said in the commit. The drone gate takes `--cave <id>` and its
  baseline is written again, looked at on 16 seeds. `npm run leaks` plays
  through the caves.
- **Before the build:** one quick in-engine mock of the tunnel mouth
  opening and of the tunnel from inside, put to the user.

---

## Phase 3: several holes and belts in content

With the machinery in from Phases 1 and 2, a cave with two holes and two
belts is content. The feature is the first such cave, and what the player
needs to use it: the arrow to the nearest hole, the workshop listing several
belts by where they run, each belt's drop-off drawn where it ends, and the
drones spreading their work across holes rather than queuing at one. The sim
gains a two-hole cave, and a figure for how evenly the holes are used.

## Phase 4: cave shapes

Carving beyond wobbly ellipses and boxes: winding tunnels (a path with a
width), caverns shaped by noise from a seed, pillars and islands of rock,
ledges. With it, a checker run over every cave in the run as a unit test:
every heap, chamber, side room and the way out can be reached from the
entry by the dozer; every heap can be pushed to a hole; no belt runs through
rock; no lamp, barrel or heap stands in rock. A cave that fails it is named
with what is cut off.

## Phase 5: bigger caves

Measured before it is agreed. For caves of 1, 2 and 4 times today's area:
the time to build the cave (carving is now every shape over the whole grid,
which grows as shapes times tiles; it will want each shape to touch only its
own box), the terrain's vertex count and build time, the nav's rebuild time
(on every gate or wall), the physics' step with the bodies spread wider, the
static scene's draw, and the camera's reach and fog. Each gets a budget and a
gate before a bigger cave lands. `BODY_CAPACITY` and `KIND_CAPACITY` become
the cave's.

## Phase 6: new biomes

One feature each, on the pattern of the four there are (`biomes.ts`: rock,
floor, dressing, air particles, feature lights, lamp colour, and a picture).
Ideas to put to the user: fungal, flooded, crystal geode, desert ruin,
clockwork.
