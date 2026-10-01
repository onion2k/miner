/**
 * What a cave is lit and dressed with: its lamps, and the stones, plants and crystals its biome stands on
 * the rock. A cave of many short walls, the Warrens, has a great length of rock face for its floor and
 * would hold twice the lamps and dressing of a cave of one ring, which is a frame more to draw; it asks
 * for less through `lampSpacing` and `dressing`. Both default to the old behaviour, which the hashes here
 * hold for every cave that was placed before they existed, as the cells are held in `shapes.test.ts`.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LAMP_SPACING, buildCave, type CaveSpec } from '../src/cave';
import { biomeStyle, decorate } from '../src/biomes';
import { buildTerrain } from '../src/terrain';
import { RUN, specOf } from './helpers';

const digest = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);

/** A cave's dressing, worked out from its terrain. */
function dressed(spec: CaveSpec) {
  const cave = buildCave(spec);
  const terrain = buildTerrain(
    cave,
    spec.secrets.map(() => false),
    biomeStyle(spec),
  );
  return { cave, decor: decorate(spec, terrain.samples) };
}

/** The hashes of each older cave's lamps, props and feature lights, before `lampSpacing` and `dressing` were. */
const BEFORE: Record<string, { lamps: string; props: string; lights: string }> = {
  hollow: { lamps: 'b223ee1111e3ba42', props: '4f53cda18c2baa0c', lights: '4f53cda18c2baa0c' },
  'south-gallery': { lamps: '6408a4c01e878d6d', props: '50413f73bfddcd04', lights: 'be28bef12336d74b' },
  'east-gallery': { lamps: 'f12c55dd06060b18', props: 'a9bc837bf4ccad22', lights: 'f90599e7df37de9c' },
  'north-vault': { lamps: '55525ed84019e737', props: '1e09d833242ca867', lights: 'bf6e6dad6e03d8c5' },
  'west-gallery': { lamps: 'c11b4faa2df5f69a', props: '522fcf7938908fe5', lights: 'e049346c45bae9cd' },
};

describe('every cave placed before the Warrens', () => {
  for (const [id, want] of Object.entries(BEFORE)) {
    // the West Gallery gained a way out in Phase 5, and no lamp, prop or light stands on or by a cutting: it is held as it
    // stood before, with the way out taken off, so that the way out is the only thing that moved it
    it(`${id} has the very same lamps, props and feature lights${id === 'west-gallery' ? ', the way out aside' : ''}`, () => {
      const spec = specOf(id);
      const { cave, decor } = dressed(id === 'west-gallery' ? { ...spec, exit: null } : spec);
      expect({ lamps: digest(cave.lamps), props: digest(decor.props), lights: digest(decor.lights) }).toEqual(want);
    });
  }
});

describe('lamp spacing and dressing', () => {
  const south = specOf('south-gallery');

  it('leave a cave as it was when they are left out or at their defaults', () => {
    const base = dressed(south);
    const same = dressed({ ...south, lampSpacing: LAMP_SPACING, dressing: 1 });
    expect(digest(same.cave.lamps)).toBe(digest(base.cave.lamps));
    expect(digest(same.decor.props)).toBe(digest(base.decor.props));
  });

  it('put fewer lamps in a cave that asks for wider spacing, none closer than it asked', () => {
    const base = dressed(south).cave.lamps.length;
    const wide = dressed({ ...south, lampSpacing: 20 }).cave;
    expect(wide.lamps.length).toBeLessThan(base * 0.8);
    // the lamps along the rock keep to the spacing; the floor's own keep 12 apart at the least
    for (let a = 0; a < wide.lamps.length; a++)
      for (let b = a + 1; b < wide.lamps.length; b++)
        expect(Math.hypot(wide.lamps[a].x - wide.lamps[b].x, wide.lamps[a].y - wide.lamps[b].y)).toBeGreaterThanOrEqual(
          12,
        );
  });

  it('space the lamps across the open floor wider only in a cave that asks, and leave the rest as they were', () => {
    const base = dressed(south).cave.lamps;
    expect(digest(dressed({ ...south, floorLampSpacing: 20 }).cave.lamps)).toBe(digest(base));
    const sparse = dressed({ ...south, floorLampSpacing: 40 }).cave.lamps;
    expect(sparse.length).toBeLessThan(base.length);
    // only the floor's own grid thins: every lamp left is one the cave had
    for (const l of sparse) expect(base.some((b) => b.x === l.x && b.y === l.y)).toBe(true);
  });

  it('stand fewer stones and plants for a lower share of dressing, and none for none', () => {
    const full = dressed(south).decor.props.length;
    expect(dressed({ ...south, dressing: 0.5 }).decor.props.length).toBeLessThan(full * 0.7);
    expect(dressed({ ...south, dressing: 0 }).decor.props.length).toBeLessThan(full * 0.1);
  });
});

describe('the Warrens’ lamps and dressing', () => {
  const others = RUN.filter((c) => c.id !== 'warrens').map((c) => dressed(c));
  const { cave, decor } = dressed(specOf('warrens'));

  it('are no more than the heaviest older cave’s lamps, and about a third more dressing at the most', () => {
    expect(cave.lamps.length).toBeLessThanOrEqual(Math.max(...others.map((o) => o.cave.lamps.length)));
    expect(decor.props.length).toBeLessThanOrEqual(Math.max(...others.map((o) => o.decor.props.length)) * 1.35);
    expect(decor.lights.length).toBeLessThanOrEqual(Math.max(...others.map((o) => o.decor.lights.length)));
  });

  it('still light the floor as well as the older caves do: no further from a lamp, on average, than theirs', () => {
    /** The floor's mean distance to its nearest lamp; the ways in and out are dark by design and drag it up alike in every cave. */
    const reach = (c: ReturnType<typeof buildCave>) => {
      const { cols, originX, originY } = c.grid;
      let sum = 0,
        n = 0;
      for (let t = 0; t < c.cells.length; t++) {
        if (c.cells[t] !== 1) continue;
        const x = originX + ((t % cols) + 0.5) * 4,
          y = originY + (Math.floor(t / cols) + 0.5) * 4;
        sum += Math.min(...c.lamps.map((l) => Math.hypot(l.x - x, l.y - y)));
        n++;
      }
      return sum / n;
    };
    expect(reach(cave)).toBeLessThanOrEqual(Math.max(...others.map((o) => reach(o.cave))));
  });
});
