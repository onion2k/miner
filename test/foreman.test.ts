/**
 * What the foreman sends the drones after when a cave has more than one hole: each coin is for the hole it
 * is nearest along the floor, whichever drone takes it, and the drone keeps to that hole. Shown on a long
 * room with a hole at each end and stacks of coins by each, so the cave's own coins and holes do not get in
 * the way of what is being looked at.
 */
import { describe, expect, it } from 'vitest';
import { BODY_CAPACITY, buildCave, type CaveSpec } from '../src/cave';
import { botHome } from '../src/game';
import { Nav } from '../src/nav';
import { makeWorld } from '../src/physics';
import { Bot, Foreman } from '../src/tools';
import { caveOf } from './helpers';

const LONG_ROOM: CaveSpec = {
  id: 'long-room',
  name: 'The Long Room',
  blurb: 'coins, and a hole at each end',
  biome: null,
  cols: 40,
  rows: 24,
  shapes: [{ kind: 'ellipse', cx: 20, cy: 12, rx: 18, ry: 10, seed: 1.7 }],
  holes: [
    { x: -48, y: 0, radius: 5.5, depth: 14 },
    { x: 48, y: 0, radius: 5.5, depth: 14 },
  ],
  heaps: [],
  vein: { x: 0, y: 30, every: 5, coins: 1, gems: [] },
  cracks: [[0, 30]],
  belts: [],
  entry: { tiles: [2, 11, 8, 12], out: [-1, 0] },
  exit: null,
  secrets: [],
  walls: [],
  stashes: [],
  barrels: 0,
};
const cave = buildCave(LONG_ROOM);
const DT = 1 / 60;

/**
 * Two drones in the middle of the room and stacks of coins, `west` of them by the west hole and `east` by the
 * east one, the west ones a little bigger so that each drone prefers them. The foreman has the first drone
 * choose, and the drone takes what it was given as it does in play, and then the second.
 */
function choices(options: { west?: number; east?: number } = {}) {
  const solid = cave.solid(false);
  const world = makeWorld(BODY_CAPACITY, solid, cave.grid, cave.holes);
  const stack = (x: number, y: number, n: number) => {
    for (let k = 0; k < n; k++) world.spawn(0, x + (k % 3) * 0.5, y + ((k / 3) | 0) * 0.5, 0.6);
  };
  for (let k = 0; k < (options.west ?? 3); k++) stack(-24, -16 + k * 16, 9);
  for (let k = 0; k < (options.east ?? 3); k++) stack(24, -16 + k * 16, 6);
  const nav = new Nav(solid, cave.grid, cave.holes);
  const bots = [new Bot(solid, cave.grid, 1, 0, -3), new Bot(solid, cave.grid, 2, 0, 3)];
  const origin = new Uint8Array(BODY_CAPACITY);
  const foreman = new Foreman(world, nav, bots, origin, () => true);
  const picks = bots.map((bot) => {
    const i = foreman.choose(bot, 1);
    bot.coin = i;
    return { coin: i, x: world.x[i], hole: bot.hole };
  });
  return { picks, nav, bots, solid, world };
}

describe('the holes a coin is for', () => {
  it('is the one it is nearest along the floor, for the nav and for the foreman', () => {
    const { nav } = choices({});
    expect(nav.holeOf(-24, 0)).toBe(0);
    expect(nav.holeOf(24, 0)).toBe(1);
    expect(nav.holeOf(-60, 0)).toBe(0);
    expect(nav.holeOf(1000, 1000), 'off the grid, none').toBe(-1);
    // and how far each is: the nearer is less than the further
    expect(nav.distanceTo(0, -24, 0)).toBeLessThan(nav.distanceTo(1, -24, 0));
    expect(nav.distanceTo(1, 24, 0)).toBeLessThan(nav.distanceTo(0, 24, 0));
  });
});

describe('the hole each coin is given', () => {
  it('is the second hole for a coin nearer it along the floor, and the first for one nearer that', () => {
    const east = choices({ west: 0 });
    expect(east.picks[0].coin).toBeGreaterThanOrEqual(0);
    expect(east.picks[0].x).toBeGreaterThan(0);
    expect(east.picks[0].hole, 'a coin by the east hole is for it').toBe(1);
    const west = choices({ east: 0 });
    expect(west.picks[0].x).toBeLessThan(0);
    expect(west.picks[0].hole).toBe(0);
  });

  it('is the nearest whichever drone takes it, and two drones at one hole are not split up', () => {
    // the west stacks are the better work, so both drones go for them, and both are for the west hole
    const { picks } = choices();
    expect(picks.map((p) => p.hole)).toEqual([0, 0]);
    expect(picks.every((p) => p.x < 0)).toBe(true);
    // with only the west stacks there is nowhere else to be sent: the second drone still has a coin and the same hole
    expect(choices({ east: 0 }).picks.map((p) => p.hole)).toEqual([0, 0]);
  });

  it('is forgotten by a drone that has given up its coin', () => {
    const solid = cave.solid(false);
    const bot = new Bot(solid, cave.grid, 1, 0, 0);
    bot.hole = 1;
    bot.reset();
    expect(bot.hole).toBe(-1);
  });
});

describe('a drone pushing a load', () => {
  const aimed = (hole: number, x: number, yaw: number) => {
    const { solid, world, nav, bots } = choices({});
    const bot = new Bot(solid, cave.grid, 1, x, 0);
    bot.dozer.yaw = yaw;
    bot.state = 'push';
    bot.hole = hole;
    return bot.decide(DT, world, 1, nav, () => -1, { bots, player: bots[0].dozer });
  };

  it('keeps to the hole it was sent to, even with another nearer', () => {
    // in the west, facing the east hole: straight at it, when the west hole is the nearer
    const sent = aimed(1, -30, 0);
    expect([sent.throttle, sent.steer]).toEqual([1, 0]);
    // and with no hole given, it turns for the nearer
    expect(Math.abs(aimed(-1, -30, 0).steer)).toBe(1);
    // the same drone sent to the west hole turns away from the east one it faces
    expect(Math.abs(aimed(0, -30, 0).steer)).toBe(1);
  });
});

describe('a drone sent home', () => {
  it('goes by the first hole, in every cave, with its neighbours in a row beside it', () => {
    for (const id of ['north-vault', 'east-gallery', 'hollow']) {
      const c = caveOf(id);
      for (let j = 0; j < 4; j++) {
        const [x, y] = botHome(c, j);
        expect(Math.hypot(x - c.holes[0].x, y - c.holes[0].y), `${id} drone ${j}`).toBeLessThan(40);
        for (const other of c.holes.slice(1))
          expect(Math.hypot(x - c.holes[0].x, y - c.holes[0].y)).toBeLessThan(Math.hypot(x - other.x, y - other.y));
      }
    }
  });
});
