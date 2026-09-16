---
name: feature
description: Build a Pushminer feature from a short prompt, confidently. Turns the prompt into a spec (acceptance criteria, edge cases, performance risk, test plan), gets it agreed, builds it test-first, and verifies it to CLAUDE.md's definition of done with evidence. Use when the user asks for a new feature or a change to how the game plays or looks.
---

# /feature

Take a one-line feature request to a finished, verified feature. Follow the
phases in order. Do not start building until the user has agreed the spec.

Two kinds of feature come through here, and they are verified differently:
something **in the cave**, which a player sees, and a **tool**, which measures
the game or holds it to something. Phase 4 has a track for each.

## 1. Understand

- Read the relevant code before proposing anything: `src/game.ts`, and whichever
  modules the feature touches.
- Find the nearest existing feature and how it is built, tested and shown. Barrels,
  walls, chambers and lamps are good models for things in the cave. The fuzzer
  and the drone gate are the models for a tool.
- Note which paths from CLAUDE.md's edge-case checklist the feature can reach.

### Measure first, where the ask has a number in it

If the request names a figure — how long a game takes, what a thing should cost,
how often something should happen — find out what that figure is now, before
writing a spec around it. A rough measurement is enough: a short run, a sum over
the tables in `cave.ts` and `economy.ts`, an existing gate's output. Put it in
the spec.

A target agreed without a measurement is a target nobody knows the cost of.
Where the levers on offer cannot reach it, say so in the spec and give the
user the trade-off, rather than finding it out half way through the build.

## 2. Spec: show the user, and wait

Write a short spec and show it in chat. Keep it under a screen.

- **What:** the behaviour, in the player's terms.
- **Where it stands now:** the measurements from phase 1, for anything the
  request puts a number on.
- **Acceptance criteria:** numbered, each observable and testable, for example
  "a lit barrel pushed down the hole is gone and banks nothing".
- **Edge cases:** go through the checklist in CLAUDE.md. Say what the feature does
  in each case that applies, and write "not reachable" for the rest.
- **Decisions:** only choices that are the user's to make: tuning feel, visuals,
  anything with more than one reasonable answer. Give a recommendation for each,
  and say what each would cost, from the measurements.
- **Performance risk:** what could cost frame time (lights, particles, draw
  groups, per-frame loops over bodies) and how it will be measured. For a tool,
  what it adds to `npm run check`.
- **Test plan:**
  - unit tests (module and `Game`)
  - the smoke play-through step
  - the fuzzer action, and any new invariant
  - the screenshots to take
  - for a tool: the gate, its baseline, and how a change to it is told from noise

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

A tool is code like any other: its own working parts get their own unit tests,
not just the end-to-end run. A bug in the middle of a tool does not throw — it
quietly gives a wrong number, and an end-to-end run is a slow and poor way to
find it.

## 4. Verify: evidence, not belief

Do all of it, and keep the numbers and file paths for the report.

Both kinds:

- **`npm run check`.** If a gate moved, rerun on other seeds
  (`npm run sim -- --room N --seeds 9-16`) before deciding it is real. Only update
  a baseline for an intended change, and say why.
- **`npm run fuzz -- --seeds 1-24`** clean. Failures print a replay command; fix
  the cause, never the check.
- **Mutation check.** Break the feature (or put the bug back), see the new tests
  fail, then restore it. A test that survives its mutation proves nothing: make
  it sharper until it fails.

Something in the cave, as well:

- **Performance.** In headless Playwright, measure `pushminer.measureFrame()` in
  the scenes the feature touches, before and after (use `git stash` for the
  before).
- **Look.** Headless Playwright screenshots of the feature in every room or biome
  it appears in, at phone size if it has UI, and before/after where it changes
  something already there. Read every screenshot, and tune until it looks right.
- **Player's save.** If you used the dev browser, leave the player's save exactly
  as it was.

A tool, as well:

- **Trust the instrument before its figures.** Watch what it does, on several
  seeds, against behaviour already known to be good, and make it competent
  before reading anything into what it reports. A measuring tool that gets
  stuck, gives up early or plays badly reports a number that says more about
  the tool than the game.
- **The same seed gives the same answer**, run again and on another machine's
  core count.
- **Its gate holds both ways** where it is pacing or balance: quicker is as much
  a change as slower. Say what the tolerance is and why it is that wide.
- **What it costs `npm run check`**, in seconds.

## 4a. When the evidence contradicts the spec

Stop and go back to phase 2. Do not tune towards a target the measurements have
just shown to be out of reach, and do not quietly pick a different one.

Report what was agreed, what the runs show, the options with their numbers, and
a recommendation. Build and land everything that stands regardless of the
answer — the tool, the gate, the tests, the docs — and leave the choice open.
Say plainly in the report and in the commit that it is still open.

## 5. Report

Report in chat, briefly:

- **Result:** what was built, in one or two sentences.
- **Acceptance criteria:** each one, and the test that proves it.
- **Checks:** results with numbers (tests, fuzz seeds and frames, drone gate,
  balance gate, bench, frame costs before and after).
- **What the numbers show,** for a tool: what it says about the game now.
- **Bugs found and fixed** along the way, in the feature and in the tool itself.
- **Not verified:** anything you could not check, said plainly. A figure the
  tool cannot calibrate — autopilot minutes against a player's, say — is not
  verified, however many runs back it.
- **Uncommitted:** say that nothing is committed until asked.
