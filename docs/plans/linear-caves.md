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
| 2     | One cave after another                          | yes           | landed  |
| 3     | Several holes and belts in a cave, in content   | yes           | landed  |
| 4     | Cave shapes: carving beyond ellipses and boxes  | yes           | landed  |
| 5     | Bigger caves, measured first                    | yes           | landed  |
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
  opening and of the tunnel from inside, put to the user. Done: the user
  chose to keep the tunnel an open cutting.

### How it is built

Written on Opus 5.5 against `89001d3`, for Sonnet 5.5 builders working one
after another in this worktree, each checked before the next starts. The
two parts land together as one commit: part A changes the content, so the
pictures are red until part B has redrawn the page. Nothing is committed
between them.

**One refinement to the agreed spec,** agreed by the user: the fade is
worked out from where the dozer is, not from a clock. It is dark by how
far down the way out's cutting the dozer has gone, black at the leaving
line, where the swap happens. It is still dark at the far end of the next
cave's entry cutting, where the dozer arrives, and lightens as the dozer
drives out. This is stepped with the game, so a test sees the same thing
every time. Backing out of the dark lightens it again, and nothing waits on
a timer. So the dozer arrives at the dark outer end of the entry cutting
(criterion 3), and the fade is by position (criterion 8).

#### The shapes

In `src/cave.ts`, replacing `HollowShape`, `Wing`, `Area`, `order` and
`barrelsIn`. A tile rectangle is `[x0, y0, x1, y1]`, inclusive, in tiles
from the grid's corner, as the chambers and walls are now. Everything
else is in world units.

```ts
type Shape =
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; seed: number; rock?: true }
  | { kind: 'rect'; tiles: [number, number, number, number]; rock?: true };

/** A cutting through the rock at the cave's edge: the way out, or the way in. */
interface Cutting {
  /** The tiles of the cutting, from the cave's floor out to near the grid's edge. */
  tiles: [number, number, number, number];
  /** Which way is out of the cave along it, as a unit step: [1, 0], [0, -1] and so on. */
  out: [number, number];
}

interface CaveSpec {
  id: string; // 'hollow', 'south-gallery', 'east-gallery', 'north-vault', 'west-gallery'
  name: string; // 'The Hollow', 'South Gallery', …
  blurb: string;
  biome: 'jungle' | 'ice' | 'lava' | 'future' | null;
  cols: number;
  rows: number;
  shapes: Shape[]; // carved in order; `rock: true` puts rock back (pillars, the lava ring's island)
  holes: HoleSpec[];
  heaps: Heap[];
  vein: Vein;
  cracks: [number, number][];
  belts: { id: string; spec: BeltSpec; cost: number }[];
  entry: Cutting; // always open
  exit: Cutting | null; // null in the last cave
  secrets: Secret[]; // `area` goes
  walls: Wall[]; // `area` goes
  stashes: Stash[]; // `area` goes
  barrels: number;
}
```

- The grid's corner is where Phase 1 put it, with tile `(cols / 2, rows / 2)`
  at the world's origin. Each cave's first hole is at the origin, so a cave
  is laid out from its hole as the five rooms were.
- `EXIT = 64` is a new cell value for the way out's tiles. It is solid until
  the way out is open, and it is checked before `BRICK` in `solid()`.
- `solid(open, revealed, broken)` loses `unlocked` and gains `open`.
- No lamp, barrel or dressing is placed on or beside a cutting's tiles.
  `decorate` skips them, which the mock showed is what keeps a cutting dark.
- `darkness(cave, open, x, y): number` (0 to 1) is how dark it is at a point:
  - 0 outside the cuttings;
  - down the way out, rising from 0 at the cave's floor to 1 at the leaving
    line, three tiles short of the cutting's outer end;
  - down the way in, 0.85 at the outer end, falling to 0 at the cave's floor.
- `pastLeavingLine(cave, x, y): boolean` says whether a point is past that
  line.
- The biome comes from `spec.biome`: `biomeAt` gives that biome, at full
  strength, everywhere in the cave.

#### The run and the save

- `src/caves.ts` exports `RUN: CaveSpec[]`, the five caves in order: the
  Hollow, South Gallery, East Gallery, North Vault, West Gallery.
  `FIVE_ROOMS` goes. Only `main.ts`, the scripts and the tests import it.
- `new Economy(store, run)`.
  - `economy.cave()` is the spec of the cave the player is in.
  - `economy.isLast()` says whether it is the last cave.
  - `economy.open()` is called when the cave is cleared. It opens the way
    out and tells listeners `'exit'`; in the last cave it sets `done` and
    tells `'done'`.
  - `economy.moveOn()` moves to the next cave's id, sets the per-cave fields
    to the new cave's fresh defaults, persists, and tells `'left:<old id>'`.
  - `economy.sources` is worked out from the current cave. With no areas,
    source 0 is the cave, then its chambers, stashes and walls, and
    `sources.area` goes.
- `Save` (in `economy.ts`):
  - It loses `room` and `areas`.
  - It gains `cave: string`, the current cave's id, and `open: boolean`, its
    way out is open.
  - `belts` becomes `string[]`: the ids bought in this cave.
  - `secrets`, `walls`, `wallDamage`, `rubble`, `barrels`, `lampsBroken` and
    `left` are the current cave's.
- **A save without `cave` is an old save**, carried over as follows:
  - Old room `r` becomes the cave `['hollow', 'south-gallery', 'north-vault', 'east-gallery', 'west-gallery'][r]`.
  - Old `left[r]` becomes the new cave's source 0.
  - The old chamber, stash and wall whose `area` was `r` (each room had at
    most one of each) become index 0 of the new cave's, and so does their
    `left`.
  - `belts[r]` becomes that cave's belt id.
  - The next room's gate being open becomes `open: true`, and `done` stays
    `done`.
  - `rubble`, `barrels` and `lampsBroken` start fresh, with `barrels: null`.
  - Every file in `test/saves/` gets a test saying which cave it lands in
    and what it keeps. A save of the new shape is added as
    `test/saves/11-linear.json`.

#### The game

- `new Game(economy, cave, events = {}, arrival?: { speed: number })`,
  where `cave` is `buildCave(economy.cave())`.
  - The dozer starts at the entry cutting's outer end, three tiles in from
    the grid's edge, facing into the cave (against `entry.out`), at
    `arrival.speed` if given.
  - Drones stand by the first hole.
- A cave is clear when `stock.banked(0) >= CLEAR_SHARE`, and then
  `economy.open()` is called.
  - On `'exit'` the way out's tiles open. Whatever lies on them is pushed
    out to the nearest open floor, as a chamber's opening does.
  - Then comes the event `exitOpened(faces, heading)`, where `faces` is
    the mouth's tiles against the cave floor, for the rock burst.
- Each step, if the way out is open and the dozer is past the leaving line,
  the game calls `economy.moveOn()`, then sends the event
  `caveLeft(fromId, lost)`, where `lost` is the coins' worth still in the
  cave. After that the `Game` is finished with. Its owner builds the next
  one, passing on the dozer's speed.
- `game.darkness()` is `darkness(...)` at the dozer, for the page.
- **These go:** gates, sealing, `roomOpened`, `roomSealed`, `warning`,
  `pastGate`, `atGate`, `behindGate`, `sealPoint`, `gateTiles`,
  `gateCentre`, `areaAt`, `order`, wings, `Area`, and in `progress.ts`
  everything but the progress line. The progress line reads like this:
  - `South Gallery: 42% banked · 90% opens the way out`
  - `… · the way out is open`
  - `the cave is cleared`
- **What the owner does on `caveLeft`**: build the next cave and game.
  Every owner does the same, so the scripts share a helper in
  `scripts/run.ts`: `onward(game, economy, run, events) => Game`. The page
  does its own, since it has to swap the scene too (part B).

#### The five caves

To the sketch maps in "The agreed spec", with hauls held so that no heap
is more than about 1.5 times its room's old distance from its hole: 45 in
the Hollow, 80 in the South Gallery and North Vault, 160 in the East and
West. Belts carry the far heaps as the sketches show them. Heaps, gems,
loot, wall grades, belt prices and barrel counts are as they are today.
Each cave keeps its old vein and cracks, moved to suit the new layout.

`test/caves.test.ts` gains a checker, run over every cave in `RUN`:

- every heap, chamber mouth, stash and the way out can be reached by the
  dozer from the entry, with the walls down and the way out open;
- every heap's middle is within its cave's haul limit of the nearest hole,
  measured along the floor (the nav's `toHole`), or within 12 of a belt's
  start;
- no heap, belt, lamp or barrel stands on rock or a cutting;
- each cave fits its grid, with two tiles of rock round the edge.

A failure names the cave and what is cut off or too far.

`scripts/cave-map.ts` writes each cave as a PNG top-down map: floor, rock,
holes, heaps, belts, walls, chambers and cuttings. It goes to a folder given
on the command line, so the caves can be looked at against the sketches.
It is written with no image library: a tiny PNG writer using zlib from
Node, in the script.

#### The tools

- **Autopilot:** it learns to drive to the way out once it is open, and on
  through the cutting.
- **Fuzzer:** it gains "drive to the way out" (by the autopilot's route)
  and rebuilds its game on `caveLeft` through `onward`.
- **Invariants:** the save's cave is in the run; every per-cave list is its
  cave's size; nothing alive lies outside the grid or inside rock; the way
  out is open exactly when enough is banked, or the cave is done.
- **Balancer:** it plays the run cave by cave, and reports minutes per cave,
  purchases and bank.
- **`balance:check`:** it holds the first two caves, as it held the first
  two rooms.
- **`sim`:** it takes `--cave <id>` in place of `--room`.
- **`leaks`:** it plays through caves, rebuilding on `caveLeft`.
- **`determinism`:** it plays through at least one cave change on each seed.
- **`physics-bench`:** it uses the East Gallery, whose belt runs through a
  heap as the old bench's did.

#### Part A: the game without the page

Everything above, and `main.ts` changed only as far as it must be to
compile and run the first cave, with no swap, fade or new words: part B
does those. Done when:

- the acceptance criteria 1 to 7, 9 (the game and world side) and the
  checker are unit tests, seen failing first;
- `check:quick` is green;
- `npm run fuzz -- --seeds 1-24` is clean, with at least one cave change
  on most seeds (counted and reported);
- `npm run determinism` is green;
- `npm run leaks` is green;
- the five caves' PNG maps are written, for the checker of part A to look
  at against the sketches;
- `npm run balance` has been run on seeds 1 to 12, with its figures reported,
  and the baselines not yet written.

The pictures, the smoke test and the two baselines are expected red, and are
part B's.

#### What part A showed, and part A2

Part A was checked on Opus 5.5. The five maps match the sketches. Four
findings sent it round again before the page is touched.

**Pacing, measured on seeds 1 to 12**, the thorough and rushed autopilots,
each capped at 90 minutes. The old game was run on the unchanged base,
`8b8d0f6`, with its full balance run. Minutes per cave are medians:

| Profile  | Build    | Finished | Run  | Hollow | South | East | North | West |
| -------- | -------- | -------- | ---- | ------ | ----- | ---- | ----- | ---- |
| thorough | old game | 11/12    | 71.5 | 16.5   | 19.4  | 19.0 | 10.2  | 5.8  |
| thorough | part A   | 7/12     | 80.4 | 14.9   | 22.3  | 27.8 | 12.8  | 7.5  |
| rusher   | old game | 12/12    | 38.2 | 11.1   | 8.8   | 6.3  | 9.1   | 2.9  |
| rusher   | part A   | 12/12    | 30.0 | 10.4   | 4.5   | 5.7  | 4.4   | 4.6  |
| thorough | part A2  | 12/12    | 59.2 | 11.5   | 12.2  | 15.3 | 11.7  | 5.6  |
| rusher   | part A2  | 12/12    | 28.0 | 10.4   | 4.6   | 6.1  | 4.1   | 2.4  |

**What part A2 found and did.** None of the five thorough runs that did not
finish was stuck: each went on sweeping for loot it could not fetch until
the cap came. A thorough player now leaves once the last 75 s have banked
less than 1.2% of the cave's worth (`DWINDLE_OVER`, `DWINDLE_BELOW` in
`autopilot.ts`). That is a change to the instrument, so the old game's row
was measured with a weaker thorough player than the new rows. The targets
were ceilings, and every cave is under its own, North the closest at 11.7
against 12.2 (it moves about a minute between runs). The worst hauls, against
their limits: Hollow 31/45, South 75/80, East 151/160, North 71/80, West
150/160. The leaks ceiling for `patches swept` is 523, worked out from the
largest cave (the real peak was 62). `check:quick` takes 20.8 s on an idle
machine, and 34 to 39 s with a balance run alongside.

**The user's decisions on it (2026-09-30):**

1. **The haul limit holds for every heap, with no exception for a belt.**
   The plan had let a heap past the limit count if a belt carried it, and
   read "a West hall of about 110 tiles" beside "1.5 times today's
   distance", which cannot both hold. That was the plan's fault. The West
   hall had heaps about 380 from the hole against 160. The user chose to
   **shorten it to the limit**: about 45 to 50 tiles long, keeping the
   pillars and the belt. The South Gallery's far heap (145 against 80) and
   the East Gallery's top heap (165 against 160) come in too. The checker
   loses its belt clause: every heap's middle is within its cave's limit of
   the nearest hole, along the floor.
2. **The thorough player is brought to no more than about 1.2 times the
   old game in each cave,** by tuning the layouts, the East ring and the
   South lobes above all. The targets, in median minutes on seeds 1 to 12,
   are: Hollow 19.8, South 23.3, East 22.8, North 12.2, West 7.0. At least
   as many seeds finish as did before (11 of 12). That comes first; the
   pacing baseline is written only after it holds (part B).

**Also found, and put right under the house rules:**

3. **The leaks gate's `patches swept` was loosened** from "must not still
   be climbing" to a flat ceiling of 400. A looser rule is not allowed. The
   map is the autopilot's, rebuilt with each cave, so it is bounded by the
   floor it can sweep. The ceiling becomes that figure, worked out from the
   largest cave in `RUN` in the script, with the reason beside it, and
   `test/leaks.test.ts` holds the figure to the caves. The ceiling
   explains the bound; it does not make room for a leak.
4. **Four tests failed under load and passed alone:**
   - the autopilot's full-size dozer;
   - "holds together played at random" in `game.test.ts`;
   - "hold of a game just begun" in `invariants.test.ts`;
   - "works in each of the caves" in `run.test.ts`.

   Each takes 3 to 4 s, and they went over vitest's 5 s limit while another
   run was using the machine. Each is made cheaper, or moved from
   `check:quick` into the full check (as a script or a separate vitest
   project). A test is not given a longer timeout to hide it. The hook stays
   under half a minute, and its time is reported.

5. **The five thorough runs that did not finish are looked into first.** For
   each, find what the autopilot was doing when the cap came: stuck, looping,
   chasing something it cannot reach, or simply slow. If it is the
   autopilot, fix it with a unit test for the case, and measure again,
   before tuning any layout against its figures.

**Part A2 is done when:**

- the checker, without its belt clause, passes on every cave;
- the maps are written again and looked at against the sketches;
- the thorough autopilot is shown competent on the seeds that failed;
- a balance run on seeds 1 to 12 meets the targets in 2, with the table
  above filled in for the new build;
- the leaks gate and the tests in 3 and 4 are put right;
- `check:quick` is green three times running with the machine busy (a
  balance run alongside it);
- fuzz 1 to 24, `determinism` and `leaks` are green.

#### Part B: the page, the pictures and the gates

- **The swap in `main.ts`:**
  - `let game`, and nothing destructured from it once;
  - on `caveLeft`, build the next cave and game, `renderer.setStatic` its
    static scene, forget the track marks, clear the effects and blasts,
    move the camera to the dozer, and hand the API the new game;
  - the swap is timed in the page and logged.
- **The fade:** a black layer over the page, with its opacity set from
  `game.darkness()` every frame.
- **The arrow** points at the way out once it is open, and at the nearest
  hole while it is off screen and the way out is shut.
- **The note** says "the way out is open", and on arrival says the cave's
  name and blurb, with what was left behind.
- **The rock burst and dust** on `exitOpened`, from the chamber's effects.
- **The workshop** lists this cave's belts.
- **`window.pushminer`:**
  - `openExit()` in place of `openNext()`;
  - `content()` gives the current cave's id, name, holes, heaps, belts and
    cuttings;
  - `state()` gives the cave id, `open` and `darkness`;
  - the smoke tests' `SaveSetup` takes `cave` and `open`.
- **Smoke test:** `smoke/progress.spec.ts` clears the Hollow through the
  API, then drives the controls into the cutting and out into the South
  Gallery. It checks the cave's id and the darkness on the way, and a
  reload after arriving.
- **Pictures:**
  - `look.spec.ts` gets a scene for each cave, the way out opening, inside
    the cutting, and arriving, plus the phone scenes;
  - the room scenes become cave scenes, and the gate pictures go;
  - `npm run look:update` writes them again, and every one is looked at.
- **Gates:**
  - `balance:check --update` after 12 seeds, with the swing explained;
  - `sim:check --update` after a 16-seed look at each cave;
  - `bench` held to its tolerance, or written again if the scene changed,
    with the reason given.
- **Performance:**
  - `measureFrame` in each cave, and in the cutting, against the old rooms'
    figures (hollow 3.1 ms, room 1 4.4 ms);
  - the swap under 1 s;
  - the West hall's frame, the nav rebuild time and the camera's reach.
- **The full check** is green: `npm run check`, look, fuzz 1 to 24, and
  leaks.
- **Mutation checks** on the new tests, as the definition of done asks.
- **CLAUDE.md and the README** are updated: rooms become caves, gates and
  sealing go, the way out is described, and the edge-case checklist's
  "sealing" and "rooms" lines are rewritten.

#### Status

- [x] Part A built and checked
- [x] Part A2: hauls, pacing, leaks gate and slow tests put right
- [x] Part B built and checked
- [x] Committed

**Settled at the commit (2026-09-30):** every start, a new game or a
reload as well as an arrival, begins at the dark outer end of the way in
and lightens as the dozer drives in. The user chose this, as built, over
starting a new game on the lit floor.

#### Handover, 2026-09-30: paused for quota

The user paused the session here, to pick up after a quota reset. What
stands, and how to go on:

- **Commits on `linear-caves`:** `a68df5b` is the plan, and `89001d3` is
  Phase 1. Nothing of Phase 2 is committed. Nothing is pushed.
- **The working tree** holds Parts A and A2, built and checked, and Part B
  half begun. It is 75 files changed from `89001d3`. The whole tree is
  snapshotted, without touching the index or the files, at
  `refs/snapshots/phase2-paused` (`93756e9`). `git diff 89001d3 93756e9`
  shows it all. The snapshot is only a record: clear it once Phase 2 has
  landed.
- **One staged change is the A2 builder's own:** `git mv test/balance.test.ts
test/slow/balance.test.ts`, which moved a slow test out of the quick
  check. Keep it.
- **Part B's partial work is unverified and unreviewed.** It is the files
  changed after A2 was recorded:
  - new: `src/aim.ts`, `test/aim.test.ts`, `smoke/swap.spec.ts`;
  - changed: `index.html`, `src/progress.ts`, `src/hud.ts`, `src/debug.ts`,
    `src/camera.ts`, `src/cave.ts`, `src/scene-dynamic.ts`,
    `smoke/progress.spec.ts`, `smoke/pushminer.ts`,
    `test/progress.test.ts`, `test/cave.test.ts`, `test/scene.test.ts` and
    `test/machine.test.ts`.

  The builder was writing tests first when it was stopped. **`check:quick`
  is red** on the typecheck: `debug.ts` now takes the game and cave as
  getters (`() => Game`, `() => Cave`), which is right for a game that is
  swapped, and `main.ts` (lines 636 to 637) still hands it values. On A2
  alone it was green, with 343 tests.

- **To go on:**
  1. Start a Sonnet 5.5 builder on Part B with the same brief as before.
     The brief was: read Phase 2 of this plan, build "Part B" to its
     done-list, test-first, look at every picture, write the gates on the
     wider seeds, measure performance, update CLAUDE.md and the README,
     report through the normal hand-back.
  2. Tell it the partial files above are a start that it must review, not
     trust.
  3. Check what it hands back on Opus against the files, as Phase 1 and
     A2 were checked. A report can go astray: A2's did, sent to a name that
     does not exist, and was read from the end of its transcript.
  4. Ask the user before committing. Phase 2 lands as one feature commit,
     with the balance and sim baselines and the pictures written in it, and
     said so.
- **Worth knowing:**
  - Old-game figures to compare against are in the pacing table above.
  - `check:quick` takes 20.8 s idle and 34 to 39 s with a balance run
    alongside. The house bar is half a minute. The user settled it: the
    half-minute bar holds on an idle machine only.
  - The thorough autopilot's new rule for leaving (`DWINDLE_OVER`,
    `DWINDLE_BELOW`) makes it a stronger player than the one the old
    figures were measured with.
- **A builder left two shell loops running** after A2, found and killed at
  the pause. Each waited on `until ! pgrep -f "mutate.py"`, which matches its
  own command line and so never ends. Tell a builder to wait on a process id,
  and check for leftovers (`ps` for `sleep` and `pgrep` loops, not only node)
  when it hands back.
- **Outside this worktree:** the main checkout
  (`~/projects/pushminer`, on `8b8d0f6`) has another session's uncommitted
  work: physics 0.8.0, render 0.22.0, a `TUNING` line in `makeWorld`, and
  pictures written again. It is not ours. Merging `linear-caves` into main
  will conflict in `src/physics.ts`: keep their `tuning` line.

---

## Phase 3: several holes and belts in a cave

Agreed with the user on 2026-09-30, with Phases 4 and 5, from sketch maps.
Built on Sonnet 5.5 after `5e55b13`, checked on Opus, then committed and
pushed on `linear-caves` before Phase 4 starts.

### What

- **The North Vault gets a second hole** in its far cavern, among its heaps.
- **The East Gallery gets a second belt,** along the bottom of the ring,
  from the bottom heap toward the hole, with a price of its own (about the
  first belt's).
- **The workshop names each belt by where it runs,** from a `label` on the
  belt in the content: "Conveyor, top of the ring" and "Conveyor, bottom of
  the ring". The old single-belt names read as they do.
- **Each belt's drop-off is drawn where it ends**, a small mark on the
  floor at its end, so it can be seen where a belt delivers.
- **The drones take each coin to its nearest hole along the floor.**
  The spread first specified here (not sending two drones to one hole when
  another was nearly as near) was built and measured, and it cost the
  drones about a third of what they bank: in the North Vault, two drones
  over 120 s on seeds 1 to 16 banked 694 spread against 1,003 not. The user
  chose nearest hole, with no forced spread (2026-09-30). Each drone keeps
  to the hole it was given with its coin (`Bot.hole`), since in the North
  Vault the neck would otherwise turn it round.
- **The arrow**, as Phase 2 made it, points at the nearest hole. That
  already holds.

### Acceptance criteria

1. The North Vault has two holes. Something pushed down either is banked,
   in the game and in the page (smoke).
2. The East Gallery has two belts, each bought on its own in the workshop,
   each listed by its label. Both run once bought, and a save keeps which
   are bought.
3. Each running belt draws a drop-off mark at its end. It is gone when the
   belt is not bought.
4. With two drones in the North Vault, each coin goes down the hole nearest
   it along the floor. The sim figure `hole share` (the smaller hole's share
   of what was banked) is kept as a measurement, held both ways to its
   baseline like the other figures, not as a target.
5. The pictures show two holes and two belts, each looked at.

### Edge cases

- **The hole:** two holes, each with its lamps, rim, pulse and collar;
  something falling between them goes to one or the other.
- **Save:** a save with the East Gallery's first belt bought (the Phase 2
  shape) loads with the second not bought. A save of the new shape joins
  `test/saves/`.
- **Drones:** covered by criterion 4, and a drone sent home goes to the
  first hole.
- **Scale:** two belts running at once, both carrying.
- **Phone:** the workshop's longer belt names fit at phone width.
- **The end:** not reachable; neither cave is last.

### Tests and gates

- Unit tests for criteria 1 to 4, seen failing first.
- A smoke step that banks down the second hole, and buys and runs both
  belts.
- A fuzzer action to buy each belt (the fuzzer already buys; check it
  reaches the second).
- A sim scenario, `north, two holes, two drones`, with the new figure.
- A look scene with the North Vault's two holes, and one with the East
  Gallery's two belts running.
- The pacing and drone baselines are written again, since hauls get
  shorter: balance on 12 seeds, sim on 16 seeds. The commit says so.
- `measureFrame` in the North Vault and the East Gallery, against Phase 2's
  figures (2.7 to 2.8 ms).

## Phase 4: cave shapes

Built after Phase 3 is pushed, on the same terms.

### What

- **Two new shapes for carving,** in `Shape` in `src/cave.ts`:
  - `{ kind: 'tunnel', points: [x, y][], width, seed }`, a winding path of
    floor through the points (tiles from the grid's corner), its width
    wobbling a little along it, from the seed;
  - `{ kind: 'cavern', box: [x0, y0, x1, y1], seed, fill }`, floor shaped
    by noise from the seed inside the box. `fill` (0 to 1) is how much of
    the box is open, and it is carved as one connected piece: any pocket not
    joined to the biggest is left as rock.
  - Both take `rock: true` as the others do.
- **Every shape carves only its own box** (an ellipse its bounding box, a
  tunnel the box round its points and width). The carved cells of every
  existing cave are unchanged, which a test holds by comparing each cave's
  cells before and after, hashed. Building the 4× cave from the measurements
  should drop from about 124 ms, and the figure is reported.
- **Noise comes from the seed alone,** from `noise.ts` or `hash`, never
  from `Math.random`, so a cave is the same every build.
- **The Warrens** is a new cave, in `RUN` between the North Vault and the
  West Gallery, id `'warrens'`:
  - jungle, about 1× the East Gallery's area;
  - five noise caverns joined by winding tunnels, as the sketch shows;
  - two holes, in two of the caverns;
  - no belt;
  - a side room behind a brick wall off one cavern, and a hidden chamber;
  - richer gems, emeralds and sapphires, with the prices as they are.
- **Haul limit:** 120 along the floor. The cave checker holds it, with all
  of the checker's other rules.
- **Old saves:** a save in the West Gallery (the Phase 2 shape) still
  loads into the West Gallery. The run's order changes, but ids are kept, so
  it lands by id.

### Acceptance criteria

1. A tunnel through given points carves a connected path of about the given
   width, the same every build from the same seed, and a different one from
   another seed.
2. A cavern carves one connected piece of about `fill` of its box, the same
   every build, with nothing carved outside the box.
3. Every existing cave's cells are the same as before the change, hashed.
4. The Warrens passes the cave checker. Its map is written and looked at
   against the sketch.
5. The run plays through the Warrens in the fuzzer and the balance run, and
   the smoke test can reach it by a save.
6. Every shape carves only its own box, measured on the 4× test cave.

**What the build showed, and the user's decision (2026-09-30).**

- **Carving was not the slow part.** On the 4× test cave, carving went from
  6.5 ms to 0.67 ms with the cells identical. The whole build stayed at about
  100 ms, because about 95% of it is `placeBarrels`, which checks every tile
  against every lamp and heap. The "124 ms carve" in Phase 5's table was the
  whole build. Criterion 6 is restated as above, and `placeBarrels` moves
  into Phase 5's swap budget.
- **The Warrens was the heaviest cave to draw:** 5.8 ms a frame at its hole,
  against 2.7 to 4.1 ms elsewhere. It had 3,924 props (the next most was
  1,892), 149 lamps (next 116) and 360,702 terrain vertices. The noise
  caverns' ragged edges carry dressing and lamps all along them. They are
  thinned until the Warrens draws no heavier than the heaviest existing cave
  from the same views.
- **The Warrens was slow to clear:** 16.3 min for a thorough player and 10.2
  for a rusher, on seeds 1 to 12. The user chose to bring it to the East
  Gallery's pace, about 12 to 13 min thorough and 5 to 6 min rushed, with
  lighter heaps: fewer coins, the same gems, the same layout, no belt.
- **Phase 5's frame budget is set per camera view.** The South and East
  Galleries already pass 4.4 ms from the highest camera.

### Tests and gates

- Unit tests for criteria 1 to 3 and 6. The checker covers 4.
- The balance baseline is written again only if its first two caves move.
  They should not; the full run's figures, with the Warrens, are reported.
- A look scene for the Warrens, and the phone.
- `measureFrame` in the Warrens.

### How the fixes landed

The work paused part way through the fixes and was picked up again. What
came of them, from the fixes' builder, checked on Opus:

- **The Warrens' heaps are 440 coins each,** with the gems as they were.
  On seeds 1 to 12, a thorough player takes 12.4 min in the Warrens and a
  rusher 6.2 min. The response to heap size is jumpy, because the cave is
  gem-heavy and the way out needs 90%. The tries were:

  | Coins a heap | Thorough (min) | Rusher (min) |
  | ------------ | -------------- | ------------ |
  | 160          | 13.2           | 9.6          |
  | 320          | 11.8           | 8.5          |
  | 400          | 12.4           | 4.8          |
  | 420          | 12.8           | 6.8          |
  | 440          | 12.4           | 6.2          |
  | 480          | 12.1           | 6.3          |
  | 800          | 14.3           | 6.1          |

- **The Warrens is dressed less densely.** It has `lampSpacing: 18` and
  `dressing: 0.6`, options on `CaveSpec` whose defaults leave every other
  cave's lamps and props identical, which hashes hold. The counts:
  - lamps from 149 to 84;
  - props from 3,924 to 2,463;
  - feature lights from 81 to 50.

  Smoother cavern edges were tried and put back: they cut vertices by 1%,
  and moved a crack and a chamber face into rock.

- **Frame times now match East and South in every view:** 4.5/4.7/5.3 ms,
  against East's 4.5/4.8/5.2, at the hole, at the heaps and from high,
  interleaved. The earlier 5.8 against 3.5 at the hole did not come back
  when measured again. The thinning rests on the counts, not a measured
  gain, and Phase 5's frame gate needs a finer instrument than
  `measureFrame`'s 0.1 ms.

## Phase 5: bigger caves

Built after Phase 4 is pushed, on the same terms. Measured before it was
agreed, on made-up caves (one big oval, heaps spread along it), three runs
each, in Node on this machine. These are estimates:

| Size (× East)   | Tiles  | Bodies | Carve  | Terrain | Nav    | New game | Step at rest |
| --------------- | ------ | ------ | ------ | ------- | ------ | -------- | ------------ |
| 1× (112 by 60)  | 6,720  | ~1,500 | 13 ms  | 74 ms   | 4.7 ms | 246 ms   | 0.95 ms      |
| 2× (158 by 85)  | 13,430 | ~3,000 | 16 ms  | 242 ms  | 5.6 ms | 491 ms   | 1.9 ms       |
| 4× (224 by 120) | 26,880 | ~5,900 | 124 ms | 209 ms  | 12 ms  | 964 ms   | 3.9 ms       |

Most of the swap is the new game, mostly its heaps settling, which grows
with the coins, not the area.

### Changed by what Phase 4 found (2026-09-30)

- **Building a cave is mostly `placeBarrels`** (about 95% of about 100 ms
  on the 4× test cave), not carving. It is part of the swap, so it is in the
  swap budget, and the first lever if the swap is over.
- **The frame budget is relative, per camera view,** not the old game's 4.4
  ms. `measureFrame` resolves 0.1 ms, and the machine's state moves every
  cave together by more than the caves differ; the South and East Galleries
  already pass 4.4 ms from high. So the gate measures every cave interleaved
  in one run, in three views (at the hole, at the heaps, from high), and
  holds each cave's median to the worst of the caves as they stood before
  this phase, the Warrens included, in that view. The allowance is set from
  the wobble measured on the unchanged caves, many rounds, and written
  beside it. The gate is seen to fail against a cave made heavier on
  purpose. A finer instrument (GPU timestamps, or more samples) is used if
  the wobble is too wide to catch a real difference.

### What

- **Budgets, each held by a gate** in `npm run check`, with a baseline and a
  tolerance measured as the house rules say:
  - the swap, in the page, under 1 s in the biggest cave;
  - a frame, relative and per view, as above;
  - the terrain's vertex count per cave, held exactly, and its build time;
  - the nav's rebuild time in the biggest cave.
- **If the swap is over budget:** settle big heaps in fewer steps, or place
  them already settled, whichever is measured to do it without changing
  what the heaps look like at rest beyond the look tolerance. A worker
  building ahead is left for later, and said so.
- **`BODY_CAPACITY` and `KIND_CAPACITY` become the cave's**, in its spec
  and worked out from its heaps with room for the vein and rubble. The
  renderer's capacities are sized to the largest cave in the run.
- **The camera at full zoom-out:** look at the biggest cave there. If the
  shadows run out inside the picture, limit the zoom, or widen the shadows'
  reach, whichever keeps the frame in budget, and say which.
- **The Deep** is a new cave, id `'deep'`, the new last cave, after the
  West Gallery:
  - future biome, about 2× the East Gallery's area;
  - a great hall with pillars and rock islands, and winding side passages
    carved with Phase 4's shapes;
  - three holes and two belts;
  - a side room and a hidden chamber;
  - the richest loot, diamonds and gold bars, with the prices as they are;
  - the vein and cracks at the end.
- **The West Gallery** gains a way out, and gives up the vein and the
  end to the Deep.
- **Haul limit for the Deep:** 160 along the floor, checked by the cave
  checker.
- **Old saves:** a done save (`done: true`) in the West Gallery stays done
  where it is: finished players are not sent on. A save in the West Gallery
  not done goes on to the Deep through the new way out, as anyone would.

### Acceptance criteria

1. Each budget above has a gate that fails when the thing is made slower or
   bigger on purpose (seen failing) and passes as built.
2. The swap into the Deep is under 1 s in the page, measured.
3. Every cave's frame passes the relative gate in each view, the Deep
   included, and the Deep's frame and swap are reported beside the others.
4. The capacities are each cave's. The Deep at capacity does not drop what
   its heaps need.
5. The camera at full zoom-out in the Deep: picture taken, looked at, and
   what was done about it said.
6. The run plays through to the Deep's end in the fuzzer and the balance
   run, and the old done save stays done.

### Tests and gates

- The pacing baseline's first two caves should not move, and are checked.
  The whole run's figures are reported.
- Pictures of the Deep, its hall at full zoom-out, and the phone.
- Leaks through the whole run, with the Deep's bodies inside their ceilings.

### How it landed (2026-10-01)

The work paused part way, and was picked up again by two Sonnet builders side
by side, one on the page and one in Node, each in a worktree made from the
paused tree. Their work was merged and checked on Opus.

- **The gates, each seen failing against a fault put in on purpose:**
  - `npm run budgets` holds each cave's terrain vertices exactly, and its
    terrain and build times and the nav's rebuild in the biggest cave, as
    multiples of a reference sum timed beside them. It is now part of
    `npm run check`.
  - `smoke/budgets.spec.ts` holds each cave's swap, and its frame in three
    views, against the worst of the caves before this phase.
  - It does not catch a doubled cheap scan in `placeBarrels`, since a cave
    builds in 1 to 3 ms, inside the slack, but it does catch the expensive
    per-tile checks coming back (+325%).
  - The frame gate catches a cave about twice as heavy as the worst, but not
    less: a Deep with twice its lamps and dressing passed. A finer instrument,
    GPU timestamps, would be needed to do better.
  - A fault found at the merge: `budgets --update` wrote only its own figures,
    which took away the page's swap baseline. It now keeps what else is in the
    file.
- **The Deep** is the new last cave: a future-biome hall with pillars and rock
  islands, side passages, three holes, two belts, a side room and a chamber.
  Its worst haul is 157 against 160. The West Gallery gains a way out, and a
  done save there stays done.
- **The swap into the Deep** is 526 to 553 ms in the page, under 1 s, with no
  lever pulled. Every cave's swap is 335 to 553 ms, most of it the page's
  rebuild.
- **The nav's rebuild** in the Deep went from 14.1 ms to 5.0 ms, and the
  Warrens' from 2.8 to 0.9. There is now one pass for each hole, with the
  nearest-hole and drop fields made from those, which gives identical fields
  in every cave. The drone gate is unchanged.
- **Each cave has its own body capacities,** and the renderer is sized to the
  largest in the run.
- **The camera at full zoom-out:** the shadow box covers the whole view, and
  the sun lights nothing, so nothing was changed.
- **Skipped by the user's choice:** the hour-long leaks run, the 12-seed
  balance run, fuzz on 24 seeds, 16-seed sim runs, and re-looking at pictures
  that did not move. The full check ran once, as one command, with its own
  fuzz, `leaks:check`, balance gate and budgets.
- **Open:** one unit test failed once, unnamed, in the Node builder's first
  run, and passed in every run after.

## Phase 6: new biomes

One feature each, on the pattern of the four there are (`biomes.ts`: rock,
floor, dressing, air particles, feature lights, lamp colour, and a picture).
Ideas to put to the user: fungal, flooded, crystal geode, desert ruin,
clockwork.
