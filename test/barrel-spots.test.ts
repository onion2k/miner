/**
 * Where each older cave's barrels stand. `placeBarrels` was made to ask its expensive questions of the tiles in rank
 * order and stop when there are barrels enough, which is quicker in a cave of thousands of tiles and must be no
 * different in the ones that were placed before: a barrel that moves is a heap or a hole that something else now
 * stands too near, and a save that kept where the barrels lay would be keeping it for another cave. The hashes are
 * of the spots the code at commit edf6e72, before the change, gave.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildCave } from '../src/cave';
import { specOf } from './helpers';

const digest = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);

const BEFORE: Record<string, string> = {
  hollow: '86fd3e512fd1c95c',
  'south-gallery': 'c4257830e52bdb94',
  'east-gallery': 'abba2f48b0e604f8',
  'north-vault': '878cefba2d006fa3',
  warrens: '6c2721e9dbcb1b15',
  'west-gallery': '8f6ed9d20649f949',
};

describe('every cave placed before the Deep', () => {
  for (const [id, want] of Object.entries(BEFORE)) {
    // the West Gallery gained a way out, and no barrel stands by a cutting: it is held as it stood, with the way out
    // taken off, so that the way out is the only thing that could move it
    it(`${id} has its barrels on the very same spots${id === 'west-gallery' ? ', the way out aside' : ''}`, () => {
      const spec = specOf(id);
      const { barrels } = buildCave(id === 'west-gallery' ? { ...spec, exit: null } : spec);
      expect(barrels.length).toBe(spec.barrels);
      expect(digest(barrels)).toBe(want);
    });
  }
});
