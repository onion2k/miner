import { describe, expect, it } from 'vitest';
import { AREAS, BODY_CAPACITY, HOLE, ORDER, SECRETS, STASHES, WALLS, buildCave } from '../src/cave';
import { SOURCES, chamberSource, roomStock, stashSource } from '../src/economy';
import { BRICK_KIND, KINDS, KIND_VALUE, World } from '../src/physics';
import { NO_SOURCE, Stock, lootHeap, type Progress, type SavedStock } from '../src/stock';
import { withSeed } from './helpers';

const CAPACITY = [0, 320, 240, 260, 160, 60, 900];
const cave = buildCave();
const fresh = () => new World(BODY_CAPACITY, cave.solid(AREAS.map(() => true)));
/** Where the player has got to: `room` being cleared, and the next open if `nextOpen`. */
const at = (n: number, nextOpen = false): Progress => ({
  current: () => ORDER[n],
  next: () => ORDER[n + 1] ?? null,
  nextOpen: () => nextOpen,
  sealed: (a) => ORDER.indexOf(a) < n,
});
const nothingSaved = (over: Partial<SavedStock> = {}): SavedStock => ({
  left: [],
  done: false,
  secrets: SECRETS.map(() => false),
  walls: WALLS.map(() => false),
  rubble: [],
  ...over,
});
const total = (stock: Stock, from: number) => stock.left[from].reduce((s, n, k) => s + n * KIND_VALUE[k], 0);

describe('the stock', () => {
  it('puts back a room whole when nothing was saved of it, and its side rooms', () => {
    withSeed(1, () => {
      const world = fresh();
      const stock = new Stock(world, CAPACITY, () => ORDER[1]);
      stock.restore(nothingSaved(), at(1));
      const room = ORDER[1];
      expect(stock.left[room]).toEqual(roomStock(room).kinds);
      expect(stock.banked(room)).toBe(0);
      for (const [k, st] of STASHES.entries())
        if (st.area === room) expect(total(stock, stashSource(k))).toBeGreaterThan(0);
      expect(world.live).toBe(stock.kinds.reduce((a, b) => a + b, 0));
    });
  });

  it('puts back as much of a room as was left, and none of a sealed room or its chamber', () => {
    withSeed(2, () => {
      const room = ORDER[2],
        behind = ORDER[1];
      const left: number[][] = Array.from({ length: SOURCES }, () => new Array<number>(KINDS).fill(0));
      left[room] = roomStock(room).kinds.map((n) => Math.floor(n / 2));
      left[chamberSource(SECRETS.findIndex((s) => s.area === behind))] = [10, 0, 0, 0, 0, 2, 0];
      const secrets = SECRETS.map((s) => s.area === behind);
      const stock = new Stock(fresh(), CAPACITY, () => room);
      stock.restore(nothingSaved({ left, secrets }), at(2));
      expect(stock.banked(room)).toBeGreaterThan(0.45);
      expect(stock.banked(room)).toBeLessThan(0.55);
      expect(total(stock, behind)).toBe(0);
      expect(
        stock.left
          .slice(AREAS.length, AREAS.length + SECRETS.length)
          .flat()
          .every((n) => n === 0),
      ).toBe(true);
    });
  });

  it('reads a save from before the gold bars, a kind short', () => {
    withSeed(3, () => {
      const room = ORDER[1];
      const left: (number[] | undefined)[] = [];
      left[room] = roomStock(room)
        .kinds.slice(0, 5)
        .map((n) => Math.floor(n / 4));
      const stock = new Stock(fresh(), CAPACITY, () => room);
      stock.restore(nothingSaved({ left }), at(1));
      expect(stock.banked(room)).toBeGreaterThan(0.7);
    });
  });

  it('puts back the bricks where they lay, with their grades', () => {
    const world = fresh();
    const stock = new Stock(world, CAPACITY, () => 0);
    stock.restore(nothingSaved({ done: true, rubble: [-30, 10, 0.8, 2, -32, 10, 0.8, 3] }), at(0));
    expect(stock.kinds[BRICK_KIND]).toBe(2);
    const bricks = [...Array(world.count).keys()].filter((i) => world.alive[i] && world.kind[i] === BRICK_KIND);
    expect(bricks.map((i) => stock.brickGrade[i])).toEqual([2, 3]);
    expect(bricks.every((i) => stock.origin[i] === NO_SOURCE)).toBe(true);
    // and records them back the same
    expect(stock.rubble().filter((_, k) => k % 4 === 3)).toEqual([2, 3]);
  });

  it('counts what goes down the hole off the source it came from, and a brick for nothing', () => {
    const world = fresh();
    const stock = new Stock(world, CAPACITY, () => 1);
    stock.spawn(1, HOLE.x, HOLE.y, 2);
    stock.spawnBrick(1, HOLE.x + 0.5, HOLE.y, 2);
    const values: number[] = [];
    for (let f = 0; f < 240; f++) world.step(1 / 60, (kind, _x, _y, i) => values.push(stock.collect(kind, i)));
    expect(values.sort((a, b) => a - b)).toEqual([0, KIND_VALUE[1]]);
    expect(stock.left[1][1]).toBe(0);
    expect(stock.kinds.every((n) => n === 0)).toBe(true);
  });

  it('refuses more of a kind than can be drawn', () => {
    const stock = new Stock(fresh(), [0, 2, 0, 0, 0, 0, 1], () => 0);
    expect([1, 2, 3].map(() => stock.spawn(1, -30, 10, 1))).toEqual([true, true, false]);
    expect(stock.spawnBrick(1, -30, 12, 1)).toBeGreaterThanOrEqual(0);
    expect(stock.spawnBrick(1, -30, 14, 1)).toBe(-1);
  });

  it('takes a sealed room out of the world, with its chamber, and leaves the rest', () => {
    withSeed(4, () => {
      const world = fresh();
      const room = ORDER[1],
        next = ORDER[2];
      const stock = new Stock(world, CAPACITY, () => room);
      stock.openRoom(room);
      stock.openRoom(next);
      const k = SECRETS.findIndex((s) => s.area === room);
      stock.spawnHeap(chamberSource(k), lootHeap(k));
      stock.spawnBrick(1, -30, 10, 1);
      const nextLeft = total(stock, next);
      let puffs = 0;
      stock.seal(room, () => puffs++);
      expect(puffs).toBeGreaterThan(0);
      expect(total(stock, room)).toBe(0);
      expect(total(stock, chamberSource(k))).toBe(0);
      expect(total(stock, next)).toBe(nextLeft);
      expect(stock.kinds[BRICK_KIND]).toBe(1);
      expect(world.live).toBe(stock.kinds.reduce((a, b) => a + b, 0));
    });
  });
});
