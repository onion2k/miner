/**
 * The ledger: what each cave held, what was brought out, paid in toll, lost down drains and left behind, which
 * finds were found, and three marks a cave. These are the plan's acceptance criteria for stage 2, and its edge
 * cases. Nothing here, nor in the ledger, counts time. What plays a cave through is in `test/slow/ledger.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { caveStock } from '../src/economy';
import { cardOf, held, heldBy, ledgerOf, runHeld, runLine, type Row } from '../src/ledger';
import { KIND_VALUE } from '../src/physics';
import { RUN, gameIn, newEconomy, saveIn, specOf } from './helpers';

describe('what a cave holds (criterion 6)', () => {
  it('sums to 68,850 over the run: 36,310 in heaps and 32,540 in finds', () => {
    const by = RUN.map(heldBy);
    const sum = (key: 'heaps' | 'chambers' | 'sideRooms' | 'walls' | 'geodes') => by.reduce((n, b) => n + b[key], 0);
    expect(sum('heaps')).toBe(36_310);
    expect(sum('chambers')).toBe(10_260);
    expect(sum('sideRooms')).toBe(14_360);
    expect(sum('walls')).toBe(2_755);
    expect(sum('geodes')).toBe(5_165);
    expect(RUN.reduce((n, s) => n + held(s), 0)).toBe(68_850);
    expect(runHeld(RUN)).toBe(68_850);
  });

  it('is every source of the cave and nothing else: heaps, chambers, side rooms, walls and geodes', () => {
    for (const spec of RUN) {
      const b = heldBy(spec);
      expect(b.heaps, `${spec.id} heaps`).toBe(caveStock(spec).value);
      expect(held(spec), spec.id).toBe(b.heaps + b.chambers + b.sideRooms + b.walls + b.geodes);
    }
    // the South Gallery, worked by hand: 3,020 of heaps, a chamber of 960, a side room of 1,400, 75 in a wall, 2 geodes of 150
    expect(held(specOf('south-gallery'))).toBe(3020 + 960 + 1400 + 75 + 300);
  });
});

describe('a row’s parts add up (criterion 1)', () => {
  it('counts what was banked, toll and bank alike, and starts each cave at nought', () => {
    const e = newEconomy(saveIn('hollow', { toll: 0 }));
    expect(e.save.taken).toBe(0);
    e.deposit(1);
    e.deposit(25);
    e.deposit(100);
    expect(e.save.taken, 'the whole of every coin, the toll’s half as well').toBe(126);
    expect(e.save.toll + e.bank, 'it is the toll and the bank between them').toBe(126);
    e.grant(1000);
    expect(e.save.taken, 'money handed over is not banked in the cave').toBe(126);
    e.drain(40);
    expect(e.save.taken, 'what went down a drain was not banked').toBe(126);
  });
});

describe('the run’s line (criterion 3)', () => {
  const rowOfCave = (id: string, taken: number, drained = 0): Row => ({
    cave: id,
    held: held(specOf(id)),
    taken,
    toll: 0,
    drained,
    left: held(specOf(id)) - taken - drained,
    finds: { chamber: 'none', sideRoom: 'none', wall: 'none', geodes: { cracked: 0, of: 0 } },
    marks: { clean: true, everyHeap: false, everyFind: false },
  });

  it('is the sum of the stored rows and the cave being played, of all that the mine holds', () => {
    const rows = [rowOfCave('hollow', 2580), rowOfCave('south-gallery', 4310, 120)];
    const game = gameIn('east-gallery', { ledger: rows, taken: 1900 });
    expect(game.economy.save.ledger).toEqual(rows);
    expect(runLine(game.economy, game)).toBe('brought out 8,790 of 68,850');
  });

  it('moves with what is banked now, and is nought on a new game', () => {
    const game = gameIn('hollow', { toll: 0 });
    expect(runLine(game.economy, game)).toBe('brought out 0 of 68,850');
    game.economy.deposit(1234);
    expect(runLine(game.economy, game)).toBe('brought out 1,234 of 68,850');
  });

  it('is read by the view with its rows, the cave being played, and the line', () => {
    const rows = [rowOfCave('hollow', 2580), rowOfCave('south-gallery', 4310, 120)];
    const game = gameIn('east-gallery', { ledger: rows, taken: 1900, drained: 60 });
    const view = ledgerOf(game.economy, game);
    expect(view.rows.map((r) => r.name)).toEqual(['The Hollow', 'South Gallery']);
    expect(view.now.name).toBe('East Gallery');
    expect(view.now.soFar).toBe(true);
    expect(view.rows[0].text).toBe('2,580 of 2,620');
    expect(view.now.text).toBe('1,900 of 7,990 so far');
    expect(view.line).toBe('brought out 8,790 of 68,850');
    expect(view.foot).toBe('The mine: brought out 8,790 of 68,850');
  });
});

describe('saved and reloaded, the ledger is as it was (criterion 4)', () => {
  it('puts a save from before the ledger in with an empty one, and the taken worked out from its heaps', () => {
    const spec = specOf('east-gallery');
    const value = caveStock(spec).value;
    // 3,800 of heaps in the east gallery, 1,950 of it left: 1,850 has been brought out, and was before there was a ledger
    const raw = JSON.parse(saveIn('east-gallery', { left: [[], ...Array.from({ length: 0 }, () => [])] })) as Record<
      string,
      unknown
    >;
    delete raw.taken;
    delete raw.ledger;
    delete raw.cracked;
    delete raw.toll;
    raw.left = [[1500, 0, 20, 10, 0, 0, 0, 0, 0]];
    const lying = 1500 + 20 * KIND_VALUE[2] + 10 * KIND_VALUE[3];
    const e = newEconomy(JSON.stringify(raw));
    expect(e.save.ledger, 'no row was ever written').toEqual([]);
    expect(e.save.taken, 'the heaps’ worth less what lies').toBe(value - lying);
    // a save that says nothing of what lies has nothing worked out
    const bare = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
    bare.left = [];
    expect(newEconomy(JSON.stringify(bare)).save.taken).toBe(0);
  });

  it('counts the geodes of an old save that no longer stand as cracked, and a cave not yet begun as none', () => {
    // the South Gallery has two geodes: a save with one standing, from before they were counted, has cracked the other
    const raw = JSON.parse(saveIn('south-gallery')) as Record<string, unknown>;
    delete raw.cracked;
    raw.geodes = [-136, 4, 1.6];
    expect(newEconomy(JSON.stringify(raw)).save.cracked).toBe(1);
    raw.geodes = [];
    expect(newEconomy(JSON.stringify(raw)).save.cracked, 'none standing').toBe(2);
    raw.geodes = null;
    expect(newEconomy(JSON.stringify(raw)).save.cracked, 'not yet begun: all standing').toBe(0);
    // a count the save gives is kept, to the cave's own number
    raw.cracked = 1;
    expect(newEconomy(JSON.stringify(raw)).save.cracked).toBe(1);
    raw.cracked = 9;
    expect(newEconomy(JSON.stringify(raw)).save.cracked, 'no more than the cave has').toBe(2);
  });

  it('keeps taken at least the toll paid, for a save that says it paid more than it brought out', () => {
    const raw = JSON.parse(saveIn('hollow', { toll: 600 })) as Record<string, unknown>;
    delete raw.taken;
    raw.left = [];
    expect(newEconomy(JSON.stringify(raw)).save.taken, 'the toll is part of what was taken').toBeGreaterThanOrEqual(
      600,
    );
  });

  it('drops a row that is not made of numbers, one for a cave not in the run, a repeat, and any past six', () => {
    const good = (id: string): Row => ({
      cave: id,
      held: held(specOf(id)),
      taken: 5,
      toll: 2,
      drained: 0,
      left: held(specOf(id)) - 5,
      finds: { chamber: 'none', sideRoom: 'none', wall: 'none', geodes: { cracked: 0, of: 1 } },
      marks: { clean: true, everyHeap: false, everyFind: false },
    });
    const ids = RUN.slice(0, -1).map((c) => c.id);
    const bad: unknown[] = [
      { ...good('hollow'), taken: 'lots' },
      { ...good('hollow'), cave: 'the-moon' },
      { ...good('hollow'), left: null },
      { ...good('hollow'), marks: { clean: 1 } },
      { ...good('hollow'), finds: { chamber: 'maybe', sideRoom: 'none', wall: 'none', geodes: { cracked: 0, of: 1 } } },
      'a row',
      null,
      { ...good('hollow'), taken: -3 },
    ];
    const rows = [...bad, ...ids.map(good), good('hollow'), good('south-gallery')];
    const e = newEconomy(saveIn('east-gallery', { ledger: rows as Row[] }));
    expect(e.save.ledger, 'only the good, whole, once each, in order').toEqual(ids.map(good));
    // a row for every cave of the run, the last too, which no player leaves: the last is the one let go
    const many = newEconomy(saveIn('east-gallery', { ledger: RUN.map((c) => good(c.id)) }));
    expect(many.save.ledger.map((r) => r.cave)).toEqual(ids);
    expect(newEconomy(saveIn('hollow', { ledger: 'nonsense' as unknown as Row[] })).save.ledger).toEqual([]);
  });
});

describe('the card and the ledger, as words', () => {
  const row: Row = {
    cave: 'south-gallery',
    held: 5755,
    taken: 4310,
    toll: 1200,
    drained: 120,
    left: 1325,
    finds: { chamber: 'found', sideRoom: 'left', wall: 'left', geodes: { cracked: 1, of: 2 } },
    marks: { clean: false, everyHeap: true, everyFind: false },
  };

  it('has a bar of gold, blue and grey that is held to what the cave held, and its figures beside it', () => {
    const card = cardOf(row, 'South Gallery');
    expect(card.name).toBe('South Gallery');
    expect(card.figures).toBe('4,310 brought out · 120 drained · 1,325 left behind');
    expect(card.bar.out).toBeCloseTo(74.9, 1);
    expect(card.bar.drained).toBeCloseTo(2.1, 1);
    expect(card.bar.left).toBeCloseTo(23.0, 1);
    expect(card.bar.out + card.bar.drained + card.bar.left).toBeCloseTo(100, 5);
  });

  it('says each mark in a word, ◆ for the won and ◇ for the not', () => {
    const card = cardOf(row, 'South Gallery');
    expect(card.marks).toEqual([
      { word: 'clean', won: false, text: '◇ clean' },
      { word: 'every heap', won: true, text: '◆ every heap' },
      { word: 'every find', won: false, text: '◇ every find' },
    ]);
  });

  it('keeps a bar that took more than the cave held inside its track, the vein’s coins and all', () => {
    const card = cardOf({ ...row, taken: 22000, held: 21800, drained: 0, left: 0, vein: true }, 'The Deep');
    expect(card.bar.out + card.bar.drained + card.bar.left).toBeCloseTo(100, 5);
    expect(card.bar.left).toBe(0);
  });

  it('has a bar of nothing for a cave that held nothing, and does not divide by it', () => {
    const card = cardOf({ ...row, held: 0, taken: 0, drained: 0, left: 0 }, 'Nowhere');
    expect(card.bar).toEqual({ out: 0, drained: 0, left: 0 });
  });
});
