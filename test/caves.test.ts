/**
 * A cave that is not the game's: two holes, one room, no gates. What the game
 * does with the cave it is handed, rather than with the one it is usually
 * handed, is shown on this one, so a constant that still stands for the grid
 * or for "the hole" gets found here and not by the next cave to be added.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildCave,
  gridOf,
  nearestHole,
  tileCentre,
  areaAt,
  OPEN,
  ROCK,
  TILE,
  type Area,
  type CaveSpec,
  type Wing,
} from '../src/cave';
import { FIVE_ROOMS } from '../src/caves';
import { Economy, memoryStore } from '../src/economy';
import { Game } from '../src/game';
import { HOLE_LAMP_HEIGHT, holeLamps } from '../src/lamps';
import { Nav } from '../src/nav';
import { Bot, type Traffic } from '../src/tools';
import { floorHeight, buildTerrain } from '../src/terrain';
import { withSeed } from './helpers';

const DT = 1 / 60;
const still = { throttle: 0, steer: 0 };

const ROOM: Area = {
  name: 'The Long Room',
  blurb: 'coins, and a hole at each end',
  heaps: [{ x: 0, y: 10, coins: 120, gems: [] }],
  vein: { x: 0, y: 30, every: 5, coins: 1, gems: [] },
  cracks: [[0, 30]],
  belt: null,
};

/** One open room, 40 by 24 tiles, a hole at each end and a heap in the middle; nothing to open, seal or break. */
const TWO_HOLES: CaveSpec = {
  cols: 40,
  rows: 24,
  holes: [
    { x: -48, y: 0, radius: 5.5, depth: 14 },
    { x: 48, y: 0, radius: 4.5, depth: 12 },
  ],
  hollow: { rx: 18, ry: 10, alcove: { along: 14, rx: 3, ry: 3 } },
  wings: [null as unknown as Wing],
  areas: [ROOM],
  order: [0],
  secrets: [],
  walls: [],
  stashes: [],
  barrelsIn: [0],
};

const cave = buildCave(TWO_HOLES);

/** A game on the test cave, told nothing, and what it banked, where. */
function newGame() {
  const banked: [number, number, number][] = [];
  const game = new Game(new Economy(memoryStore(), TWO_HOLES), cave, {
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
    // the border is rock, the middle of the room is open, and no cell is anything else in a cave with no gates
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
    const solid = cave.solid([true]);
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
    const solid = cave.solid([true]);
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
    expect(tileCentre(grid, 0, 0)).not.toEqual(tileCentre(gridOf(FIVE_ROOMS), 0, 0));
    // the middle tile is centred on the world's origin, where the game's hole is
    expect(tileCentre(grid, 20, 12)).toEqual([0, 0]);
    // south of the hollow is the South Gallery in the game, and nothing in a cave with no wings
    expect(areaAt(FIVE_ROOMS, 0, -100)).toBe(1);
    expect(areaAt(TWO_HOLES, 0, -100)).toBe(0);
    expect(nearestHole(cave.holes, 40, 3)).toBe(cave.holes[1]);
    expect(nearestHole(cave.holes, -40, 3)).toBe(cave.holes[0]);
    // not the game's hole, which is in the middle
    expect(nearestHole(FIVE_ROOMS.holes, 40, 3)).toBe(FIVE_ROOMS.holes[0]);
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
