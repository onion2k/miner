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
import { Economy, memoryStore } from '../src/economy';
import { Game } from '../src/game';
import { checkInvariants } from '../src/invariants';
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
};

describe('saves from every shape the game has written', () => {
  it('has a file for every shape, oldest first, and says where each lands', () => {
    expect(files.length).toBeGreaterThanOrEqual(14);
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
        } else if (file.startsWith('14')) {
          expect(save.lampsBroken).toEqual([5, 11]);
          expect(save.barrels, 'the barrels where they stood').toHaveLength(9);
          expect(save.geodes, 'the geodes where they lay').toEqual([-136, 4, 1.6, -172, -20, 1.6]);
        } else {
          expect(save.lampsBroken, 'lamps start afresh').toEqual([]);
          expect(save.barrels, 'barrels start afresh').toBeNull();
        }
        // a save from before the scoop, the geodes and the drains has none of them, and starts without
        if (!file.startsWith('14')) {
          expect(save.scoop, 'no scoop bought').toBe(0);
          expect(save.geodes, 'geodes start afresh').toBeNull();
          expect(save.drained, 'nothing down a drain').toBe(0);
        }
        expect(Number.isFinite(save.bank) && save.bank >= 0).toBe(true);
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
        // a save with its geodes where they lay has them there again; one from before them has them where they start
        if (before.geodes) expect(after.geodes).toEqual(before.geodes);
        else expect(after.geodes).toHaveLength(caveOf(before.cave).geodes.length * 3);
        expect(after.drained).toBe(before.drained);
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
