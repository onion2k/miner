# Pushminer: working on it

A bulldozer, a cave full of coins, and a hole to push them into. TypeScript,
Vite, and WebGPU through
[artshape-render](https://github.com/onion2k/artshape-render). The README says
what the game is and how it is put together; this file says how to change it
without breaking it.

## Commands

    npm run dev            the game at http://localhost:5194
    npm run check:quick    formatting, types, lint, unit tests (the pre-commit hook; ~15 s)
    npm run check          all of it: check:quick, fuzz, determinism, drone gate, balance gate, physics bench, budgets, smoke (~4 min)
    npm test               unit tests (Vitest, test/)
    npm run fuzz           the game played at random, rules checked (scripts/fuzz.ts)
    npm run fuzz -- --seed N           one failing seed again, with what led up to it
    npm run determinism    the same seed played twice, hashed, to catch chance not from the seed
    npm run leaks          an hour of play, watching what must stay bounded (20 min of it in check)
    npm run sim:check      the drones held to scripts/sim-baseline.json
    npm run balance        the whole game played through by the autopilot: cave times, purchases, bank
    npm run balance:check  the first two caves' pacing held to scripts/balance-baseline.json
    npm run bench          the physics' frame time held to scripts/bench-baseline.json
    npm run budgets        each cave's terrain size and build time, and the nav's rebuild, held to scripts/budgets-baseline.json
    npm run smoke -- smoke/budgets.spec.ts   each cave's swap and frame in the page, held the same way
    npm run smoke          the game in headless Chromium on the real GPU (Playwright, smoke/)
    npm run look           the scenes held to the pictures in smoke/screens
    npm run look:update    the pictures written again, after a change meant to alter them

`--update` on `sim:check`, `balance:check`, `bench` or `budgets` writes a new baseline (`BUDGETS_UPDATE=1` for the page's swap), and
`npm run look:update` writes the pictures again. Only do that when a change is
meant to move the figures or alter the picture, and say so in the commit. Look
at every picture you write; a baseline updated without being looked at holds
the game to whatever it happened to draw that day.

## How the code is laid out

- `src/game.ts` is the game without the picture: everything that happens in
  the cave, a step at a time. It tells what happened through `GameEvents`,
  and knows nothing of the renderer, the page or the sound.
- `src/main.ts` is the page. It turns those events into particles, sound and
  words, and draws the frame. There is no game logic here; if a change needs
  some, it goes in `game.ts` or a module of its own. A `Game` is one cave: on
  `caveLeft` the page swaps (`enter` in `main.ts`) to the next cave's game,
  static scene, track marks and camera, in the dark, timed and logged as
  `swap <id> <ms>`. What the minimap shows, and where, is `src/minimap.ts`'s; `hud.ts` only draws it.
- Currents and drains: a current (`CurrentSpec`, in `caves.ts`) is a belt that
  runs from the start, in the world's belt list; one to a hole is a drop-off
  for the nav, one that ends in a drain is not (`nav.onDrain`), and the foreman
  and the autopilot skip coins on any. A drain (`cave.drains`, `drainOf` in
  `src/currents.ts`) is a hole the world lists **after** `cave.holes`: the hole
  index `collect` is handed tells them apart, `Game.collect` loses what goes
  down one (`save.drained`, the `drained` event) and looks at the way out's
  share again, since the bank has not moved. A drain is never in `cave.holes`:
  nav, the foreman, the autopilot, the tally and the minimap's holes read that
  as where to deliver. Routes are content, and `npm run caves:map` draws them.
- `src/debug.ts` is `window.pushminer`, the test API. `src/invariants.ts` lists
  the rules that must always hold.
- Content (heaps, walls, barrels, lamps, the way in and the way out) is
  built from a `CaveSpec` by `cave.ts`; the five specs, the run, are in
  `caves.ts`. Prices and the save live in `economy.ts`. A cave is cleared at
  `CLEAR_SHARE` banked, which opens its way out: a cutting of rock at the far
  end, solid until then, through which the dozer drives into the next cave.
  The page fades to black by `game.darkness()`, which is by position.

## Model features

What to copy the shape of, when building something new:

- **In the cave:** barrels, geodes, walls, hidden chambers and lamps. Each has
  its unit tests in `test/`, a step in `smoke/progress.spec.ts`, a fuzzer
  action and a picture. A geode (`GEODE_KIND`, `src/geode-stones.ts`, tests in
  `test/geode-stones.test.ts`: 'geode' is also a biome) is the model for a new
  body kind that is `NO_SOURCE` and spawns others: it needs `spawn…`/`remove…`/
  `…Record` in `stock.ts`, a `capacityOf` entry, a case in `Stock.collect` and
  `Game.collect`, a place in `scene-dynamic.ts` and a source of its own, last.
- **A workshop action worked by a button:** the scoop (`src/scoop.ts`, headless;
  `test/scoop.test.ts`, and `test/slow/scoop.test.ts` for how well it pushes),
  through the horn's road end to end: a key in `input.ts`, `Controls` into
  `Game.step`, a pad button in `hud.ts` and `index.html`, an event for the
  page, a fuzzer action, a smoke step by the keys and another by the pad's
  buttons, and pictures. What it holds is `world.carried`, which the physics
  leaves alone, so a new thing that reads bodies skips `carried` as the
  foreman, the autopilot, the horn and the map do.
- **What the machine pushes with:** the blade's pieces or the bucket's
  (`bladePieces`, `bucketPieces` in `dozer.ts`), chosen by `DozerSpec.bucket`.
  The physics pushes with them and the picture is drawn from them, so what
  is seen is what is felt; a shape for one is a shape for both.
- **Currents and drains:** `test/currents.test.ts` (every cave's routes held
  clear of what stands in it, and one cave of each ending played),
  `test/slow/currents.test.ts` (every cave played), a step in
  `smoke/progress.spec.ts` for each ending, the fuzzer actions `onto a current`
  and `down the drain`, and pictures `current-water`, `current-lava`,
  `current-ice` and `drain`. Not fed to the barrel and lamp placers, whose
  spots are pinned by hash. How each flow looks is `FLOW_LOOK` in
  `src/currents.ts`, drawn by artshape-render's flow kinds from the game's
  clock (`renderer.time = game.t`), at `RIDE` of the current's speed.
- **Tools:** the fuzzer (`scripts/fuzzer.ts`) and the drone gate
  (`scripts/sim-check.ts`). Each has unit tests of its own working parts.
- **Test helpers:** `withSeed` in `test/helpers.ts` for chance from a seed,
  and `memoryStore` in `src/economy.ts` for a save that is not the player's.
- **Gate tolerances:** the drone gate allows a quarter of the figure, or a
  slack of one or two; the balance gate a fifth on minutes and purchases and
  15% on the bank; the bench a fifth and 0.05 ms. A swing on 8 seeds is
  checked on another 8 with `npm run sim -- --cave <id> --seeds 9-16`.

## Rules for the code

- **No tight coupling.** A module takes what it needs as arguments or
  options. It does not import game state, and lower modules (nav, tracks,
  terrain) do not import content. `main.ts` is the only place that wires
  everything together. The physics is a package of its own, artshape-physics;
  `src/physics.ts` is the game's side of it (the kinds, and `makeWorld`), and
  nothing else imports the package directly. A change the physics needs goes
  in that repo, with a version bump here.
- **Match the style.** Comments are full sentences in the house voice, saying
  why and not what. Keep names plain. Prettier decides the formatting.
- **Nothing is kept for ever.** A list, map or cache that is added to has to
  be emptied somewhere, and the size it can reach named in `scripts/leaks.ts`.
  `npm run leaks` plays an hour and fails on anything still climbing at the end.
- **Every kind of thing is handled everywhere.** A new body kind, event, save
  field or room has to work in every path it can reach. See the checklist
  below. Most bugs so far were a new thing missing from one of those paths.
- **Save compatibility.** Old saves must still load. A new save field needs a
  default for saves that don't have it, and a save in the new shape added to
  `test/saves/`, which keeps one of every shape the game has ever written. The
  corpus test fails until the new one is there.

## Definition of done

A feature is not done until all of this is true, and the report to the user
says so point by point:

1. **Acceptance criteria written first** as unit tests, or as steps in a smoke
   test, and seen failing before the feature exists.
2. **The edge-case checklist** below gone through, with a test for each case
   that applies.
3. **`npm run check` green.** If the drone gate or the bench moved, explain
   why, check another 8 seeds before believing an 8-seed swing, and only then
   update the baseline.
4. **The play-through smoke test** (`smoke/progress.spec.ts`) exercises the
   feature through `window.pushminer`. The API gains whatever it needs to.
5. **The fuzzer does what a player can do with it.** Add its action to
   `scripts/fuzzer.ts`, and any new rule that must hold to `src/invariants.ts`.
   `npm run fuzz -- --seeds 1-24` is clean.
6. **Performance checked.** Use `measureFrame` through the API in the scenes
   the feature touches, compared with the same scenes before the change.
7. **Looked at.** `npm run look` green, or its pictures written again and
   every one looked at. A feature with a look of its own gets a scene in
   `smoke/look.spec.ts`; one that changes an existing scene changes its
   picture, and the change is described in the report.
8. **New tests mutation-checked.** Put the bug back (or remove the feature) and
   watch the test fail, then restore it.
9. **Anything not verified is said plainly.**

## Edge-case checklist

For anything new in the cave, check what it does:

- **the hole:** pushed down it, lit or moving
- **leaving:** the cave left with it in it (lit, moving, on the way out's tiles when it opens): counted as lost, never carried over
- **save:** saved, reloaded, and loaded from an old save without the field
- **drones:** pushed by one, or targeted by the foreman
- **other features:** blasts, the horn, belts, the magnet, brick walls and rubble,
  hidden chambers, lamps, the scoop (a body raised in it is carried: skipped, never
  banked, never in the rock, counted lost on leaving, and back in its heap on a reload;
  set down in it, it is on the floor like any other),
  geodes (a blast cracks one within `CRACK_RADIUS`; its gems are a bonus source,
  never toward `CLEAR_SHARE`), currents (a body carried onto one, and down a drain:
  a lit barrel, a brick, a gem, a geode; saved and reloaded with `drained`; the last
  coins of a cave going down a drain still open the way out)
- **rock:** against walls and in corridors; never left in rock
- **caves:** in every cave and biome, the hollow included, and the last, which has no way out
- **scale:** many at once, chains, at capacity (`KIND_CAPACITY`)
- **phone:** touch controls, narrow screen
- **the end:** after the cave is done, with the vein running

## Verifying in a browser

- **Use headless Playwright** (the `smoke/` setup, `start()` in
  `smoke/pushminer.ts`) for anything that has to be seen or measured. The
  in-app Browser pane pauses its frames when hidden, and its screenshots go stale.
- **Control time.** Pause the game with `pushminer.pause()`, set the scene with
  the API, `seed(n)`, then `step(frames)`, rather than waiting on timeouts.
- **Keep the player's save safe.** Never write over it in a browser the player
  uses. A test save goes in through `start(page, { save })`, in a fresh
  Playwright context.

## Commits

Commit only when asked. Commit messages follow the existing ones: a sentence
summary in the house voice, and a body saying what changed and why. Use two
commits when a refactor and a feature land together. The pre-commit hook runs
`check:quick`.
