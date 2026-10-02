/**
 * What the tests of the currents share: the currents of the run by where they end, a note of what a game
 * tells, the few moves a test makes (put a body on a current, step until something has happened), and the
 * scenarios of the plan's criteria, each tried on one cave in the quick tests and on every cave in the slow ones.
 */
import { expect } from 'vitest';
import type { CurrentSpec } from '../src/cave';
import { flowOf } from '../src/currents';
import { CLEAR_SHARE, Economy, caveStock, memoryStore } from '../src/economy';
import { Game, type GameEvents } from '../src/game';
import { checkInvariants } from '../src/invariants';
import { BAR, KIND_VALUE } from '../src/physics';
import { Foreman } from '../src/tools';
import { RUN, caveOf, gameIn, saveIn, specOf, withSeed } from './helpers';

export const DT = 1 / 60;
export const still = { throttle: 0, steer: 0 };

/** Every current of the run, with the cave it is in. */
export const ALL = RUN.flatMap((spec) => (spec.currents ?? []).map((c) => ({ id: spec.id, c })));
export const TO_HOLE = ALL.filter(({ c }) => !c.drain);
export const TO_DRAIN = ALL.filter(({ c }) => c.drain);
export const DRAINING_CAVES = [...new Set(TO_DRAIN.map(({ id }) => id))];
export const WITH_CURRENTS = RUN.filter((s) => s.currents?.length);

/** A note of what the game tells, by name. */
export function told() {
  const log: { name: string; args: unknown[] }[] = [];
  const events: GameEvents = new Proxy(
    {},
    {
      get:
        (_, name: string) =>
        (...args: unknown[]) =>
          log.push({ name, args }),
    },
  );
  return { events, named: (name: string) => log.filter((e) => e.name === name) };
}

/** A point `along` from a current's head, on its centre line, and `across` to the left of it. */
export function onIt(c: CurrentSpec, along: number, across = 0): [number, number] {
  const [ux, uy] = flowOf(c);
  return [c.x0 + ux * along - uy * across, c.y0 + uy * along + ux * across];
}

/** Steps until `done` or `frames` have gone; how many it took. */
export function until(game: Game, frames: number, done: () => boolean): number {
  let f = 0;
  while (f < frames && !done()) {
    game.step(DT, still);
    f++;
  }
  return f;
}

/** The slot of the `nth` coin still in a heap, for moving to where a test wants it. */
export function aCoin(game: Game, nth = 0): number {
  const { world, stock } = game;
  for (let i = 0, seen = 0; i < world.count; i++)
    if (world.alive[i] && world.kind[i] === 0 && stock.origin[i] === 0 && seen++ === nth) return i;
  throw new Error('no coin in the cave');
}

/** A body put at a point, still, as the test API does. */
export function put(game: Game, slot: number, x: number, y: number, z = 1.2) {
  const { world } = game;
  world.x[slot] = x;
  world.y[slot] = y;
  world.z[slot] = z;
  world.vx[slot] = world.vy[slot] = world.vz[slot] = 0;
  world.wake(slot);
}

/** The first current of a cave of the run that ends in a drain. */
export const drainCurrent = (id: string) => specOf(id).currents!.find((c) => c.drain)!;

// ---- the scenarios ----

/** Criterion 1: a gold bar at the head of a current to a hole is banked, and nothing is lost. */
export function carriesToHole(id: string, c: CurrentSpec) {
  withSeed(31, () => {
    const game = gameIn(id);
    const before = game.economy.bank;
    expect(game.world.belts.length, 'the current runs without being bought').toBeGreaterThan(0);
    expect(game.stock.spawn(BAR, ...onIt(c, 2), 1.2)).toBe(true);
    const took = until(game, 60 * 30, () => game.economy.bank > before);
    expect(game.economy.bank, `${c.id}: banked after ${took} frames`).toBe(before + KIND_VALUE[BAR]);
    expect(game.economy.save.drained, 'nothing lost').toBe(0);
  });
}

/** Criterion 2: a coin put on a current to a drain is lost: the bank unchanged, `drained` raised, the share risen. */
export function losesToDrain(id: string, c: CurrentSpec) {
  withSeed(33, () => {
    const { events, named } = told();
    const game = gameIn(id, {}, events);
    const before = { bank: game.economy.bank, share: game.stock.banked(), lying: game.stock.lying() };
    put(game, aCoin(game), ...onIt(c, 2));
    const took = until(game, 60 * 30, () => named('drained').length > 0);
    expect(named('drained'), `${c.id}: drained after ${took} frames`).toHaveLength(1);
    expect(named('drained')[0].args.slice(0, 2), 'its kind and its value').toEqual([0, 1]);
    expect(game.economy.bank, 'the bank is as it was').toBe(before.bank);
    expect(game.economy.save.drained).toBe(1);
    expect(game.economy.save.banked, 'and what was ever banked').toBe(0);
    expect(game.stock.lying()).toBe(before.lying - 1);
    expect(game.stock.banked(), 'the cave’s share rose without the bank').toBeGreaterThan(before.share);
    expect(named('banked'), 'nothing banked').toHaveLength(0);
    expect(
      game.tally.holePulse.every((p) => p === 0),
      'and no hole glows',
    ).toBe(true);
    expect(checkInvariants(game)).toEqual([]);
  });
}

/** A save of the cave with just over what it is cleared at lying in it, all of it coins: one coin gone clears it. */
function nearlyCleared(id: string): string {
  const stocked = caveStock(specOf(id)).value;
  let lying = Math.floor((1 - CLEAR_SHARE) * stocked);
  while (1 - lying / stocked >= CLEAR_SHARE) lying++;
  const fresh = JSON.parse(saveIn(id)) as { left: number[][] };
  fresh.left[0] = [lying, 0, 0, 0, 0, 0, 0, 0];
  return JSON.stringify({ ...fresh, cave: id });
}

/** Criterion 3: a cave whose last coins go down a drain still opens its way out, or ends the game if it is the last. */
export function opensOnTheLastCoin(id: string) {
  withSeed(36, () => {
    const { events, named } = told();
    const game = new Game(new Economy(memoryStore(nearlyCleared(id)), RUN), caveOf(id), events);
    for (let f = 0; f < 10; f++) game.step(DT, still);
    expect(game.stock.banked(), 'just short of the share').toBeLessThan(CLEAR_SHARE);
    expect(game.economy.save.open || game.economy.save.done, 'not yet').toBe(false);
    put(game, aCoin(game), ...onIt(drainCurrent(id), 2));
    until(game, 60 * 30, () => game.economy.save.drained > 0);
    for (let f = 0; f < 5; f++) game.step(DT, still);
    expect(game.economy.save.drained).toBe(1);
    expect(game.economy.bank, 'nothing banked, and the cave is cleared').toBe(0);
    // in the last cave the game is done and its vein runs more coins in, so the share it is cleared at is not held to after
    if (!game.economy.isLast()) expect(game.stock.banked()).toBeGreaterThanOrEqual(CLEAR_SHARE);
    expect(game.economy.save.open || game.economy.save.done).toBe(true);
    expect(named(game.economy.isLast() ? 'done' : 'exitOpened')).toHaveLength(1);
    expect(checkInvariants(game)).toEqual([]);
  });
}

/** Criterion 6: the dozer put on a current stays where it is put. */
export function dozerStays(id: string, c: CurrentSpec) {
  withSeed(41, () => {
    const game = gameIn(id);
    const [x, y] = onIt(c, 6);
    Object.assign(game.dozer, { x, y, speed: 0, yawRate: 0 });
    for (let f = 0; f < 120; f++) game.step(DT, still);
    expect([game.dozer.x, game.dozer.y], c.id).toEqual([x, y]);
  });
}

/** What the nav holds of a current: a drop-off if it runs to a hole, a drain's if not, and no drone sent for a coin on it. */
export function navAndForeman(id: string, c: CurrentSpec) {
  withSeed(43, () => {
    const game = gameIn(id, { drones: 1 });
    const { world, nav } = game;
    const [x, y] = onIt(c, 3);
    if (c.drain) {
      expect(nav.onBelt(x, y), `${c.id} is not a drop-off`).toBeNull();
      expect(nav.onDrain(x, y), `${c.id} is a drain`).not.toBeNull();
    } else {
      expect(nav.onBelt(x, y), `${c.id} is a drop-off`).not.toBeNull();
      expect(nav.onDrain(x, y), `${c.id} is no drain`).toBeNull();
    }
    // one coin in the cave, so that what the foreman says of it is all it says: it sends a drone for the coin
    // lying in a heap, and for none that lies on the current
    const slot = aCoin(game);
    for (let i = 0; i < world.count; i++) if (world.alive[i] && i !== slot) world.remove(i);
    const foreman = new Foreman(world, nav, game.bots, game.stock.origin, () => true);
    const heap = game.cave.spec.heaps[0];
    put(game, slot, heap.x, heap.y, 1);
    expect(foreman.choose(game.bots[0], 100), `${c.id}: a coin in the heap is worked`).toBe(slot);
    put(game, slot, ...onIt(c, 4));
    expect(foreman.choose(game.bots[0], 200), `${c.id}: a coin on the current is not`).toBe(-1);
  });
}
