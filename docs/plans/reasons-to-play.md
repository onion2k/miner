# A reason to play: the toll, the ledger, and tools as keys

A plan in five stages, on pushminer `main` at `ed15970`. Once approved it is copied to
`docs/plans/reasons-to-play.md`, and each stage is marked there as it lands.

## Context

There is no reason to pick up a coin. Money buys only getting money faster: the autopilot buys the whole
workshop and ends the run with about 39,000 unspent. No heap asks for a particular tool, the Spiderdozer is a
costume, and a cave opens at nine tenths whatever is done. The game lacks a want, a need and a way to do well.

This gives it all three, and **never a clock**: a toll (coins have somewhere to go), tools as keys (each tool
reaches something the others cannot), and a ledger (what was brought out, and what was lost).

## Measured

- **The mine holds 68,850:** 36,310 in heaps and 32,540 in finds (chambers 10,260, side rooms 14,360, wall
  treasure 2,755, geodes 5,165). The workshop costs 20,980 and the paint shop 2,800.
- **A current is no barrier:** 30 of 30 coins pushed across one arrive. I said otherwise; that was wrong.
- **A sinkhole across a passage is:** 0 to 3 of 30 get over it pushed; a load raised in the scoop goes over.
- **A bucket and a blade break walls alike today:** it is the hull that hits, and nothing asks what is fitted.
- **The Spiderdozer:** no game logic reads it. The dozer has a `solid` array of its own, so a tile can be rock
  to tracks and floor to legs and to coins.

## Decisions made

- **Half of each coin pays the toll** (yours, 2026-10-03, after the autopilot's run): half of every coin banked
  goes to the toll until it is paid, the other half to the bank from the first coin; paid, the way out opens.
  "The first coins pay it", chosen first, starved the start of every cave and left a quick player stuck.
- **The toll is four tenths of the cave's heaps** (yours, after the run; six tenths was chosen first), rounded
  to a hundred: 1,000, 1,200, 1,500, 1,800, 1,900 and 2,200, which is 9,600. The way out opens at about eight
  tenths banked. The Deep has no way out and no toll.
- **Only the blade breaks walls** (yours); blade and scoop are both kept and swapped in the workshop for nothing.
- **The legs cross rockfalls** (yours): rubble across a passage, rock to tracks, floor to legs and to coins.
- **The scoop crosses sinkholes** (from the measurement).
- **Never stranded** (mine): the way out also opens when nine tenths of the heaps are gone, as now.
- **The old rule's word is taken:** `tally` is the run of coins down the hole, so this is the **ledger**.
- **Every size and price below is an estimate,** played by the autopilot and shown before it is agreed.

## How it is built

One stage at a time, in this order, since all five change `economy.ts`. Each is built test-first by a builder
in a worktree to the definition of done, checked here against its files, and shown to you. Nothing is
committed until you ask. What is a matter of taste is shown as a mock or a map first.

---

## Stage 1: the toll

**What.** Each cave with a way out has a toll. `Economy.deposit` pays it first. The way out opens when it is
paid, or when nine tenths of the heaps are gone. The last cave is as it is.

**Interfaces.**

- `src/economy.ts`: `TOLL_SHARE = 0.6`, `tollOf(spec)`; per-cave save field `toll` (paid so far); `deposit`
  splits a coin between toll and bank, and `banked` (the lifetime haul) takes all of it; `owed()`.
- `src/game.ts`: the check runs when `save.banked` moves, not `bank`; event `tollPaid(paid, owed)`.
- `src/progress.ts`: "the Hollow: toll 640 of 1,500", then "the way out is open".
- `src/invariants.ts`: the toll is within its range; paid, the way out is open after a step.
- Old saves: a cave in progress has its toll counted as paid. `test/saves/15-toll.json`.

**Acceptance criteria.**

1. The first 1,500 banked in the Hollow leave the bank at nought; the next coin raises it by one.
2. The way out opens on the coin that pays the toll.
3. With the toll unpaid and nine tenths of the heaps drained, the way out opens.
4. Every cave's toll is six tenths of its heaps to the nearest hundred; the Deep has none.
5. A save from before the toll loads with nothing taken back, and plays on.
6. The autopilot, both profiles, gets through the first two caves.

**Edge cases.** A find banked before the toll is paid pays it too. Saved and reloaded part paid. Left with it
paid: the next cave owes afresh. The fuzzer's and the test API's `deposit`. The phone's workshop heading.

**Gates.** The balance baseline is meant to move (purchases come later): shown, then written. The determinism
run's "almost cleared" Hollow still opens by the nine tenths rule.

**Churn to expect.** Many tests hold "a coin banked raises the bank". Test helpers start a cave with its toll
paid unless a test asks otherwise; the toll's own tests, smoke, the fuzzer and the gates play it for real.

**Out of scope.** Buying the way out; debt; any change to prices.

---

## Stage 2: the ledger

**What.** What each cave held, what was brought out, paid in toll, lost down drains and left behind, and which
finds were found. A line for the run: "brought out 12,340 of 68,850". No time anywhere.

**Interfaces.**

- `src/ledger.ts`, new, headless: `held(spec)` (everything obtainable, by source), `rowOf(game)`.
- `src/economy.ts`: per-cave `taken`; run-wide `ledger: Row[]`, a row a cave left, at most seven.
- `src/game.ts`: `leave()` hands the row to `moveOn`; `caveLeft` carries it.
- The page, as chosen from the mock (`docs/plans/ledger-mock.html`, its B, 2026-10-02): a bar a cave, gold for
  what was brought out, blue for what drained and grey for what was left, with the figures under it; on
  leaving a cave, when the last is cleared, and opened from the workshop, whose foot carries the run's line.
- Marks, three a cave, as chosen: clean (nothing down a drain), every heap (nothing left of the heaps), every find.

**Acceptance criteria.**

1. A row's parts add up: brought out, drained and left behind come to what the cave held.
2. An unopened chamber, a standing wall's treasure and a whole geode count as left behind.
3. The run's line is the sum of its rows and the cave being played.
4. Saved and reloaded, the ledger is as it was; an old save has an empty one.
5. Each mark is given exactly when its rule holds.

**Edge cases.** The last cave, never left, and its vein. A cave left by the nine tenths rule. The phone.

**Out of scope.** Scores across runs; anything timed.

---

## Stage 3: the blade breaks, and refitting

**What.** A bucket only dents brick: walls and hidden chambers take nothing from a machine with the scoop
fitted. Blade and scoop are both kept; the workshop fits either for nothing. The blade's row opens again.

**Interfaces.**

- `src/economy.ts`: run-wide `fitted: 'blade' | 'scoop'` (an old save with a scoop has it fitted);
  `spec().bucket` follows it; two rows to fit one or the other, as the tracks and legs have.
- `src/impacts.ts`: `ImpactState.breaks`; without it a wall takes no damage and a chamber is not revealed.
- `src/game.ts`: event `glanced`, and the page's note "a bucket only dents it · fit the blade".
- Refitting with a load up sets it down first.

**Acceptance criteria.**

1. With the scoop fitted, a square hit at full speed does a wall no damage and opens no chamber.
2. With the blade fitted, both break as they do today, at each engine grade.
3. Fitting costs nothing and is refused only for a scoop not owned.
4. A wider blade can be bought with a scoop owned, and is the width fitted.
5. An old save with a scoop loads with it fitted.

**Edge cases.** Refit while raised. The fuzzer charges with either fitted. The autopilot, which has no scoop.

**Out of scope.** A key to swap without the workshop.

---

## Stage 4: sinkhole rooms, the scoop's key

**What.** A side room down a passage with a sinkhole across it, in three caves (first proposal: the East
Gallery, the Warrens, the Deep), holding about 1,600, 2,200 and 3,500. Pushed out, the loot is lost down the
sinkhole; raised in the scoop it is carried over.

**Interfaces.**

- `src/cave.ts`: a `Stash` may have a `sinkhole` in place of a wall; `cave.drains` gains it.
- `src/caves.ts`: the three rooms. **Their routes on `npm run caves:map` first.**
- `src/economy.ts`: their sources go last, after the geodes', so no number given out moves.
- `src/tools.ts`, `src/autopilot.ts`: a drone and the autopilot never work a source behind a sinkhole.

**Acceptance criteria.**

1. Of a room's loot pushed out by a blade, nine tenths or more goes down the sinkhole.
2. Of what the scoop lifts, all of it arrives on the cave's side.
3. Every sinkhole fills its passage: no way round it wider than a coin.
4. No drone ever pushes that loot. The machine crosses the sinkhole unharmed.
5. Old saves load with the room's loot whole.

**Gates meant to move.** Budgets' terrain counts; pictures of those caves; what the mine holds.

**Out of scope.** Sinkholes in the open cave; bridges.

---

## Stage 5: rockfalls, the legs' key

**What.** Rubble across a passage in three caves (first proposal: the North Vault, the West Gallery, the Deep),
with a room behind holding about 2,000, 2,800 and 3,500. Tracks meet it as rock. Legs step between the stones,
and coins are pushed out through it. The Spiderdozer's row says what it is for.

**Interfaces.**

- `src/cave.ts`: a cell kind `ROCKFALL`; `Cave.solid` (floor there, for bodies) and `Cave.tracked` (rock there).
- `src/game.ts`: `reshape` gives the player's dozer the view its body has; drones and the nav keep the tracked
  one. Swapping to tracks while standing on a rockfall is refused.
- `src/invariants.ts`: each machine is held out of its own rock.
- Drawing: **a mock first** of the rubble, sparse enough that a coin among the stones reads true.

**Acceptance criteria.**

1. On tracks the machine cannot enter a rockfall from either side; on legs it crosses.
2. A coin pushed by a legged machine passes through; no body is left "in the rock".
3. No drone paths through one, and none is sent for what lies behind.
4. On tracks behind a rockfall, fitting the legs gets the machine out.
5. Old saves load; the Spiderdozer costs what it did.

**Known and accepted.** Coins pushed out are drawn passing among stones that are only a picture.

**Out of scope.** Ledges and floors at different heights; the legs as a costume alone.

---

## Verification, every stage

- Criteria as tests, seen failing first, each mutation-checked; an edge case each from the checklist.
- `npm run check` green; the fuzzer on 24 seeds; a step in `smoke/progress.spec.ts` worked as a user works it.
- Pictures looked at, at a desk and on a phone; the workshop's words held by its text list.
- The autopilot's run (`npm run balance`) before and after, and the figures shown before a price is agreed.
- At the end: a whole run by the autopilot, and its ledger read: how much of 68,850 comes out, and of what.

## Named, not done

- The autopilot does not use the scoop or the legs, so the balance gate cannot play their keys.
- README and `CLAUDE.md` say five caves; `caves.ts` says six; there are seven.
- `economy.ts`'s comment that the cave holds about 19,000 is stale.

## Status

- [x] Stage 1: the toll, landed 2026-10-03. The autopilot's run with it: thorough 83 min with 27,000 left and
      everything bought; a quick player finishes 6 of 6 in 50 min with 6,000 left. Balance baseline written again
      (rusher purchases 12 to 8.83); six pictures written again for the progress line's words.
- [ ] Stage 2: the ledger
- [ ] Stage 3: the blade breaks, and refitting
- [ ] Stage 4: sinkhole rooms
- [ ] Stage 5: rockfalls
