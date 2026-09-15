---
name: feature
description: Build a Pushminer feature from a short prompt, confidently. Turns the prompt into a spec (acceptance criteria, edge cases, performance risk, test plan), gets it agreed, builds it test-first, and verifies it to CLAUDE.md's definition of done with evidence. Use when the user asks for a new feature or a change to how the game plays or looks.
---

# /feature

Take a one-line feature request to a finished, verified feature. Follow the
phases in order. Do not start building until the user has agreed the spec.

## 1. Understand

- Read the relevant code before proposing anything: `src/game.ts`, and whichever
  modules the feature touches.
- Find the nearest existing feature and how it is built, tested and shown. Barrels,
  walls, chambers and lamps are good models for things in the cave.
- Note which paths from CLAUDE.md's edge-case checklist the feature can reach.

## 2. Spec: show the user, and wait

Write a short spec and show it in chat. Keep it under a screen.

- **What:** the behaviour, in the player's terms.
- **Acceptance criteria:** numbered, each observable and testable, for example
  "a lit barrel pushed down the hole is gone and banks nothing".
- **Edge cases:** go through the checklist in CLAUDE.md. Say what the feature does
  in each case that applies, and write "not reachable" for the rest.
- **Decisions:** only choices that are the user's to make: tuning feel, visuals,
  anything with more than one reasonable answer. Give a recommendation for each.
- **Performance risk:** what could cost frame time (lights, particles, draw
  groups, per-frame loops over bodies) and how it will be measured.
- **Test plan:**
  - unit tests (module and `Game`)
  - the smoke play-through step
  - the fuzzer action, and any new invariant
  - the screenshots to take

Ask the user to agree the spec or change it. Use AskUserQuestion only for real
decisions.

## 3. Build test-first

1. Write the acceptance criteria as failing tests.
   - Unit tests in `test/`: headless, on `Game`, with `memoryStore` and `withSeed`.
   - A step in `smoke/progress.spec.ts` through `window.pushminer`, paused and stepped.
   - Run them and see them fail for the right reason.
2. Build the feature. Logic goes in `game.ts` or its own module, which is handed
   what it needs. `main.ts` only presents it through `GameEvents`. Content goes
   in `cave.ts`.
3. Extend the test API (`src/debug.ts`) with whatever the tests need to set up
   or read the feature.
4. Add the fuzzer action to `scripts/fuzzer.ts`: only what a player could do.
   Add any new always-true rule to `src/invariants.ts`.
5. Make the tests pass.

## 4. Verify: evidence, not belief

Do all of it, and keep the numbers and file paths for the report:

- **`npm run check`.** If the drone gate or the bench moved, rerun on other seeds
  (`npm run sim -- --room N --seeds 9-16`) before deciding it is real. Only update
  a baseline for an intended change, and say why.
- **`npm run fuzz -- --seeds 1-24`** clean. Failures print a replay command; fix
  the cause, never the check.
- **Mutation check.** Break the feature (or put the bug back), see the new tests
  fail, then restore it.
- **Performance.** In headless Playwright, measure `pushminer.measureFrame()` in
  the scenes the feature touches, before and after (use `git stash` for the
  before).
- **Look.** Headless Playwright screenshots of the feature in every room or biome
  it appears in, at phone size if it has UI, and before/after where it changes
  something already there. Read every screenshot, and tune until it looks right.
- **Player's save.** If you used the dev browser, leave the player's save exactly
  as it was.

## 5. Report

Report in chat, briefly:

- **Result:** what was built, in one or two sentences.
- **Acceptance criteria:** each one, and the test that proves it.
- **Checks:** results with numbers (tests, fuzz seeds and frames, drone gate,
  bench, frame costs before and after).
- **Bugs found and fixed** along the way.
- **Not verified:** anything you could not check, said plainly.
- **Uncommitted:** say that nothing is committed until asked.
