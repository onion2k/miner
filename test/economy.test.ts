import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BLADE,
  Economy,
  SCOOP,
  SCOOP_SIZES,
  WALL_STRENGTH,
  browserStore,
  caveStock,
  memoryStore,
  sourcesOf,
  workshopTotal,
} from '../src/economy';
import { KIND_VALUE } from '../src/physics';
import { RUN, payToll, specOf, leavingRow } from './helpers';

/** An economy over the browser's storage, which these tests stand in for. */
const newEconomy = () => payToll(new Economy(browserStore, RUN));

const KEY = 'pushminer-save-v1';
let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('travelling to a cave, for the page’s gates', () => {
  it('puts the save in any cave of the run afresh, keeping what the player carries', () => {
    const e = newEconomy();
    e.deposit(700);
    e.buy('engine');
    e.save.lampsBroken.push(3);
    e.travel('warrens');
    expect(e.cave().id).toBe('warrens');
    expect(e.save.cave).toBe('warrens');
    expect(e.save.open).toBe(false);
    expect(e.save.lampsBroken).toEqual([]);
    expect(e.save.secrets).toHaveLength(specOf('warrens').secrets.length);
    expect(e.save.engine, 'the engine goes on').toBe(1);
    expect(e.bank).toBe(650);
    // and back to the first, which is the same as any other
    e.travel('hollow');
    expect(e.index()).toBe(0);
  });

  it('refuses a cave that is not in the run, by name', () => {
    const e = newEconomy();
    expect(() => e.travel('nowhere')).toThrow(/nowhere/);
    expect(e.save.cave).toBe('hollow');
  });
});

describe('the economy', () => {
  it('starts in the first cave with nothing', () => {
    const e = newEconomy();
    expect(e.bank).toBe(0);
    expect(e.cave()).toBe(RUN[0]);
    expect(e.index()).toBe(0);
    expect(e.isLast()).toBe(false);
    expect(e.save.cave).toBe('hollow');
    expect(e.save.open).toBe(false);
  });

  it('opens each cave’s way out, moves on through the run in order, and is done after the last', () => {
    const e = newEconomy();
    const events: string[] = [];
    e.onChange((id) => events.push(id));
    for (let n = 1; n < RUN.length; n++) {
      e.open();
      expect(e.save.open).toBe(true);
      // opening again before moving on does nothing
      e.open();
      e.moveOn(leavingRow(e));
      expect(e.cave()).toBe(RUN[n]);
      expect(e.save.cave).toBe(RUN[n].id);
      expect(e.index()).toBe(n);
      expect(e.save.open, 'the way out of the new cave is shut').toBe(false);
    }
    expect(e.isLast()).toBe(true);
    expect(e.save.done).toBe(false);
    e.open();
    expect(e.save.done).toBe(true);
    expect(e.save.open, 'the last cave has no way out to open').toBe(false);
    expect(events).toEqual([...RUN.slice(0, -1).flatMap((c) => ['exit', `left:${c.id}`]), 'done']);
  });

  it('will not move on before the way out is open, or past the last cave', () => {
    const e = newEconomy();
    e.moveOn(leavingRow(e));
    expect(e.cave()).toBe(RUN[0]);
    e.save.cave = RUN[RUN.length - 1].id;
    const last = new Economy(memoryStore(JSON.stringify(e.save)), RUN);
    last.save.open = true;
    last.moveOn(leavingRow(last));
    expect(last.save.cave).toBe(RUN[RUN.length - 1].id);
  });

  it('stops telling a listener that has let go, so a game that is finished with costs nothing', () => {
    const e = newEconomy();
    const told: string[] = [];
    const stop = e.onChange((id) => told.push(id));
    expect(e.listening).toBe(1);
    e.open();
    stop();
    expect(e.listening).toBe(0);
    e.moveOn(leavingRow(e));
    expect(told).toEqual(['exit']);
  });

  it('keeps its save across a reload', () => {
    const a = newEconomy();
    a.deposit(500);
    a.open();
    a.breakLamp(3);
    a.breakLamp(3);
    const b = newEconomy();
    expect(b.bank).toBe(500);
    expect(b.save.banked).toBe(500);
    expect(b.save.open).toBe(true);
    expect(b.save.lampsBroken).toEqual([3]);
  });

  it('keeps which cave it is in across a reload, and starts the new cave afresh', () => {
    const a = newEconomy();
    a.deposit(40);
    a.breakLamp(2);
    a.open();
    a.moveOn(leavingRow(a));
    const b = newEconomy();
    expect(b.save.cave).toBe(RUN[1].id);
    expect(b.save.open).toBe(false);
    expect(b.save.lampsBroken).toEqual([]);
    expect(b.bank).toBe(40);
  });

  it('plays from the start when the save is unreadable', () => {
    store.set(KEY, '{not json');
    expect(newEconomy().bank).toBe(0);
  });

  it('checks what comes from outside: a value out of range is brought into it, and lists are the cave’s size', () => {
    store.set(
      KEY,
      JSON.stringify({
        bank: -5,
        engine: 99,
        blade: 'lots',
        drones: 9,
        body: 'hovercraft',
        paint: 'plaid',
        cave: 'south-gallery',
        open: true,
        belts: ['south-belt', 'the-moon'],
        secrets: [true, true, true],
        walls: 'yes',
        rubble: [1, 2, 3, 4, 5],
        barrels: [1, 2, 3, 4],
        lampsBroken: [1, 'x', 2],
        scoop: 99,
        geodes: [1, 2, 3, 4],
        drained: -4,
      }),
    );
    const e = newEconomy();
    const south = specOf('south-gallery');
    expect(e.bank).toBe(0);
    expect(e.save.engine).toBeLessThan(10);
    expect(e.save.blade).toBe(0);
    expect(e.save.drones).toBeLessThanOrEqual(3);
    expect(e.save.body).toBe('dozer');
    expect(e.save.paint).toBe('yellow');
    expect(e.save.cave).toBe('south-gallery');
    expect(e.save.belts).toEqual(['south-belt']);
    expect(e.save.secrets).toEqual(south.secrets.map(() => true));
    expect(e.save.walls).toEqual(south.walls.map(() => false));
    expect(e.save.rubble, 'whole bricks only').toEqual([1, 2, 3, 4]);
    expect(e.save.barrels, 'whole barrels only').toEqual([1, 2, 3]);
    expect(e.save.scoop, 'no size of scoop past the largest').toBe(3);
    expect(e.save.geodes, 'whole geodes only').toEqual([1, 2, 3]);
    expect(e.save.drained, 'nothing less than nothing down a drain').toBe(0);
    expect(e.save.lampsBroken).toEqual([1, 2]);
  });

  it('refuses a cave it does not know, by name, and begins the run again', () => {
    store.set(KEY, JSON.stringify({ bank: 30, cave: 'the-moon', open: true }));
    const e = newEconomy();
    expect(e.save.cave).toBe('hollow');
    expect(e.save.open).toBe(false);
    expect(e.bank).toBe(30);
  });

  it('fills in what an older save is missing', () => {
    store.set(KEY, JSON.stringify({ bank: 7, room: 0, areas: [true] }));
    const e = newEconomy();
    const spec = e.cave();
    expect(e.save.cave).toBe('hollow');
    expect(e.save.belts).toEqual([]);
    expect(e.save.secrets).toHaveLength(spec.secrets.length);
    expect(e.save.walls).toHaveLength(spec.walls.length);
    expect(e.save.wallDamage).toHaveLength(spec.walls.length);
    expect(e.save.left).toHaveLength(sourcesOf(spec).count);
  });

  it('buys what it can afford and nothing it cannot', () => {
    const e = newEconomy();
    expect(e.buy('engine')).toBe(false);
    const cost = e.offers().find((o) => o.id === 'engine')!.cost;
    e.deposit(cost);
    const before = e.spec().maxSpeed;
    expect(e.buy('engine')).toBe(true);
    expect(e.bank).toBe(0);
    expect(e.spec().maxSpeed).toBeGreaterThan(before);
    expect(e.buy('nonsense')).toBe(false);
  });

  it('sells the Spiderdozer body once, and swaps it for the tracks and back for nothing', () => {
    const e = payToll(new Economy(memoryStore(), RUN));
    expect(e.save.body).toBe('dozer');
    expect(e.save.bodies).toEqual(['dozer']);
    const spider = e.cosmetics().find((o) => o.id === 'body:spider')!;
    expect(spider.owned).toBe(false);
    expect(spider.cost).toBeGreaterThan(0);
    expect(e.buy('body:spider')).toBe(false);
    e.deposit(spider.cost);
    expect(e.buy('body:spider')).toBe(true);
    expect(e.save.body).toBe('spider');
    expect(e.save.bodies).toEqual(['dozer', 'spider']);
    expect(e.bank).toBe(0);
    expect(e.buy('body:dozer')).toBe(true);
    expect(e.save.body).toBe('dozer');
    expect(e.buy('body:spider')).toBe(true);
    expect(e.save.body).toBe('spider');
    expect(e.bank).toBe(0);
    // the row says which is worn
    expect(e.cosmetics().find((o) => o.id === 'body:spider')!.active).toBe(true);
    expect(e.cosmetics().find((o) => o.id === 'body:dozer')!.active).toBe(false);
  });

  it('loads a save from before there were bodies on its tracks', () => {
    const e = new Economy(memoryStore(JSON.stringify({ bank: 5, paint: 'red', paints: ['yellow', 'red'] })), RUN);
    expect(e.save.body).toBe('dozer');
    expect(e.save.bodies).toEqual(['dozer']);
  });

  it('puts on a paint already owned for nothing', () => {
    const e = newEconomy();
    const paint = e.cosmetics().find((o) => o.id.startsWith('paint:') && !o.owned)!;
    e.deposit(paint.cost);
    expect(e.buy(paint.id)).toBe(true);
    expect(e.buy('paint:yellow')).toBe(true);
    expect(e.save.paint).toBe('yellow');
    expect(e.buy(paint.id)).toBe(true);
    expect(e.bank).toBe(0);
  });

  it('sells the belts of the cave being cleared, bought for it and gone with it', () => {
    const e = new Economy(memoryStore(JSON.stringify({ cave: 'south-gallery' })), RUN);
    const id = 'belt:south-belt';
    expect(e.offers().map((o) => o.id)).toContain(id);
    expect(e.offers().find((o) => o.id === id)).toMatchObject({ owned: false, available: true });
    expect(e.buy(id), 'not without the money').toBe(false);
    e.deposit(1e6);
    expect(e.buy(id)).toBe(true);
    expect(e.save.belts).toEqual(['south-belt']);
    expect(e.offers().find((o) => o.id === id)!.owned).toBe(true);
    // the hollow has none to sell, and the next cave's are its own
    expect(new Economy(memoryStore(), RUN).offers().some((o) => o.id.startsWith('belt:'))).toBe(false);
    e.open();
    e.moveOn(leavingRow(e));
    expect(e.save.belts).toEqual([]);
    expect(e.offers().find((o) => o.id === id)).toBeUndefined();
    expect(e.offers().map((o) => o.id)).toContain('belt:east-belt');
  });

  it('sells each of a cave’s belts on its own, named by where it runs, and keeps which are bought', () => {
    const e = new Economy(memoryStore(JSON.stringify({ cave: 'east-gallery' })), RUN);
    const belt = (id: string) => e.offers().find((o) => o.id === `belt:${id}`)!;
    expect(belt('east-belt').title).toBe('Conveyor, top of the ring');
    expect(belt('east-belt-bottom').title).toBe('Conveyor, bottom of the ring');
    expect(belt('east-belt-bottom')).toMatchObject({ owned: false, available: true });
    // a belt with no label reads as the single belts always did
    expect(
      new Economy(memoryStore(JSON.stringify({ cave: 'south-gallery' })), RUN)
        .offers()
        .find((o) => o.id.startsWith('belt:'))!.title,
    ).toBe('Conveyor to the South Gallery');
    e.deposit(1e6);
    expect(e.buy('belt:east-belt-bottom')).toBe(true);
    expect(e.save.belts, 'only the one bought').toEqual(['east-belt-bottom']);
    expect(belt('east-belt').owned, 'the other still for sale').toBe(false);
    expect(belt('east-belt-bottom').owned).toBe(true);
    expect(e.buy('belt:east-belt')).toBe(true);
    expect([...e.save.belts].sort()).toEqual(['east-belt', 'east-belt-bottom']);
    // a save keeps both, and a save with only the first (the shape before the second was sold) loads with the second not bought
    const again = new Economy(memoryStore(JSON.stringify(e.save)), RUN);
    expect([...again.save.belts].sort()).toEqual(['east-belt', 'east-belt-bottom']);
    const old = new Economy(memoryStore(JSON.stringify({ ...e.save, belts: ['east-belt'] })), RUN);
    expect(old.save.belts).toEqual(['east-belt']);
    expect(old.offers().find((o) => o.id === 'belt:east-belt-bottom')).toMatchObject({ owned: false, available: true });
  });

  it('hurts a wall more the harder it is hit, and brings it down at its strength', () => {
    const e = newEconomy();
    expect(e.ram(2)).toBe(0);
    expect(e.ram(8)).toBeGreaterThan(e.ram(5));
    expect(e.ram(30)).toBe(e.ram(100));
    // a wall is in the South Gallery, off the hollow's one way out
    const south = new Economy(memoryStore(JSON.stringify({ cave: 'south-gallery' })), RUN);
    const falls: string[] = [];
    south.onChange((id) => falls.push(id));
    const strength = WALL_STRENGTH[specOf('south-gallery').walls[0].grade];
    let hits = 0,
      gone = 0;
    while (gone < 1 && hits < 100) {
      gone = south.hitWall(0, e.ram(30));
      hits++;
    }
    expect(gone).toBe(1);
    expect(hits).toBe(Math.ceil(strength / e.ram(30)));
    expect(south.save.walls[0]).toBe(true);
    expect(falls).toEqual(['wall0']);
    // a wall already down stays down and says so again
    expect(south.hitWall(0, 1)).toBe(1);
    expect(falls).toEqual(['wall0']);
  });
});

describe('the sources', () => {
  it('number the cave first, then its chambers, side rooms and walls', () => {
    for (const spec of RUN) {
      const sources = sourcesOf(spec);
      const walled = 1 + spec.secrets.length + spec.stashes.length + spec.walls.length;
      // the geodes' gems are the last source, so nothing numbered before they were added has moved
      expect(sources.count, spec.id).toBe(walled + (spec.geodes ? 1 : 0));
      expect(sources.geodes(), spec.id).toBe(spec.geodes ? walled : -1);
      spec.secrets.forEach((_, k) => expect(sources.chamber(k)).toBe(1 + k));
      spec.stashes.forEach((_, k) => expect(sources.stash(k)).toBe(1 + spec.secrets.length + k));
      spec.walls.forEach((_, k) => expect(sources.wall(k)).toBe(1 + spec.secrets.length + spec.stashes.length + k));
      if (spec.walls.length) expect(sources.wall(spec.walls.length - 1)).toBe(walled - 1);
    }
  });

  it('value a cave at what its heaps hold', () => {
    for (const spec of RUN) {
      const byHand = spec.heaps.reduce(
        (s, h) => s + h.coins * KIND_VALUE[0] + h.gems.reduce((g, [k, n]) => g + n * KIND_VALUE[k], 0),
        0,
      );
      expect(caveStock(spec).value).toBe(byHand);
    }
  });
});

describe('the scoop in the workshop', () => {
  it('comes in three sizes, each dearer and wider than the last, and none is the machine as it starts', () => {
    expect(SCOOP_SIZES, 'the save is held to the sizes sold').toBe(SCOOP.length - 1);
    expect(SCOOP_SIZES).toBe(3);
    expect(SCOOP[0]).toEqual({ width: 0, cost: 0 });
    for (let k = 1; k < SCOOP.length; k++) {
      expect(SCOOP[k].width, `size ${k} is wider`).toBeGreaterThan(SCOOP[k - 1].width);
      expect(SCOOP[k].cost, `size ${k} costs more`).toBeGreaterThan(SCOOP[k - 1].cost);
    }
  });

  it('is offered after the blade, bought one size at a time for what that size costs, and is as wide as the size says', () => {
    const e = payToll(new Economy(memoryStore(), RUN));
    const ids = e.offers().map((o) => o.id);
    expect(ids.indexOf('scoop')).toBe(ids.indexOf('blade') + 1);
    expect(e.spec().bucket, 'a blade to begin with').toBe(false);
    expect(e.save.scoop).toBe(0);
    expect(e.buy('scoop'), 'not without the money').toBe(false);
    for (let size = 1; size <= SCOOP_SIZES; size++) {
      const offer = e.offers().find((o) => o.id === 'scoop')!;
      expect(offer).toMatchObject({ owned: false, available: true, cost: SCOOP[size].cost });
      expect(offer.sub, 'says how wide it is').toContain(`${SCOOP[size].width} across`);
      e.deposit(SCOOP[size].cost - 1);
      expect(e.buy('scoop'), `size ${size} one short`).toBe(false);
      e.deposit(1);
      expect(e.buy('scoop')).toBe(true);
      expect(e.save.scoop).toBe(size);
      expect(e.spec()).toMatchObject({ bladeWidth: SCOOP[size].width, bucket: true });
      expect(e.bank, 'paid for, to the coin').toBe(0);
    }
    expect(e.offers().find((o) => o.id === 'scoop')).toMatchObject({ owned: true, available: false });
    e.deposit(1e6);
    expect(e.buy('scoop'), 'no size past the widest').toBe(false);
    expect(e.save.scoop).toBe(SCOOP_SIZES);
  });

  it('keeps the blade: its row stays open for a wider one, which is the width the blade has when it is fitted', () => {
    const e = payToll(new Economy(memoryStore(), RUN));
    e.deposit(1e6);
    expect(e.buy('blade')).toBe(true);
    expect(e.spec().bladeWidth, 'a wider blade, while there is a blade').toBe(BLADE[1].width);
    expect(e.buy('scoop')).toBe(true);
    // its own width, whatever the blade was, while it is fitted
    expect(e.spec().bladeWidth).toBe(SCOOP[1].width);
    const row = () => e.offers().find((o) => o.id === 'blade')!;
    expect(row(), 'still for sale').toMatchObject({
      title: 'Wider blade',
      owned: false,
      available: true,
      cost: BLADE[2].cost,
    });
    expect(row().sub).not.toContain('replaced');
    const bank = e.bank;
    expect(e.buy('blade'), 'a wider blade, with a scoop owned').toBe(true);
    expect(e.bank).toBe(bank - BLADE[2].cost);
    expect(e.save.blade).toBe(2);
    expect(e.spec(), 'the scoop is still fitted, at its own width').toMatchObject({
      bladeWidth: SCOOP[1].width,
      bucket: true,
    });
    expect(e.buy('fit:blade')).toBe(true);
    expect(e.spec(), 'fitted, the blade has the width bought').toMatchObject({
      bladeWidth: BLADE[2].width,
      bucket: false,
    });
    e.buy('blade');
    expect(e.spec().bladeWidth).toBe(BLADE[3].width);
    expect(row()).toMatchObject({ owned: true, available: false });
    expect(e.buy('fit:scoop')).toBe(true);
    expect(e.spec().bladeWidth, 'the scoop’s width is its own, and the blade’s is not added to it').toBe(
      SCOOP[1].width,
    );
  });

  it('fits the scoop when one is bought, as it has always been', () => {
    const e = payToll(new Economy(memoryStore(), RUN));
    e.deposit(1e6);
    expect(e.save.fitted, 'a new game has the blade').toBe('blade');
    e.buy('scoop');
    expect(e.save.fitted).toBe('scoop');
    e.buy('fit:blade');
    e.buy('scoop');
    expect(e.save.fitted, 'a bigger scoop is fitted too').toBe('scoop');
    expect(e.save.scoop).toBe(2);
  });

  it('has two rows to fit one or the other, under the scoop’s, saying which is fitted', () => {
    const e = payToll(new Economy(memoryStore(), RUN));
    const ids = e.offers().map((o) => o.id);
    expect(ids.slice(ids.indexOf('scoop') + 1, ids.indexOf('scoop') + 3)).toEqual(['fit:blade', 'fit:scoop']);
    const rows = () => ({
      blade: e.offers().find((o) => o.id === 'fit:blade')!,
      scoop: e.offers().find((o) => o.id === 'fit:scoop')!,
    });
    expect(rows().blade).toMatchObject({ title: 'Blade', cost: 0, active: true, available: true, owned: true });
    expect(rows().blade.sub).toBe('pushes, and breaks brick walls and chambers');
    expect(rows().blade.words).toEqual({ on: 'fitted', off: 'fit' });
    expect(rows().scoop, 'no scoop to fit yet').toMatchObject({
      title: 'Scoop',
      cost: 0,
      available: false,
      owned: false,
    });
    expect(rows().scoop.sub).toBe('lifts, carries and tips; only dents a wall');
    e.deposit(SCOOP[1].cost);
    e.buy('scoop');
    expect(rows().scoop).toMatchObject({ active: true, available: true, owned: true });
    expect(rows().blade).toMatchObject({ active: false, available: true, owned: true });
    e.buy('fit:blade');
    expect(rows().scoop).toMatchObject({ active: false, available: true, owned: true });
    expect(rows().blade.active).toBe(true);
  });

  it('fits for nothing, at once, changing the bucket and the width, and is refused only for a scoop not owned', () => {
    const e = payToll(new Economy(memoryStore(), RUN));
    e.deposit(5000);
    const heard: string[] = [];
    e.onChange((id) => heard.push(id));
    expect(e.buy('fit:scoop'), 'no scoop to fit').toBe(false);
    expect(e.save.fitted).toBe('blade');
    expect(e.buy('fit:blade'), 'already fitted').toBe(false);
    expect(heard).toEqual([]);
    e.buy('scoop');
    heard.length = 0;
    const bank = e.bank;
    expect(e.spec()).toMatchObject({ bladeWidth: SCOOP[1].width, bucket: true });
    expect(e.buy('fit:blade')).toBe(true);
    expect(e.spec()).toMatchObject({ bladeWidth: BLADE[0].width, bucket: false });
    expect(e.buy('fit:scoop')).toBe(true);
    expect(e.spec()).toMatchObject({ bladeWidth: SCOOP[1].width, bucket: true });
    expect(e.bank, 'for nothing').toBe(bank);
    expect(heard, 'the game is told which').toEqual(['fit:blade', 'fit:scoop']);
    expect(e.buy('fit:scoop'), 'it is fitted already').toBe(false);
  });

  it('keeps what is fitted in the save, and a save that says a scoop is fitted with none owned has the blade', () => {
    const e = payToll(new Economy(memoryStore(), RUN));
    e.deposit(5000);
    e.buy('scoop');
    e.buy('fit:blade');
    const store = memoryStore(JSON.stringify(e.save));
    expect(new Economy(store, RUN).save.fitted).toBe('blade');
    e.buy('fit:scoop');
    expect(new Economy(memoryStore(JSON.stringify(e.save)), RUN).save.fitted).toBe('scoop');
    const lie = { ...e.save, scoop: 0, fitted: 'scoop' };
    const loaded = new Economy(memoryStore(JSON.stringify(lie)), RUN);
    expect(loaded.save.fitted).toBe('blade');
    expect(loaded.spec().bucket).toBe(false);
  });

  it('tells the game it was bought, and is part of what the whole workshop costs', () => {
    const e = payToll(new Economy(memoryStore(), RUN));
    const heard: string[] = [];
    e.onChange((id) => heard.push(id));
    e.deposit(SCOOP[1].cost);
    e.buy('scoop');
    expect(heard).toEqual(['scoop']);
    // the workshop came to 17,280 before the scoop, and its prices are in the sum now
    expect(workshopTotal(RUN)).toBe(17_280 + SCOOP.reduce((n, s) => n + s.cost, 0));
  });

  it('loads from a save made before it with a blade, and keeps the scoop a save has, fitted if the save says so or says nothing', () => {
    const old = new Economy(memoryStore(JSON.stringify({ bank: 12, engine: 2, blade: 2 })), RUN);
    expect(old.save.scoop).toBe(0);
    expect(old.save.fitted).toBe('blade');
    expect(old.spec()).toMatchObject({ bladeWidth: 10, bucket: false });
    // before there was a choice, a scoop was fitted: it still is
    const bought = new Economy(memoryStore(JSON.stringify({ scoop: 2, blade: 3 })), RUN);
    expect(bought.save.fitted).toBe('scoop');
    expect(bought.spec()).toMatchObject({ bladeWidth: SCOOP[2].width, bucket: true });
    const blade = new Economy(memoryStore(JSON.stringify({ scoop: 2, blade: 3, fitted: 'blade' })), RUN);
    expect(blade.spec()).toMatchObject({ bladeWidth: BLADE[3].width, bucket: false });
    const none = new Economy(memoryStore(JSON.stringify({ scoop: 0, fitted: 'scoop' })), RUN);
    expect(none.save.fitted, 'a scoop that is not owned is not fitted').toBe('blade');
    // anything else is refused by name, and the blade is what the machine has
    for (const nonsense of ['wrench', 3, null, ['scoop']]) {
      const e = new Economy(memoryStore(JSON.stringify({ scoop: 1, fitted: nonsense })), RUN);
      expect(e.save.fitted, JSON.stringify(nonsense)).toBe('blade');
    }
  });
});
