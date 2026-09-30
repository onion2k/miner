/**
 * The machinery of a cave, asked of each cave in the run: carved the same
 * every time, lamps and barrels out on open floor and clear of what they must
 * be, and the way in and the way out, which the checker in `caves.test.ts`
 * and the run in `run.test.ts` lean on: how dark it is down them, where the
 * machine arrives, where the rock bursts when the way out opens.
 */
import { describe, expect, it } from 'vitest';
import {
  BRICK,
  EXIT,
  OPEN,
  TILE,
  ARRIVAL_DARK,
  LEAVING_SHORT,
  arrival,
  buildCave,
  darkness,
  exitFaces,
  exitPoints,
  nearCutting,
  pastLeavingLine,
  rockish,
  tileCentre,
} from '../src/cave';
import { IDS, caveOf, specOf, tileIn } from './helpers';

describe.each(IDS)('the cave %s', (id) => {
  const cave = caveOf(id);
  const { spec, cells } = cave;

  it('is the same every time it is built', () => {
    expect(buildCave(spec).cells).toEqual(cells);
    expect(buildCave(spec).lamps).toEqual(cave.lamps);
    expect(buildCave(spec).barrels).toEqual(cave.barrels);
  });

  it('puts every lamp on open floor, clear of the hole', () => {
    expect(cave.lamps.length).toBeGreaterThan(0);
    for (const l of cave.lamps) {
      expect(cells[tileIn(cave, l.x, l.y)], `lamp at ${l.x},${l.y}`).toBe(OPEN);
      for (const h of cave.holes) expect(Math.hypot(l.x - h.x, l.y - h.y)).toBeGreaterThan(h.radius + 4);
    }
  });

  it('stands as many barrels as the cave asks for, out on open floor, clear of the heaps, belts, lamps and hole', () => {
    expect(cave.barrels).toHaveLength(spec.barrels);
    for (const b of cave.barrels) {
      expect(cells[tileIn(cave, b.x, b.y)]).toBe(OPEN);
      for (const h of cave.holes) expect(Math.hypot(b.x - h.x, b.y - h.y)).toBeGreaterThan(h.radius + 10);
      for (const h of spec.heaps)
        expect(Math.hypot(h.x - b.x, h.y - b.y)).toBeGreaterThan(Math.sqrt(h.coins) * 0.36 + 4);
      for (const l of cave.lamps) expect(Math.hypot(l.x - b.x, l.y - b.y)).toBeGreaterThan(4);
    }
    for (const b of cave.barrels) {
      const others = cave.barrels.filter((o) => o !== b);
      if (others.length) expect(Math.min(...others.map((o) => Math.hypot(o.x - b.x, o.y - b.y)))).toBeGreaterThan(15);
    }
  });

  it('keeps every lamp and barrel off and away from its cuttings', () => {
    for (const l of cave.lamps) expect(nearCutting(cave.grid, spec, l.x, l.y, 1), `lamp at ${l.x},${l.y}`).toBe(false);
    for (const b of cave.barrels)
      expect(nearCutting(cave.grid, spec, b.x, b.y, 2), `barrel at ${b.x},${b.y}`).toBe(false);
  });

  it('opens the way in, at the outer end of which the machine arrives, facing in, on floor', () => {
    const at = arrival(cave);
    expect(cells[tileIn(cave, at.x, at.y)]).toBe(OPEN);
    const [ox, oy] = spec.entry.out;
    expect(Math.cos(at.yaw)).toBeCloseTo(-ox, 9);
    expect(Math.sin(at.yaw)).toBeCloseTo(-oy, 9);
    // three tiles in from the grid's edge, along the axis of the cutting
    const { cols, rows } = cave.grid;
    const tx = Math.floor((at.x - cave.grid.originX) / TILE),
      ty = Math.floor((at.y - cave.grid.originY) / TILE);
    if (ox) expect(ox < 0 ? tx : cols - 1 - tx).toBe(3);
    else expect(oy < 0 ? ty : rows - 1 - ty).toBe(3);
  });

  it('is darkest at the outer end of its way in, and light on its floor', () => {
    const at = arrival(cave);
    expect(darkness(cave, false, at.x, at.y)).toBeGreaterThan(ARRIVAL_DARK * 0.7);
    expect(darkness(cave, false, at.x, at.y)).toBeLessThanOrEqual(ARRIVAL_DARK);
    const hole = cave.holes[0];
    expect(darkness(cave, true, hole.x, hole.y)).toBe(0);
    // lighter the nearer the floor, along the cutting
    const [ox, oy] = spec.entry.out;
    const nearer = darkness(cave, false, at.x - ox * 8 * TILE, at.y - oy * 8 * TILE);
    expect(nearer).toBeLessThan(darkness(cave, false, at.x, at.y));
  });

  if (specOf(id).exit) {
    it('is rock at its way out, dark and then black down it once open, and past the leaving line at its end', () => {
      const exit = spec.exit!;
      const faces = exitFaces(cave);
      expect(faces.length, 'the rock that bursts').toBeGreaterThan(0);
      for (const [x, y] of faces) expect(cells[tileIn(cave, x, y)]).toBe(EXIT);
      const [x0, y0, x1, y1] = exit.tiles;
      const [ox, oy] = exit.out;
      const mid = (a: number, b: number) => (a + b) / 2;
      const at = (along: number) => {
        // `along` tiles in from the outer end, down the middle
        const tx = ox ? (ox > 0 ? x1 - along : x0 + along) : mid(x0, x1),
          ty = oy ? (oy > 0 ? y1 - along : y0 + along) : mid(y0, y1);
        return tileCentre(cave.grid, tx, ty);
      };
      const length = ox ? x1 - x0 + 1 : y1 - y0 + 1;
      // nothing while it is shut: the dozer is not in it
      const [ex, ey] = at(0);
      expect(darkness(cave, false, ex, ey)).toBe(0);
      const samples = [length - 1, (length * 2) / 3, length / 3, 0].map((a) => darkness(cave, true, ...at(a)));
      for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
      expect(darkness(cave, true, ...at(LEAVING_SHORT / TILE - 1))).toBeCloseTo(1, 1);
      expect(darkness(cave, true, ...at(0))).toBe(1);
      // past the line only within the last three tiles of it
      expect(pastLeavingLine(cave, ...at(0))).toBe(true);
      expect(pastLeavingLine(cave, ...at(LEAVING_SHORT / TILE + 2))).toBe(false);
      expect(pastLeavingLine(cave, cave.holes[0].x, cave.holes[0].y)).toBe(false);
    });
  } else {
    it('has no way out to be dark or to leave by', () => {
      expect(exitFaces(cave)).toEqual([]);
      const at = arrival(cave);
      expect(pastLeavingLine(cave, at.x, at.y)).toBe(false);
    });
  }
});

describe.each(IDS)('the way out of %s, as two points', (id) => {
  const cave = caveOf(id);

  it('has a mouth in its first tile and a point beyond the leaving line, or none in the last cave', () => {
    const points = exitPoints(cave);
    if (!cave.spec.exit) return expect(points).toBeNull();
    const { mouth, beyond } = points!;
    expect(cave.cells[tileIn(cave, mouth.x, mouth.y)], 'the mouth is in the way out').toBe(EXIT);
    expect(pastLeavingLine(cave, mouth.x, mouth.y), 'not yet gone').toBe(false);
    expect(cave.cells[tileIn(cave, beyond.x, beyond.y)], 'beyond is in the way out').toBe(EXIT);
    expect(pastLeavingLine(cave, beyond.x, beyond.y), 'gone on').toBe(true);
  });
});

describe('the cells', () => {
  it('keep the way out past the walls, so it is never taken for one', () => {
    expect(EXIT).toBeGreaterThan(BRICK + 31);
    const cave = caveOf('south-gallery');
    const walls = cave.spec.walls.length;
    expect(walls).toBeLessThanOrEqual(32);
    // a wall's tile is a wall's, and stands solid until it is down; the way out is neither
    const shut = cave.solid(false, [], [true]);
    cave.cells.forEach((c, t) => {
      if (c >= BRICK && c < EXIT) expect(shut[t]).toBe(0);
      if (c === EXIT) expect(shut[t]).toBe(1);
    });
  });

  it('look like rock until the way out opens, and then like floor', () => {
    expect(rockish(EXIT, [], false)).toBe(true);
    expect(rockish(EXIT, [], true)).toBe(false);
    expect(rockish(OPEN, [], false)).toBe(false);
  });
});
