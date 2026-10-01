/**
 * Geodes: boulders that stand about a cave, worth nothing whole, with gems in them. A barrel's blast close enough
 * cracks one open: the stone is gone and the gems it held are thrown out, to be pushed down the hole for money.
 * Nothing else cracks one, not the dozer ramming it and not a drone pushing it about, so the way to the gems is
 * through a barrel, and a barrel has to be got to the stone.
 *
 * (The Deep's biome is also called geode, in `geode.ts`. This is the body.) A geode is a body in the world of
 * its own kind; this works out which of them a blast reaches and where what is inside them goes. The world is
 * handed in, and nothing else of the game, so it is the game that removes the stone and spawns the gems: a
 * blast walks the world's slots, and a gem spawned in the middle of that walk would be visited by it.
 */
import type { GemKind } from './cave';
import { hash } from './noise';
import { GEODE_KIND, type World } from './physics';

/** How near a blast has to be to crack a geode: well inside the blast's own reach, so a barrel has to be brought close. */
export const CRACK_RADIUS = 8;

/** Where a blast is, as far as a geode is concerned. */
export interface Burst {
  x: number;
  y: number;
  z: number;
}

/** The slots of the geodes a blast cracks: those standing within `CRACK_RADIUS` of it, as the blast itself measures. Not one that is carried. */
export function cracked(blast: Burst, world: World): number[] {
  const out: number[] = [];
  for (let i = 0; i < world.count; i++) {
    if (!world.alive[i] || world.carried[i] || world.kind[i] !== GEODE_KIND) continue;
    const d = Math.hypot(world.x[i] - blast.x, world.y[i] - blast.y, (world.z[i] - blast.z) * 0.5);
    if (d < CRACK_RADIUS) out.push(i);
  }
  return out;
}

/** A gem thrown out of a geode: its kind, where it starts and how fast it goes. */
export interface Piece {
  kind: GemKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

/** The angle a fan of things is spread by, so no two go the same way and none bunches up. */
const GOLDEN = 2.399963;

/**
 * Where the gems of a geode that stood at (x, y, z) start, and how they go: out from its middle, spread all round
 * and in layers so none begins inside another, each thrown outward and up. The same for the same `salt`, with no
 * chance in it, so a run is the same twice.
 */
export function scatter(holds: readonly [GemKind, number][], x: number, y: number, z: number, salt: number): Piece[] {
  const out: Piece[] = [];
  const turn = hash(salt, 17, 3) * Math.PI * 2;
  let k = 0;
  for (const [kind, n] of holds) {
    for (let j = 0; j < n; j++, k++) {
      const a = turn + k * GOLDEN,
        r = 0.4 + 0.9 * ((k * 0.618) % 1);
      const speed = 4 + (k % 3) * 1.5;
      out.push({
        kind,
        x: x + Math.cos(a) * r,
        y: y + Math.sin(a) * r,
        z: z + 0.2 + (k % 4) * 0.9,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        vz: 5 + (k % 2) * 2,
      });
    }
  }
  return out;
}
