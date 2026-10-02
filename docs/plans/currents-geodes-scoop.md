# Currents, geodes and the scoop

A plan for three features built side by side by agents, on pushminer `main` at
`6f1a03b`. Each part is marked in **Status** as it lands. Once approved, this
file is copied to `docs/plans/currents-geodes-scoop.md` and kept there.

## Context

The caves look different and play the same, barrels only scatter things, and a
coin in a corner is a chore. Three features answer that, and you want them
quickly, so they are cut into tracks that share as few files as they can:

- **Currents:** strips of water, lava (East Gallery) and ice (North Vault) that
  carry what lies on them. Some run to a hole and help; some run to a **drain**,
  and what goes down a drain is lost.
- **Geodes:** boulders worth nothing whole, cracked open into gems by a
  barrel's blast.
- **The scoop:** a workshop upgrade in three sizes. It pushes as the blade
  does, and Space (or a pad button) scoops what is at the blade and carries it.

## Decisions made

- **Drains lose things** (your answer). `Stock.banked()` is
  `1 - lying(0) / stocked`, so a coin down a drain stops lying in the cave and
  the cave's share rises without the bank: the cave can always be cleared.
- **A geode's gems are a bonus** (your answer): a source of their own, over and
  above the cave, as a chamber's gold is.
- **The scoop is three sizes** (your answer), worked by Space and a pad button.
- **Carrying or pushing, not both** (mine): with a load up, the blade is
  lifted and only the hull shoves.
- **The autopilot does not buy the scoop** (mine): it cannot work one, and a
  wasted purchase would move the balance gate for no reason.
- **The water needs a renderer release** (found): artshape-render 0.22 has no
  time in the scene shader, no glow and no hook for a game's own shader. The
  shader is built in that package, as track R.
- **"Geode" is already a biome** (`src/geode.ts`, the Deep). The body is
  `GEODE_KIND`, named `'geode'`, and its files are `geode-stones`.
- **Every size, price and speed below is an estimate.** Each builder measures
  and reports; the figures are agreed at landing.

## Tracks

```
S  seams (this session) ──┬── C  scoop      (builder, worktree, port 5196)
                          ├── B  geodes     (builder, worktree, port 5197)
                          ├── A1 currents   (builder, worktree, port 5198)
                          └── R0 water mock (this session) → your choice
                                └── R1 flow material (builder, artshape-render worktree)
                                      └── release 0.23.0 (on your word) → pin moved
                                            └── A2 the currents' look (after A1 lands)
```

Landing order on `main`: **S, C, B, A1, the pin, A2.**

## Rules for every builder

- A worktree each, made from the commit S lands as, and a port each:
  `PUSHMINER_SMOKE_PORT`, which S adds to `playwright.config.ts`.
- Tests first, seen failing. Each new test mutation-checked.
- Run: `npm run check:quick`, `npm run fuzz -- --seeds 1-24`,
  `npm run determinism`, the track's own smoke spec, and
  `smoke/progress.spec.ts`.
- **Do not run** `bench`, `budgets` or `smoke/budgets.spec.ts`: three builders
  at once make a busy machine, and a timing taken on one proves nothing.
- **Write no shared baseline and no existing picture.** Add only the track's
  own new pictures. Report what moved, by how much and why.
- Never commit. Hand back the report the builder agent's definition asks for.
- Add the track's lines to `README.md` and to `CLAUDE.md` (model features, and
  "other features" in the edge-case checklist).

Integration is this session's: check each report against the files, commit on
the track's branch, merge, run `npm run check` on a quiet machine, write again
only the baselines and pictures the change is meant to move, and look at each.
Timing baselines are written only after every builder has stopped.

---

## S: seams (this session, one commit, no behaviour changed)

What three tracks would otherwise collide on.

- `src/economy.ts`: `Save` gains `scoop: number` (run-wide, 0 to 3, default 0),
  and per cave `geodes: number[] | null` (x, y, z triples, `null` for a cave
  just begun, trimmed to a multiple of 3 as `barrels` is) and `drained: number`
  (value lost down drains, default 0). Each has its line in `fresh()` or
  `perCave()` and in `load()`.
- `test/saves/14-scoop-geodes-drained.json`, its `KEPT` and `LANDS` entries and
  its branch in `test/saves.test.ts`; `test/run.test.ts` (scoop carries over,
  the other two start afresh); `src/invariants.ts` (each field in range).
- `src/cave.ts`, types and empty defaults only:
  ```ts
  export type Flow = 'water' | 'lava' | 'ice';
  export interface CurrentSpec {
    id: string;
    flow: Flow;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    width: number;
    speed: number;
    /** Present when it ends in a drain, where what it carries is lost. */
    drain?: { radius: number; depth: number };
  }
  export interface GeodeSpec {
    count: number;
    holds: [GemKind, number][];
  }
  // CaveSpec: currents?: CurrentSpec[]; geodes?: GeodeSpec
  // Cave:     currents: CurrentSpec[]; drains: HoleSpec[]; geodes: { x: number; y: number }[]
  ```
- `src/game.ts`: `Controls.scoop?: boolean`, declared and unread.
- `playwright.config.ts`: the port from `PUSHMINER_SMOKE_PORT`, 5195 without.
- **Check:** `npm run check` green with no baseline and no picture moved. The
  frame cost of each cave (`budgets-baseline.json`, `ms`) is noted here as the
  "before" for every track.

---

## C: the scoop

**What.** `scoop` in the workshop after the blade, three levels. Press with
nothing held: coins, gems and bars in the mouth (a box ahead of the blade, the
blade's width) are taken up, nearest first, up to the level's load. Press
again: they are tipped out ahead at the dozer's speed and a little more.

**Interfaces.**

- `src/economy.ts`: `SCOOP = [{load 0, cost 0}, {12, 250}, {24, 700}, {40, 1600}]`
  (estimates), `scoopLoad(): number`, the offer, `buy`, and `workshopTotal`.
  `DozerSpec` is not touched (drones and tests build their own).
- `src/scoop.ts`, new, headless: `class Scoop` with `held: number[]`, `lift`
  (0 to 1, eased by game time), `take(dozer, bladeWidth, load)`,
  `carry(dozer, bladeWidth)` each step before the world's, `tip(dozer)`; and
  pure `mouth()` and `seat(n, bladeWidth)` for the tests and the picture. Held
  bodies use the physics' own `world.carried[i] = 1`: still alive, still
  counted by the stock, drawn where they are put, and never in `world.load`,
  which is what stops them slowing the dozer (`dozer.ts:122`).
- `src/dozer.ts`: `pushers(spec, out, lift = 0)` raises the blade's boxes.
  Nought is the old behaviour bit for bit, and drones never pass it.
- `src/game.ts`: owns the scoop; events `scooped(count)` and `tipped(count)`.
- Carried bodies skipped in `Foreman.choose` (`tools.ts:535`),
  `Autopilot.lying/best/patch`, `Game.honk` and `minimap.ts`.
  `Autopilot.shop()` skips `scoop`.
- `src/input.ts` (Space: `takeScoop`, `pressScoop`), `src/touch.ts`, `hud.ts`
  and `index.html` (`#scoopButton`, hidden until owned, as the horn's is).
- `src/machine.ts`: `scoopMesh(width)`, kept apart from `MachineMeshes` as the
  blade is. `scene-dynamic.ts`: the `BLADE` group gets a matrix of its own so
  it can rise and tip; at rest it draws as it does now.
- `src/debug.ts`: `state().scoop { size, held }`, `carried` on `bodies()`, and
  `scoop()`, which goes through the input path.

**Acceptance criteria** (`test/scoop.test.ts`, `test/economy.test.ts`).

1. Coins against two walls, which the blade leaves behind, are taken up.
2. A full scoop reaches `spec.maxSpeed`; the same pile pushed does not.
   Both speeds are in the report.
3. Tipped at the hole's edge, the load is banked.
4. Only kinds worth something are taken; never more than the load.
5. With a load up the blade pushes nothing.
6. Three levels, each dearer and larger; an old save loads with none.

**Edge cases.** The hole (tipped in). Leaving with a load: counted lost, never
carried over. Save and reload with a load: the coins are back in their heaps,
the bank unchanged; the load is not saved. A blast and the horn leave a held
body alone. Drones never target one. The last cave with the vein running.
A narrow blade and the widest. Phone: the pad button, tapped.

**Tests and gates.** Fuzzer action `scoop`. Invariants: every held slot is
alive, carried and worth something; nothing is carried that the scoop does not
hold; `held.length <= load`. Determinism hashes `held`. Leaks: `scoop held`,
ceiling 40. Smoke: Space pressed in `progress.spec.ts`; pictures `scoop.png`
and `phone-scoop.png`. Expected to move: `workshop*.png` (a new row), and
nothing else.

**Out of scope.** Drones or the autopilot using a scoop; scooping bricks,
barrels or geodes; saving the load; any other price.

---

## B: geodes

**What.** Kind 8, `'geode'`, worth 0, radius 1.6 (estimate). Each cave has a
few (`hollow` 1, the rest 2 or 3, `deep` 4: estimates), standing on open floor.
A barrel's blast within `CRACK_RADIUS` (about 8) removes the geode and throws
out its gems.

**Interfaces.**

- `src/physics.ts`: the kind. `src/palette.ts`: its colour.
- `src/cave.ts`: `placeGeodes`, run after `placeBarrels` and never fed into
  it, so the barrel spots pinned in `test/barrel-spots.test.ts` do not move.
  Clear of holes, heaps, belts, `spec.currents`, cuttings, lamps and barrels.
- `src/caves.ts`: each spec's `geodes`. Barrels at least as many as geodes.
- `src/economy.ts`: `sourcesOf` gains `geodes()`, **last**, so no source
  already numbered moves. `load()` appends a zero row to a `left` that is one
  short, where today it throws the cave's progress away (`economy.ts:349`).
- `src/stock.ts`: `spawnGeode`, `removeGeode`, `geodeRecord`, `collect`
  returning 0 for it, and `capacityOf` (the kind, and room for every gem).
- `src/geode-stones.ts`, new, headless: `cracked(blast, world): number[]`.
- `src/game.ts`: after `barrels.update`, each cracked geode is removed and its
  gems spawned through `stock.spawn(…, sources.geodes())`; event
  `geodeCracked(x, y, gems)`.
- `scene-dynamic.ts`: a `GEODES` group before `LEGS_GROUP` (mesh from
  `lump(seed)` in `meshes.ts`). `main.ts`, `effects.ts`, `audio.ts`: shards, a
  crack, a note. `debug.ts`: `state().geodes`, `content().geodes`.

**Acceptance criteria** (`test/geode-stones.test.ts`).

1. A blast inside the radius cracks; one outside does not.
2. The gems pay when banked and do not count toward `CLEAR_SHARE`.
3. A chain of barrels cracks every geode it reaches.
4. Down the hole whole: nothing banked, nothing owed.
5. Saved and reloaded: whole geodes where they lay, cracked gems by count.
6. Every file in `test/saves` still lands with its progress kept.
7. Every cave: geodes on floor joined to a hole, clear of everything, and
   never more than the barrels.

**Edge cases.** Left behind with the cave. Drones push one and never crack it.
Carried by a belt or current. The horn and the magnet. Against rock and in
corridors. Every geode cracked at once, at capacity. The last cave.

**Tests and gates.** Fuzzer action `crack`. Leaks: `geodes saved`. Smoke: a
step in `progress.spec.ts`; pictures `geode-stone.png` and `geode-cracked.png`.
Expected to move, and written again at landing: the balance baseline (bodies
in the way, and the seeded stream shifted by their spawning) and the pictures
of every cave. A larger largest radius widens the physics' search: the bench
and the drone gate are expected to hold, and are watched.

**Out of scope.** Cracking by ramming or by drones; the autopilot cracking
them; shell pieces as bodies; geodes on the minimap.

---

## A1: currents and drains

**What.** Each cave has one or two currents, always running, built on the
physics' belt. A drain is a hole that does not pay.

| Cave          | Flow      | Runs to (first proposal) |
| ------------- | --------- | ------------------------ |
| hollow        | water     | the hole                 |
| south-gallery | water     | a drain                  |
| east-gallery  | lava      | a drain                  |
| north-vault   | ice, fast | a hole                   |
| warrens       | water     | a hole, and a drain      |
| west-gallery  | water     | a drain                  |
| deep          | water     | a hole, and a drain      |

The routes are content. The builder draws them on `npm run caves:map` and they
are shown to you at landing; moving one is a few numbers in `caves.ts`.

**Interfaces.**

- `src/caves.ts`: each spec's `currents`. `src/cave.ts`: `buildCave` fills
  `cave.currents` and `cave.drains` (centred just past each drain current's end).
- `src/physics.ts`: `makeWorld(…, holes, drains = [])`; drains follow the holes
  in the world's list, so the hole index the physics already hands to
  `collect` tells them apart.
- `src/game.ts`: `runBelts()` adds every current. A drained body leaves the
  stock, adds to `save.drained`, raises `drained(kind, value, x, y)` and
  persists. The way out's check, which runs only when the bank changes
  (`game.ts:275`), runs on a drain too. `leave()` adds `save.drained` to what
  was lost.
- `src/nav.ts`, `tools.ts`, `autopilot.ts`: a current to a hole is a drop-off,
  as a running belt is; coins on any current are not targeted; only holes are
  ever a place to deliver.
- `scene-static.ts`: a flat strip per current, plainly coloured by its flow,
  and each drain drawn as a hole without its glow. `minimap.ts`: both shown.
  `main.ts`, `effects.ts`, `audio.ts`: a splash, a sound, a note of what was lost.
- `debug.ts`: `content().currents`, `content().drains`, `state().drained`.

**Acceptance criteria** (`test/currents.test.ts`).

1. A coin at the head of a current to a hole is banked, in every such cave.
2. A coin on a current to a drain is lost: bank unchanged, `drained` raised,
   `save.drained` up, and the cave's share risen.
3. A cave whose last coins go down a drain still opens its way out.
4. Every current lies on floor for its whole length and width, clear of the
   way in, the way out, heaps, belts, barrels, lamps and geodes.
5. The way from each heap to its hole never crosses a current to a drain.
6. The dozer and the drones are not moved by a current.

**Edge cases.** Every kind down a drain (a lit barrel, a brick, a geode). Saved
and reloaded mid-cave. A blast across a current. The vein running. Many bodies
on one current at once. Phone: the minimap.

**Tests and gates.** Fuzzer: `onto a current` and `down the drain`, and
`drained` compared on reload. Smoke: a step for each ending; pictures
`current-water.png`, `current-lava.png`, `current-ice.png`, `drain.png`.
Expected to move: the balance baseline, the budgets' terrain counts (a drain is
cut as a hole is), and every cave's picture. **Performance risk:** nothing on a
current ever sleeps; the frame is measured in each cave before and after.

**Out of scope.** Dams; sluices; currents that move machines; currents in
`npm run sim` (the drone gate does not play them, the balance gate does);
sounds that loop; friction by tile.

---

## R: the flow material, in artshape-render

- **R0, this session, first:** a mock of water, lava and ice strips, moving,
  in a dark cave under a headlight, two or three looks of each, put to you.
  Only what you choose is built.
- **R1, a builder in a worktree of `~/projects/artshape-render`**, to that
  repo's own definition of done. The game's clock goes into the `Frame`
  uniform (`renderer.time`, which exists and only grass reads). A scene variant
  compiled when a group first asks draws the chosen looks as pattern kinds,
  scrolled along the mesh by time and speed, with a glow term so lava shows in
  the dark. Files: `src/game/shaders.ts`, `src/game/renderer.ts`,
  `shaders.test.ts`, a new `flow.gpu.test.ts`, the perf scene, README.
  Held: a game that does not ask draws the same frame to the pixel and compiles
  nothing new; the same time gives the same picture; `keep` mode does not
  freeze a flowing group.
- **Release 0.23.0:** tagged and pushed **only on your word**, asked then.
- **The pin:** one commit in pushminer, 0.22.0 to 0.23.0, installed by its tag
  outright, with `npm run look` green and no picture moved.

## A2: the currents' look (after A1 and the pin)

What R0 settled: the renderer gains three pattern kinds, 5 `ripple`, 6 `crust` and 7 `drift`, each reading
its placement's floats as kind, scale, speed and glow, and travelling along the mesh's own +x. The foam at
a stream's banks is the game's: a narrow strip of its own along each edge.

`scene-static.ts` gives each strip the flow material; `main.ts` sets
`renderer.time = game.t`, so a picture is the same every run. Lava gets two or
three flickering lights within the light pool's budget. The pattern moves at
the pace the coins do, said once. The three current pictures are written again
and looked at, a moving check holds that two times differ and one time does
not, and the frame is measured before and after.

---

## What approving this allows

- S, C, B, A1 and R0 start at once; builders run on `sonnet` in worktrees.
- Each landing is committed and merged on `main`, locally. Nothing is pushed.
- The renderer's tag and push, and any push of pushminer, wait to be asked.

## Verification

- Each track: its criteria as tests, seen failing, then mutation-checked.
- Each landing: `npm run check` green on a quiet machine; `measureFrame` in
  each cave against S's figures; every picture written is looked at.
- At the end: the game played headless through all seven caves by
  `smoke/progress.spec.ts`, working the scoop by Space and the pad button,
  cracking a geode and losing a coin down a drain; and `npm run leaks`.
- The report goes through the definition of done point by point for each
  track, and says what could not be verified here (other browsers and GPUs).

## Named, not done

- README and `CLAUDE.md` say five caves; `RUN` has seven.
- `KIND_CAPACITY`, in the checklist, exists nowhere; it is `capacityOf`.
- artshape-render's consumer table has pushminer on v0.16.1.
- Later: dams of rubble, the autopilot cracking geodes, drones with scoops.

## Status

- [x] S seams: `8e071a6`. The full check green with no baseline and no picture moved.
- [x] C scoop: landed. Loads 12, 24 and 40 at 250, 700 and 1600. A full scoop of 24 reaches the engine's top of 11
      where the same pile pushed reaches 9.65. Space is in the line of keys once a scoop is owned. The full check
      green; the three workshop pictures written again for the new row, and nothing else moved.
- [x] B geodes: landed. Radius 1.6, cracked within 8 of a blast; one in the hollow, two or three in the caves
      between and four in the deep, each worth about a twentieth of its cave. Veined in violet, chosen from the
      picture. The full check green; the balance baseline written again (within tolerance, the caves have
      geodes in the way and the seeded stream is shifted), and ten pictures written again for a geode in view.
- [x] A1 currents and drains: landed. Nine currents, seven wide, at 9 (the ice at 13); five end in drains of
      radius 3.5. The full check green. The balance baseline written again: the hollow moved 15.03 to 10.96
      minutes on seeds 1-6, and on seeds 7-12 it is 10.4 with its brook and 10.7 without, so the move is the
      seeded stream's and not the brook's. Five terrain counts each 864 fewer for a drain cut.
- [x] R0 mock chosen (2026-10-01): water A, ripples that glint, with B's foam at the banks; lava A, crust
      over glowing cracks; ice A, a frosted slide with snow drifting. The mock is `docs/plans/currents-mock.html`.
- [x] R1 flow material: built and checked, `74b4c48` on the branch `flow-material` of artshape-render, not yet
      merged or released. Its frame timings were taken on a busy machine and are to be taken again first.
- [ ] 0.23.0 released (artshape-render `ed9b117`, tagged and pushed, 2026-10-01); pin not yet moved
- [ ] A2 the currents' look

## Handover, 2026-10-01: paused for the night

**On `main`, committed, not pushed:** S `8e071a6`, lint `dc53287`, the plan and mock `2a6d282`, the scoop
`af04a37`, geodes `50cafe5`. Each had the full check green.

**In the main checkout, applied and NOT committed: A1, currents and drains.** Everything staged or modified in
the tree is A1 over the scoop and geodes, with what integration added:

- conflicts resolved in `CLAUDE.md`, `README.md`, `scripts/fuzzer.ts`, `src/cave.ts`, `src/game.ts`, `src/invariants.ts`;
- a drain's middle is put on the floor's lattice (`currentToDrain` in `caves.ts`, `drainOf` in `currents.ts`),
  which cured a ragged collar; held by a test in `test/currents.test.ts`;
- the west gallery's current moved to `48, 22` at 340 degrees: where the builder had it, its drain took coins
  off the settling heap with nobody touching anything. `test/slow/currents.test.ts` now holds every cave, left
  alone on four seeds, to losing nothing;
- the drain tests send each kind down one at a time, a geode among them, and the two-hundred test allows a
  body at rest past the strip's end; real geodes are held clear of real currents in `test/geode-stones.test.ts`.

`npm run check:quick` and `npm run test:slow` are green on it. Twenty-odd pictures are written again and every
one was looked at. **Still to do before it is committed:** `npm run check` in full on a quiet machine; the
balance baseline and the budgets' terrain counts written again (both are meant to move) with the figures in the
commit; then the commit.

**Then:**

1. The pin: artshape-render `v0.23.0` is released (`ed9b117`, pushed). One commit here moving 0.22.0 to 0.23.0,
   installed by its tag outright, `npm run look` green with no picture moved.
2. A2, the currents' look. From the renderer: `packFlow(patterns, i * PATTERN_STRIDE, { kind, scale, speed,
glow, second })` from `artshape-render/game/flow`, kinds 5 ripple, 6 crust, 7 drift; the pattern runs along
   the mesh's own +x; set `renderer.time = game.t` each frame; `await renderer.prepare()` after the groups are
   set. Foam at a stream's banks is two narrow strips of the game's own. Lava wants two or three flickering lights.
3. Clear the three worktrees under `.claude/worktrees`, each checked against what landed first.
4. artshape-render's consumers' table: pushminer on v0.23.0, once the pin has moved.
5. `npm run leaks`, and the report point by point.

**Noticed, for you to decide:** the workshop's list now scrolls past four rows, so the conveyor and the drones
are below the fold on a desk; a coin off the corner of a current's end can come to rest beside the drain; the
bucket's lip passes through a lamp without knocking it; the scoop has no sound of its own; the currents are
short (16 to 27 long) and their routes are the builder's, on `npm run caves:map`.
