# Pushminer

A bulldozer in a cave full of coins, and a hole to push them into.

Drive with **W A S D** (or the arrows), shove coins and gems into the hole to
bank them, and press **B** for the workshop: a bigger engine, a wider blade,
a stronger magnet, a conveyor belt for the room you are in, and drones that
go and fetch things. Drag to orbit the camera, wheel to zoom, **C** to put it
back, **M** to mute. Progress is saved in the browser; the workshop has a
_start over_ button.

The cave is five rooms, and nothing refills them. Bank nine tenths of what a
room holds and the rock at the next gate comes down: the Hollow, then the
South Gallery, the East Gallery, the North Vault and the West Gallery, each
with dearer gems than the last. A gold arrow at the edge of the screen points
to the open gate. Chase the last tenth or leave it: drive on through the new
gate and down its corridor and the room behind is sealed, with whatever was
still in it. Up at the gate the game says so, and the line that seals it
glows red. Only a room or two is ever in play, so a cave that has been worked
through does not weigh on the frame.

Each gallery is a world of its own. The South Gallery is jungle: mossy rock,
ferns and trees, and mushrooms that glow in the dark with fireflies about them.
The North Vault is ice: blue walls, snow falling, and crystal clusters lit from
inside. The East Gallery is lava: black basalt, pools of it glowing on the
rock, embers rising. The West Gallery is the future: steel panels, neon along
the walls, beacons blinking on pylons. The hollow is the cave as it always was,
and each world creeps in down the corridor out to its room rather than starting
at a line. A world is only how a room looks: the rock, the floor and the coins
play the same in all of them.

Off each gallery a stretch of the wall looks like any other rock and is not.
Knock into it and it sounds hollow; drive square into it at speed and it
smashes, and behind it is a hidden chamber with gold bars in it. What is in a
chamber does not count toward clearing the room, and whatever is still in it
when the room is sealed is gone with the room.

Down a corridor off each gallery is a side room behind a brick wall, and you
can see what is in it over the top. Drive square into
a wall hard and it takes a beating, by how good the engine is and how fast
you hit it: clay brick stands little, stone more, iron-bound a great deal.
The right engine brings a wall down in one hit, a lesser one in several, and
the bricks show the damage until the wall comes down. Then the bricks tumble
and stay where they fall, to be pushed aside, or down the hole to be rid of.
Some walls have treasure set in them, a gold brick or a gem in the top of
one, which comes loose with the rest. What is in a side room, or set in its
wall, is over and above the room, as a chamber's is, and sealed in with it.

Barrels stand about each room. Push one and it goes where it is pushed; hit
one with the dozer and its fuse is lit. It flashes, faster and faster, beeping,
and three seconds later it goes off with a bang and a flash that lights the
cave, throwing every coin and gem near it outward and up. A barrel caught in a
blast goes off soon after, so a row of them goes up one after another. Only the
player lights a fuse; the drones push barrels about without setting them off.
Barrels are worth nothing down the hole, and are sealed in with their room.

The cave is pitch black. What you see by is the dozer's own lights, the
drones', and the lamps on posts along the rooms' edges, which come on when a
room opens and go out when it is sealed. Drive into a lamp and it goes over,
glass everywhere, and stays dark.

The dozer's tracks, and the drones', press into the floor where they drive, and the marks stay,
the oldest fading away as new ones are made.

A run of coins into the hole is tallied on screen and grows louder — in
sparkle, light and pitch — the longer it goes on.

Drawn on the game path of [artshape-render](https://github.com/onion2k/artshape-render):
a forward WebGPU renderer that redraws everything every frame and instances
each kind of thing — three and a half thousand coins are one draw.

## Running it

    npm install
    npm run dev        # http://localhost:5194
    npm run typecheck

It needs a browser with WebGPU.

## Measuring the drones

    npm run sim                                  # the south gallery, three drones, two minutes, seeds 1-8
    npm run sim -- --room 3 --belt               # the east gallery, with its belt running
    npm run sim -- --room 1 --player patrol      # the player driving in and out through the drones
    npm run sim -- --room 2 --secret             # the north vault with its hidden chamber broken into
    npm run sim -- --drones 1 --seconds 300 --seeds 1-3 --each

The game without the picture: the same cave, physics, machines and drone code,
stepped in Node as fast as it goes, from a seed, so a run can be repeated. One
run of the game is too much luck to tell a better drone from a worse one; eight
seeds of this take seconds. It reports what was banked, how each push ended,
and how much the drones got in each other's way — see the top of
`scripts/sim.ts`.

## Keeping it working

    npm run check          # everything: formatting, types, lint, unit tests, the fuzzer, the drone gate, the balance gate, the physics bench, the smoke test
    npm run check:quick    # formatting, types, lint and unit tests; what runs before each commit
    npm test               # the unit tests
    npm run lint
    npm run format         # Prettier over the lot
    npm run sim:check      # the drones held to their baseline
    npm run sim:check -- --update
    npm run balance        # the whole game played through by the autopilot, seeds 1-6, thorough and rushed
    npm run balance -- --profile thorough --seeds 1-12 --purchases
    npm run balance:check  # the first two rooms' pacing held to its baseline
    npm run balance:check -- --update
    npm run fuzz           # the game played at random, the rules that must hold checked
    npm run fuzz -- --seed 17
    npm run determinism    # every seed played twice: the same game both times
    npm run bench          # the physics' time a frame held to its baseline
    npm run bench -- --update
    npm run smoke          # the game in a real browser (once: npx playwright install chromium)
    npm run look           # the scenes held to the pictures in smoke/screens
    npm run look:update    # the pictures written again, after a change meant to alter them

`npm install` points git at `.githooks`, whose pre-commit hook runs
`check:quick` (a few seconds). `git commit --no-verify` skips it.

The unit tests in `test/` cover what runs without WebGPU: the cave's layout
rules (every heap reachable, each room shut off by its gate, side rooms and
chambers sealed in rock), the physics' sleep bookkeeping while blades churn a
heap, the dozer never ending up in rock, the way to the hole from every room,
the save and the order rooms open and seal in, and that the drawn rock never
stands over floor the dozer can drive on.

The drone gate runs six scenarios, eight seeds each, side by side, and fails
if what the drones bank, or how often they lose a load or get in each other's
way, has got worse than `scripts/sim-baseline.json` by more than a tolerance.
A run is the same from the same seed, so any change to the physics, cave or
drones moves the figures; when a change makes them better, `--update` holds
the next change to the better figures.

What the game looks like is held to pictures (`npm run look`, part of the smoke
run): the hollow, each of the four biomes, a barrel mid-blast, the cave cleared
with its vein, the workshop, and a phone's controls and workshop. Each scene is
set through the test API with chance seeded from before the game is built and
the page started stopped (`?paused=1`), so nothing has moved but what the test
stepped, and the same machine draws the same pixels every run. The pictures are
this machine's GPU, and another will draw them a little differently. A failure
leaves the picture, what was drawn, and the difference in `test-results/`.

Every seed has to play out the same way twice (`npm run determinism`): two
runs of the same seed, hashed every 300 frames — every body's place and speed,
the machines, the fuses and the save — and the frame they first part at if they
ever do. Everything that holds the game to a figure rests on that, so what
breaks it shows up nowhere else, only as gates whose numbers wander.

`test/saves/` keeps a save of every shape the game has ever written, from the
three-room cave before there were magnets to the one it writes today. Each one
has to load, keep what it bought, fill out every list to the cave as it stands,
play on without breaking a rule, and survive being written again. A new field
in the save means a new file there; the last test in `test/saves.test.ts` fails
until it is added.

The balance run (`scripts/balancer.ts`) plays the whole game through, from a
new save to the cave cleared, with the autopilot (`src/autopilot.ts`) at the
controls: the drones' own mind driving the player's dozer, buying the cheapest
thing in the workshop as soon as it can, and going on when it is done with a
room. Played `thorough` it breaks into every chamber and wall and clears each
room to its last twentieth; played `rusher` it goes on as soon as the next
gate opens. It reports how long each room took, when each purchase came and
how far apart, and what was banked, spent and left over, for tuning prices
and loot against. The autopilot is not a person: its minutes are its own, and
say how the game paces, not how long a player will take. The balance gate
plays the Hollow and the South Gallery both ways, six seeds each, and fails if
the rooms' times, what was banked or how much was bought moved beyond a
tolerance either way, since quicker is as much a change to the balance as
slower.

The fuzzer (`scripts/fuzzer.ts`) plays the real game without the picture, at
random, from a seed: driving about and charging walls, chambers, lamps and
barrels, pushing anything at all down the hole, setting barrels off, buying
things, opening rooms and going on into them, saving and loading. After every
few frames it checks the rules in `src/invariants.ts` — nothing in the rock,
nothing not a number, the counts of what is in the cave agreeing with what is
in it, nothing left of a sealed room, a save that comes back as it went — and
fails with the seed, the frame and what was done before it, to be played again
with `--seed`. It only does what a player can: a monkey that did what no player
can would find bugs no player will.

The game has a test API, `window.pushminer` (`src/debug.ts`), that the smoke
tests drive it through: pause it, step it a frame at a time, seed its chance,
set a scene, and read back its state, what has happened, and whether any rule
is broken. `CLAUDE.md` has the definition of done a change is held to, and
`/feature` is a Claude Code skill that takes a feature from a prompt to done.

The physics bench times three scenarios over the whole cave with every room's
heaps in it: at rest, blades and belts churning the heaps, and a heap of four
thousand coins falling at once. Each runs several times in a worker of its own
and the fastest counts. It is held to `scripts/bench-baseline.json` as a
multiple of a fixed piece of arithmetic timed alongside it, so the baseline
means something on a faster or slower machine, and fails at 20% slower (and at
least 0.05 ms a frame).

The smoke test (`smoke/`) serves the game with Vite and plays it in Chromium's
headless mode on the machine's own GPU, a fresh save each time: it boots with
no errors, draws a picture that is not black, drives the dozer and sees tracks
laid, opens and shuts the workshop, keeps the cave across a reload, and boots
on a phone-sized screen with the touch controls. And it goes through the whole
cave in one go: every room opened and gone on into, a chamber and a wall in
each, a lamp, a drone, the horn, and the end. Screenshots of each go in
`test-results/` when a test fails, with a trace to step through.

## How it is put together

    src/main.ts           the page: renderer, sound, controls, camera and counters round the game; the frame loop
    src/game.ts           the game without the picture: a step of everything that happens, told as events
    src/debug.ts          window.pushminer, the test API
    src/invariants.ts     the rules that must always hold, whatever has been played
    src/cave.ts           the tile grid: rooms and the order they open in, gates, heaps, veins, belt routes, lamps
    src/economy.ts        the bank, the upgrades, which room is being cleared, the save, the shop
    src/stock.ts          what is in the cave, from where: put back from the save, spawned, banked, sealed away
    src/progress.ts       when the next room opens, going on through its gate, and what the player is told
    src/walls.ts          the brick walls as bricks: laid, beaten, treasure set in them, coming apart
    src/lamps.ts          which lamps are lit, knocked over, and worth lighting this frame
    src/impacts.ts        what driving into a wall or a chamber's rock does
    src/tally.ts          a run of things into the hole, and how hot it is
    src/barrels.ts        barrels: fuses lit by the player, flashing, and the blast that throws what is near
    src/vein.ts           the last room's vein, once the cave is cleared
    src/physics.ts        the coins as spheres: spatial hash, sleeping, floor, hole, walls, pushers, belts
    src/dozer.ts          the bulldozer: tank steering, the blade and hull as pushers, load
    src/tools.ts          conveyor belts, drones, and the fountains
    src/autopilot.ts      the player's dozer driven by the drones' mind, for playing the whole game through
    src/nav.ts            the way round the rock and the heaps, for the drones
    src/terrain.ts        the cave to look at: the rock and floor as one faceted surface over the tiles, and the stones on it
    src/biomes.ts         each gallery's world: its palette and rock, how it blends in, what stands in it, its lights and air
    src/noise.ts          smooth noise, for rock, floor and the patches a world creeps in by
    src/tracks.ts         the marks the tracks press into the floor, kept a page at a time, the oldest fading
    src/scene-static.ts   what does not move, as groups for the renderer: ground, hole, gates, walls, lamps, belts
    src/scene-dynamic.ts  what moves, written each frame: bodies, machines, treads, stripes, pennant, track marks
    src/lighting.ts       each frame's lights and glows
    src/camera.ts         the camera rig: fixed, chase and free
    src/calibrate.ts      how much coin this machine can draw
    src/hud.ts            the page round the cave: counters, tally, notes, the arrow to the next gate, a phone's buttons
    src/palette.ts        the colours things are drawn in
    src/effects.ts        the bursts of particles: glass, chips, dust, sparkle
    src/audio.ts          every sound, synthesised: clinks, thunks, the engine, the rumble
    src/meshes.ts         flat-shaded shapes: coin, gem, box, cone, ball, stone, the hole's collar and pit
    src/matrix.ts         column-major placements
    src/input.ts          the keyboard
    src/touch.ts          a phone's sliders
    scripts/sim.ts        the drones without the picture, for measuring them
    scripts/sim-check.ts  the drones held to a baseline
    scripts/fuzzer.ts     the game played at random, its rules checked; fuzz.ts runs it over seeds
    scripts/balancer.ts   the whole game played through by the autopilot; balance.ts runs it over seeds and gates it
    scripts/determinism.ts  a seed played twice and hashed; determinism-check.ts runs it over seeds
    scripts/physics-bench.ts  the physics' time a frame, held to a baseline
    test/                 unit tests, run by Vitest
    test/saves/           a save of every shape the game has written, all still loading
    smoke/                the game in a real browser, run by Playwright
    smoke/screens/        what each scene is meant to look like, on this machine's GPU

The coins collide as balls a little smaller than their rims, which is what
lets thousands of them be stepped in JavaScript at 120 Hz. They are drawn
flat when resting on the floor and tumbling when they fly. A body that has
barely moved over a third of a second goes to sleep and costs nothing until
something arrives with intent — the blade wakes what is ahead of it before
it gets there.

The blade's load slows the engine: a heap in front of the blade is a heap
the engine has to move, and that is what the engine upgrades are for.

## Where it is going: the physics on its own

The renderer is already a project of its own,
[artshape-render](https://github.com/onion2k/artshape-render), and the game
only uses it through its interface. The physics is meant to go the same way:
a package the game depends on, knowing nothing about coins, caves or bank
balances. It has not moved yet. For now it lives here, and it is still tied
to the game in a handful of places, which are the work to be done first:

- **The cave.** It imports the tile grid's size, origin and tile size from
  `cave.ts`, to size its hash and to collide with the rock. The rock should
  be handed to it as a grid of solid tiles when a world is made.
- **The hole.** There is exactly one, taken from `HOLE`, rim slope and all.
  The places things fall out of the world should be handed in, as many as
  there are.
- **The kinds of thing.** `KIND_VALUE`, `KIND_NAME`, `BAR` and `BRICK_KIND`
  are the economy's, not the physics'. All the physics needs of a kind is its
  radius.
- **Chance.** `spawn` calls `Math.random`, which the drone sim has to swap
  out to get a repeatable run. A world should take its own random source.
- **The tuning.** Gravity, friction, restitution, sleep thresholds, and how
  stiff the belts and blades are, are constants tuned for coins at this
  scale. They should be options, with today's values as the defaults.

Moving it will change how the rest of the game is built: it will make a
world by handing the physics its rock, its holes and its kinds, and read
back what fell in, rather than the physics reaching into the game for them.
The plan is to cut those ties first, inside this repo, with the physics
importing nothing from the game, and to lift it into its own package once a
second game or demo wants it.

### No tight coupling, anywhere

That goes for every part of the game, not just the physics. Build each
piece so it could be lifted out:

- A module takes what it needs as arguments or options, when it is made or
  called; it does not import the game's constants, content or state to find
  it out for itself.
- Game content — rooms, prices, values, names — stays in the modules that
  own it (`cave.ts`, `economy.ts`), and flows out from there. Nothing lower
  down, like the physics, the navigation or the machines, should hold any.
- Talk across boundaries through small interfaces and plain data (a
  `Pusher`, a `Belt`, a callback for what fell in), not by reaching into
  another module's internals.
- Nothing global that a caller cannot replace: chance, time and storage are
  handed in, so a module can be run headless, repeatably, and tested alone.
- `main.ts` is the one place that knows about everything, and wires it
  together.

New code should follow this now, and existing code should move toward it
when it is next worked on.
