/**
 * Saves from every shape the game has ever written, kept in `test/saves`, all
 * still loading and playing. A player's save outlives the code that wrote it:
 * the cave has grown rooms, chambers, walls, lamps, barrels, geodes and drains
 * since the first one, and the workshop a scoop, and each of those added a
 * field that an older save does not have.
 *
 * A save whose shape is new needs a file here. The last test sees to that: it
 * fails when the game writes a field no file in the corpus has.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Autopilot } from '../src/autopilot';
import { Economy, caveStock, memoryStore, tollOf } from '../src/economy';
import { Game } from '../src/game';
import { checkInvariants } from '../src/invariants';
import { KIND_VALUE } from '../src/physics';
import type { Row } from '../src/ledger';
import { RUN, caveOf, newGame, specOf, withSeed } from './helpers';

const DIR = new URL('saves/', import.meta.url);
const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .sort();
const read = (file: string) => readFileSync(new URL(file, DIR), 'utf8');

/** What each save was worth when it was written, and what loading it must keep. */
const KEPT: Record<string, Record<string, unknown>> = {
  '01-three-rooms.json': { bank: 120, engine: 2, blade: 1, drones: 1 },
  '02-magnet.json': { magnet: 3, engine: 3 },
  '03-paint-shop.json': { paint: 'red', horn: true, blade: 2 },
  '04-rooms-in-order.json': { banked: 5200, drones: 2 },
  '05-sealing.json': { magnet: 4 },
  '06-chambers.json': { engine: 4 },
  '07-walls-and-lamps.json': { magnet: 5 },
  '08-barrels.json': { drones: 3 },
  '09-current.json': { engine: 2 },
  '10-spider.json': { body: 'spider' },
  '11-linear.json': { cave: 'east-gallery', open: true },
  '12-two-belts.json': { cave: 'east-gallery', belts: ['east-belt', 'east-belt-bottom'] },
  '13-deep.json': { cave: 'deep', belts: ['deep-belt-north'], engine: 4 },
  '14-scoop-geodes-drained.json': { cave: 'warrens', scoop: 2, drained: 35 },
  '15-toll.json': { cave: 'warrens', scoop: 2, drained: 35, toll: 1200 },
  '16-ledger.json': { cave: 'warrens', scoop: 2, drained: 35, toll: 1200, taken: 2950, cracked: 1 },
  '17-fitted.json': { cave: 'warrens', scoop: 2, drained: 35, toll: 1200, taken: 2950, cracked: 1, fitted: 'blade' },
};

/**
 * What each save has paid of its cave's toll once loaded. A save from before the toll has paid what has gone from its
 * heaps, up to the toll (a save that says nothing of what is left, none; one whose way out is open, all of it); a save
 * with a toll keeps it. Worked by hand from each save's `left` row and the cave's worth: east gallery 3,800 with 1,950
 * left, and so 1,850 gone, for 05.
 */
const TOLLS: Record<string, number> = {
  '01-three-rooms.json': 0,
  '02-magnet.json': 0,
  '03-paint-shop.json': 0,
  '04-rooms-in-order.json': 1260,
  '05-sealing.json': 925,
  '06-chambers.json': 275,
  '07-walls-and-lamps.json': 1215,
  '08-barrels.json': 1085,
  '09-current.json': 0,
  '10-spider.json': 0,
  '11-linear.json': 1500,
  '12-two-belts.json': 1500,
  '13-deep.json': 0,
  '14-scoop-geodes-drained.json': 975,
  '15-toll.json': 1200,
  '16-ledger.json': 1200,
  '17-fitted.json': 1200,
};

/**
 * Where each save lands, and what of its cave it keeps. An old save's room becomes the cave of the
 * same name; what was left of the room is the cave's source 0, and the chamber, side room and wall that
 * were off the room are the cave's, at index 0; rubble, barrels and broken lamps, which were in the old
 * map's coordinates, start afresh.
 */
const LANDS: Record<
  string,
  {
    cave: string;
    open: boolean;
    /** What was left of the room, by kind: empty where the save did not say, which is all of it. */
    left: number[];
    belts: string[];
    secrets: boolean[];
    walls: boolean[];
    wallDamage: number[];
  }
> = {
  '01-three-rooms.json': {
    cave: 'south-gallery',
    open: false,
    left: [],
    belts: [],
    secrets: [false],
    walls: [false],
    wallDamage: [0],
  },
  '02-magnet.json': {
    cave: 'north-vault',
    open: false,
    left: [],
    belts: [],
    secrets: [false],
    walls: [false],
    wallDamage: [0],
  },
  '03-paint-shop.json': {
    cave: 'north-vault',
    open: false,
    left: [],
    belts: [],
    secrets: [false],
    walls: [false],
    wallDamage: [0],
  },
  '04-rooms-in-order.json': {
    cave: 'east-gallery',
    open: false,
    left: [420, 30, 12, 4, 1],
    belts: [],
    secrets: [false],
    walls: [false],
    wallDamage: [0],
  },
  '05-sealing.json': {
    cave: 'east-gallery',
    open: false,
    left: [610, 40, 20, 6, 2],
    belts: [],
    secrets: [false],
    walls: [false],
    wallDamage: [0],
  },
  '06-chambers.json': {
    cave: 'south-gallery',
    open: false,
    left: [700, 55, 24, 8, 3],
    belts: [],
    secrets: [true],
    walls: [false],
    wallDamage: [0],
  },
  '07-walls-and-lamps.json': {
    cave: 'north-vault',
    open: false,
    left: [520, 44, 18, 9, 4],
    belts: ['north-belt'],
    secrets: [true],
    walls: [false],
    wallDamage: [0],
  },
  '08-barrels.json': {
    cave: 'west-gallery',
    open: false,
    left: [820, 60, 30, 14, 6],
    belts: [],
    secrets: [false],
    walls: [false],
    wallDamage: [60],
  },
  '09-current.json': {
    cave: 'south-gallery',
    open: false,
    left: [1920, 40, 28, 0, 0, 0, 0, 0],
    belts: [],
    secrets: [false],
    walls: [false],
    wallDamage: [0],
  },
  '10-spider.json': {
    cave: 'south-gallery',
    open: false,
    left: [1920, 40, 28, 0, 0, 0, 0, 0],
    belts: [],
    secrets: [false],
    walls: [false],
    wallDamage: [0],
  },
  '11-linear.json': {
    cave: 'east-gallery',
    open: true,
    left: [300, 20, 0, 0, 0, 0, 0, 0],
    belts: ['east-belt'],
    secrets: [true],
    walls: [false],
    wallDamage: [0],
  },
  '12-two-belts.json': {
    cave: 'east-gallery',
    open: false,
    left: [220, 14, 0, 0, 0, 0, 0, 0],
    belts: ['east-belt', 'east-belt-bottom'],
    secrets: [false],
    walls: [false],
    wallDamage: [0],
  },
  '13-deep.json': {
    cave: 'deep',
    open: false,
    left: [2536, 0, 0, 72, 36, 0, 0, 0],
    belts: ['deep-belt-north'],
    secrets: [false],
    walls: [false],
    wallDamage: [0],
  },
  '14-scoop-geodes-drained.json': {
    cave: 'warrens',
    open: false,
    left: [900, 0, 40, 20, 0, 0, 0, 0],
    belts: [],
    secrets: [false],
    walls: [false],
    wallDamage: [0],
  },
  '15-toll.json': {
    cave: 'warrens',
    open: false,
    left: [900, 0, 40, 20, 0, 0, 0, 0],
    belts: [],
    secrets: [false],
    walls: [false],
    wallDamage: [0],
  },
  '16-ledger.json': {
    cave: 'warrens',
    open: false,
    left: [900, 0, 40, 20, 0, 0, 0, 0],
    belts: [],
    secrets: [false],
    walls: [false],
    wallDamage: [0],
  },
  '17-fitted.json': {
    cave: 'warrens',
    open: false,
    left: [900, 0, 40, 20, 0, 0, 0, 0],
    belts: [],
    secrets: [false],
    walls: [false],
    wallDamage: [0],
  },
};

/** The ledger a save of the shape of 16 holds: a row for each of the four caves it has left, which loading keeps whole. */
const LEDGER_OF_16 = (JSON.parse(readFileSync(new URL('16-ledger.json', DIR), 'utf8')) as { ledger: Row[] }).ledger;

/**
 * What a save from before the ledger has taken from the cave it is in, worked out here from what it says is lying of
 * the cave's heaps and not from the code that loads it: the heaps' worth less what lies, nothing for a save that says
 * nothing of what lies, and never less than the toll paid.
 */
function takenFrom(file: string): number {
  const land = LANDS[file];
  const lying = land.left.reduce((sum, n, k) => sum + n * KIND_VALUE[k], 0);
  const gone = land.left.length ? Math.max(0, caveStock(specOf(land.cave)).value - lying) : 0;
  return Math.max(gone, TOLLS[file]);
}

describe('saves from every shape the game has written', () => {
  it('has a file for every shape, oldest first, and says where each lands', () => {
    expect(files.length).toBeGreaterThanOrEqual(17);
    expect(files).toEqual(Object.keys(KEPT).sort());
    expect(Object.keys(LANDS).sort()).toEqual(files);
  });

  for (const file of files) {
    describe(file, () => {
      it('loads into the cave it was in, with what it bought kept and every list sized to that cave', () => {
        const e = new Economy(memoryStore(read(file)), RUN);
        const save = e.save;
        const want = LANDS[file];
        for (const [key, was] of Object.entries(KEPT[file])) expect(save[key as keyof typeof save]).toEqual(was);
        expect(save.cave, 'the cave it lands in').toBe(want.cave);
        expect(save.open).toBe(want.open);
        const spec = specOf(want.cave);
        // the cave, its chambers, side rooms and walls, and last the gems of its geodes
        const sources = 1 + spec.secrets.length + spec.stashes.length + spec.walls.length + (spec.geodes ? 1 : 0);
        expect(save.left, 'one row a source of the cave').toHaveLength(sources);
        expect(save.left[0], 'what was left of the room is what is left of the cave').toEqual(want.left);
        expect(save.belts).toEqual(want.belts);
        expect(save.secrets).toEqual(want.secrets);
        expect(save.walls).toEqual(want.walls);
        expect(save.wallDamage).toEqual(want.wallDamage);
        expect(save.rubble, 'rubble starts afresh').toEqual([]);
        // an old save's rubble, lamps and barrels were in the old map's coordinates: they start afresh; a new one's are kept
        if (file.startsWith('11')) expect(save.lampsBroken).toEqual([4, 9]);
        else if (file.startsWith('12')) expect(save.lampsBroken).toEqual([2, 7]);
        else if (file.startsWith('13')) {
          expect(save.lampsBroken).toEqual([3, 9]);
          expect(save.barrels, 'the barrels where they stood').toHaveLength(18);
        } else if (['14', '15', '16', '17'].some((n) => file.startsWith(n))) {
          expect(save.lampsBroken).toEqual([5, 11]);
          expect(save.barrels, 'the barrels where they stood').toHaveLength(9);
          expect(save.geodes, 'the geodes where they lay').toEqual(
            file.startsWith('16') || file.startsWith('17') ? [-136, 4, 1.6] : [-136, 4, 1.6, -172, -20, 1.6],
          );
        } else {
          expect(save.lampsBroken, 'lamps start afresh').toEqual([]);
          expect(save.barrels, 'barrels start afresh').toBeNull();
        }
        // a save from before the scoop, the geodes and the drains has none of them, and starts without
        if (!['14', '15', '16', '17'].some((n) => file.startsWith(n))) {
          expect(save.scoop, 'no scoop bought').toBe(0);
          expect(save.geodes, 'geodes start afresh').toBeNull();
          expect(save.drained, 'nothing down a drain').toBe(0);
        }
        expect(Number.isFinite(save.bank) && save.bank >= 0).toBe(true);
      });

      it('has the blade or the scoop fitted as it says, the scoop for a save that has one and says nothing, the blade for none', () => {
        const raw = JSON.parse(read(file)) as { fitted?: string; scoop?: number };
        const e = new Economy(memoryStore(read(file)), RUN);
        const owned = (raw.scoop ?? 0) > 0;
        expect(e.save.fitted).toBe(owned && raw.fitted !== 'blade' ? 'scoop' : 'blade');
        expect(e.spec().bucket, 'the machine has what is fitted').toBe(e.save.fitted === 'scoop');
        if (file.startsWith('17')) expect(raw.fitted, 'this is the shape that says').toBe('blade');
        else expect(raw.fitted, 'older shapes say nothing').toBeUndefined();
      });

      it('keeps its bank whole and has its toll paid by what has gone from the cave, never more than the toll', () => {
        const raw = JSON.parse(read(file)) as { bank: number; banked: number };
        const e = new Economy(memoryStore(read(file)), RUN);
        expect(e.save.bank, 'nothing is taken back from the bank').toBe(raw.bank);
        expect(e.save.banked).toBe(raw.banked);
        expect(e.save.toll, 'the toll paid').toBe(TOLLS[file]);
        expect(e.owed()).toBe(tollOf(specOf(e.save.cave)) - TOLLS[file]);
      });

      it('has its ledger as it was written, or none and what it has taken worked out from its heaps if it was before the ledger', () => {
        const e = new Economy(memoryStore(read(file)), RUN);
        if (file.startsWith('16') || file.startsWith('17')) {
          expect(e.save.ledger, 'every row kept whole').toEqual(LEDGER_OF_16);
          expect(e.save.taken).toBe(2950);
          expect(e.save.cracked).toBe(1);
        } else {
          expect(e.save.ledger, 'no row was ever written').toEqual([]);
          expect(e.save.taken, 'the heaps’ worth less what lies').toBe(takenFrom(file));
          // a save that was not told of the geodes counted has the ones that no longer stand cracked
          const raw = JSON.parse(read(file)) as { geodes?: number[] | null };
          const cave = specOf(e.save.cave);
          const standing = Array.isArray(raw.geodes) ? raw.geodes.length / 3 : (cave.geodes?.count ?? 0);
          expect(e.save.cracked).toBe(Math.max(0, (cave.geodes?.count ?? 0) - standing));
        }
        expect(e.save.taken, 'at least the toll, which is part of it').toBeGreaterThanOrEqual(e.save.toll);
      });

      it('plays on from where it left off, and breaks no rule', () => {
        withSeed(7, () => {
          const game = newGame(read(file));
          expect(checkInvariants(game)).toEqual([]);
          const pilot = new Autopilot(game, 'rusher', { shop: false });
          for (let f = 0; f < 600; f++) pilot.step(1 / 60);
          expect(checkInvariants(game)).toEqual([]);
        });
      });

      it('comes back as it went, written again in the shape of today', () => {
        const store = memoryStore(read(file));
        const before = new Economy(store, RUN).save;
        new Economy(memoryStore(read(file)), RUN); // loading alone must not write
        const game = new Game(new Economy(store, RUN), caveOf(before.cave));
        game.persist();
        const after = new Economy(memoryStore(store.json), RUN).save;
        expect(after.bank).toBe(before.bank);
        expect(after.cave).toBe(before.cave);
        expect(after.open).toBe(before.open);
        expect(after.belts).toEqual(before.belts);
        expect(after.secrets).toEqual(before.secrets);
        expect(after.walls).toEqual(before.walls);
        expect(after.scoop).toBe(before.scoop);
        expect(after.fitted).toBe(before.fitted);
        // a save with its geodes where they lay has them there again; one from before them has them where they start
        if (before.geodes) expect(after.geodes).toEqual(before.geodes);
        else expect(after.geodes).toHaveLength(caveOf(before.cave).geodes.length * 3);
        expect(after.drained).toBe(before.drained);
        expect(after.ledger, 'the ledger is as it was').toEqual(before.ledger);
        expect(after.taken).toBe(before.taken);
        expect(after.cracked).toBe(before.cracked);
        expect(after.toll, 'the toll worked out for an old save is kept once it is written').toBe(before.toll);
      });
    });
  }

  it('opens the way out of the cave a save was in, when the next room’s gate was already open', () => {
    // 06 was clearing the south gallery, and the east gallery was the next to open: with its gate up
    const old = JSON.parse(read('06-chambers.json')) as { areas: boolean[] };
    old.areas = [true, true, false, true, false];
    const e = new Economy(memoryStore(JSON.stringify(old)), RUN);
    expect(e.save.cave).toBe('south-gallery');
    expect(e.save.open).toBe(true);
  });

  it('keeps a cleared cave cleared: a save from the last room with the cave done stays done', () => {
    const old = JSON.parse(read('08-barrels.json')) as { done: boolean };
    old.done = true;
    const e = new Economy(memoryStore(JSON.stringify(old)), RUN);
    expect(e.save.cave).toBe('west-gallery');
    expect(e.save.done).toBe(true);
    expect(e.save.open, 'not sent on through the way out it has since been given').toBe(false);
  });

  it('refuses a cave it does not know, by name, and starts the run from its first', () => {
    const e = new Economy(
      memoryStore(JSON.stringify({ ...JSON.parse(read('11-linear.json')), cave: 'the-moon' })),
      RUN,
    );
    expect(e.save.cave).toBe(RUN[0].id);
    expect(e.save.open).toBe(false);
  });

  it('has the shape the game writes now: a new field means a new file here', () => {
    const game = newGame();
    game.persist();
    const now = Object.keys(JSON.parse(JSON.stringify(game.economy.save)) as object).sort();
    const newest = Object.keys(JSON.parse(read(files[files.length - 1])) as object).sort();
    expect(newest, 'add a save in the new shape to test/saves').toEqual(now);
  });
});
