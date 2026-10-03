/**
 * The toll: half of every coin banked in a cave goes to it until it is paid, and the other half is the
 * player's bank. It opens the way out, as nine tenths of the heaps gone still does, so that a player is never
 * stranded; the last cave has none. These are the plan's acceptance criteria for it, and its edge cases.
 */
import { describe, expect, it } from 'vitest';
import { Economy, FORMER_LAST, TOLL_SHARE, TOLL_TAKE, caveStock, memoryStore, tollOf } from '../src/economy';
import { Game } from '../src/game';
import { checkInvariants } from '../src/invariants';
import { BAR } from '../src/physics';
import { RUN, caveOf, gameIn, newEconomy, saveIn, specOf, withSeed } from './helpers';
import { opensOnTheLastCoin, told } from './current-helpers';

const DT = 1 / 60;
const still = { throttle: 0, steer: 0 };

/** The sum of every toll in the run, which the plan names: 1,000, 1,200, 1,500, 1,800, 1,900 and 2,200. */
const TOLLS = {
  hollow: 1000,
  'south-gallery': 1200,
  'east-gallery': 1500,
  'north-vault': 1800,
  warrens: 1900,
  'west-gallery': 2200,
};

/** `n` coins still in the cave's heaps, set down at the hole, a few to a spot so that they fall and are banked. */
function sendCoins(game: Game, n: number) {
  const { world, stock } = game;
  const hole = game.cave.holes[0];
  let sent = 0;
  for (let i = 0; i < world.count && sent < n; i++) {
    if (!world.alive[i] || world.kind[i] !== 0 || stock.origin[i] !== 0) continue;
    const a = sent * 2.399;
    const r = 0.4 + (sent % 7) * 0.25;
    world.x[i] = hole.x + Math.cos(a) * r;
    world.y[i] = hole.y + Math.sin(a) * r;
    world.z[i] = 2 + (sent % 5) * 0.1;
    world.vx[i] = world.vy[i] = world.vz[i] = 0;
    world.wake(i);
    sent++;
  }
  expect(sent, 'coins to send').toBe(n);
}

/** `n` coins banked, sent down in batches that fit round the hole, and waited for: whether they all were is said. */
function bankCoins(game: Game, n: number): boolean {
  const { save } = game.economy;
  const want = save.banked + n;
  while (save.banked < want) {
    const batch = Math.min(200, want - save.banked);
    const target = save.banked + batch;
    sendCoins(game, batch);
    if (!until(game, () => save.banked >= target)) return false;
  }
  return true;
}

/** Step until `done` or a minute of game time has gone, and say whether it did. */
function until(game: Game, done: () => boolean): boolean {
  for (let f = 0; f < 60 * 60 && !done(); f++) game.step(DT, still);
  return done();
}

describe('what each cave owes (criterion 4)', () => {
  it('is four tenths of the cave’s heaps to the nearest hundred, and nothing for the Deep', () => {
    expect(TOLL_SHARE).toBe(0.4);
    expect(TOLL_TAKE, 'half of each coin').toBe(0.5);
    for (const spec of RUN) {
      if (spec.exit === null) {
        expect(tollOf(spec), `${spec.id} has no way out and no toll`).toBe(0);
        continue;
      }
      const worth = caveStock(spec).value;
      expect(tollOf(spec), spec.id).toBe(Math.round((worth * 0.4) / 100) * 100);
      expect(Math.abs(tollOf(spec) - worth * 0.4), `${spec.id} to the nearest hundred`).toBeLessThanOrEqual(50);
    }
    expect(Object.fromEntries(RUN.filter((s) => s.exit).map((s) => [s.id, tollOf(s)]))).toEqual(TOLLS);
    expect(RUN.reduce((n, s) => n + tollOf(s), 0)).toBe(9_600);
    expect(tollOf(RUN[RUN.length - 1])).toBe(0);
  });
});

describe('the toll takes half of every coin (criterion 1)', () => {
  it('splits a deposit in two, the odd coin to the toll on the even and the bank on the odd, so single coins alternate', () => {
    const e = newEconomy(saveIn('hollow', { toll: 0 }));
    expect(e.owed()).toBe(1000);
    const seen = () => [e.save.toll, e.bank, e.save.banked];
    e.deposit(1);
    expect(seen(), 'the first coin is the toll’s').toEqual([1, 0, 1]);
    e.deposit(1);
    expect(seen(), 'the next is the bank’s').toEqual([1, 1, 2]);
    e.deposit(1);
    expect(seen(), 'and the next the toll’s').toEqual([2, 1, 3]);
    e.deposit(10);
    expect(seen(), 'a ruby gives five and five').toEqual([7, 6, 13]);
  });

  it('gives an emerald’s odd coin to the toll or the bank by which side has had the fewer', () => {
    const even = newEconomy(saveIn('hollow', { toll: 0 }));
    even.deposit(25);
    expect([even.save.toll, even.bank], 'from the start, 13 and 12').toEqual([13, 12]);
    const odd = newEconomy(saveIn('hollow', { toll: 0 }));
    odd.deposit(1);
    odd.deposit(1);
    odd.deposit(1);
    expect([odd.save.toll, odd.bank]).toEqual([2, 1]);
    odd.deposit(25);
    expect([odd.save.toll, odd.bank], 'with the bank a coin behind it goes there: 12 and 13').toEqual([2 + 12, 1 + 13]);
  });

  it('keeps whole coins and the lifetime haul takes all of every deposit', () => {
    const e = newEconomy(saveIn('hollow', { toll: 0 }));
    let total = 0;
    for (const v of [1, 10, 25, 40, 100, 250, 1, 1, 25]) {
      e.deposit(v);
      total += v;
      expect(Number.isInteger(e.save.toll) && Number.isInteger(e.bank)).toBe(true);
      expect(e.save.toll + e.bank, 'every coin is somewhere').toBe(total);
      expect(e.save.banked).toBe(total);
    }
  });

  it('does it in the game: of the first 2,000 banked in the Hollow, 1,000 go to the toll and 1,000 to the bank, coin about', () => {
    withSeed(11, () => {
      const game = gameIn('hollow', { toll: 0 });
      const { save } = game.economy;
      expect(bankCoins(game, 1998), 'all banked').toBe(true);
      expect([save.toll, game.economy.bank]).toEqual([999, 999]);
      expect(save.open, 'one coin short of the toll').toBe(false);
      sendCoins(game, 1);
      expect(until(game, () => save.banked === 1999)).toBe(true);
      expect([save.toll, game.economy.bank], 'the toll is paid by the coin it was owed').toEqual([1000, 999]);
      expect(save.open).toBe(true);
      sendCoins(game, 1);
      expect(until(game, () => save.banked === 2000)).toBe(true);
      expect([save.toll, game.economy.bank], 'and of 2,000, half and half').toEqual([1000, 1000]);
      game.economy.deposit(1);
      expect(game.economy.bank, 'past the toll every coin is the bank’s').toBe(1001);
      expect(checkInvariants(game)).toEqual([]);
    });
  });
});

describe('the toll opens the way out (criterion 2)', () => {
  it('opens on the step the coin that pays it is banked, and tells of it once', () => {
    withSeed(12, () => {
      const { events, named } = told();
      const game = gameIn('hollow', { toll: 0 }, events);
      expect(bankCoins(game, 1998), 'all banked').toBe(true);
      expect(game.economy.save.open).toBe(false);
      expect(named('tollPaid')).toHaveLength(0);
      sendCoins(game, 1);
      // a step at a time, and the first in which the haul has moved is the one in which the way out is open
      for (let f = 0; f < 3600 && game.economy.save.banked < 1999; f++) game.step(DT, still);
      expect(game.economy.save.banked).toBeGreaterThanOrEqual(1999);
      expect(game.economy.save.open, 'open on that very step').toBe(true);
      expect(named('tollPaid'), 'told of once').toHaveLength(1);
      expect(named('exitOpened')).toHaveLength(1);
      expect(game.stock.banked(), 'eight tenths, not nine: it is the toll that did it').toBeLessThan(0.9);
      sendCoins(game, 1);
      for (let f = 0; f < 600; f++) game.step(DT, still);
      expect(named('tollPaid'), 'and not again').toHaveLength(1);
      expect(named('exitOpened')).toHaveLength(1);
      expect(checkInvariants(game)).toEqual([]);
    });
  });

  it('still opens with nine tenths of the heaps down a drain and the toll unpaid (criterion 3)', () => {
    opensOnTheLastCoin('south-gallery');
  });

  it('is told of again by a game on a save part paid, which pays the rest', () => {
    withSeed(13, () => {
      const { events, named } = told();
      const game = gameIn('hollow', { toll: 998 }, events);
      sendCoins(game, 4);
      until(game, () => game.economy.save.open);
      expect(named('tollPaid')).toHaveLength(1);
      expect(game.economy.save.toll).toBe(1000);
    });
  });

  it('says nothing for a game begun on a save that has paid in full', () => {
    withSeed(14, () => {
      const { events, named } = told();
      const game = gameIn('hollow', {}, events);
      for (let f = 0; f < 120; f++) game.step(DT, still);
      expect(named('tollPaid')).toHaveLength(0);
    });
  });
});

describe('the toll, case by case', () => {
  it('is paid by a find as by a coin: a gold bar banked before it is paid counts', () => {
    withSeed(15, () => {
      const game = gameIn('hollow', { toll: 0 });
      const hole = game.cave.holes[0];
      expect(game.stock.spawn(BAR, hole.x, hole.y, 2)).toBe(true);
      expect(until(game, () => game.economy.save.banked === 250)).toBe(true);
      expect([game.economy.save.toll, game.economy.bank], 'half and half').toEqual([125, 125]);
    });
  });

  it('pays exactly and banks the rest when a deposit is more than is owed', () => {
    const e = newEconomy(saveIn('hollow', { toll: 900 }));
    e.deposit(250);
    expect(e.save.toll, 'exactly the toll, and no more: half would have been 125').toBe(1000);
    expect(e.bank, 'and the rest is the player’s').toBe(150);
    expect(e.save.banked).toBe(250);
    expect(e.owed()).toBe(0);
  });

  it('keeps what was paid, and the bank, across a save and a reload part way through', () => {
    const store = memoryStore(saveIn('hollow', { toll: 0 }));
    const a = new Economy(store, RUN);
    a.deposit(640);
    const b = new Economy(memoryStore(store.json), RUN);
    expect([b.save.toll, b.bank, b.save.banked, b.owed()]).toEqual([320, 320, 640, 680]);
    b.deposit(1400);
    expect([b.save.toll, b.bank, b.owed()]).toEqual([1000, 320 + 720, 0]);
  });

  it('is owed afresh by the next cave when this one is left with its toll paid', () => {
    const e = newEconomy(saveIn('hollow', { toll: 0 }));
    e.deposit(2100);
    e.open();
    expect(e.owed()).toBe(0);
    e.moveOn();
    expect(e.save.cave).toBe('south-gallery');
    expect([e.save.toll, e.owed(), e.tollDue()]).toEqual([0, 1200, 1200]);
    expect(e.bank, 'what the hollow left over is the player’s, and goes on').toBe(1100);
  });

  it('is owed by the cave `travel` arrives in, whatever was paid in the one it left', () => {
    const e = newEconomy(saveIn('hollow'));
    expect(e.owed()).toBe(0);
    e.travel('north-vault');
    expect([e.save.toll, e.owed()]).toEqual([0, 1800]);
    e.travel('deep');
    expect([e.save.toll, e.owed()]).toEqual([0, 0]);
  });

  it('is nothing in the last cave, which ends at nine tenths as it did', () => {
    withSeed(16, () => {
      const deep = specOf('deep');
      expect(deep.exit).toBeNull();
      const { value } = caveStock(deep);
      const { events, named } = told();
      const game = gameIn('deep', { left: [[Math.round(value * 0.05), 0, 0, 0, 0, 0, 0, 0]] }, events);
      expect(game.economy.owed()).toBe(0);
      expect(game.economy.tollDue()).toBe(0);
      game.step(DT, still);
      expect(game.economy.save.done, 'ended at nine tenths').toBe(true);
      expect(game.economy.save.open, 'with no way out').toBe(false);
      expect(named('tollPaid'), 'and no toll to pay').toHaveLength(0);
      expect(checkInvariants(game)).toEqual([]);
      // and a last cave that is not nearly cleared is not ended by its having no toll
      const fresh = gameIn('deep');
      for (let f = 0; f < 60; f++) fresh.step(DT, still);
      sendCoins(fresh, 5);
      expect(until(fresh, () => fresh.economy.save.banked === 5)).toBe(true);
      expect(fresh.economy.save.done, 'coins banked in it are the bank’s, and end nothing').toBe(false);
      expect(fresh.economy.bank).toBe(5);
    });
  });

  it('leaves a game finished in the cave the run used to end in as it is', () => {
    const e = newEconomy(saveIn(FORMER_LAST, { done: true, toll: 0 }));
    expect(e.save.done).toBe(true);
    expect(e.save.open, 'not sent on through the way out it has since been given').toBe(false);
    expect(e.owed(), 'nothing owed by a game that is over').toBe(0);
    const game = new Game(e, caveOf(FORMER_LAST));
    for (let f = 0; f < 60; f++) game.step(DT, still);
    expect(e.save.done).toBe(true);
    expect(e.save.open).toBe(false);
    expect(checkInvariants(game)).toEqual([]);
  });

  it('is held to its range when a save is read: not past the toll, and not a number that is not one', () => {
    const toll = (v: unknown) => newEconomy(JSON.stringify({ ...JSON.parse(saveIn('hollow')), toll: v })).save.toll;
    expect(toll(1e9), 'more than any toll is the cave’s whole').toBe(1000);
    expect(toll(900)).toBe(900);
    expect(toll(-5), 'a number below nought is nothing paid').toBe(0);
    expect(toll('lots'), 'what is not a number is read as from before the toll').toBe(0);
    expect(newEconomy(saveIn('deep', { toll: 500 })).save.toll, 'the last cave has none').toBe(0);
  });

  it('counts a way out open as a toll paid, in a save from before there was one', () => {
    const old = JSON.parse(saveIn('east-gallery', { open: true, bank: 321 })) as Record<string, unknown>;
    delete old.toll;
    const e = newEconomy(JSON.stringify(old));
    expect(e.save.toll).toBe(1500);
    expect(e.owed()).toBe(0);
    expect(e.bank, 'and nothing taken back').toBe(321);
  });

  it('works out a save from before the toll by what has gone from the heaps, and none where it does not say', () => {
    const old = (left: number[][] | undefined, cave = 'hollow') => {
      const s = JSON.parse(saveIn(cave, { bank: 77 })) as Record<string, unknown>;
      delete s.toll;
      if (left) s.left = left;
      return newEconomy(JSON.stringify(s));
    };
    // 2,500 in the hollow: with 1,000 lying 1,500 has gone, and half of it is 750; with 1,800 lying 700 has, and half is 350
    expect(old([[1000]]).save.toll).toBe(750);
    expect(old([[1800]]).save.toll).toBe(350);
    expect(old([[0]]).save.toll, 'all gone: half of 2,500 is past the toll of 1,000, which is all of it').toBe(1000);
    expect(old([[1999]]).save.toll, 'an odd figure gone is rounded down: 501 gone is 250').toBe(250);
    expect(old([[2400, 10]]).save.toll, '2,400 coins and 10 rubies lying is 2,500 lying: nothing gone').toBe(0);
    expect(old([[]]).save.toll, 'a cave not said to be touched is not').toBe(0);
    expect(old(undefined).save.toll).toBe(0);
    expect(old([[1000]]).bank, 'the bank untouched').toBe(77);
  });
});

describe('the rules that hold of it', () => {
  it('says so of a toll that is not a number, or past what the cave asks', () => {
    const game = gameIn('hollow', { toll: 0 });
    for (let f = 0; f < 10; f++) game.step(DT, still);
    expect(checkInvariants(game)).toEqual([]);
    game.economy.save.toll = 1001;
    expect(checkInvariants(game).join('\n')).toContain('the toll: 1001 of 1000');
    game.economy.save.toll = Number.NaN;
    expect(checkInvariants(game).join('\n')).toContain('the toll');
    game.economy.save.toll = -1;
    expect(checkInvariants(game).join('\n')).toContain('the toll: -1');
  });

  it('says so when the toll is paid, a coin has been banked, and the way out is shut', () => {
    const game = gameIn('hollow', { toll: 0 });
    game.step(DT, still);
    // paid behind the game's back, as a bug that missed it would: nothing has opened the way out
    game.economy.deposit(2000);
    expect(checkInvariants(game).join('\n')).toContain('the toll is paid (1000 of 1000) and the way out is shut');
    game.step(DT, still);
    expect(game.economy.save.open, 'the next step opens it').toBe(true);
    expect(checkInvariants(game)).toEqual([]);
  });

  it('does not hold a save that arrives paid and shut to it until a coin is banked, nor the last cave, which has no toll to pay', () => {
    const game = gameIn('hollow');
    for (let f = 0; f < 30; f++) game.step(DT, still);
    expect(game.economy.owed()).toBe(0);
    expect(game.economy.save.open, 'as the save says').toBe(false);
    expect(checkInvariants(game)).toEqual([]);
    sendCoins(game, 1);
    expect(
      until(game, () => game.economy.save.open),
      'the first coin banked settles it',
    ).toBe(true);
    expect(checkInvariants(game)).toEqual([]);
    const deep = gameIn('deep');
    deep.step(DT, still);
    expect(checkInvariants(deep)).toEqual([]);
  });
});
