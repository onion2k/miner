/**
 * Saves from every shape the game has ever written, kept in `test/saves`, all
 * still loading and playing. A player's save outlives the code that wrote it:
 * the cave has grown rooms, chambers, walls, lamps and barrels since the first
 * one, and each of those added a field that an older save does not have.
 *
 * A save whose shape is new needs a file here. The last test sees to that: it
 * fails when the game writes a field no file in the corpus has.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Autopilot } from '../src/autopilot';
import { AREAS, ORDER } from '../src/cave';
import { Economy, memoryStore } from '../src/economy';
import { Game } from '../src/game';
import { checkInvariants } from '../src/invariants';
import { withSeed } from './helpers';

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
  '05-sealing.json': { room: 3, magnet: 4 },
  '06-chambers.json': { room: 1, engine: 4 },
  '07-walls-and-lamps.json': { room: 2, magnet: 5 },
  '08-barrels.json': { room: 4, drones: 3 },
  '09-current.json': { room: 1, engine: 2 },
};

describe('saves from every shape the game has written', () => {
  it('has a file for every shape, oldest first', () => {
    expect(files.length).toBeGreaterThanOrEqual(9);
    expect(files).toEqual(Object.keys(KEPT).sort());
  });

  for (const file of files) {
    describe(file, () => {
      it('loads with what it bought kept, and every list filled out to the cave as it is now', () => {
        const e = new Economy(memoryStore(read(file)));
        const save = e.save;
        for (const [key, was] of Object.entries(KEPT[file])) expect(save[key as keyof typeof save]).toEqual(was);
        expect(save.areas).toHaveLength(AREAS.length);
        expect(save.belts).toHaveLength(AREAS.length);
        expect(save.areas[ORDER[0]], 'the hollow is always open').toBe(true);
        expect(ORDER).toContain(save.room);
        expect(Number.isFinite(save.bank) && save.bank >= 0).toBe(true);
      });

      it('plays on from where it left off, and breaks no rule', () => {
        withSeed(7, () => {
          const game = new Game(new Economy(memoryStore(read(file))));
          expect(checkInvariants(game)).toEqual([]);
          const pilot = new Autopilot(game, 'rusher', { shop: false });
          for (let f = 0; f < 600; f++) pilot.step(1 / 60);
          expect(checkInvariants(game)).toEqual([]);
        });
      });

      it('comes back as it went, written again in the shape of today', () => {
        const store = memoryStore(read(file));
        const before = new Economy(store).save;
        new Economy(memoryStore(read(file))); // loading alone must not write
        const game = new Game(new Economy(store));
        game.persist();
        const after = new Economy(memoryStore(store.json)).save;
        expect(after.bank).toBe(before.bank);
        expect(after.room).toBe(before.room);
        expect(after.areas).toEqual(before.areas);
        expect(after.secrets).toEqual(before.secrets);
        expect(after.walls).toEqual(before.walls);
      });
    });
  }

  it('has the shape the game writes now: a new field means a new file here', () => {
    const game = new Game(new Economy(memoryStore()));
    game.persist();
    const now = Object.keys(JSON.parse(JSON.stringify(game.economy.save)) as object).sort();
    const newest = Object.keys(JSON.parse(read(files[files.length - 1])) as object).sort();
    expect(newest, 'add a save in the new shape to test/saves').toEqual(now);
  });
});
