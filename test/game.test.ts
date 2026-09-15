import { describe, expect, it } from 'vitest';
import { AREAS, ORDER, WINGS, sealPoint } from '../src/cave';
import { Economy, memoryStore } from '../src/economy';
import { Game, type GameEvents } from '../src/game';
import { checkInvariants } from '../src/invariants';
import { BARREL_KIND } from '../src/physics';
import { fuzz } from '../scripts/fuzzer';
import { withSeed } from './helpers';

const DT = 1 / 60;
const still = { throttle: 0, steer: 0 };

/** A new game in memory, and a note of every event it tells. */
function newGame(json: string | null = null) {
  const store = memoryStore(json);
  const told: string[] = [];
  const events: GameEvents = new Proxy(
    {},
    {
      get:
        (_, name: string) =>
        (...args: unknown[]) =>
          told.push(`${name} ${args.filter((a) => typeof a === 'number').join(' ')}`.trim()),
    },
  );
  const game = new Game(new Economy(store), events);
  return { game, store, told };
}

/** On into the next room, as driving past where it seals the one behind would. */
function goOn(game: Game) {
  const next = game.economy.next()!;
  const [sx, sy] = sealPoint(game.cave, next);
  const [dx, dy] = WINGS[next].dir;
  Object.assign(game.dozer, { x: sx + dx * 4, y: sy + dy * 4, speed: 0 });
  game.step(DT, still);
}

describe('the game', () => {
  it('starts in the hollow with its heaps and barrels, and nothing that must hold broken', () => {
    withSeed(1, () => {
      const { game } = newGame();
      expect(game.economy.current()).toBe(ORDER[0]);
      expect(game.world.live).toBeGreaterThan(1000);
      expect(game.stock.kinds[BARREL_KIND]).toBe(game.cave.barrels.filter((b) => b.area === 0).length);
      expect(checkInvariants(game)).toEqual([]);
    });
  });

  it('banks what goes down the hole, and tells of it', () => {
    withSeed(2, () => {
      const { game, told } = newGame();
      const coin = [...Array(game.world.count).keys()].find((i) => game.world.alive[i] && game.world.kind[i] === 0)!;
      game.world.x[coin] = 0;
      game.world.y[coin] = 0;
      game.world.z[coin] = 2;
      game.world.wake(coin);
      for (let f = 0; f < 120; f++) game.step(DT, still);
      expect(game.economy.bank).toBe(1);
      expect(told.some((t) => t.startsWith('banked'))).toBe(true);
    });
  });

  it('opens the next room, seals the one behind on going on, and tells of both', () => {
    withSeed(3, () => {
      const { game, told } = newGame();
      game.economy.open();
      expect(told).toContain(`roomOpened ${ORDER[1]}`);
      goOn(game);
      game.economy.open();
      goOn(game);
      expect(game.economy.current()).toBe(ORDER[2]);
      expect(told.some((t) => t.startsWith(`roomSealed ${ORDER[1]}`))).toBe(true);
      expect(checkInvariants(game)).toEqual([]);
    });
  });

  it('forgets a lit barrel sealed in with its room, so no barrel put in its place goes off', () => {
    withSeed(4, () => {
      const { game } = newGame();
      game.economy.open();
      goOn(game);
      const barrel = [...Array(game.world.count).keys()].find(
        (i) => game.world.alive[i] && game.world.kind[i] === BARREL_KIND && game.stock.home[i] === ORDER[1],
      )!;
      game.barrels.light(barrel, 30);
      game.economy.open();
      goOn(game);
      expect(game.barrels.lit).toEqual([]);
      expect(checkInvariants(game)).toEqual([]);
    });
  });

  it('comes back from its save as it was left', () => {
    withSeed(5, () => {
      const { game, store } = newGame();
      game.economy.deposit(700);
      game.economy.open();
      goOn(game);
      for (let f = 0; f < 60; f++) game.step(DT, { throttle: 1, steer: 0.3 });
      game.persist();
      const again = newGame(store.json).game;
      expect(again.economy.save.bank).toBe(game.economy.save.bank);
      expect(again.economy.current()).toBe(game.economy.current());
      expect(again.stock.left).toEqual(game.stock.left);
      expect(again.stock.kinds[BARREL_KIND]).toBe(game.stock.kinds[BARREL_KIND]);
      expect(checkInvariants(again)).toEqual([]);
      expect(AREAS.length).toBeGreaterThan(1);
    });
  });

  it('holds together played at random, a few seeds of the fuzzer', () => {
    for (const seed of [101, 102]) {
      const result = fuzz(seed, 1500);
      if (result.failure)
        expect.fail(`seed ${seed}: ${result.failure.problems.join('; ')}\n${result.failure.log.join('\n')}`);
    }
  });
});
