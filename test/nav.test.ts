import { describe, expect, it } from 'vitest';
import { AREAS, COLS, HOLE, ROWS, buildCave } from '../src/cave';
import { Nav } from '../src/nav';
import { beltOf } from '../src/tools';
import { flood, tileAt } from './helpers';

const cave = buildCave();
const solid = cave.solid(AREAS.map(() => true));
const nav = new Nav(solid);
const reachable = flood(tileAt(HOLE.x, HOLE.y), (t) => solid[t] === 0);

describe('the way round the rock', () => {
  it('knows how far every tile joined to the hole is from it, and no other', () => {
    for (let t = 0; t < COLS * ROWS; t++) {
      if (reachable.has(t)) expect(Number.isFinite(nav.toHole[t]), `tile ${t}`).toBe(true);
      else expect(nav.toHole[t], `tile ${t}`).toBe(Infinity);
    }
    expect(nav.toHole[tileAt(HOLE.x, HOLE.y)]).toBe(0);
  });

  it('leads from anywhere in every room to the hole in clear straight runs', () => {
    for (const area of AREAS) {
      for (const h of area.heaps) {
        let x = h.x,
          y = h.y;
        for (let leg = 0; leg < 60 && Math.hypot(x - HOLE.x, y - HOLE.y) > HOLE.radius + 4; leg++) {
          const aim = nav.ahead(nav.toHole, x, y, 2.4, 6);
          expect(aim, `${area.name}: no way on from ${x},${y}`).not.toBeNull();
          expect(nav.clear(x, y, aim![0], aim![1], 0.5)).toBe(true);
          expect(nav.distance(nav.toHole, aim![0], aim![1])).toBeLessThan(nav.distance(nav.toHole, x, y));
          [x, y] = aim!;
        }
        expect(
          Math.hypot(x - HOLE.x, y - HOLE.y),
          `${area.name} heap at ${h.x},${h.y} never got to the hole`,
        ).toBeLessThanOrEqual(HOLE.radius + 4);
      }
    }
  });

  it('counts a running belt as somewhere to leave a load, and never as further than the hole', () => {
    const area = AREAS.find((a) => a.belt)!;
    const belt = beltOf(area.belt!.spec);
    nav.setBelts([belt]);
    try {
      for (let t = 0; t < COLS * ROWS; t++)
        if (Number.isFinite(nav.toHole[t])) expect(nav.toDrop[t]).toBeLessThanOrEqual(nav.toHole[t] + 1e-3);
      const farEnd = { x: belt.cx - belt.dx * belt.half, y: belt.cy - belt.dy * belt.half };
      expect(nav.onBelt(farEnd.x, farEnd.y, 0.5)).toBe(belt);
      expect(nav.dropIsHole(farEnd.x, farEnd.y)).toBe(false);
    } finally {
      nav.setBelts([]);
    }
  });

  it('has no way toward a point in the rock', () => {
    const rock = solid.findIndex((s, t) => s === 1 && t > COLS);
    const [x, y] = nav.centre(rock);
    expect(nav.toward(x, y).every((v) => v === Infinity)).toBe(true);
  });
});
