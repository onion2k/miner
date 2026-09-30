import { describe, expect, it } from 'vitest';
import { checkInvariants } from '../src/invariants';
import { BARREL_KIND } from '../src/physics';
import { fuzz } from '../scripts/fuzzer';
import { gameIn, newGame, specOf, withSeed } from './helpers';

const DT = 1 / 60;
const still = { throttle: 0, steer: 0 };

/** A new game on the first cave, and a note of every event it tells. */
function told(json: string | null = null) {
  const log: string[] = [];
  const events = new Proxy(
    {},
    {
      get:
        (_, name: string) =>
        (...args: unknown[]) =>
          log.push(`${name} ${args.filter((a) => typeof a === 'number' || typeof a === 'string').join(' ')}`.trim()),
    },
  );
  const game = newGame(json, events);
  return { game, told: log };
}

describe('the game', () => {
  it('starts in the hollow with its heaps and barrels, and nothing that must hold broken', () => {
    withSeed(1, () => {
      const { game } = told();
      expect(game.economy.save.cave).toBe('hollow');
      expect(game.world.live).toBeGreaterThan(1000);
      expect(game.stock.kinds[BARREL_KIND]).toBe(specOf('hollow').barrels);
      expect(checkInvariants(game)).toEqual([]);
    });
  });

  it('banks what goes down the hole, and tells of it', () => {
    withSeed(2, () => {
      const { game, told: log } = told();
      const coin = [...Array(game.world.count).keys()].find((i) => game.world.alive[i] && game.world.kind[i] === 0)!;
      game.world.x[coin] = 0;
      game.world.y[coin] = 0;
      game.world.z[coin] = 2;
      game.world.wake(coin);
      for (let f = 0; f < 120; f++) game.step(DT, still);
      expect(game.economy.bank).toBe(1);
      expect(log.some((t) => t.startsWith('banked'))).toBe(true);
    });
  });

  it('opens the way out when the cave is cleared, and tells of it', () => {
    withSeed(3, () => {
      const { game, told: log } = told();
      game.economy.open();
      expect(log.some((t) => t.startsWith('exitOpened'))).toBe(true);
      expect(game.economy.save.open).toBe(true);
      expect(checkInvariants(game)).toEqual([]);
    });
  });

  it('does not light a barrel of the cave behind in the next: each game has its own fuses', () => {
    withSeed(4, () => {
      const game = gameIn('hollow', { open: true });
      const barrel = [...Array(game.world.count).keys()].find(
        (i) => game.world.alive[i] && game.world.kind[i] === BARREL_KIND,
      )!;
      game.barrels.light(barrel, 30);
      expect(game.barrels.lit).toEqual([barrel]);
      const next = gameIn('south-gallery');
      expect(next.barrels.lit).toEqual([]);
      expect(checkInvariants(next)).toEqual([]);
    });
  });

  it('comes back from its save as it was left', () => {
    withSeed(5, () => {
      const { game } = told();
      game.economy.deposit(700);
      for (let f = 0; f < 60; f++) game.step(DT, { throttle: 1, steer: 0.3 });
      game.persist();
      const json = JSON.stringify(game.economy.save);
      const again = newGame(json);
      expect(again.economy.save.bank).toBe(game.economy.save.bank);
      expect(again.economy.save.cave).toBe(game.economy.save.cave);
      expect(again.stock.left).toEqual(game.stock.left);
      expect(again.stock.kinds[BARREL_KIND]).toBe(game.stock.kinds[BARREL_KIND]);
      expect(checkInvariants(again)).toEqual([]);
    });
  });

  it('holds together played at random, a seed of the fuzzer, briefly (`npm run fuzz` does the many)', () => {
    for (const seed of [101]) {
      const result = fuzz(seed, 900);
      if (result.failure)
        expect.fail(`seed ${seed}: ${result.failure.problems.join('; ')}\n${result.failure.log.join('\n')}`);
    }
  });
});
