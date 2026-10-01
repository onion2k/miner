/**
 * What the foreman sends the drones after when a cave has more than one hole: each coin is for the hole it
 * is nearest along the floor, whichever drone takes it, and the drone keeps to that hole. Shown on a long
 * room with a hole at each end and stacks of coins by each, so the cave's own coins and holes do not get in
 * the way of what is being looked at.
 */
import { describe, expect, it } from 'vitest';
import { buildCave, type CaveSpec } from '../src/cave';
import { botHome } from '../src/game';
import { Nav } from '../src/nav';
import { makeWorld } from '../src/physics';
import { Bot, Foreman } from '../src/tools';
import { TEST_BODIES, caveOf } from './helpers';

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
  const world = makeWorld(TEST_BODIES, solid, cave.grid, cave.holes);
  const stack = (x: number, y: number, n: number) => {
    for (let k = 0; k < n; k++) world.spawn(0, x + (k % 3) * 0.5, y + ((k / 3) | 0) * 0.5, 0.6);
  };
  for (let k = 0; k < (options.west ?? 3); k++) stack(-24, -16 + k * 16, 9);
  for (let k = 0; k < (options.east ?? 3); k++) stack(24, -16 + k * 16, 6);
  const nav = new Nav(solid, cave.grid, cave.holes);
  const bots = [new Bot(solid, cave.grid, 1, 0, -3), new Bot(solid, cave.grid, 2, 0, 3)];
  const origin = new Uint8Array(TEST_BODIES);
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

describe('what the player’s scoop holds', () => {
  it('is not for a drone to go after, and a drone that had chosen it lets it go', () => {
    const { picks, world, bots, nav, solid } = choices({ east: 0, west: 1 });
    const first = picks[0].coin;
    expect(first, 'a coin to go for').toBeGreaterThanOrEqual(0);
    // everything lying in the cave taken up by a scoop: nothing is left to choose
    for (let i = 0; i < world.count; i++) if (world.alive[i]) world.carried[i] = 1;
    const origin = new Uint8Array(TEST_BODIES);
    const foreman = new Foreman(world, nav, bots, origin, () => true);
    expect(foreman.choose(bots[1], 5), 'all of it held').toBe(-1);
    // half of it let go: what it picks is among the half that is not held
    const lying = [...Array(world.count).keys()].filter((i) => world.alive[i]);
    lying.forEach((i, k) => (world.carried[i] = k % 2 ? 1 : 0));
    const again = new Foreman(world, nav, bots, origin, () => true);
    for (const bot of bots) bot.coin = -1;
    const i = again.choose(bots[0], 5);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(world.carried[i], 'not a held one').toBe(0);
    // a drone on its way to a coin that is taken up gives it up on the next look
    const bot = new Bot(solid, cave.grid, 3, -10, 0);
    bot.coin = first;
    bot.state = 'approach';
    bot['setUp'] = [0, 0];
    world.carried[first] = 1;
    bot.decide(DT, world, 0, nav, () => -1, { bots, player: bots[0].dozer });
    expect(bot.coin, 'let go of').toBe(-1);
  });
});

describe('what the player’s scoop takes up after the drones have looked', () => {
  it('is skipped from the list the foreman keeps, even a long one it can only sample, and from the list as it was kept', () => {
    const world = makeWorld(TEST_BODIES, cave.solid(false), cave.grid, cave.holes);
    const nav = new Nav(cave.solid(false), cave.grid, cave.holes);
    const bots = [new Bot(cave.solid(false), cave.grid, 1, 0, -3)];
    const foreman = new Foreman(world, nav, bots, new Uint8Array(TEST_BODIES), () => true);
    // five hundred coins on the floor by the west hole, all held but the last
    const slots: number[] = [];
    for (let k = 0; k < 500; k++) slots.push(world.spawn(0, -40 + (k % 25) * 0.6, -14 + Math.floor(k / 25) * 0.6, 0.6));
    const last = slots[slots.length - 1];
    for (const i of slots) world.carried[i] = i === last ? 0 : 1;
    // listed afresh each time, a half second apart: with only the one lying, it is the one it finds, every time
    for (let t = 1; t <= 12; t += 1.5) expect(foreman.choose(bots[0], t), `at ${t}`).toBe(last);
    // and listed while five were lying, then four of them taken up inside the half second the list is kept for
    for (const i of slots) world.carried[i] = i < slots[5] ? 0 : 1;
    foreman.choose(bots[0], 100);
    for (const i of slots.slice(0, 4)) world.carried[i] = 1;
    expect(foreman.choose(bots[0], 100.1), 'the list as it was kept').toBe(slots[4]);
    world.carried[slots[4]] = 1;
    expect(foreman.choose(bots[0], 100.2)).toBe(-1);
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
