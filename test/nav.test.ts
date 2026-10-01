import { describe, expect, it } from 'vitest';
import { Nav } from '../src/nav';
import { beltOf } from '../src/tools';
import { IDS, caveOf, floodIn, tileIn } from './helpers';

describe.each(IDS)('the way round the rock in %s', (id) => {
  const cave = caveOf(id);
  const { spec, holes } = cave;
  const hole = holes[0];
  const solid = cave.solid(true);
  const nav = new Nav(solid, cave.grid, holes);
  const reachable = floodIn(cave, tileIn(cave, hole.x, hole.y), (t) => solid[t] === 0);

  it('knows how far every tile joined to the hole is from it, and no other', () => {
    for (let t = 0; t < solid.length; t++) {
      if (reachable.has(t)) expect(Number.isFinite(nav.toHole[t]), `tile ${t}`).toBe(true);
      else expect(nav.toHole[t], `tile ${t}`).toBe(Infinity);
    }
    expect(nav.toHole[tileIn(cave, hole.x, hole.y)]).toBe(0);
  });

  it('leads from every heap to a hole in clear straight runs', () => {
    const atAHole = (x: number, y: number, margin: number) =>
      holes.some((h) => Math.hypot(x - h.x, y - h.y) <= h.radius + margin);
    for (const h of spec.heaps) {
      let x = h.x,
        y = h.y;
      for (let leg = 0; leg < 160 && !atAHole(x, y, 4); leg++) {
        const aim = nav.ahead(nav.toHole, x, y, 2.4, 6);
        expect(aim, `${spec.name}: no way on from ${x},${y}`).not.toBeNull();
        expect(nav.clear(x, y, aim![0], aim![1], 0.5)).toBe(true);
        expect(nav.distance(nav.toHole, aim![0], aim![1])).toBeLessThan(nav.distance(nav.toHole, x, y));
        [x, y] = aim!;
      }
      expect(atAHole(x, y, 4), `${spec.name} heap at ${h.x},${h.y} never got to a hole`).toBe(true);
    }
  });

  it('knows how far each of its holes is on its own, and which a point is nearest', () => {
    expect(nav.toEach).toHaveLength(holes.length);
    holes.forEach((h, k) => {
      expect(nav.distanceTo(k, h.x, h.y), `hole ${k}`).toBe(0);
    });
    for (const h of spec.heaps) {
      const own = holes.map((_, k) => nav.distanceTo(k, h.x, h.y));
      expect(nav.distance(nav.toHole, h.x, h.y), 'the nearest is the nearest of them').toBeCloseTo(Math.min(...own), 3);
      expect(own[nav.holeOf(h.x, h.y)]).toBe(Math.min(...own));
    }
  });

  it('counts a running belt as somewhere to leave a load, and never as further than the hole', () => {
    if (!spec.belts.length) return;
    const belt = beltOf(spec.belts[0].spec);
    nav.setBelts([belt]);
    try {
      for (let t = 0; t < solid.length; t++)
        if (Number.isFinite(nav.toHole[t])) expect(nav.toDrop[t]).toBeLessThanOrEqual(nav.toHole[t] + 1e-3);
      const farEnd = { x: belt.cx - belt.dx * belt.half, y: belt.cy - belt.dy * belt.half };
      expect(nav.onBelt(farEnd.x, farEnd.y, 0.5)).toBe(belt);
      expect(nav.dropIsHole(farEnd.x, farEnd.y)).toBe(false);
    } finally {
      nav.setBelts([]);
    }
  });

  it('has the fields of the holes together exactly the nearer of those each hole has alone, with belts and without', () => {
    // The drop fields are made from the holes' own fields and the belts', not by a pass of their own, so
    // each is held to the same field made the long way: a nav that has only that one hole.
    const alone = holes.map((h) => new Nav(solid, cave.grid, [h]));
    const belt = beltOf({ x0: hole.x + 14, y0: hole.y, x1: hole.x + 34, y1: hole.y, width: 6, speed: 4 });
    const same = (a: Float32Array, b: Float32Array, what: string) => {
      for (let t = 0; t < a.length; t++) if (!Object.is(a[t], b[t])) expect(a[t], `${what}, tile ${t}`).toBe(b[t]);
    };
    for (const belts of [[], [belt]]) {
      nav.setBelts(belts);
      alone.forEach((n) => n.setBelts(belts));
      try {
        const nearest = new Float32Array(solid.length).fill(Infinity),
          nearestDrop = new Float32Array(solid.length).fill(Infinity);
        alone.forEach((n, k) => {
          same(nav.toEach[k], n.toHole, `hole ${k}`);
          same(nav.toDropEach[k], n.toDrop, `hole ${k} or a belt`);
          for (let t = 0; t < nearest.length; t++) {
            nearest[t] = Math.min(nearest[t], n.toHole[t]);
            nearestDrop[t] = Math.min(nearestDrop[t], n.toDrop[t]);
          }
        });
        same(nav.toHole, nearest, 'the nearest hole');
        same(nav.toDrop, nearestDrop, 'the nearest hole or belt');
      } finally {
        nav.setBelts([]);
      }
    }
  });

  it('has no way toward a point in the rock', () => {
    const rock = solid.findIndex((s, t) => s === 1 && t > cave.grid.cols);
    const [x, y] = nav.centre(rock);
    expect(nav.toward(x, y).every((v) => v === Infinity)).toBe(true);
  });

  it('reaches through the way out once it is open, and not before', () => {
    if (!spec.exit) return;
    const shut = new Nav(cave.solid(false), cave.grid, holes);
    const exits = [...cave.cells.keys()].filter((t) => cave.cells[t] === 64);
    expect(exits.length).toBeGreaterThan(0);
    const [x, y] = nav.centre(exits[exits.length >> 1]);
    expect(Number.isFinite(nav.distance(nav.toHole, x, y)), 'open').toBe(true);
    expect(shut.distance(shut.toHole, x, y), 'shut').toBe(Infinity);
  });
});
