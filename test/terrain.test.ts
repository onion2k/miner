import { describe, expect, it } from 'vitest';
import {
  AREAS,
  COLS,
  HOLE,
  ORIGIN_X,
  ORIGIN_Y,
  ROWS,
  SECRETS,
  TILE,
  buildCave,
  chamberCentre,
  rockish,
} from '../src/cave';
import { TONES, buildTerrain, floorHeight } from '../src/terrain';

const cave = buildCave();
const hidden = SECRETS.map(() => false);
const terrain = buildTerrain(cave, hidden);

/** How far a point is from the nearest tile that is rock to look at. */
function toRock(x: number, y: number, revealed: boolean[]): number {
  const tx = Math.floor((x - ORIGIN_X) / TILE),
    ty = Math.floor((y - ORIGIN_Y) / TILE);
  let best = Infinity;
  for (let oy = -2; oy <= 2; oy++) {
    for (let ox = -2; ox <= 2; ox++) {
      const nx = tx + ox,
        ny = ty + oy;
      if (nx >= 0 && ny >= 0 && nx < COLS && ny < ROWS && !rockish(cave.cells[ny * COLS + nx], revealed)) continue;
      const x0 = ORIGIN_X + nx * TILE,
        y0 = ORIGIN_Y + ny * TILE;
      best = Math.min(best, Math.hypot(Math.max(0, x0 - x, x - x0 - TILE), Math.max(0, y0 - y, y - y0 - TILE)));
    }
  }
  return best;
}

describe('the terrain', () => {
  it('is the same every time it is built', () => {
    const again = buildTerrain(cave, hidden);
    expect(again.groups.map((g) => g.mesh.positions.length)).toEqual(
      terrain.groups.map((g) => g.mesh.positions.length),
    );
    expect(again.stones).toEqual(terrain.stones);
  });

  it('draws no rock over floor the dozer can drive on', () => {
    for (const g of terrain.groups) {
      const p = g.mesh.positions;
      for (let v = 0; v < p.length; v += 3) {
        // anything standing more than a little proud of the floor is over rock, or a whisker from it
        if (p[v + 2] > 1 && toRock(p[v], p[v + 1], hidden) > 0.25)
          expect.fail(
            `surface ${p[v + 2].toFixed(2)} high over the floor at ${p[v].toFixed(1)},${p[v + 1].toFixed(1)}`,
          );
      }
    }
  });

  it('keeps the floor under what rests on it', () => {
    for (let x = -60; x <= 60; x += 1.7)
      for (let y = -40; y <= 40; y += 1.3) expect(floorHeight(x, y)).toBeLessThanOrEqual(0);
    // level where it meets the collar round the hole
    expect(floorHeight(HOLE.x + HOLE.radius + 0.4, HOLE.y)).toBeCloseTo(0, 6);
  });

  it('names a real room, floor or rock, and shade for every group, with whole triangles', () => {
    expect(terrain.groups.length).toBeGreaterThan(0);
    for (const g of terrain.groups) {
      expect(g.area).toBeGreaterThanOrEqual(0);
      expect(g.area).toBeLessThan(AREAS.length);
      expect(g.tone).toBeLessThan(TONES);
      expect(g.mesh.positions.length % 9).toBe(0);
      expect(g.mesh.normals.length).toBe(g.mesh.positions.length);
      expect(g.mesh.indices.length * 3).toBe(g.mesh.positions.length);
    }
  });

  it('keeps boulders from bulging far over the floor', () => {
    for (const s of terrain.stones) {
      if (s.size[0] < 0.7) continue; // grit
      expect(toRock(s.x, s.y, hidden), `boulder at ${s.x.toFixed(1)},${s.y.toFixed(1)}`).toBeLessThan(1.2);
    }
  });

  it('takes the rock away from a chamber once it is broken into', () => {
    const k = 0;
    const [cx, cy] = chamberCentre(k);
    const highest = (t: typeof terrain) => {
      let top = -Infinity;
      for (const g of t.groups) {
        const p = g.mesh.positions;
        for (let v = 0; v < p.length; v += 3)
          if (Math.hypot(p[v] - cx, p[v + 1] - cy) < 1.5) top = Math.max(top, p[v + 2]);
      }
      return top;
    };
    expect(highest(terrain)).toBeGreaterThan(2);
    expect(
      highest(
        buildTerrain(
          cave,
          SECRETS.map((_, j) => j === k),
        ),
      ),
    ).toBeLessThan(0.5);
  });
});
