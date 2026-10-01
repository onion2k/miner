/**
 * The runway lights down each cave's cuttings: where they stand, when the way out's are lit, and which way the
 * pulse runs along them. Without these a start at the dark outer end of the way in is a black screen with two
 * headlights in it, which looks as if the game had broken.
 */
import { describe, expect, it } from 'vitest';
import { ARRIVAL_DARK, EXIT, OPEN, TILE, arrival, darkness, tileCentre, type Cave, type Cutting } from '../src/cave';
import { beat, featureParticle, runwayFeatures } from '../src/biomes';
import { RUNWAY_PERIOD, runwayBeat, runwayLights } from '../src/runway';
import { IDS, caveOf, specOf, tileIn } from './helpers';

/** The rows a cutting should have: a light every two tiles down each edge. */
const rows = (c: Cutting) => {
  const [x0, y0, x1, y1] = c.tiles;
  return Math.ceil((c.out[0] ? x1 - x0 + 1 : y1 - y0 + 1) / 2);
};

/** A cutting's world rectangle. */
function box(cave: Cave, c: Cutting): [number, number, number, number] {
  const [x0, y0, x1, y1] = c.tiles;
  const [ax, ay] = tileCentre(cave.grid, x0, y0),
    [bx, by] = tileCentre(cave.grid, x1, y1);
  return [ax - TILE / 2, ay - TILE / 2, bx + TILE / 2, by + TILE / 2];
}

describe.each(IDS)('the runway of %s', (id) => {
  const cave = caveOf(id);
  const { spec } = cave;

  it('lights both edges of the way in, every 2 tiles, inside the cutting and off the rock', () => {
    const lit = runwayLights(cave, false).filter((l) => l.cutting === 'in');
    expect(lit).toHaveLength(rows(spec.entry) * 2);
    const [x0, y0, x1, y1] = box(cave, spec.entry);
    for (const l of lit) {
      expect(l.x, `light at ${l.x},${l.y}`).toBeGreaterThan(x0);
      expect(l.x).toBeLessThan(x1);
      expect(l.y).toBeGreaterThan(y0);
      expect(l.y).toBeLessThan(y1);
      expect(cave.cells[tileIn(cave, l.x, l.y)], `cell under ${l.x},${l.y}`).toBe(OPEN);
      expect(l.along).toBeGreaterThanOrEqual(0);
      expect(l.along).toBeLessThanOrEqual(1);
    }
    // the two edges are the two ends of the cutting's width, and each keeps to the spacing down its length
    const [ox, oy] = spec.entry.out;
    const across = (l: { x: number; y: number }) => (ox ? l.y : l.x);
    const down = (l: { x: number; y: number }) => (ox ? l.x * ox : l.y * oy);
    const sides = [...new Set(lit.map(across))].sort((a, b) => a - b);
    expect(sides).toHaveLength(2);
    for (const side of sides) {
      const row = lit.filter((l) => across(l) === side).sort((a, b) => down(a) - down(b));
      expect(row).toHaveLength(rows(spec.entry));
      for (let k = 1; k < row.length; k++) expect(down(row[k]) - down(row[k - 1])).toBeCloseTo(2 * TILE, 6);
    }
    // 0 at the cave's floor, 1 at the outer end
    const inner = lit.reduce((a, b) => (a.along < b.along ? a : b));
    const outer = lit.reduce((a, b) => (a.along > b.along ? a : b));
    expect(down(outer)).toBeGreaterThan(down(inner));
  });

  it('lights the way in whether or not the way out is open', () => {
    const shut = runwayLights(cave, false).filter((l) => l.cutting === 'in');
    const open = runwayLights(cave, true).filter((l) => l.cutting === 'in');
    expect(open).toEqual(shut);
  });

  if (spec.exit) {
    it('lights the way out only once it is open, in the same rows as the way in', () => {
      expect(runwayLights(cave, false).filter((l) => l.cutting === 'out')).toEqual([]);
      const lit = runwayLights(cave, true).filter((l) => l.cutting === 'out');
      expect(lit).toHaveLength(rows(spec.exit!) * 2);
      const [x0, y0, x1, y1] = box(cave, spec.exit!);
      for (const l of lit) {
        expect(l.x).toBeGreaterThan(x0);
        expect(l.x).toBeLessThan(x1);
        expect(l.y).toBeGreaterThan(y0);
        expect(l.y).toBeLessThan(y1);
        expect([OPEN, EXIT], `cell under ${l.x},${l.y}`).toContain(cave.cells[tileIn(cave, l.x, l.y)]);
      }
      expect(Math.min(...lit.map((l) => l.along))).toBe(0);
    });
  } else {
    it('has no way out to light, open or shut', () => {
      expect(runwayLights(cave, true).filter((l) => l.cutting === 'out')).toEqual([]);
    });
  }
});

describe('the pulse', () => {
  /** The place along the row of the brightest light at a time. */
  const brightest = (cave: Cave, cutting: 'in' | 'out', t: number) => {
    const row = runwayLights(cave, true).filter((l) => l.cutting === cutting);
    return row.reduce((a, b) => (runwayBeat(b, t) > runwayBeat(a, t) ? b : a)).along;
  };
  const cave = caveOf('hollow');

  it('stays lit between pulses, and never goes past full', () => {
    for (const l of runwayLights(cave, true))
      for (let t = 0; t < 3; t += 0.05) {
        expect(runwayBeat(l, t)).toBeGreaterThan(0.3);
        expect(runwayBeat(l, t)).toBeLessThanOrEqual(1);
      }
  });

  it('runs toward the cave’s floor down the way in', () => {
    // sampled a twentieth of a period apart, the head moves down toward 0 except where it wraps to the outer end
    const step = RUNWAY_PERIOD / 20;
    let moved = 0,
      wrapped = 0,
      last = brightest(cave, 'in', 0);
    for (let k = 1; k <= 40; k++) {
      const now = brightest(cave, 'in', k * step);
      if (now > last + 0.5) wrapped++;
      else {
        expect(now).toBeLessThanOrEqual(last);
        if (now < last) moved++;
      }
      last = now;
    }
    expect(moved).toBeGreaterThan(10);
    expect(wrapped).toBe(2);
  });

  it('runs away from it, toward the next cave, down the way out', () => {
    const step = RUNWAY_PERIOD / 20;
    let moved = 0,
      wrapped = 0,
      last = brightest(cave, 'out', 0);
    for (let k = 1; k <= 40; k++) {
      const now = brightest(cave, 'out', k * step);
      if (now < last - 0.5) wrapped++;
      else {
        expect(now).toBeGreaterThanOrEqual(last);
        if (now > last) moved++;
      }
      last = now;
    }
    expect(moved).toBeGreaterThan(10);
    expect(wrapped).toBe(2);
  });

  it('passes along the row about once every 1.2 seconds', () => {
    expect(RUNWAY_PERIOD).toBeCloseTo(1.2, 6);
    const l = runwayLights(cave, false)[0];
    expect(runwayBeat(l, 0.3)).toBeCloseTo(runwayBeat(l, 0.3 + RUNWAY_PERIOD), 9);
  });
});

describe('the dark at the start', () => {
  it('is 45% at the machine’s arrival, lifting to nothing at the cave’s floor', () => {
    expect(ARRIVAL_DARK).toBe(0.45);
    for (const id of IDS) {
      const c = caveOf(id);
      const at = arrival(c);
      expect(darkness(c, false, at.x, at.y)).toBeGreaterThan(ARRIVAL_DARK * 0.7);
      expect(darkness(c, false, at.x, at.y)).toBeLessThanOrEqual(ARRIVAL_DARK);
      expect(darkness(c, false, c.holes[0].x, c.holes[0].y)).toBe(0);
    }
  });

  it('still reaches black at the leaving line down the way out', () => {
    for (const id of IDS) {
      const c = caveOf(id);
      if (!specOf(id).exit) continue;
      const x = c.spec.exit!;
      const [x0, y0, x1, y1] = x.tiles;
      const [ox, oy] = x.out;
      const [px, py] = tileCentre(
        c.grid,
        ox ? (ox > 0 ? x1 : x0) : (x0 + x1) / 2,
        oy ? (oy > 0 ? y1 : y0) : (y0 + y1) / 2,
      );
      expect(darkness(c, true, px, py)).toBe(1);
    }
  });
});

describe('the runway as the lighting takes it', () => {
  const cave = caveOf('hollow');

  it('beats as the runway does, in the direction of its own cutting, and throws no sparks', () => {
    const lights = runwayLights(cave, true),
      features = runwayFeatures(cave, true);
    expect(features).toHaveLength(lights.length);
    features.forEach((f, k) => {
      expect(f.beat).toBe('runway');
      expect(f.biome, 'the cave’s own, whatever its biome').toBeNull();
      expect(featureParticle(f)).toBeNull();
      for (const t of [0, 0.37, 1.1]) expect(beat(f, t)).toBeCloseTo(runwayBeat(lights[k], t), 12);
    });
  });
});
