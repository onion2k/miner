/**
 * The Deep, the last cave, twice the size of the East Gallery, and the West Gallery's way out to it. A cave of
 * this size is held to the same rules as every other (`caves.test.ts` runs the checker over the whole run,
 * haul limit and all); what is here is what is particular to it, read off its content: what it holds, that it
 * is the last, and that the West Gallery has a way out to it. What is played, which takes seconds a test, is in
 * `slow/deep.test.ts`; and the barrels' spots are held here, since they are the first thing made cheaper if the
 * swap is over its budget and must not move.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EXIT, buildCave } from '../src/cave';
import { caveStock } from '../src/economy';
import { BAR, KIND_VALUE } from '../src/physics';
import { HAUL_LIMIT } from '../scripts/hauls';
import { IDS, caveOf, newEconomy, saveIn, specOf } from './helpers';

const deep = specOf('deep');

describe('the Deep', () => {
  it('is the last cave, after the West Gallery, by the id it is saved under', () => {
    expect(IDS.at(-1)).toBe('deep');
    expect(IDS.at(-2)).toBe('west-gallery');
    expect(deep.name).toBe('The Deep');
    expect(deep.exit, 'no way out: clearing it ends the game').toBeNull();
    expect(newEconomy(saveIn('deep')).isLast()).toBe(true);
  });

  it('is a geode cave of about twice the East Gallery’s area', () => {
    expect(deep.biome).toBe('geode');
    const east = specOf('east-gallery');
    const ratio = (deep.cols * deep.rows) / (east.cols * east.rows);
    expect(ratio).toBeGreaterThan(1.8);
    expect(ratio).toBeLessThan(2.2);
  });

  it('has three holes and two belts, each belt named for where it runs and priced', () => {
    expect(deep.holes).toHaveLength(3);
    expect(deep.belts).toHaveLength(2);
    expect(new Set(deep.belts.map((b) => b.id)).size).toBe(2);
    for (const b of deep.belts) {
      expect(b.label, `${b.id} has a label`).toBeTruthy();
      expect(b.cost).toBeGreaterThan(0);
    }
    // each belt ends at the rim of a hole, which is what it is for
    for (const { spec: b } of deep.belts)
      expect(
        Math.min(...deep.holes.map((h) => Math.hypot(b.x1 - h.x, b.y1 - h.y))),
        'the belt ends by a hole',
      ).toBeLessThan(10);
  });

  it('has a side room behind a wall and a hidden chamber, each with diamonds and gold bars in it', () => {
    expect(deep.walls).toHaveLength(1);
    expect(deep.stashes).toHaveLength(1);
    expect(deep.secrets).toHaveLength(1);
    for (const loot of [deep.stashes[0].loot, deep.secrets[0].loot]) {
      const kinds = loot.gems.map(([k]) => k);
      expect(kinds, 'diamonds').toContain(4);
      expect(kinds, 'gold bars').toContain(BAR);
    }
  });

  it('is the richest cave, in diamonds and in coins all told, with prices as they are', () => {
    const worth = (id: string) => caveStock(specOf(id)).value;
    for (const id of IDS.slice(0, -1)) expect(worth('deep'), `more than ${id}`).toBeGreaterThan(worth(id));
    const diamonds = (id: string) => caveStock(specOf(id)).kinds[4];
    for (const id of IDS.slice(0, -1))
      expect(diamonds('deep'), `more diamonds than ${id}`).toBeGreaterThan(diamonds(id));
    expect(KIND_VALUE[4], 'a diamond is worth what it was').toBe(100);
    expect(KIND_VALUE[BAR], 'a gold bar is worth what it was').toBe(250);
  });

  it('is held to a haul of 160 along the floor, by the checker in caves.test.ts', () => {
    expect(HAUL_LIMIT.deep).toBe(160);
  });

  it('has its vein and cracks on the floor, for when it is cleared', () => {
    const cave = caveOf('deep');
    expect(cave.spec.cracks.length).toBeGreaterThanOrEqual(3);
    expect(cave.spec.vein.every).toBeGreaterThan(0);
  });
});

describe('the West Gallery’s way out, into the Deep', () => {
  const west = specOf('west-gallery');

  it('gives the West Gallery a way out, rock until it is cleared, and no end', () => {
    expect(west.exit).not.toBeNull();
    const cave = caveOf('west-gallery');
    expect(cave.cells.some((c) => c === EXIT)).toBe(true);
    const shut = cave.solid(false);
    cave.cells.forEach((c, t) => c === EXIT && expect(shut[t]).toBe(1));
    expect(newEconomy(saveIn('west-gallery')).isLast()).toBe(false);
  });
});

describe('the barrels stand where they stood', () => {
  // `placeBarrels` is the first thing to make cheaper if the swap is over its budget, and it must not move a barrel: a save
  // keeps where they are, and a picture has them in it
  const SPOTS: Record<string, string> = {
    hollow: '86fd3e512fd1c95c',
    'south-gallery': 'c4257830e52bdb94',
    'east-gallery': 'abba2f48b0e604f8',
    'north-vault': '878cefba2d006fa3',
    warrens: '6c2721e9dbcb1b15',
    'west-gallery': '8f6ed9d20649f949',
  };
  for (const [id, hash] of Object.entries(SPOTS)) {
    it(`${id} has the very same barrel spots`, () => {
      const spots = buildCave(specOf(id)).barrels;
      expect(createHash('sha256').update(JSON.stringify(spots)).digest('hex').slice(0, 16)).toBe(hash);
    });
  }
});
