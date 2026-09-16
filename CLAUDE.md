# Pushminer: working on it

A bulldozer, a cave full of coins, and a hole to push them into. TypeScript,
Vite, and WebGPU through
[artshape-render](https://github.com/onion2k/artshape-render). The README says
what the game is and how it is put together; this file says how to change it
without breaking it.

## Commands

    npm run dev            the game at http://localhost:5194
    npm run check:quick    formatting, types, lint, unit tests (the pre-commit hook; ~15 s)
    npm run check          all of it: check:quick, fuzz, determinism, drone gate, balance gate, physics bench, smoke (~2.5 min)
    npm test               unit tests (Vitest, test/)
    npm run fuzz           the game played at random, rules checked (scripts/fuzz.ts)
    npm run fuzz -- --seed N           one failing seed again, with what led up to it
    npm run determinism    the same seed played twice, hashed, to catch chance not from the seed
    npm run leaks          an hour of play, watching what must stay bounded (20 min of it in check)
    npm run sim:check      the drones held to scripts/sim-baseline.json
    npm run balance        the whole game played through by the autopilot: room times, purchases, bank
    npm run balance:check  the first two rooms' pacing held to scripts/balance-baseline.json
    npm run bench          the physics' frame time held to scripts/bench-baseline.json
    npm run smoke          the game in headless Chromium on the real GPU (Playwright, smoke/)
    npm run look           the scenes held to the pictures in smoke/screens
    npm run look:update    the pictures written again, after a change meant to alter them

`--update` on `sim:check`, `balance:check` or `bench` writes a new baseline, and
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
  some, it goes in `game.ts` or a module of its own.
- `src/debug.ts` is `window.pushminer`, the test API. `src/invariants.ts` lists
  the rules that must always hold.
- Content (rooms, heaps, walls, barrels, lamps) lives in `cave.ts`. Prices
  and the save live in `economy.ts`.

## Rules for the code

- **No tight coupling.** A module takes what it needs as arguments or
  options. It does not import game state, and lower modules (physics, nav,
  tracks, terrain) do not import content. `main.ts` is the only place that
  wires everything together. The physics is meant to become a package of its
  own (see the README), so add nothing to `physics.ts` that ties it closer
  to the game.
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
- **sealing:** its room sealed with it in it; the next room opening in its place
- **save:** saved, reloaded, and loaded from an old save without the field
- **drones:** pushed by one, or targeted by the foreman
- **other features:** blasts, the horn, belts, the magnet, brick walls and rubble,
  hidden chambers, lamps
- **rock:** against walls and in corridors; never left in rock
- **rooms:** in every room and biome, the hollow included
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
