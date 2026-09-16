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
import {
  FOOT_BAND,
  FOOT_TONE,
  PLAIN_ROCK,
  SCREE_REACH,
  TONES,
  buildTerrain,
  floorHeight,
  rockHeight,
} from '../src/terrain';

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

  it('meets the floor at a slope and not a step, and climbs from there', () => {
    // the first sample row into the rock, the half tile, and the tile: rising, and gently at first
    const rows = [TILE / 4, TILE / 2, TILE];
    const heights = rows.map(() => [] as number[]);
    for (let x = -80; x <= 80; x += 2.3)
      for (let y = -50; y <= 50; y += 1.9) rows.forEach((d, k) => heights[k].push(rockHeight(x, y, d, PLAIN_ROCK)));
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const [first, half, tile] = heights.map(mean);
    // under 35 degrees over the first sample row, everywhere on average and nowhere a cliff
    expect(first / (TILE / 4)).toBeLessThan(Math.tan((35 * Math.PI) / 180));
    expect(Math.max(...heights[0])).toBeLessThan(1.1);
    expect(half).toBeGreaterThan(first);
    expect(tile).toBeGreaterThan(half * 1.3);
    // and still rock by the tile: tall enough to read as a wall
    expect(tile).toBeGreaterThan(1.5);
  });

  it('sheds a skirt of scree along the foot, thick against the wall and thinning out, none of it tall', () => {
    const grit = terrain.stones.filter((s) => s.size[0] < 0.7);
    const edge = (s: (typeof grit)[number]) => toRock(s.x, s.y, hidden);
    const within = (lo: number, hi: number) => grit.filter((s) => edge(s) >= lo && edge(s) < hi);
    const floorSamples = (lo: number, hi: number) => {
      let n = 0;
      const sm = terrain.samples;
      for (let k = 0; k < sm.depth.length; k++) {
        if (sm.depth[k] !== 0) continue;
        const e = toRock(sm.x[k], sm.y[k], hidden);
        if (e >= lo && e < hi) n++;
      }
      return n;
    };
    const density = (lo: number, hi: number) => within(lo, hi).length / floorSamples(lo, hi);
    // most of the floor right at the wall has something on it; well out, little does
    expect(density(0, 1)).toBeGreaterThan(0.5);
    expect(density(0, 1)).toBeGreaterThan(density(SCREE_REACH, SCREE_REACH + 3) * 3);
    // the chunks against the wall are bigger than the grit further out
    const meanSize = (xs: typeof grit) => xs.reduce((n, s) => n + s.size[0], 0) / xs.length;
    expect(meanSize(within(0, 1))).toBeGreaterThan(meanSize(within(2, SCREE_REACH)) * 1.3);
    // nothing on the floor proper so tall a coin could hide behind it; the boulders at the very foot are the rock's
    for (const s of grit)
      if (edge(s) > 0.05)
        expect(s.size[2], `scree at ${s.x.toFixed(1)},${s.y.toFixed(1)} too tall`).toBeLessThanOrEqual(0.6);
  });

  it('shades the floor within reach of the rock in the foot tone, and the open floor never', () => {
    const centroids = (g: (typeof terrain.groups)[number]) => {
      const out: [number, number][] = [];
      const p = g.mesh.positions;
      for (let v = 0; v < p.length; v += 9)
        out.push([(p[v] + p[v + 3] + p[v + 6]) / 3, (p[v + 1] + p[v + 4] + p[v + 7]) / 3]);
      return out;
    };
    const foot = terrain.groups.filter((g) => !g.rock && g.tone === FOOT_TONE);
    const open = terrain.groups.filter((g) => !g.rock && g.tone !== FOOT_TONE);
    expect(foot.length).toBeGreaterThan(0);
    for (const g of foot) for (const [x, y] of centroids(g)) expect(toRock(x, y, hidden)).toBeLessThan(FOOT_BAND + 1.5);
    for (const g of open)
      for (const [x, y] of centroids(g)) expect(toRock(x, y, hidden)).toBeGreaterThan(FOOT_BAND * 0.4);
    // rock never takes the foot tone
    for (const g of terrain.groups) if (g.rock) expect(g.tone).toBeLessThan(FOOT_TONE);
  });

  it('builds in well under a frame of thought', () => {
    const t0 = performance.now();
    buildTerrain(cave, hidden);
    expect(performance.now() - t0).toBeLessThan(400);
  });
});
