/**
 * The Deep and the West Gallery's way out to it, played: each hole banking, the belts carrying, the way out
 * opening and leaving, and saves from the West Gallery of before it had a way out, finished players staying
 * finished. Each plays a cave for seconds, so they are in the full check; what can be read off the content is in
 * `../deep.test.ts`.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { arrival, buildCave } from '../../src/cave';
import { Economy, memoryStore } from '../../src/economy';
import { Game, SETTLE_STEPS } from '../../src/game';
import { checkInvariants } from '../../src/invariants';
import { BAR } from '../../src/physics';
import { onward } from '../../scripts/run';
import { RUN, caveOf, gameIn, newEconomy, saveIn, specOf, withSeed } from '../helpers';

const DT = 1 / 60;
const still = { throttle: 0, steer: 0 };
const deep = specOf('deep');

describe('the Deep, played', () => {
  it('banks what is pushed down each of its three holes', () => {
    withSeed(5, () => {
      const game = gameIn('deep');
      const before = game.economy.bank;
      deep.holes.forEach((h, k) => {
        expect(game.stock.spawn(1, h.x, h.y, 2), `a ruby over hole ${k}`).toBe(true);
        for (let f = 0; f < 120; f++) game.step(DT, still);
        expect(game.economy.bank, `after a ruby down hole ${k}`).toBe(before + 10 * (k + 1));
      });
    });
  });

  it('carries a load off either belt to its hole, both running at once', () => {
    withSeed(6, () => {
      const bars: number[] = [];
      const game = gameIn(
        'deep',
        { belts: deep.belts.map((b) => b.id) },
        { banked: (kind) => kind === BAR && bars.push(bars.length) },
      );
      expect(game.running(), 'both belts run').toEqual([0, 1]);
      deep.belts.forEach(({ spec: s }, k) => {
        const x = s.x0 + (s.x1 - s.x0) * 0.6,
          y = s.y0 + (s.y1 - s.y0) * 0.6;
        expect(game.stock.spawn(BAR, x, y, 1.2), `a bar on belt ${k}`).toBe(true);
      });
      for (let f = 0; f < 60 * 30 && bars.length < 2; f++) game.step(DT, still);
      expect(bars.length, 'a bar banked off each belt').toBe(2);
    });
  });

  it('arrives the machine at its way in, facing in, on floor', () => {
    const cave = caveOf('deep');
    const at = arrival(cave);
    const game = gameIn('deep');
    expect(game.dozer.x).toBeCloseTo(at.x, 6);
    expect(game.dozer.y).toBeCloseTo(at.y, 6);
    expect(checkInvariants(game)).toEqual([]);
  });
});

describe('the West Gallery’s way out, played', () => {
  const west = specOf('west-gallery');

  it('clearing it opens the way out, and does not end the game', () => {
    withSeed(21, () => {
      const game = gameIn('west-gallery');
      sendAllDown(game);
      for (let f = 0; f < 4000 && !game.economy.save.open; f++) game.step(DT, still);
      expect(game.economy.save.open, 'the way out opened').toBe(true);
      expect(game.economy.save.done, 'and the game is not done').toBe(false);
      expect(game.fountains, 'no cracking floors in a cave that is not the last').toHaveLength(0);
    });
  });

  it('driven out of, lands in the Deep at its way in, with what the player carries', () => {
    withSeed(22, () => {
      const economy = newEconomy(saveIn('west-gallery', { open: true, bank: 123, engine: 2, drones: 1 }));
      const game = new Game(economy, caveOf('west-gallery'));
      const exit = west.exit!;
      const [x0, , x1, y1] = exit.tiles;
      const cave = game.cave;
      const tx = (x0 + x1) / 2,
        ty = y1 - 1;
      const x = cave.grid.originX + (tx + 0.5) * 4,
        y = cave.grid.originY + (ty + 0.5) * 4;
      Object.assign(game.dozer, { x, y, yaw: Math.PI / 2, speed: 8 });
      game.step(DT, still);
      expect(game.left, 'the West Gallery is left').toBe(true);
      const next = onward(game, economy, RUN);
      expect(next.cave.spec.id).toBe('deep');
      expect(economy.bank).toBe(123);
      expect(economy.save.engine).toBe(2);
      expect(economy.save.drones).toBe(1);
      expect(next.dozer.x).toBeCloseTo(arrival(next.cave).x, 6);
      expect(checkInvariants(next)).toEqual([]);
    });
  });
});

describe('saves from the West Gallery, from before it had a way out', () => {
  it('a done save stays done, where it is: not sent on, the vein running', () => {
    withSeed(23, () => {
      const old = JSON.parse(readFileSync(new URL('../saves/08-barrels.json', import.meta.url), 'utf8')) as {
        done: boolean;
      };
      old.done = true;
      const economy = new Economy(memoryStore(JSON.stringify(old)), RUN);
      expect(economy.save.cave).toBe('west-gallery');
      expect(economy.save.done).toBe(true);
      const game = new Game(economy, caveOf('west-gallery'));
      expect(game.fountains, 'the floor still cracks').toHaveLength(1);
      for (let f = 0; f < 600; f++) game.step(DT, still);
      // nothing to be sent on by: the way out is never opened for a finished game
      economy.open();
      economy.moveOn();
      expect(economy.save.cave).toBe('west-gallery');
      expect(economy.save.done).toBe(true);
      expect(economy.save.open).toBe(false);
      expect(game.left).toBe(false);
      expect(checkInvariants(game)).toEqual([]);
    });
  });

  it('one that is not done goes on to the Deep through the new way out, as anyone would', () => {
    withSeed(24, () => {
      const old = readFileSync(new URL('../saves/08-barrels.json', import.meta.url), 'utf8');
      const economy = new Economy(memoryStore(old), RUN);
      expect(economy.save.cave).toBe('west-gallery');
      expect(economy.save.done).toBe(false);
      const game = new Game(economy, caveOf('west-gallery'));
      sendAllDown(game);
      for (let f = 0; f < 4000 && !economy.save.open; f++) game.step(DT, still);
      expect(economy.save.open, 'its way out opens').toBe(true);
      // opened by the toll, which the cave's coins pay first, before nine tenths of it are banked
      expect(economy.owed()).toBe(0);
      // out through the way it now has, as a player would, and not by the save's say-so alone
      const [x0, , x1, y1] = specOf('west-gallery').exit!.tiles;
      const { grid } = game.cave;
      Object.assign(game.dozer, {
        x: grid.originX + ((x0 + x1) / 2 + 0.5) * 4,
        y: grid.originY + (y1 - 1 + 0.5) * 4,
        yaw: Math.PI / 2,
        speed: 8,
      });
      game.step(DT, still);
      expect(game.left, 'the West Gallery is left').toBe(true);
      const next = onward(game, economy, RUN);
      expect(next.cave.spec.id).toBe('deep');
      expect(economy.save.cave).toBe('deep');
      expect(economy.save.done).toBe(false);
    });
  });
});

describe('the Deep’s heaps, settled in fewer steps', () => {
  /** The Deep's game from a seed, its heaps let fall for `settle` steps, and then played still for `frames`: where every body is, hashed. */
  function atRest(settle: number, frames: number) {
    return withSeed(31, () => {
      const economy = newEconomy(saveIn('deep'));
      const game = new Game(economy, buildCave({ ...deep, settle }));
      const awake = () => {
        let n = 0;
        for (let i = 0; i < game.world.count; i++) if (game.world.alive[i] && !game.world.asleep[i]) n++;
        return n;
      };
      const awakeAtSwap = awake();
      for (let f = 0; f < frames; f++) game.step(DT, still);
      const { world } = game;
      const xs = [
        ...world.x.subarray(0, world.count),
        ...world.y.subarray(0, world.count),
        ...world.z.subarray(0, world.count),
      ];
      return {
        awakeAtSwap,
        awakeAfter: awake(),
        hash: createHash('sha256').update(JSON.stringify(xs)).digest('hex').slice(0, 16),
      };
    });
  }

  it('asks fewer steps than the rest of the run, which keep the usual number', () => {
    expect(deep.settle).toBeLessThan(SETTLE_STEPS);
    for (const c of RUN.filter((c) => c.id !== 'deep')) expect(c.settle, `${c.id} settles as it did`).toBeUndefined();
  });

  it('leaves every heap where it would lie after the usual number: the rest of the settling is done in the frames after', () => {
    const usual = atRest(SETTLE_STEPS, 900);
    const fewer = atRest(deep.settle!, 900);
    expect(fewer.awakeAtSwap, 'more still moving when the swap is over').toBeGreaterThan(usual.awakeAtSwap);
    expect(fewer.awakeAfter, 'and none a few seconds on').toBe(0);
    expect(usual.awakeAfter).toBe(0);
    expect(fewer.hash, 'at rest, the same heaps').toBe(usual.hash);
  });
});

/** Every coin of the cave itself, sent down the holes at once. */
function sendAllDown(game: Game) {
  const { world, stock } = game;
  const { holes } = game.cave;
  let n = 0;
  for (let i = 0; i < world.count; i++) {
    if (!world.alive[i] || stock.origin[i] !== 0) continue;
    const hole = holes[n % holes.length];
    const a = n++ * 2.399;
    const r = 0.5 + (n % 9) * 0.3;
    world.x[i] = hole.x + Math.cos(a) * r;
    world.y[i] = hole.y + Math.sin(a) * r;
    world.z[i] = 2 + (n % 5) * 0.1;
    world.vx[i] = world.vy[i] = world.vz[i] = 0;
    world.wake(i);
  }
}
