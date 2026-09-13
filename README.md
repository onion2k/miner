# Pushminer

A bulldozer in a cave full of coins, and a hole to push them into.

Drive with **W A S D** (or the arrows), shove coins and gems into the hole to
bank them, and press **B** for the workshop: a bigger engine, a wider blade,
a stronger magnet, the two locked rooms beyond the gates, a conveyor belt
for each, and drones that go and fetch things. Drag to orbit the camera,
wheel to zoom, **C** to put it back, **M** to mute. Progress is saved in the
browser; the workshop has a *start over* button.

Now and then a room's floor cracks, glows, and throws up a fountain of coins.
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

## How it is put together

    src/main.ts       boot, the scene's groups, lights, particles, the HUD, the frame loop
    src/cave.ts       the tile grid: rooms, gates, heaps, veins, belt routes
    src/physics.ts    the coins as spheres: spatial hash, sleeping, floor, hole, walls, pushers, belts
    src/dozer.ts      the bulldozer: tank steering, the blade and hull as pushers, load
    src/tools.ts      conveyor belts, drones, and the fountains
    src/audio.ts      every sound, synthesised: clinks, thunks, the engine, the rumble
    src/economy.ts    the bank, the upgrades, the save, the shop
    src/meshes.ts     flat-shaded shapes: coin, gem, box, cone, ball, the hole's collar and pit
    src/matrix.ts     column-major placements
    src/input.ts      the keyboard

The coins collide as balls a little smaller than their rims, which is what
lets thousands of them be stepped in JavaScript at 120 Hz. They are drawn
flat when resting on the floor and tumbling when they fly. A body that has
barely moved over a third of a second goes to sleep and costs nothing until
something arrives with intent — the blade wakes what is ahead of it before
it gets there.

The blade's load slows the engine: a heap in front of the blade is a heap
the engine has to move, and that is what the engine upgrades are for.
