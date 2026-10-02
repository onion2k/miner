/**
 * Currents in every cave that has one, played: what `test/currents.test.ts` holds on the Hollow and the South
 * Gallery, held on each of the seven, since a current is a belt in the physics and a drain a hole, and the caves
 * differ in size, in rock and in how many bodies they hold. Slow, since each is a cave built and played.
 */
import { describe, expect, it } from 'vitest';
import { Economy, memoryStore } from '../../src/economy';
import { Game } from '../../src/game';
import { checkInvariants } from '../../src/invariants';
import { BARREL_KIND } from '../../src/physics';
import { RUN, caveOf, gameIn, saveIn, withSeed } from '../helpers';
import {
  ALL,
  DRAINING_CAVES,
  DT,
  TO_DRAIN,
  TO_HOLE,
  WITH_CURRENTS,
  aCoin,
  carriesToHole,
  dozerStays,
  drainCurrent,
  losesToDrain,
  navAndForeman,
  onIt,
  opensOnTheLastCoin,
  put,
  still,
  told,
  until,
} from '../current-helpers';

describe('criterion 1, in every cave with a current to a hole', () => {
  it.each(TO_HOLE.map(({ id, c }) => [c.id, id, c] as const))(
    'carries a gold bar at the head of %s to the hole',
    (_n, id, c) => carriesToHole(id, c),
  );
});

describe('criterion 2, in every cave with a current to a drain', () => {
  it.each(TO_DRAIN.map(({ id, c }) => [c.id, id, c] as const))('loses a coin from %s', (_n, id, c) =>
    losesToDrain(id, c),
  );
});

describe('criterion 3, in every cave with a drain', () => {
  it.each(DRAINING_CAVES)('opens the way out of %s (or ends the game, in the last) on the last coin drained', (id) =>
    opensOnTheLastCoin(id),
  );
});

describe('a cave left alone', () => {
  // a drain near enough a heap takes what rolls off it as it settles: money gone with nobody touching anything
  it.each(RUN.map((s) => [s.id] as const))('loses nothing down a drain and banks nothing, in %s, on any seed', (id) => {
    for (const seed of [1, 11, 23, 56]) {
      withSeed(seed, () => {
        const game = gameIn(id);
        for (let f = 0; f < 60 * 30; f++) game.step(DT, still);
        expect(game.economy.save.drained, `seed ${seed}: down a drain`).toBe(0);
        expect(game.economy.save.banked, `seed ${seed}: down a hole`).toBe(0);
      });
    }
  });
});

describe('criterion 6, in every cave with a current', () => {
  it.each(ALL.map(({ id, c }) => [c.id, id, c] as const))('leaves the dozer where it stood on %s', (_n, id, c) =>
    dozerStays(id, c),
  );
});

describe('the nav and the foreman, in every cave with a current', () => {
  it.each(ALL.map(({ id, c }) => [c.id, id, c] as const))('treat %s as what it is', (_n, id, c) =>
    navAndForeman(id, c),
  );

  it.each(WITH_CURRENTS.map((s) => [s.id] as const))(
    'has %s’s nav and world hold the holes and the drains apart',
    (id) => {
      const game = gameIn(id);
      expect(game.nav.holes).toBe(game.cave.holes);
      expect(game.world.holes).toHaveLength(game.cave.holes.length + game.cave.drains.length);
      game.cave.drains.forEach((d, k) => {
        const h = game.world.holes[game.cave.holes.length + k];
        expect([h.x, h.y, h.radius]).toEqual([d.x, d.y, d.radius]);
      });
    },
  );
});

describe('edge cases, in every cave with a drain', () => {
  it.each(DRAINING_CAVES)(
    'loses a lit barrel down the drain of %s with the fuse going, and no blast comes of it',
    (id) => {
      withSeed(52, () => {
        const { events, named } = told();
        const game = gameIn(id, {}, events);
        const slot = game.stock.spawnBarrel(...onIt(drainCurrent(id), 3), 1.2);
        expect(slot).toBeGreaterThanOrEqual(0);
        game.barrels.light(slot, 30);
        until(game, 60 * 30, () => !game.world.alive[slot]);
        for (let f = 0; f < 60 * 35; f++) game.step(DT, still);
        expect(named('blast')).toHaveLength(0);
        expect(game.barrels.lit).toEqual([]);
        expect(game.stock.kinds[BARREL_KIND], 'the cave’s own barrels are as they were').toBe(game.cave.barrels.length);
        expect(checkInvariants(game)).toEqual([]);
      });
    },
  );

  it.each(DRAINING_CAVES)('sends what a blast throws on a current of %s down it, with every count true', (id) => {
    withSeed(54, () => {
      const c = drainCurrent(id);
      const game = gameIn(id);
      const [bx, by] = onIt(c, 8);
      for (let n = 0; n < 12; n++) put(game, aCoin(game, n), bx + (n % 4) - 1.5, by + ((n / 4) | 0) - 1, 0.6);
      const barrel = game.stock.spawnBarrel(bx + 1.5, by + 4, 1.2);
      game.barrels.light(barrel, 0.05);
      for (let f = 0; f < 60 * 12; f++) game.step(DT, still);
      expect(game.economy.save.drained, 'what the blast threw on the current went down it').toBeGreaterThan(0);
      expect(checkInvariants(game)).toEqual([]);
    });
  });

  it('loses what lands on a current in the last cave while its vein runs, and the game stays done', () => {
    withSeed(55, () => {
      const store = memoryStore(saveIn('deep', { done: true }));
      const game = new Game(new Economy(store, RUN), caveOf('deep'));
      const c = drainCurrent('deep');
      const before = game.economy.bank;
      // a cave that was cleared long ago has no heaps: what is on the current is coins from its vein, set there
      for (let n = 0; n < 5; n++) expect(game.stock.spawn(0, ...onIt(c, 2 + n * 0.7), 1.2)).toBe(true);
      for (let f = 0; f < 60 * 15; f++) game.step(DT, still);
      expect(game.economy.save.drained).toBe(5);
      expect(game.economy.bank).toBe(before);
      expect(game.economy.save.done).toBe(true);
      expect(game.economy.save.open).toBe(false);
      expect(checkInvariants(game)).toEqual([]);
    });
  });
});
