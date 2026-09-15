import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AREAS, ORDER, SECRETS, STASHES, WALLS } from '../src/cave';
import {
  Economy,
  SOURCES,
  WALL_STRENGTH,
  areaOfSource,
  chamberSource,
  roomStock,
  stashSource,
  wallSource,
} from '../src/economy';
import { KIND_VALUE } from '../src/physics';

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

describe('the economy', () => {
  it('starts in the hollow with nothing', () => {
    const e = new Economy();
    expect(e.bank).toBe(0);
    expect(e.current()).toBe(ORDER[0]);
    expect(e.save.areas).toEqual(AREAS.map((_, a) => a === 0));
    expect(e.next()).toBe(ORDER[1]);
    expect(e.nextOpen()).toBe(false);
  });

  it('opens the rooms in order, seals each behind the player, and is done after the last', () => {
    const e = new Economy();
    const events: string[] = [];
    e.onChange((id) => events.push(id));
    for (let n = 1; n < ORDER.length; n++) {
      e.open();
      expect(e.save.areas[ORDER[n]]).toBe(true);
      // opening again before moving on does nothing
      e.open();
      e.moveOn();
      expect(e.current()).toBe(ORDER[n]);
      if (n > 1) {
        expect(e.save.areas[ORDER[n - 1]]).toBe(false);
        expect(e.sealed(ORDER[n - 1])).toBe(true);
      }
      // the hollow is never shut
      expect(e.save.areas[0]).toBe(true);
    }
    expect(e.save.done).toBe(false);
    e.open();
    expect(e.save.done).toBe(true);
    expect(events).toEqual([...ORDER.slice(1).flatMap((a, n) => [`area${a}`, `sealed${ORDER[n]}`]), 'done']);
  });

  it('will not move on before the next gate is open', () => {
    const e = new Economy();
    e.moveOn();
    expect(e.current()).toBe(ORDER[0]);
  });

  it('keeps its save across a reload', () => {
    const a = new Economy();
    a.deposit(500);
    a.open();
    a.breakLamp(3);
    a.breakLamp(3);
    const b = new Economy();
    expect(b.bank).toBe(500);
    expect(b.save.banked).toBe(500);
    expect(b.save.areas[ORDER[1]]).toBe(true);
    expect(b.save.lampsBroken).toEqual([3]);
  });

  it('plays from the start when the save is unreadable', () => {
    store.set(KEY, '{not json');
    expect(new Economy().bank).toBe(0);
  });

  it('brings a save from before rooms were sealed forward to the furthest room it had', () => {
    const furthest = ORDER[2];
    store.set(
      KEY,
      JSON.stringify({ bank: 50, areas: AREAS.map((_, a) => ORDER.indexOf(a) <= 2), left: [1, 2, 3, 4, 5] }),
    );
    const e = new Economy();
    expect(e.current()).toBe(furthest);
    expect(e.save.areas).toEqual(AREAS.map((_, a) => a === 0 || a === furthest));
    expect(e.save.left).toHaveLength(SOURCES);
    expect(e.save.left[furthest]).toEqual([1, 2, 3, 4, 5]);
  });

  it('fills in what an older save is missing', () => {
    store.set(KEY, JSON.stringify({ bank: 7, room: 0, areas: [true] }));
    const e = new Economy();
    expect(e.save.areas).toHaveLength(AREAS.length);
    expect(e.save.belts).toHaveLength(AREAS.length);
    expect(e.save.secrets).toHaveLength(SECRETS.length);
    expect(e.save.walls).toHaveLength(WALLS.length);
    expect(e.save.wallDamage).toHaveLength(WALLS.length);
  });

  it('buys what it can afford and nothing it cannot', () => {
    const e = new Economy();
    expect(e.buy('engine')).toBe(false);
    const cost = e.offers().find((o) => o.id === 'engine')!.cost;
    e.deposit(cost);
    const before = e.spec().maxSpeed;
    expect(e.buy('engine')).toBe(true);
    expect(e.bank).toBe(0);
    expect(e.spec().maxSpeed).toBeGreaterThan(before);
    expect(e.buy('nonsense')).toBe(false);
  });

  it('puts on a paint already owned for nothing', () => {
    const e = new Economy();
    const paint = e.cosmetics().find((o) => o.id.startsWith('paint:') && !o.owned)!;
    e.deposit(paint.cost);
    expect(e.buy(paint.id)).toBe(true);
    expect(e.buy('paint:yellow')).toBe(true);
    expect(e.save.paint).toBe('yellow');
    expect(e.buy(paint.id)).toBe(true);
    expect(e.bank).toBe(0);
  });

  it('only sells a belt for a room that is open', () => {
    const e = new Economy();
    const a = ORDER.find((r) => AREAS[r].belt)!;
    e.deposit(1e6);
    expect(e.buy(`belt${a}`)).toBe(false);
    e.save.areas[a] = true;
    expect(e.buy(`belt${a}`)).toBe(true);
    expect(e.save.belts[a]).toBe(true);
  });

  it('hurts a wall more the harder it is hit, and brings it down at its strength', () => {
    const e = new Economy();
    expect(e.ram(2)).toBe(0);
    expect(e.ram(8)).toBeGreaterThan(e.ram(5));
    expect(e.ram(30)).toBe(e.ram(100));
    if (!WALLS.length) return;
    const falls: string[] = [];
    e.onChange((id) => falls.push(id));
    const strength = WALL_STRENGTH[WALLS[0].grade];
    let hits = 0,
      gone = 0;
    while (gone < 1 && hits < 100) {
      gone = e.hitWall(0, e.ram(30));
      hits++;
    }
    expect(gone).toBe(1);
    expect(hits).toBe(Math.ceil(strength / e.ram(30)));
    expect(e.save.walls[0]).toBe(true);
    expect(falls).toEqual(['wall0']);
    // a wall already down stays down and says so again
    expect(e.hitWall(0, 1)).toBe(1);
    expect(falls).toEqual(['wall0']);
  });
});

describe('the sources', () => {
  it('put everything in the room it is sealed with', () => {
    AREAS.forEach((_, a) => expect(areaOfSource(a)).toBe(a));
    SECRETS.forEach((s, k) => expect(areaOfSource(chamberSource(k))).toBe(s.area));
    STASHES.forEach((s, k) => expect(areaOfSource(stashSource(k))).toBe(s.area));
    WALLS.forEach((w, k) => expect(areaOfSource(wallSource(k))).toBe(w.area));
    expect(wallSource(WALLS.length - 1)).toBe(SOURCES - 1);
  });

  it('value a room at what its heaps hold', () => {
    for (let a = 0; a < AREAS.length; a++) {
      const byHand = AREAS[a].heaps.reduce(
        (s, h) => s + h.coins * KIND_VALUE[0] + h.gems.reduce((g, [k, n]) => g + n * KIND_VALUE[k], 0),
        0,
      );
      expect(roomStock(a).value).toBe(byHand);
    }
  });
});
