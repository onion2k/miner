import { describe, expect, it } from 'vitest';
import { TILE, tileCentre } from '../src/cave';
import { Dozer, separate } from '../src/dozer';
import {
  IDS,
  PLAYER_SPEC,
  ROWS,
  ORIGIN_X,
  ORIGIN_Y,
  TEST_GRID as GRID,
  caveOf,
  grid,
  tileAt,
  tileIn,
  withSeed,
} from './helpers';

const DT = 1 / 60;

function drive(d: Dozer, seconds: number, throttle = 1, steer = 0) {
  let path = 0;
  for (let f = 0; f < seconds * 60; f++) {
    const x = d.x,
      y = d.y;
    d.update(DT, { throttle, steer }, PLAYER_SPEC, 0);
    path += Math.hypot(d.x - x, d.y - y);
  }
  return path;
}

/** A grid with a straight north-south wall of rock from column `wall` westward. */
const WALL_COL = 30;
const walled = grid((tx) => tx <= WALL_COL);
const wallFace = ORIGIN_X + (WALL_COL + 1) * TILE;
const middleY = ORIGIN_Y + (ROWS / 2) * TILE;

describe('the dozer', () => {
  it('drives at its top speed on open floor', () => {
    const d = new Dozer(grid(), GRID);
    d.x = 0;
    d.y = middleY;
    d.yaw = 0;
    const path = drive(d, 3);
    // up to speed in under a second, then the rest at top speed
    expect(path).toBeGreaterThan(PLAYER_SPEC.maxSpeed * 2);
    expect(Math.abs(d.speed)).toBeCloseTo(PLAYER_SPEC.maxSpeed, 0);
  });

  it('slides along a wall it meets at a slant rather than sticking', () => {
    for (const into of [5, 20, 35]) {
      const d = new Dozer(walled, GRID);
      d.x = wallFace + 3.7;
      d.y = middleY - 40;
      d.yaw = Math.PI / 2 + (into * Math.PI) / 180;
      const path = drive(d, 3);
      expect(path, `${into} degrees into the wall`).toBeGreaterThan(PLAYER_SPEC.maxSpeed * 1.2);
      expect(d.x).toBeGreaterThan(wallFace);
    }
  });

  it('is stopped by a wall it drives square into, and backs off it again', () => {
    const d = new Dozer(walled, GRID);
    d.x = wallFace + 12;
    d.y = middleY;
    d.yaw = Math.PI;
    drive(d, 3);
    expect(d.x).toBeGreaterThan(wallFace + 3);
    expect(Math.abs(d.speed)).toBeLessThan(1);
    expect(drive(d, 1, -1)).toBeGreaterThan(2);
  });

  it('is got out of rock it finds itself inside', () => {
    const d = new Dozer(walled, GRID);
    d.x = wallFace - 10;
    d.y = middleY;
    d.yaw = 0;
    drive(d, 0.1, 0);
    expect(walled[tileAt(d.x, d.y)]).toBe(0);
  });

  it.each(IDS)('never ends up in the rock, driven about the cave %s at random', (id) => {
    const cave = caveOf(id);
    const { cols } = cave.grid;
    const solid = cave.solid(true);
    const open: number[] = [];
    for (let t = 0; t < solid.length; t++) if (!solid[t]) open.push(t);
    withSeed(3, () => {
      for (let run = 0; run < 12; run++) {
        const d = new Dozer(solid, cave.grid);
        const t = open[Math.floor(Math.random() * open.length)];
        [d.x, d.y] = tileCentre(cave.grid, t % cols, (t / cols) | 0);
        d.yaw = Math.random() * Math.PI * 2;
        let throttle = 1,
          steer = 0;
        for (let f = 0; f < 60 * 20; f++) {
          if (f % 45 === 0) {
            throttle = Math.random() < 0.8 ? 1 : -1;
            steer = Math.random() * 2 - 1;
          }
          d.update(DT, { throttle, steer }, PLAYER_SPEC, 0);
          const at = tileIn(cave, d.x, d.y);
          if (at < 0 || solid[at]) expect.fail(`run ${run} frame ${f}: in rock at ${d.x.toFixed(1)},${d.y.toFixed(1)}`);
        }
      }
    });
  });

  it('keeps two machines out of each other', () => {
    const a = new Dozer(grid(), GRID),
      b = new Dozer(grid(), GRID);
    a.x = 0;
    a.y = middleY;
    a.yaw = 0;
    b.x = 1;
    b.y = middleY;
    b.yaw = Math.PI;
    for (let k = 0; k < 4; k++) separate(a, b);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(4);
  });
});
