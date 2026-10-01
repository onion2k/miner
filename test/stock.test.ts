import { describe, expect, it } from 'vitest';
import { caveStock, sourcesOf } from '../src/economy';
import { BARREL_KIND, BRICK_KIND, KINDS, KIND_VALUE, makeWorld, type World } from '../src/physics';
import { NO_SOURCE, Stock, lootHeap, type SavedStock } from '../src/stock';
import { IDS, TEST_BODIES, caveOf, withSeed } from './helpers';

const CAPACITY = [0, 320, 240, 260, 160, 60, 900];
/** The South Gallery: a belt, a chamber, a side room behind a wall, and barrels. */
const cave = caveOf('south-gallery');
const spec = cave.spec;
const SOURCES = sourcesOf(spec);
const HOLE = cave.holes[0];
const fresh = () => makeWorld(TEST_BODIES, cave.solid(true), cave.grid, cave.holes);
const nothingSaved = (over: Partial<SavedStock> = {}): SavedStock => ({
  left: [],
  done: false,
  secrets: spec.secrets.map(() => false),
  walls: spec.walls.map(() => false),
  rubble: [],
  barrels: [],
  ...over,
});
const total = (stock: Stock, from: number) => stock.left[from].reduce((s, n, k) => s + n * KIND_VALUE[k], 0);

describe('the stock', () => {
  it('puts back a cave whole when nothing was saved of it, and its side rooms', () => {
    withSeed(1, () => {
      const world = fresh();
      const stock = new Stock(cave, world, CAPACITY);
      stock.restore(nothingSaved());
      expect(stock.left[0]).toEqual(caveStock(spec).kinds);
      expect(stock.banked()).toBe(0);
      spec.stashes.forEach((_, k) => expect(total(stock, SOURCES.stash(k))).toBeGreaterThan(0));
      // a chamber not broken into has nothing out
      spec.secrets.forEach((_, k) => expect(total(stock, SOURCES.chamber(k))).toBe(0));
      expect(world.live).toBe(stock.kinds.reduce((a, b) => a + b, 0));
    });
  });

  it('puts back as much of a cave as was left, and the chamber broken into from what was left of it', () => {
    withSeed(2, () => {
      const left: number[][] = Array.from({ length: SOURCES.count }, () => new Array<number>(KINDS).fill(0));
      left[0] = caveStock(spec).kinds.map((n) => Math.floor(n / 2));
      left[SOURCES.chamber(0)] = [10, 0, 0, 0, 0, 2, 0];
      const stock = new Stock(cave, fresh(), CAPACITY);
      stock.restore(nothingSaved({ left, secrets: [true] }));
      expect(stock.banked()).toBeGreaterThan(0.45);
      expect(stock.banked()).toBeLessThan(0.55);
      expect(total(stock, SOURCES.chamber(0))).toBe(10 + 2 * KIND_VALUE[5]);
    });
  });

  it.each(IDS)('puts back exactly what was left of %s, however it is shared over the heaps', (id) => {
    withSeed(IDS.indexOf(id) + 1, () => {
      const c = caveOf(id);
      const sources = sourcesOf(c.spec);
      const left: number[][] = Array.from({ length: sources.count }, () => new Array<number>(KINDS).fill(0));
      // odd numbers of each, that no share of the heaps comes to evenly
      left[0] = caveStock(c.spec).kinds.map((n, k) => Math.max(0, Math.floor(n * 0.37) - (k % 2)));
      const world = makeWorld(TEST_BODIES, c.solid(true), c.grid, c.holes);
      const stock = new Stock(c, world, CAPACITY);
      stock.restore({
        ...nothingSaved({ left }),
        secrets: c.spec.secrets.map(() => false),
        walls: c.spec.walls.map(() => false),
      });
      expect(stock.left[0], c.spec.name).toEqual(left[0]);
    });
  });

  it('reads a save from before the gold bars, a kind short', () => {
    withSeed(3, () => {
      const left: (number[] | undefined)[] = [];
      left[0] = caveStock(spec)
        .kinds.slice(0, 5)
        .map((n) => Math.floor(n / 4));
      const stock = new Stock(cave, fresh(), CAPACITY);
      stock.restore(nothingSaved({ left }));
      expect(stock.banked()).toBeGreaterThan(0.7);
    });
  });

  it('does not put a cleared cave back when the game is done and it was emptied long ago', () => {
    const last = caveOf('west-gallery');
    const world = makeWorld(TEST_BODIES, last.solid(true), last.grid, last.holes);
    const stock = new Stock(last, world, CAPACITY);
    stock.restore({
      ...nothingSaved(),
      done: true,
      secrets: last.spec.secrets.map(() => false),
      walls: last.spec.walls.map(() => false),
    });
    expect(stock.left[0].every((n) => n === 0)).toBe(true);
  });

  it('puts back the bricks where they lay, with their grades', () => {
    const world = fresh();
    const stock = new Stock(cave, world, CAPACITY);
    stock.restore(nothingSaved({ done: true, rubble: [-30, 10, 0.8, 2, -32, 10, 0.8, 3] }));
    expect(stock.kinds[BRICK_KIND]).toBe(2);
    const bricks = [...Array(world.count).keys()].filter((i) => world.alive[i] && world.kind[i] === BRICK_KIND);
    expect(bricks.map((i) => stock.brickGrade[i])).toEqual([2, 3]);
    expect(bricks.every((i) => stock.origin[i] === NO_SOURCE)).toBe(true);
    // and records them back the same
    expect(stock.rubble().filter((_, k) => k % 4 === 3)).toEqual([2, 3]);
  });

  it('counts what goes down the hole off the source it came from, and a brick for nothing', () => {
    const world = fresh();
    const stock = new Stock(cave, world, CAPACITY);
    stock.spawn(1, HOLE.x, HOLE.y, 2);
    stock.spawnBrick(1, HOLE.x + 0.5, HOLE.y, 2);
    const values: number[] = [];
    for (let f = 0; f < 240; f++) world.step(1 / 60, (kind, _x, _y, i) => values.push(stock.collect(kind, i)));
    expect(values.sort((a, b) => a - b)).toEqual([0, KIND_VALUE[1]]);
    expect(stock.left[0][1]).toBe(0);
    expect(stock.kinds.every((n) => n === 0)).toBe(true);
  });

  it('refuses more of a kind than can be drawn', () => {
    const stock = new Stock(cave, fresh(), [0, 2, 0, 0, 0, 0, 1]);
    expect([1, 2, 3].map(() => stock.spawn(1, -30, 10, 1))).toEqual([true, true, false]);
    expect(stock.spawnBrick(1, -30, 12, 1)).toBeGreaterThanOrEqual(0);
    expect(stock.spawnBrick(1, -30, 14, 1)).toBe(-1);
  });

  it('stands the cave’s barrels where they start, for a cave just begun, and where they were left otherwise', () => {
    const barrelsIn = (world: World) =>
      [...Array(world.count).keys()].filter((i) => world.alive[i] && world.kind[i] === BARREL_KIND);
    const fresh1 = fresh();
    const placed = new Stock(cave, fresh1, CAPACITY, cave.barrels);
    placed.restore(nothingSaved({ barrels: null }));
    expect(barrelsIn(fresh1)).toHaveLength(spec.barrels);
    const record = placed.barrelRecord();
    expect(record).toHaveLength(spec.barrels * 3);
    // put back from what was saved, not from where they start
    const fresh2 = fresh();
    const again = new Stock(cave, fresh2, CAPACITY, cave.barrels);
    again.restore(nothingSaved({ barrels: record.slice(0, 3) }));
    expect(barrelsIn(fresh2)).toHaveLength(1);
    expect(again.barrelRecord()).toEqual(record.slice(0, 3));
    // and none, for a cave whose barrels have all gone off
    const fresh3 = fresh();
    const none = new Stock(cave, fresh3, CAPACITY, cave.barrels);
    none.restore(nothingSaved({ barrels: [] }));
    expect(barrelsIn(fresh3)).toEqual([]);
  });

  it('counts a barrel for nothing, down the hole or gone off', () => {
    const world = fresh();
    const stock = new Stock(cave, world, CAPACITY, cave.barrels);
    stock.restore(nothingSaved({ barrels: null }));
    const mine = [...Array(world.count).keys()].filter((i) => world.alive[i] && world.kind[i] === BARREL_KIND);
    expect(mine.length).toBeGreaterThan(1);
    expect(stock.lying()).toBe(caveStock(spec).value);
    expect(stock.collect(BARREL_KIND, mine[0])).toBe(0);
    world.remove(mine[0]);
    stock.removeBarrel(mine[1]);
    expect(world.alive[mine[1]]).toBe(0);
    expect(stock.kinds[BARREL_KIND]).toBe(mine.length - 2);
    expect(stock.lying(), 'a barrel is worth nothing').toBe(caveStock(spec).value);
  });

  it('says what leaving would lose: everything still in the cave, its chambers and side rooms too', () => {
    withSeed(4, () => {
      const stock = new Stock(cave, fresh(), CAPACITY);
      stock.restore(nothingSaved({ left: [], secrets: [true] }));
      const k = 0;
      stock.spawnHeap(SOURCES.chamber(k), lootHeap(cave, k));
      const all = [...Array(SOURCES.count).keys()].reduce((sum, s) => sum + total(stock, s), 0);
      expect(stock.lyingAll()).toBe(all);
      expect(stock.lyingAll()).toBeGreaterThan(stock.lying());
    });
  });
});
