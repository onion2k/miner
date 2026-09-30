/**
 * A cave that is not the game's: two holes, one room, no gates. What the game
 * does with the cave it is handed, rather than with the one it is usually
 * handed, is shown on this one, so a constant that still stands for the grid
 * or for "the hole" gets found here and not by the next cave to be added.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildCave, gridOf, nearestHole, tileCentre, OPEN, ROCK, TILE, type CaveSpec } from '../src/cave';
import { RUN } from '../src/caves';
import { Economy, memoryStore } from '../src/economy';
import { Game } from '../src/game';
import { HOLE_LAMP_HEIGHT, holeLamps } from '../src/lamps';
import { Nav } from '../src/nav';
import { BAR } from '../src/physics';
import { Bot, type Traffic } from '../src/tools';
import { floorHeight, buildTerrain } from '../src/terrain';
import { HAUL_LIMIT, haulField } from '../scripts/hauls';
import { caveOf, gameIn, withSeed } from './helpers';

const DT = 1 / 60;
const still = { throttle: 0, steer: 0 };

/** One open room, 40 by 24 tiles, a hole at each end and a heap in the middle; nothing to open or break. */
const TWO_HOLES: CaveSpec = {
  id: 'two-holes',
  name: 'The Long Room',
  blurb: 'coins, and a hole at each end',
  biome: null,
  cols: 40,
  rows: 24,
  shapes: [{ kind: 'ellipse', cx: 20, cy: 12, rx: 18, ry: 10, seed: 1.7 }],
  holes: [
    { x: -48, y: 0, radius: 5.5, depth: 14 },
    { x: 48, y: 0, radius: 4.5, depth: 12 },
  ],
  heaps: [{ x: 0, y: 10, coins: 120, gems: [] }],
  vein: { x: 0, y: 30, every: 5, coins: 1, gems: [] },
  cracks: [[0, 30]],
  belts: [],
  entry: { tiles: [2, 11, 8, 12], out: [-1, 0] },
  exit: null,
  secrets: [],
  walls: [],
  stashes: [],
  barrels: 0,
};

const cave = buildCave(TWO_HOLES);

/** A game on the test cave, told nothing, and what it banked, where. */
function newGame() {
  const banked: [number, number, number][] = [];
  const game = new Game(new Economy(memoryStore(), [TWO_HOLES]), cave, {
    banked: (_kind, value, x, y) => banked.push([value, x, y]),
  });
  return { game, banked };
}

describe('a cave handed in', () => {
  it('is carved to the spec: its own grid, both holes, and the room it asked for', () => {
    expect(cave.grid).toEqual(gridOf(TWO_HOLES));
    expect(cave.grid.cols).toBe(40);
    expect(cave.grid.rows).toBe(24);
    expect(cave.holes).toHaveLength(2);
    expect(cave.holes).toEqual(TWO_HOLES.holes);
    expect(cave.cells).toHaveLength(40 * 24);
    // the border is rock, the middle of the room is open, and no cell is anything else in a cave with no chambers or walls
    for (let tx = 0; tx < 40; tx++) {
      expect(cave.cells[tx]).toBe(ROCK);
      expect(cave.cells[23 * 40 + tx]).toBe(ROCK);
    }
    expect(cave.cells[12 * 40 + 20]).toBe(OPEN);
    expect(cave.cells.every((c) => c === ROCK || c === OPEN)).toBe(true);
    // each hole stands on floor, and so does the heap
    for (const h of cave.holes) {
      const tx = Math.floor((h.x - cave.grid.originX) / TILE),
        ty = Math.floor((h.y - cave.grid.originY) / TILE);
      expect(cave.cells[ty * 40 + tx], `hole at ${h.x}`).toBe(OPEN);
    }
  });

  it('banks what goes down either hole, by its worth, each time', () => {
    withSeed(3, () => {
      const { game, banked } = newGame();
      let expected = 0;
      for (const [hole, kind, worth] of [
        [cave.holes[0], 0, 1],
        [cave.holes[1], 1, 10],
        [cave.holes[1], 0, 1],
        [cave.holes[0], 2, 25],
      ] as const) {
        expect(game.stock.spawn(kind, hole.x, hole.y, 2)).toBe(true);
        for (let f = 0; f < 120; f++) game.step(DT, still);
        expected += worth;
        expect(game.economy.bank, `after a ${worth} down the hole at ${hole.x}`).toBe(expected);
      }
      // told of each where it went down
      expect(banked.map(([v, x]) => [v, Math.sign(x)])).toEqual([
        [1, -1],
        [10, 1],
        [1, 1],
        [25, -1],
      ]);
    });
  });

  it('finds its way to the nearer hole from every side', () => {
    const solid = cave.solid(false);
    const nav = new Nav(solid, cave.grid, cave.holes);
    const at = (x: number, y: number) => nav.tileOf(x, y);
    // beside each hole it is nothing to go
    for (const h of cave.holes) expect(nav.toHole[at(h.x, h.y)]).toBe(0);
    // a tile nearer the second hole is its distance to that one: a few tiles, where the first is forty away
    const nearSecond = nav.toHole[at(36, 0)];
    expect(nearSecond).toBeGreaterThan(0);
    expect(nearSecond).toBeLessThan(5);
    const nearFirst = nav.toHole[at(-36, 0)];
    expect(nearFirst).toBeLessThan(5);
    // and the middle, which is a long way from both, is further from each than these
    expect(nav.toHole[at(0, 0)]).toBeGreaterThan(nearSecond);
    // a load is as well left at either
    expect(nav.toDrop[at(36, 0)]).toBe(nearSecond);
    expect(nav.dropIsHole(36, 0)).toBe(true);
  });

  it('sends a loaded drone at the hole nearest it', () => {
    const solid = cave.solid(false);
    const nav = new Nav(solid, cave.grid, cave.holes);
    const { game } = newGame();
    const traffic: Traffic = { bots: [], player: game.dozer };
    for (const [x, yaw, hole] of [
      [30, 0, 1],
      [-30, Math.PI, 0],
    ] as const) {
      const bot = new Bot(solid, cave.grid, 1, x, 0);
      bot.dozer.yaw = yaw;
      bot.state = 'push';
      // pushing straight at the nearer hole: full throttle, no turn. At the other it would turn right round.
      const drive = bot.decide(DT, game.world, 1, nav, () => -1, traffic);
      expect(drive.throttle, `at ${x}, toward hole ${hole}`).toBe(1);
      expect(drive.steer).toBe(0);
      // and facing the far hole instead, it turns to the near one
      bot.dozer.yaw = yaw + Math.PI;
      bot.state = 'push';
      const turning = bot.decide(DT, game.world, 1, nav, () => -1, traffic);
      expect(Math.abs(turning.steer)).toBe(1);
    }
  });

  it('hangs three lamps round each hole and keeps the floor flat in each one', () => {
    const lamps = holeLamps(cave.holes);
    expect(lamps).toHaveLength(2);
    cave.holes.forEach((h, k) => {
      expect(lamps[k], `lamps round hole ${k}`).toHaveLength(3);
      for (const [x, y] of lamps[k]) expect(Math.hypot(x - h.x, y - h.y)).toBeCloseTo(h.radius + 1.5, 9);
    });
    expect(HOLE_LAMP_HEIGHT).toBeGreaterThan(0);
    for (const h of cave.holes) {
      expect(floorHeight(cave.holes, h.x + h.radius + 0.4, h.y)).toBeCloseTo(0, 6);
      expect(floorHeight(cave.holes, h.x, h.y + 1.5)).toBeCloseTo(0, 9);
    }
    // away from both it is the uneven floor it was
    let uneven = 0;
    for (let x = -30; x <= 30; x += 3) uneven = Math.min(uneven, floorHeight(cave.holes, x, 8));
    expect(uneven).toBeLessThan(-0.01);
    // the collar is the floor round each hole: the terrain draws none of it
    const terrain = buildTerrain(cave, []);
    for (const g of terrain.groups) {
      if (g.rock) continue;
      const p = g.mesh.positions;
      for (let v = 0; v < p.length; v += 3)
        for (const h of cave.holes)
          if (Math.abs(p[v] - h.x) < TILE && Math.abs(p[v + 1] - h.y) < TILE)
            expect.fail(`floor drawn at ${p[v].toFixed(1)},${p[v + 1].toFixed(1)}, inside the collar at ${h.x}`);
    }
  });

  it('answers for the cave it is asked about and not the game', () => {
    const grid = cave.grid;
    expect(tileCentre(grid, 0, 0)).toEqual([-20 * TILE, -12 * TILE]);
    expect(tileCentre(grid, 0, 0)).not.toEqual(tileCentre(gridOf(RUN[0]), 0, 0));
    // the middle tile is centred on the world's origin, where the game's hole is
    expect(tileCentre(grid, 20, 12)).toEqual([0, 0]);
    expect(nearestHole(cave.holes, 40, 3)).toBe(cave.holes[1]);
    expect(nearestHole(cave.holes, -40, 3)).toBe(cave.holes[0]);
    // not the game's hole, which is in the middle
    expect(nearestHole(RUN[0].holes, 40, 3)).toBe(RUN[0].holes[0]);
  });
});

describe('several holes and belts in a cave', () => {
  const north = caveOf('north-vault');
  const east = caveOf('east-gallery');

  it('gives the North Vault two holes, each on its own floor and clear of the other and of the ways in and out', () => {
    expect(north.holes).toHaveLength(2);
    const [a, b] = north.holes;
    expect(Math.hypot(a.x - b.x, a.y - b.y), 'the holes are a good way apart').toBeGreaterThan(40);
    for (const h of north.holes) {
      const { cols, originX, originY } = north.grid;
      for (let dx = -h.radius - TILE; dx <= h.radius + TILE; dx += TILE / 2)
        for (let dy = -h.radius - TILE; dy <= h.radius + TILE; dy += TILE / 2) {
          const t = Math.floor((h.y + dy - originY) / TILE) * cols + Math.floor((h.x + dx - originX) / TILE);
          expect(north.cells[t], `rock by the hole at ${h.x},${h.y}`).toBe(OPEN);
        }
    }
  });

  it('banks what is pushed down either hole of the North Vault, in the game', () => {
    withSeed(5, () => {
      const banked: [number, number, number][] = [];
      const game = gameIn('north-vault', {}, { banked: (_k, value, x, y) => banked.push([value, x, y]) });
      const before = game.economy.bank;
      north.holes.forEach((h, k) => {
        expect(game.stock.spawn(1, h.x, h.y, 2), `a ruby over hole ${k}`).toBe(true);
        for (let f = 0; f < 120; f++) game.step(DT, still);
        expect(game.economy.bank, `after a ruby down hole ${k}`).toBe(before + 10 * (k + 1));
      });
      expect(banked.map(([value]) => value)).toEqual([10, 10]);
      // told where each went down: one near each hole
      banked.forEach(([, x, y], k) =>
        expect(nearestHole(north.holes, x, y), `the ruby banked at ${x.toFixed(0)},${y.toFixed(0)}`).toBe(
          north.holes[k],
        ),
      );
    });
  });

  it('gives the East Gallery two belts, each with a label of its own and a price of its own', () => {
    const { belts } = east.spec;
    expect(belts.map((b) => b.label)).toEqual(['Conveyor, top of the ring', 'Conveyor, bottom of the ring']);
    expect(new Set(belts.map((b) => b.id)).size, 'their ids differ').toBe(2);
    expect(belts[0].id, 'the first keeps the id a save has been given').toBe('east-belt');
    // the bottom belt runs from the bottom heap toward the hole: the heap furthest south, and a belt that ends near the hole
    const bottom = east.spec.heaps.reduce((f, h) => (h.y < f.y ? h : f));
    const b = belts[1].spec;
    expect(Math.hypot(b.x0 - bottom.x, b.y0 - bottom.y), 'the bottom belt starts by the bottom heap').toBeLessThan(12);
    expect(Math.hypot(b.x1 - east.holes[0].x, b.y1 - east.holes[0].y), 'and ends by the hole').toBeLessThan(18);
    expect(belts[1].cost, 'about the first belt’s price').toBeGreaterThan(belts[0].cost * 0.7);
    expect(belts[1].cost).toBeLessThan(belts[0].cost * 1.5);
    // the caves with one belt have no label: their names read as they did
    for (const c of RUN) if (c.id !== 'east-gallery') for (const o of c.belts) expect(o.label).toBeUndefined();
  });

  it('carries a load off either belt of the East Gallery to the hole, both running at once', () => {
    withSeed(6, () => {
      // a gold bar, which the heaps have none of, is set down on each belt near its far end; the belts carry the
      // heaps' coins too, so the bars are what is watched for
      const bars: number[] = [];
      const game = gameIn(
        'east-gallery',
        { belts: ['east-belt', 'east-belt-bottom'] },
        { banked: (kind) => kind === BAR && bars.push(bars.length) },
      );
      expect(game.running(), 'both belts run').toEqual([0, 1]);
      expect(game.world.belts, 'both are the physics’ belts').toHaveLength(2);
      const carried = east.spec.belts.map(({ spec: s }, k) => {
        const x = s.x0 + (s.x1 - s.x0) * 0.6,
          y = s.y0 + (s.y1 - s.y0) * 0.6;
        expect(game.stock.spawn(BAR, x, y, 1.2), `a bar on belt ${k}`).toBe(true);
        return k;
      });
      for (let f = 0; f < 60 * 30 && bars.length < carried.length; f++) game.step(DT, still);
      expect(bars.length, 'a bar banked off each belt').toBe(2);
    });
  });
});

describe('the structure', () => {
  const sources = readdirSync('src')
    .filter((f) => f.endsWith('.ts'))
    .map((f) => [f, readFileSync(`src/${f}`, 'utf8')] as const);

  it('has the content in caves.ts and only the page importing it', () => {
    const importers = sources.filter(([, text]) => /(from|import)\s*\(?\s*'\.\/caves'/.test(text)).map(([f]) => f);
    expect(importers).toEqual(['main.ts']);
  });

  it('has no constant in the machinery for the grid or for the hole', () => {
    for (const [file, text] of sources) {
      expect(text, file).not.toMatch(/export\s+(const|let|var)\s+(COLS|ROWS|ORIGIN_X|ORIGIN_Y|HOLE)\b/);
    }
  });
});

// ---- the five caves of the run, held to their sketches ----

/** The heap's own size, for whether it stands clear of rock: how far its coins spread. */
const heapReach = (coins: number) => Math.sqrt(coins) * 0.36 + 1.5;

/** The tiles a point is over, given the cave's grid. */
function tileOfPoint(cave: ReturnType<typeof buildCave>, x: number, y: number): number {
  const { cols, rows, originX, originY } = cave.grid;
  const tx = Math.floor((x - originX) / TILE),
    ty = Math.floor((y - originY) / TILE);
  return tx < 0 || ty < 0 || tx >= cols || ty >= rows ? -1 : ty * cols + tx;
}

/** Whether a world point is on or within `margin` tiles of a cutting's tiles. */
function inCutting(spec: CaveSpec, cave: ReturnType<typeof buildCave>, x: number, y: number, margin = 0): boolean {
  const { originX, originY } = cave.grid;
  return [spec.entry, spec.exit].some((c) => {
    if (!c) return false;
    const [x0, y0, x1, y1] = c.tiles;
    return (
      x >= originX + (x0 - margin) * TILE &&
      x <= originX + (x1 + 1 + margin) * TILE &&
      y >= originY + (y0 - margin) * TILE &&
      y <= originY + (y1 + 1 + margin) * TILE
    );
  });
}

describe.each(RUN.map((spec) => [spec.id, spec] as const))('the cave %s, held to its sketch', (id, spec) => {
  const cave = buildCave(spec);
  const { cols, rows } = cave.grid;
  const cells = cave.cells;
  const open = cave.solid(
    true,
    spec.secrets.map(() => false),
    spec.walls.map(() => true),
  );
  const at = (x: number, y: number) => tileOfPoint(cave, x, y);
  const arrivalTile = () => {
    const [x0, y0, x1, y1] = spec.entry.tiles;
    const [ox, oy] = spec.entry.out;
    const tx = ox < 0 ? x0 + 1 : ox > 0 ? x1 - 1 : (x0 + x1) >> 1,
      ty = oy < 0 ? y0 + 1 : oy > 0 ? y1 - 1 : (y0 + y1) >> 1;
    return ty * cols + tx;
  };

  it('fits its grid, with two tiles of rock round the edge', () => {
    for (let t = 0; t < cells.length; t++) {
      const tx = t % cols,
        ty = (t / cols) | 0;
      if (tx >= 2 && ty >= 2 && tx < cols - 2 && ty < rows - 2) continue;
      expect(cells[t], `${id} has ${cells[t]} at the edge, ${tx},${ty}`).toBe(ROCK);
    }
    for (const c of [spec.entry, spec.exit]) {
      if (!c) continue;
      const [x0, y0, x1, y1] = c.tiles;
      expect(Math.min(x0, y0), `${id} cutting starts inside the edge`).toBeGreaterThanOrEqual(2);
      expect(x1, `${id} cutting ends inside the edge`).toBeLessThanOrEqual(cols - 3);
      expect(y1, `${id} cutting ends inside the edge`).toBeLessThanOrEqual(rows - 3);
    }
  });

  it('can be reached everywhere from its way in, with the walls down and its way out open', () => {
    const reach = new Set<number>();
    const stack = [arrivalTile()];
    expect(open[arrivalTile()], `${id} arrival is on floor`).toBe(0);
    while (stack.length) {
      const t = stack.pop()!;
      if (t < 0 || reach.has(t) || open[t]) continue;
      reach.add(t);
      const tx = t % cols;
      if (tx > 0) stack.push(t - 1);
      if (tx < cols - 1) stack.push(t + 1);
      if (t >= cols) stack.push(t - cols);
      if (t < cols * (rows - 1)) stack.push(t + cols);
    }
    const cut: string[] = [];
    spec.heaps.forEach((h, k) => {
      if (!reach.has(at(h.x, h.y))) cut.push(`heap ${k} at ${h.x},${h.y}`);
    });
    spec.secrets.forEach((s, k) => {
      const [x0, y0, x1, y1] = s.wall;
      let mouth = false;
      for (let ty = y0 - 1; ty <= y1 + 1; ty++)
        for (let tx = x0 - 1; tx <= x1 + 1; tx++) if (reach.has(ty * cols + tx)) mouth = true;
      if (!mouth) cut.push(`chamber ${k}'s mouth`);
    });
    spec.stashes.forEach((st, k) => {
      if (!reach.has(at(...tileCentre(cave.grid, st.at[0], st.at[1])))) cut.push(`side room ${k}`);
    });
    if (spec.exit) {
      const [x0, y0, x1, y1] = spec.exit.tiles;
      const [ox, oy] = spec.exit.out;
      const tx = ox < 0 ? x0 : ox > 0 ? x1 : (x0 + x1) >> 1,
        ty = oy < 0 ? y0 : oy > 0 ? y1 : (y0 + y1) >> 1;
      if (!reach.has(ty * cols + tx)) cut.push('the way out');
    }
    spec.holes.forEach((h, k) => {
      if (!reach.has(at(h.x, h.y))) cut.push(`hole ${k}`);
    });
    expect(cut, `${id}: cut off from the way in`).toEqual([]);
  });

  it('keeps every heap within its haul limit of a hole along the floor, belt or no belt', () => {
    const field = haulField(cave);
    const limit = HAUL_LIMIT[id];
    expect(limit, `${id} has a haul limit`).toBeGreaterThan(0);
    expect(spec.heaps.length).toBeGreaterThan(0);
    spec.heaps.forEach((h, k) => {
      const d = field[at(h.x, h.y)];
      expect(
        d,
        `${id} heap ${k} at ${h.x},${h.y} is ${d.toFixed(0)} from a hole along the floor, past ${limit}`,
      ).toSatisfy((v: number) => Number.isFinite(v) && v <= limit);
    });
  });

  it('stands no heap, belt, lamp or barrel on rock or in a cutting', () => {
    spec.heaps.forEach((h, k) => {
      const r = heapReach(h.coins) * 0.6;
      for (const [dx, dy] of [
        [0, 0],
        [r, 0],
        [-r, 0],
        [0, r],
        [0, -r],
        [r * 0.7, r * 0.7],
        [-r * 0.7, -r * 0.7],
        [r * 0.7, -r * 0.7],
        [-r * 0.7, r * 0.7],
      ]) {
        const t = at(h.x + dx, h.y + dy);
        expect(
          cells[t],
          `${id} heap ${k} stands on ${cells[t]} at ${(h.x + dx).toFixed(0)},${(h.y + dy).toFixed(0)}`,
        ).toBe(OPEN);
        expect(inCutting(spec, cave, h.x + dx, h.y + dy), `${id} heap ${k} in a cutting`).toBe(false);
      }
    });
    spec.belts.forEach(({ id: beltId, spec: b }) => {
      const len = Math.hypot(b.x1 - b.x0, b.y1 - b.y0);
      const nx = -(b.y1 - b.y0) / len,
        ny = (b.x1 - b.x0) / len;
      for (let s = 0; s <= 1.0001; s += 0.01) {
        for (const side of [-1, 0, 1]) {
          const x = b.x0 + (b.x1 - b.x0) * s + nx * side * (b.width / 2),
            y = b.y0 + (b.y1 - b.y0) * s + ny * side * (b.width / 2);
          expect(cells[at(x, y)], `${id} belt ${beltId} on rock at ${x.toFixed(0)},${y.toFixed(0)}`).toBe(OPEN);
          expect(inCutting(spec, cave, x, y), `${id} belt ${beltId} in a cutting`).toBe(false);
        }
      }
    });
    for (const l of cave.lamps) {
      expect(cells[at(l.x, l.y)], `${id} lamp at ${l.x},${l.y}`).toBe(OPEN);
      expect(inCutting(spec, cave, l.x, l.y, 1), `${id} lamp at ${l.x},${l.y} on or beside a cutting`).toBe(false);
    }
    for (const b of cave.barrels) {
      expect(cells[at(b.x, b.y)], `${id} barrel at ${b.x},${b.y}`).toBe(OPEN);
      expect(inCutting(spec, cave, b.x, b.y, 2), `${id} barrel at ${b.x},${b.y} on or beside a cutting`).toBe(false);
    }
    expect(cave.barrels.length, `${id} barrels stood`).toBe(spec.barrels);
  });

  it('has a hole on floor, a vein and cracks on floor, and a place for each drone on floor out of the way in', () => {
    for (const h of spec.holes) {
      for (const [dx, dy] of [
        [0, 0],
        [h.radius + 4, 0],
        [-h.radius - 4, 0],
        [0, h.radius + 4],
        [0, -h.radius - 4],
      ])
        expect(cells[at(h.x + dx, h.y + dy)], `${id} floor round the hole`).toBe(OPEN);
    }
    expect(cells[at(spec.vein.x, spec.vein.y)], `${id} vein`).toBe(OPEN);
    spec.cracks.forEach(([x, y]) => expect(cells[at(x, y)], `${id} crack at ${x},${y}`).toBe(OPEN));
    for (let j = 0; j < 3; j++) {
      const hole = spec.holes[0];
      const x = hole.x + 14 + j * 6,
        y = hole.y + 10;
      expect(cells[at(x, y)], `${id} drone ${j}'s place`).toBe(OPEN);
      expect(inCutting(spec, cave, x, y), `${id} drone ${j}'s place in a cutting`).toBe(false);
    }
  });

  it('has its way in open and its way out rock until opened, the last cave with none', () => {
    const [x0, y0, x1, y1] = spec.entry.tiles;
    let openEntry = 0;
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (cells[ty * cols + tx] === OPEN) openEntry++;
    expect(openEntry, `${id} way in is open`).toBe((x1 - x0 + 1) * (y1 - y0 + 1));
    if (!spec.exit) return;
    const shut = cave.solid(false);
    let exits = 0;
    cells.forEach((c, t) => {
      if (c !== 64) return;
      exits++;
      expect(shut[t]).toBe(1);
    });
    expect(exits, `${id} has a way out`).toBeGreaterThan(0);
    const [ex0, ey0, ex1, ey1] = spec.exit.tiles;
    const [ox, oy] = spec.exit.out;
    const tx = ox < 0 ? ex0 : ox > 0 ? ex1 : (ex0 + ex1) >> 1,
      ty = oy < 0 ? ey0 : oy > 0 ? ey1 : (ey0 + ey1) >> 1;
    expect(cells[ty * cols + tx], `${id} way out reaches its outer end`).toBe(64);
  });

  it('hides each chamber in rock, and puts each side room behind a wall with floor on both faces', () => {
    const main = new Set<number>();
    const stack = [arrivalTile()];
    // the floor the dozer can reach with every wall standing and the way out shut
    const standing = cave.solid(false);
    while (stack.length) {
      const t = stack.pop()!;
      if (t < 0 || main.has(t) || standing[t]) continue;
      main.add(t);
      const tx = t % cols;
      if (tx > 0) stack.push(t - 1);
      if (tx < cols - 1) stack.push(t + 1);
      if (t >= cols) stack.push(t - cols);
      if (t < cols * (rows - 1)) stack.push(t + cols);
    }
    spec.stashes.forEach((st, k) => {
      const inside = new Set<number>();
      const s2 = [at(...tileCentre(cave.grid, st.at[0], st.at[1]))];
      while (s2.length) {
        const t = s2.pop()!;
        if (t < 0 || inside.has(t) || cells[t] !== OPEN) continue;
        inside.add(t);
        const tx = t % cols;
        if (tx > 0) s2.push(t - 1);
        if (tx < cols - 1) s2.push(t + 1);
        if (t >= cols) s2.push(t - cols);
        if (t < cols * (rows - 1)) s2.push(t + cols);
      }
      expect(inside.size, `${id} side room ${k} has floor`).toBeGreaterThan(0);
      for (const t of inside)
        expect(main.has(t), `${id} side room ${k} is reached without its wall broken`).toBe(false);
    });
    spec.walls.forEach((w, k) => {
      const [x0, y0, x1, y1] = w.tiles;
      const alongX = x1 - x0 >= y1 - y0;
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++) {
          const a = alongX ? cells[(y - 1) * cols + x] : cells[y * cols + x - 1],
            b = alongX ? cells[(y + 1) * cols + x] : cells[y * cols + x + 1];
          expect(a === OPEN || (a >= 32 && a < 64), `${id} wall ${k} at ${x},${y}`).toBe(true);
          expect(b === OPEN || (b >= 32 && b < 64), `${id} wall ${k} at ${x},${y}`).toBe(true);
        }
    });
    spec.secrets.forEach((s, k) => {
      const [w0x, w0y, w1x, w1y] = s.wall;
      const isWall = (x: number, y: number) => x >= w0x && x <= w1x && y >= w0y && y <= w1y;
      let faces = 0,
        mine = 0;
      for (let ty = 0; ty < rows; ty++)
        for (let tx = 0; tx < cols; tx++) {
          if (cells[ty * cols + tx] !== 16 + k) continue;
          mine++;
          if (isWall(tx, ty)) {
            if (
              [
                [1, 0],
                [-1, 0],
                [0, 1],
                [0, -1],
              ].some(([dx, dy]) => cells[(ty + dy) * cols + tx + dx] === OPEN)
            )
              faces++;
            continue;
          }
          for (let dy = -2; dy <= 2; dy++)
            for (let dx = -2; dx <= 2; dx++) {
              const c = cells[(ty + dy) * cols + tx + dx];
              const leak = (c === OPEN || c === 64) && !isWall(tx + dx, ty + dy);
              expect(leak, `${id} chamber ${k} tile ${tx},${ty} beside open floor at ${tx + dx},${ty + dy}`).toBe(
                false,
              );
            }
        }
      expect(mine, `${id} chamber ${k} has tiles`).toBeGreaterThan(0);
      expect(faces, `${id} chamber ${k} has a face to break`).toBeGreaterThan(0);
    });
  });
});
