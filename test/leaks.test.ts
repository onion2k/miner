/**
 * What must stay bounded over a long game, and the tool that watches it.
 * The run itself is too long for a unit test — `npm run leaks` does that —
 * so what is tested here is the measuring: that the sizes are read off the
 * game properly, and that the thing which decides what is growing says so
 * when it is, and holds its tongue when it is not.
 */
import { describe, expect, it } from 'vitest';
import { WATCH, grew, sizes, trouble } from '../scripts/leaks';
import { Economy, memoryStore } from '../src/economy';
import { Game } from '../src/game';
import { withSeed } from './helpers';

describe('what must stay bounded', () => {
  it('reads the sizes off a game, and they move with it', () => {
    withSeed(1, () => {
      const game = new Game(new Economy(memoryStore()));
      const before = sizes(game);
      for (const key of ['bodies', 'slots', 'fuses lit', 'rubble', 'lamps broken', 'save bytes']) {
        expect(Object.keys(before), `${key} measured`).toContain(key);
        expect(Number.isFinite(before[key])).toBe(true);
      }
      // a barrel lit, a lamp knocked over: the sizes say so
      const barrel = game.stock.barrelRecord().length ? game.barrels : game.barrels;
      const slot = [...Array(game.world.count).keys()].find((i) => game.world.alive[i] && game.world.kind[i] === 7)!;
      barrel.light(slot);
      game.economy.breakLamp(2);
      game.persist();
      const after = sizes(game);
      expect(after['fuses lit']).toBe(before['fuses lit'] + 1);
      expect(after['lamps broken']).toBe(before['lamps broken'] + 1);
      expect(after['save bytes']).toBeGreaterThan(0);
    });
  });

  it('has a ceiling for every size it measures, and watches the caches for growth', () => {
    withSeed(1, () => {
      const game = new Game(new Economy(memoryStore()));
      for (const key of Object.keys(sizes(game))) expect(Object.keys(WATCH), `a ceiling for ${key}`).toContain(key);
      // the things kept and then forgotten again are the ones a leak lives in
      expect(
        Object.entries(WATCH)
          .filter(([, w]) => w?.steady)
          .map(([k]) => k),
      ).toEqual(['patches swept', 'heap MB']);
    });
  });

  it('knows a size that grows from one that wanders', () => {
    // flat, noisy, and settling back: none of them growing
    expect(grew(new Array<number>(12).fill(40))).toBe(false);
    expect(grew([40, 44, 38, 41, 45, 39, 42, 40, 43, 38, 41, 40])).toBe(false);
    expect(grew([10, 80, 120, 90, 60, 44, 40, 38, 41, 39, 40, 38])).toBe(false);
    // a slow creep, and a fast one: both growing
    expect(grew([40, 44, 49, 54, 60, 66, 73, 80, 88, 97, 107, 118])).toBe(true);
    expect(grew([40, 60, 90, 140, 200, 280, 380, 500, 640, 800, 980, 1200])).toBe(true);
    // too few samples to say
    expect(grew([1, 2, 9])).toBe(false);
  });

  it('reports a size over its ceiling, and one that keeps growing', () => {
    const flat = new Array<number>(12).fill(10);
    const creeping = [10, 12, 15, 18, 22, 27, 33, 40, 49, 60, 73, 89];
    expect(trouble({ bodies: flat, 'patches swept': flat })).toEqual([]);
    expect(trouble({ 'patches swept': creeping }).join()).toMatch(/patches swept.*grew/);
    expect(trouble({ bodies: [1, 99_999] }).join()).toMatch(/bodies.*over its ceiling/);
    // what rises and falls with the rooms is held by its ceiling alone, so a room opened at the end is not a leak
    expect(trouble({ bodies: creeping })).toEqual([]);
  });
});
