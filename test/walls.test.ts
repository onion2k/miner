import { describe, expect, it } from 'vitest';
import { wallAlongX } from '../src/cave';
import { BAR, BRICK_KIND, KIND_RADIUS } from '../src/physics';
import {
  BRICK_SIZE,
  COURSES,
  layBricks,
  looseBricks,
  stashBehind,
  standingBricks,
  treasureBricks,
  wallTiles,
} from '../src/walls';
import { IDS, caveOf, withSeed } from './helpers';

/** Every cave of the run that has a wall, each wall of each. */
const WALLED = IDS.map(caveOf).flatMap((cave) => cave.spec.walls.map((wall, w) => ({ cave, wall, w })));

describe('the brick walls', () => {
  it('are in every cave but the Hollow', () => {
    expect(WALLED.map(({ cave }) => cave.spec.id)).toEqual(IDS.slice(1));
  });

  it('lay every wall in courses, two deep, filling its span', () => {
    WALLED.forEach(({ cave, wall, w }) => {
      const bricks = layBricks(cave, w);
      const [x0, y0, x1, y1] = wall.tiles;
      const span = ((wallAlongX(cave.spec, w) ? x1 - x0 : y1 - y0) + 1) * 4;
      // each course, each side, covers the span less the mortar
      for (let c = 0; c < COURSES; c++) {
        const course = bricks.filter((b) => Math.abs(b.z - BRICK_SIZE[2] * (c + 0.5)) < 1e-6);
        const length = course.reduce((sum, b) => sum + b.length + 0.08, 0);
        expect(length / 2, `${cave.spec.id} wall ${w} course ${c}`).toBeGreaterThan(span - 1);
        expect(length / 2).toBeLessThanOrEqual(span + 1e-6);
      }
    });
  });

  it('set treasure in distinct bricks of the top course, the same every time', () => {
    WALLED.forEach(({ cave, wall, w }) => {
      const bricks = layBricks(cave, w),
        treasure = treasureBricks(cave, w);
      const count = wall.treasure.reduce((n, [, k]) => n + k, 0);
      expect(treasure).toHaveLength(count);
      expect(new Set(treasure.map((t) => t.brick)).size).toBe(count);
      for (const t of treasure) expect(bricks[t.brick].z).toBeGreaterThan(BRICK_SIZE[2] * (COURSES - 1));
      expect(treasureBricks(cave, w)).toEqual(treasure);
    });
  });

  it('show a beating: untouched bricks where they were laid, beaten ones knocked askew and darker', () => {
    const { cave, w } = WALLED.find(({ wall }) => wall.treasure.length)!;
    const laid = layBricks(cave, w),
      fresh = standingBricks(cave, w, 0),
      beaten = standingBricks(cave, w, 1);
    fresh.forEach((b, i) => {
      for (const [got, want] of [
        [b.x, laid[i].x],
        [b.y, laid[i].y],
        [b.yaw, laid[i].yaw],
        [b.tilt, 0],
      ])
        expect(got).toBeCloseTo(want, 9);
    });
    expect(beaten.some((b, i) => Math.hypot(b.x - laid[i].x, b.y - laid[i].y) > 0.05)).toBe(true);
    beaten.forEach((b, i) => expect(b.shade).toBeLessThan(fresh[i].shade));
    expect(fresh.filter((b) => b.treasure !== undefined)).toHaveLength(treasureBricks(cave, w).length);
  });

  it('come apart into every brick, and the treasure, flying the way the dozer drove', () => {
    const found = WALLED.find(({ wall }) => wall.treasure.some(([k]) => k === BAR)) ?? WALLED[0];
    const { cave, w } = found;
    withSeed(4, () => {
      const pieces = looseBricks(cave, w, { x: 0, y: 0, yaw: 0 }, KIND_RADIUS[BRICK_KIND]);
      const bars = treasureBricks(cave, w).filter((t) => t.kind === BAR).length;
      // a gold brick is a bar in its place, not a bar and a brick
      expect(pieces.filter((p) => p.treasure === undefined)).toHaveLength(layBricks(cave, w).length - bars);
      expect(pieces.filter((p) => p.treasure !== undefined)).toHaveLength(treasureBricks(cave, w).length);
      // on the way the dozer faces, which is +x
      const mean = pieces.reduce((s, p) => s + p.vx, 0) / pieces.length;
      expect(mean).toBeGreaterThan(2);
      for (const p of pieces) expect(p.z).toBeGreaterThanOrEqual(KIND_RADIUS[BRICK_KIND]);
    });
  });

  it('know their tiles, and the side room behind them', () => {
    WALLED.forEach(({ cave, wall, w }) => {
      const [x0, y0, x1, y1] = wall.tiles;
      expect(wallTiles(cave, w)).toHaveLength((x1 - x0 + 1) * (y1 - y0 + 1));
    });
    // every side room has a wall in front of it
    for (const cave of IDS.map(caveOf))
      for (const stash of cave.spec.stashes)
        expect(
          cave.spec.walls.some((_, w) => stashBehind(cave, w) === stash),
          stash.name,
        ).toBe(true);
  });
});
