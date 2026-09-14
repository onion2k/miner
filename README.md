# Pushminer

A bulldozer in a cave full of coins, and a hole to push them into.

Drive with **W A S D** (or the arrows), shove coins and gems into the hole to
bank them, and press **B** for the workshop: a bigger engine, a wider blade,
a stronger magnet, a conveyor belt for the room you are in, and drones that
go and fetch things. Drag to orbit the camera, wheel to zoom, **C** to put it
back, **M** to mute. Progress is saved in the browser; the workshop has a
*start over* button.

The cave is five rooms, and nothing refills them. Bank nine tenths of what a
room holds and the rock at the next gate comes down: the Hollow, then the
South Gallery, the East Gallery, the North Vault and the West Gallery, each
with dearer gems than the last. A gold arrow at the edge of the screen points
to the open gate. Chase the last tenth or leave it: drive on through the new
gate and down its corridor and the room behind is sealed, with whatever was
still in it. Up at the gate the game says so, and the line that seals it
glows red. Only a room or two is ever in play, so a cave that has been worked
through does not weigh on the frame.

Off each gallery a stretch of the wall looks like any other rock and is not.
Knock into it and it sounds hollow; drive square into it at speed and it
smashes, and behind it is a hidden chamber with gold bars in it. What is in a
chamber does not count toward clearing the room, and whatever is still in it
when the room is sealed is gone with the room.

The drones work the room being cleared, finding their way round the rock and
the heaps, and give a loaded machine the road. With a belt running they push
a load to whichever is nearer, the belt or the hole, and leave the belt to
carry it. Once the West Gallery is cleared too, its vein trickles coins in and
its floor now and then cracks, glows, and throws up a fountain of them.

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

## How it is put together

    src/main.ts       boot, the scene's groups, lights, particles, the HUD, the frame loop
    src/cave.ts       the tile grid: rooms and the order they open in, gates, heaps, veins, belt routes
    src/physics.ts    the coins as spheres: spatial hash, sleeping, floor, hole, walls, pushers, belts
    src/dozer.ts      the bulldozer: tank steering, the blade and hull as pushers, load
    src/tools.ts      conveyor belts, drones, and the fountains
    src/nav.ts        the way round the rock and the heaps, for the drones
    scripts/sim.ts    the drones without the picture, for measuring them
    src/audio.ts      every sound, synthesised: clinks, thunks, the engine, the rumble
    src/economy.ts    the bank, the upgrades, which room is being cleared, the save, the shop
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
