/**
 * Currents: strips of floor that are always running and carry what lies on them. One that runs to a hole
 * helps, and what it carries is banked; one that ends in a drain loses what it carries, which is gone from the
 * cave and so is out of the way of clearing it without being banked. Each of these is a criterion or an edge case
 * of the plan (`docs/plans/currents-geodes-scoop.md`, "A1"), so a change that breaks one says which.
 *
 * The caves' own geometry is held for every cave here, since it costs nothing; what has to be played is held on
 * the Hollow (a current to a hole) and the South Gallery (one to a drain), and on every cave in
 * `test/slow/currents.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { Autopilot } from '../src/autopilot';
import { TILE, buildCave, nearestHole, tileCentre, type Cave, type CurrentSpec } from '../src/cave';
import { FLOW_LOOK, currentBelt, drainOf, flowOf } from '../src/currents';
import { Economy, memoryStore } from '../src/economy';
import { Game } from '../src/game';
import { checkInvariants } from '../src/invariants';
import { minimapView, type MinimapBodies } from '../src/minimap';
import { StaticScene } from '../src/scene-static';
import { buildTerrain, floorHeight, pitsOf } from '../src/terrain';
import { BARREL_KIND, BRICK_KIND, GEODE_KIND, KINDS, KIND_VALUE } from '../src/physics';
import { RUN, caveOf, gameIn, saveIn, specOf, withSeed } from './helpers';
import {
  ALL,
  DT,
  TO_DRAIN,
  TO_HOLE,
  WITH_CURRENTS,
  aCoin,
  carriesToHole,
  dozerStays,
  drainCurrent,
  losesToDrain,
  navAndForeman,
  onIt,
  opensOnTheLastCoin,
  put,
  still,
  told,
  until,
} from './current-helpers';
import { routeProblems, toSegment } from './current-geometry';

/** What each cave's currents are, by flow and by where they end: the plan's table, as the routes were laid. */
const TABLE: Record<string, { flow: string; ends: 'hole' | 'drain' }[]> = {
  hollow: [{ flow: 'water', ends: 'hole' }],
  'south-gallery': [{ flow: 'water', ends: 'drain' }],
  'east-gallery': [{ flow: 'lava', ends: 'drain' }],
  'north-vault': [{ flow: 'ice', ends: 'hole' }],
  warrens: [
    { flow: 'water', ends: 'hole' },
    { flow: 'water', ends: 'drain' },
  ],
  'west-gallery': [{ flow: 'water', ends: 'drain' }],
  deep: [
    { flow: 'water', ends: 'hole' },
    { flow: 'water', ends: 'drain' },
  ],
};

describe('the currents of the run', () => {
  it('are the table: each cave has one or two, of the flow and the ending it was given', () => {
    for (const spec of RUN) {
      const got = (spec.currents ?? []).map((c) => ({ flow: c.flow, ends: c.drain ? 'drain' : 'hole' }));
      expect(got, spec.id).toEqual(TABLE[spec.id]);
    }
    expect(ALL.length, 'there are currents to hold to the rest').toBe(9);
    expect(TO_HOLE.length).toBe(4);
    expect(TO_DRAIN.length).toBe(5);
  });

  it('are named for ever: each id is its own across the run, and says what it is', () => {
    const ids = ALL.map(({ c }) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  it('are about the width of a belt and run at about its pace, the ice faster', () => {
    for (const { c } of ALL) {
      expect(c.width).toBeGreaterThanOrEqual(5);
      expect(c.width).toBeLessThanOrEqual(8);
      if (c.flow !== 'ice') expect(c.speed).toBeLessThanOrEqual(10);
    }
    const ice = ALL.find(({ c }) => c.flow === 'ice')!.c;
    expect(ice.speed, 'ice is fast').toBeGreaterThan(10);
  });

  it('are belts to the physics: the cave builds each, and a drain past each end that has one', () => {
    for (const spec of RUN) {
      const cave = buildCave(spec);
      expect(cave.currents, spec.id).toEqual(spec.currents ?? []);
      expect(cave.drains, spec.id).toEqual((spec.currents ?? []).flatMap((c) => drainOf(c) ?? []));
      for (const c of spec.currents ?? []) {
        const belt = currentBelt(c);
        expect(belt.half * 2).toBeCloseTo(Math.hypot(c.x1 - c.x0, c.y1 - c.y0));
        expect(belt.width).toBe(c.width);
        expect(belt.speed).toBe(c.speed);
      }
    }
  });

  it('put every drain just past the end of its current, a rim’s gap off, and never among the holes', () => {
    for (const { id, c } of TO_DRAIN) {
      const cave = caveOf(id);
      const drain = cave.drains.find((d) => Math.hypot(d.x - c.x1, d.y - c.y1) < c.drain!.radius + 4);
      expect(drain, `${c.id} has its drain`).toBeDefined();
      expect(Math.hypot(drain!.x - c.x1, drain!.y - c.y1)).toBeCloseTo(c.drain!.radius + 2, 5);
      expect(cave.holes, `${c.id}: a drain is never a hole`).not.toContain(drain);
    }
  });

  it('put every drain’s middle on the lattice the floor is cut on, so its collar meets the floor in a straight edge', () => {
    let drains = 0;
    for (const spec of WITH_CURRENTS) {
      const cave = buildCave(spec);
      for (const d of cave.drains) {
        drains++;
        // the floor is drawn a quarter of a tile to a step, and a hole's collar is laid on those steps
        const step = TILE / 4;
        expect(((d.x - cave.grid.originX) / step) % 1, `${spec.id}: a drain at x ${d.x}`).toBe(0);
        expect(((d.y - cave.grid.originY) / step) % 1, `${spec.id}: a drain at y ${d.y}`).toBe(0);
      }
    }
    expect(drains).toBeGreaterThan(0);
  });

  it('run on to a hole, ending a rim’s gap short of it and aimed at it, as a belt does', () => {
    for (const { id, c } of TO_HOLE) {
      const cave = caveOf(id);
      const hole = nearestHole(cave.holes, c.x1, c.y1);
      const gap = Math.hypot(hole.x - c.x1, hole.y - c.y1) - hole.radius;
      expect(gap, `${c.id} ends ${gap.toFixed(1)} from the rim`).toBeGreaterThanOrEqual(1);
      expect(gap).toBeLessThanOrEqual(4.5);
      const [ux, uy] = flowOf(c);
      expect(Math.abs(-(hole.x - c.x1) * uy + (hole.y - c.y1) * ux), `${c.id} is aimed at its hole`).toBeLessThan(
        hole.radius * 0.6,
      );
      expect((hole.x - c.x1) * ux + (hole.y - c.y1) * uy).toBeGreaterThan(0);
    }
  });

  it('keep the drains out of the list of holes the nav, the foreman and the minimap read, and put them after the holes in the world’s', () => {
    for (const spec of WITH_CURRENTS) {
      const cave = caveOf(spec.id);
      expect(cave.holes, spec.id).toBe(spec.holes);
      for (const d of cave.drains) expect(cave.holes.includes(d)).toBe(false);
    }
    const game = gameIn('warrens');
    expect(game.nav.holes).toHaveLength(2);
    expect(game.world.holes).toHaveLength(3);
    expect(game.world.holes[2]).toMatchObject({ radius: game.cave.drains[0].radius });
  });
});

describe('criterion 1: what a current to a hole carries is banked', () => {
  it('carries a gold bar at the head of the Hollow’s to the hole', () => {
    carriesToHole('hollow', specOf('hollow').currents![0]);
  });

  it('banks a coin down a hole as it always did, with a drain in the cave', () => {
    withSeed(32, () => {
      const game = gameIn('south-gallery');
      const before = game.economy.bank;
      const h = game.cave.holes[0];
      game.stock.spawn(1, h.x, h.y, 2);
      until(game, 120, () => game.economy.bank > before);
      expect(game.economy.bank).toBe(before + 10);
      expect(game.economy.save.drained).toBe(0);
    });
  });
});

describe('criterion 2: what a current to a drain carries is lost', () => {
  it('loses a coin from the South Gallery’s: bank unchanged, drained raised, the share risen', () => {
    losesToDrain('south-gallery', drainCurrent('south-gallery'));
  });

  it('writes it into the save as it goes, not at the next thing banked', () => {
    withSeed(34, () => {
      const store = memoryStore(saveIn('south-gallery'));
      const game = new Game(new Economy(store, RUN), caveOf('south-gallery'));
      put(game, aCoin(game), ...onIt(drainCurrent('south-gallery'), 2));
      until(game, 60 * 30, () => game.economy.save.drained > 0);
      expect((JSON.parse(store.json!) as { drained: number }).drained).toBe(1);
    });
  });
});

describe('criterion 3: a cave whose last coins go down a drain still opens its way out', () => {
  it('opens the South Gallery’s on the last coin drained', () => {
    opensOnTheLastCoin('south-gallery');
  });
});

describe('criterion 4: every current lies on floor, clear of everything that stands in the cave', () => {
  describe.each(WITH_CURRENTS.map((s) => [s.id, s] as const))('%s', (id, spec) => {
    const cave = caveOf(id);
    it.each(spec.currents!.map((c) => [c.id, c] as const))('keeps %s clear', (_n, c) => {
      const others = spec.currents!.filter((o) => o !== c);
      const drain = drainOf(c);
      expect(routeProblems(cave, c, drain, others)).toEqual([]);
      // and from the other currents' drains
      for (const d of cave.drains) {
        if (drain && d.x === drain.x && d.y === drain.y) continue;
        expect(toSegment(d.x, d.y, [c.x0, c.y0, c.x1, c.y1]).d, `${c.id} by another drain`).toBeGreaterThan(
          d.radius + c.width / 2 + 2,
        );
      }
    });
  });

  it('can tell: a route laid across a barrel, a lamp and a heap is refused, one by one', () => {
    const cave = caveOf('south-gallery');
    const lay = (x0: number, y0: number, x1: number, y1: number): CurrentSpec => ({
      id: 'laid',
      flow: 'water',
      x0,
      y0,
      x1,
      y1,
      width: 7,
      speed: 9,
    });
    const barrel = cave.barrels[0],
      lamp = cave.lamps[0],
      heap = cave.spec.heaps[0];
    expect(routeProblems(cave, lay(barrel.x - 5, barrel.y, barrel.x + 5, barrel.y), null).join()).toContain('barrel');
    expect(routeProblems(cave, lay(lamp.x - 5, lamp.y, lamp.x + 5, lamp.y), null).join()).toContain('lamp');
    expect(routeProblems(cave, lay(heap.x - 5, heap.y, heap.x + 5, heap.y), null).join()).toContain('heap');
    expect(routeProblems(cave, lay(cave.grid.originX - 20, 0, cave.grid.originX - 5, 0), null).join()).toContain(
      'not on floor',
    );
  });

  it('are not fed to the placers of barrels and lamps: with the currents taken off, the very same ones stand', () => {
    for (const spec of WITH_CURRENTS) {
      const bare = buildCave({ ...spec, currents: undefined });
      const cave = caveOf(spec.id);
      expect(cave.barrels, `${spec.id} barrels`).toEqual(bare.barrels);
      expect(cave.lamps, `${spec.id} lamps`).toEqual(bare.lamps);
    }
  });
});

describe('criterion 5: the way from each heap to its hole never crosses a current to a drain', () => {
  const nearestTile = (cave: Cave, x: number, y: number) => {
    const { cols, originX, originY } = cave.grid;
    return Math.floor((y - originY) / 4) * cols + Math.floor((x - originX) / 4);
  };

  /** Tiles from a point over the floor the dozer can drive, with `blocked` tiles left out; Infinity where there is no way. */
  function haul(cave: Cave, from: { x: number; y: number }, blocked: (x: number, y: number) => boolean): number[] {
    const { cols, rows } = cave.grid;
    const solid = cave.solid(
      true,
      cave.spec.secrets.map(() => false),
      cave.spec.walls.map(() => true),
    );
    const dist = new Array<number>(cols * rows).fill(Infinity);
    const start = nearestTile(cave, from.x, from.y);
    dist[start] = 0;
    const queue = [start];
    for (let q = 0; q < queue.length; q++) {
      const t = queue[q];
      const tx = t % cols,
        ty = (t / cols) | 0;
      for (const [nx, ny] of [
        [tx - 1, ty],
        [tx + 1, ty],
        [tx, ty - 1],
        [tx, ty + 1],
      ]) {
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const n = ny * cols + nx;
        if (solid[n] || dist[n] !== Infinity) continue;
        const [x, y] = tileCentre(cave.grid, nx, ny);
        if (blocked(x, y)) continue;
        dist[n] = dist[t] + 1;
        queue.push(n);
      }
    }
    return dist;
  }

  /** The tiles a current to a drain, and its pit, take: a margin of three units on either side of it. */
  const takenBy = (drainers: readonly CurrentSpec[], cave: Cave) => (x: number, y: number) =>
    drainers.some((c) => toSegment(x, y, [c.x0, c.y0, c.x1, c.y1]).d < c.width / 2 + 3) ||
    cave.drains.some((d) => Math.hypot(x - d.x, y - d.y) < d.radius + 3);

  it.each([...new Set(TO_DRAIN.map(({ id }) => id))])(
    'keeps every heap of %s as near its hole as it was, with the drains put in the way',
    (id) => {
      const cave = caveOf(id);
      const blocked = takenBy(
        cave.spec.currents!.filter((c) => c.drain),
        cave,
      );
      const open = cave.holes.map((h) => haul(cave, h, () => false));
      const shut = cave.holes.map((h) => haul(cave, h, blocked));
      for (const h of cave.spec.heaps) {
        const t = nearestTile(cave, h.x, h.y);
        const k = open.reduce((best, d, j) => (d[t] < open[best][t] ? j : best), 0);
        expect(open[k][t], `the heap at ${h.x.toFixed(0)},${h.y.toFixed(0)} can reach a hole`).toBeLessThan(Infinity);
        expect(
          shut[k][t],
          `the heap at ${h.x.toFixed(0)},${h.y.toFixed(0)}: ${shut[k][t]} tiles with the drains in the way, ${open[k][t]} without`,
        ).toBeLessThanOrEqual(open[k][t] * 1.1 + 2);
      }
    },
  );

  it('can tell: a drain current laid across the whole of a heap’s way cuts it off', () => {
    const cave = caveOf('south-gallery');
    const hole = cave.holes[0],
      heap = cave.spec.heaps[0];
    const across: CurrentSpec = {
      id: 'across',
      flow: 'water',
      x0: (heap.x + hole.x) / 2,
      y0: hole.y - 80,
      x1: (heap.x + hole.x) / 2,
      y1: hole.y + 80,
      width: 7,
      speed: 9,
      drain: { radius: 3.5, depth: 10 },
    };
    const shut = haul(cave, hole, takenBy([across], cave));
    expect(shut[nearestTile(cave, heap.x, heap.y)], 'cut off').toBe(Infinity);
    expect(haul(cave, hole, () => false)[nearestTile(cave, heap.x, heap.y)], 'and not before').toBeLessThan(Infinity);
  });
});

describe('criterion 6: the dozer and the drones are not moved by a current', () => {
  it('leaves the dozer where it stood on a current', () => {
    dozerStays('south-gallery', drainCurrent('south-gallery'));
    dozerStays('hollow', specOf('hollow').currents![0]);
  });

  it('leaves a drone where it stood on a current, to within what its own engine does in a few frames', () => {
    withSeed(42, () => {
      const game = gameIn('south-gallery', { drones: 1 });
      const bot = game.bots[0];
      const [x, y] = onIt(drainCurrent('south-gallery'), 6);
      Object.assign(bot.dozer, { x, y, speed: 0, yawRate: 0 });
      for (let f = 0; f < 10; f++) game.step(DT, still);
      // nine units a second would have taken it 1.5 in ten frames; its own engine takes it a few hundredths
      expect(Math.hypot(bot.dozer.x - x, bot.dozer.y - y)).toBeLessThan(0.4);
    });
  });
});

describe('what the nav and the drones do with a current', () => {
  it('counts one to a hole as somewhere to leave a load and sends no drone for a coin on it', () => {
    navAndForeman('hollow', specOf('hollow').currents![0]);
  });

  it('never counts one to a drain as somewhere to leave a load, and sends no drone for a coin on it', () => {
    navAndForeman('south-gallery', drainCurrent('south-gallery'));
  });
});

describe('the autopilot', () => {
  it('leaves a coin on a current to a drain where it lies, in both the coin it sets up for and the patch it drives over', () => {
    withSeed(44, () => {
      const game = gameIn('south-gallery');
      const c = drainCurrent('south-gallery');
      const slot = aCoin(game);
      for (let i = 0; i < game.world.count; i++) if (game.world.alive[i] && i !== slot) game.world.remove(i);
      const pilot = new Autopilot(game, 'thorough');
      const mind = pilot as unknown as { best(bot: unknown): number; patch(): [number, number] | null };
      // beside the current, the coin is worked, so that what is seen on it is the current's doing and not the cave's
      const beside = [10, -10, 14, -14].find((across) => {
        put(game, slot, ...onIt(c, 6, across), 1);
        return mind.best(pilot.machine) === slot;
      });
      expect(beside, 'a coin beside the current is worked').toBeDefined();
      expect(mind.patch(), 'and its patch is driven over').not.toBeNull();
      put(game, slot, ...onIt(c, 6));
      expect(mind.best(pilot.machine), 'on the current it is let be').toBe(-1);
      expect(mind.patch(), 'and so is its patch').toBeNull();
    });
  });
});

describe('edge cases', () => {
  const c = drainCurrent('south-gallery');

  it('loses every kind of body down a drain, each counted out of the cave, and only what is worth something raises drained', () => {
    withSeed(51, () => {
      const { events, named } = told();
      const game = gameIn('south-gallery', {}, events);
      const everyKind = [...Array(KINDS).keys()];
      const barrels = game.stock.kinds[BARREL_KIND];
      // one at a time, down the middle: a row of them laid at once stands in each other, a boulder among them,
      // and what is shoved off the strip's side is not what this is about
      for (const kind of everyKind) {
        const [x, y] = onIt(c, 6);
        let slot: number;
        if (kind === BRICK_KIND) slot = game.stock.spawnBrick(1, x, y, 1.2);
        else if (kind === BARREL_KIND) slot = game.stock.spawnBarrel(x, y, 1.2);
        else if (kind === GEODE_KIND) slot = game.stock.spawnGeode(x, y);
        else {
          expect(game.stock.spawn(kind, x, y, 1.2)).toBe(true);
          slot = [...Array(game.world.count).keys()].find(
            (i) =>
              game.world.alive[i] &&
              game.world.kind[i] === kind &&
              Math.abs(game.world.x[i] - x) < 1e-3 &&
              Math.abs(game.world.y[i] - y) < 1e-3,
          )!;
        }
        expect(slot, `kind ${kind} spawned`).toBeGreaterThanOrEqual(0);
        until(game, 60 * 20, () => !game.world.alive[slot]);
        expect(game.world.alive[slot], `kind ${kind} lost down the drain`).toBeFalsy();
      }
      const worth = everyKind.reduce((n, k) => n + KIND_VALUE[k], 0);
      expect(game.economy.save.drained, 'every value, and bricks, barrels and whole geodes none').toBe(worth);
      expect(
        named('drained')
          .map((e) => e.args[0] as number)
          .sort(),
      ).toEqual(everyKind);
      expect(game.economy.bank).toBe(0);
      expect(game.stock.kinds[BARREL_KIND], 'the barrel sent down is counted out, and no other').toBe(barrels);
      expect(game.barrels.lit, 'no fuse is left on a barrel that has gone').toEqual([]);
      expect(checkInvariants(game)).toEqual([]);
    });
  });

  it('saves what was lost, and comes back with the same lost, the same bank and the same cave left', () => {
    withSeed(53, () => {
      const store = memoryStore(saveIn('south-gallery'));
      const game = new Game(new Economy(store, RUN), caveOf('south-gallery'));
      for (let n = 0; n < 3; n++) put(game, aCoin(game, n), ...onIt(c, 2 + n * 0.8));
      until(game, 60 * 30, () => game.economy.save.drained >= 3);
      expect(game.economy.save.drained).toBe(3);
      const lying = game.stock.lying();
      game.persist();
      const back = new Game(new Economy(memoryStore(store.json), RUN), caveOf('south-gallery'));
      expect(back.economy.save.drained, 'what was lost comes back').toBe(3);
      expect(back.economy.bank).toBe(0);
      expect(back.stock.lying(), 'and the cave is what was left, not what was lost put back').toBe(lying);
      expect(checkInvariants(back)).toEqual([]);
    });
  });

  it('clears a current of two hundred bodies at once: each is lost, or thrown off the strip’s side or past its end and at rest, and every count is true', () => {
    withSeed(56, () => {
      const game = gameIn('south-gallery');
      const n = 200;
      const slots = [...Array(n).keys()].map((k) => aCoin(game, k));
      slots.forEach((slot, k) =>
        put(game, slot, ...onIt(c, 2 + (k % 20) * 0.7, ((k / 20) | 0) * 0.5 - 2.4), 1 + (k % 5) * 0.9),
      );
      until(game, 60 * 60, () => game.economy.save.drained >= n);
      const { world } = game;
      const [ux, uy] = flowOf(c);
      const left = slots.filter((i) => world.alive[i]);
      // a pile this thick throws a few off the side of a strip seven wide, and a few off the corners of its end
      // come to rest beside the drain: they lie where they land, and none is left on the running strip
      const length = Math.hypot(c.x1 - c.x0, c.y1 - c.y0);
      for (const i of left) {
        const along = (world.x[i] - c.x0) * ux + (world.y[i] - c.y0) * uy;
        const across = Math.abs(-(world.x[i] - c.x0) * uy + (world.y[i] - c.y0) * ux);
        expect(across > c.width / 2 || along > length, `slot ${i} still on the current`).toBe(true);
        expect(world.asleep[i], `slot ${i} at rest`).toBeTruthy();
      }
      expect(game.economy.save.drained + left.length).toBe(n);
      expect(left.length, 'most of them went down').toBeLessThan(n / 10);
      expect(game.economy.bank).toBe(0);
      expect(checkInvariants(game)).toEqual([]);
    });
  });

  it('counts what was lost with what is left, when the cave is left', () => {
    withSeed(57, () => {
      const { events, named } = told();
      const game = gameIn('hollow', { drained: 40 }, events);
      const lying = game.stock.lyingAll();
      game.economy.open();
      const exit = game.cave.spec.exit!;
      const [x0, y0, x1, y1] = exit.tiles;
      const [ox, oy] = exit.out;
      // two tiles short of the outer end of the cutting, which is past the line three short of it
      const outer = tileCentre(
        game.cave.grid,
        ox < 0 ? x0 : ox > 0 ? x1 : (x0 + x1) / 2,
        oy < 0 ? y0 : oy > 0 ? y1 : (y0 + y1) / 2,
      );
      Object.assign(game.dozer, { x: outer[0] - ox * 8, y: outer[1] - oy * 8, speed: 0 });
      game.step(DT, still);
      expect(named('caveLeft')).toHaveLength(1);
      expect(named('caveLeft')[0].args[1], 'lost is what lay in it and what went down its drains').toBe(lying + 40);
      expect(game.economy.save.drained, 'and the next cave starts with none lost').toBe(0);
    });
  });
});

describe('the map', () => {
  const NO_BODIES: MinimapBodies = {
    count: 0,
    alive: new Uint8Array(0),
    kind: new Uint8Array(0),
    x: new Float32Array(0),
    y: new Float32Array(0),
  };
  const view = (cave: Cave, x: number, y: number) =>
    minimapView({
      cave,
      open: false,
      dozer: { x, y, yaw: 0 },
      facing: Math.PI / 2,
      bots: [],
      belts: [],
      bodies: NO_BODIES,
      range: 100,
    });

  it('shows the currents of the cave in what they are made of, and the drains in the window apart from the holes', () => {
    for (const spec of WITH_CURRENTS) {
      const cave = caveOf(spec.id);
      const mid = spec.currents![0];
      const v = view(cave, (mid.x0 + mid.x1) / 2, (mid.y0 + mid.y1) / 2);
      expect(
        v.currents.map((c) => c.flow),
        spec.id,
      ).toEqual(spec.currents!.map((c) => c.flow));
      for (const h of v.holes)
        expect(
          cave.holes.some((x) => x.radius === h.radius),
          'only holes are holes',
        ).toBe(true);
      const draining = spec.currents!.filter((c) => c.drain);
      // a drain beyond the window is not drawn, and one in it is drawn once
      expect(v.drains.length).toBeLessThanOrEqual(draining.length);
    }
    const here = drainCurrent('south-gallery');
    const d = drainOf(here)!;
    expect(view(caveOf('south-gallery'), d.x, d.y).drains).toHaveLength(1);
    expect(view(caveOf('south-gallery'), d.x + 400, d.y).drains, 'out of the window').toHaveLength(0);
  });

  it('puts a drain where it stands, turned with the camera like everything else', () => {
    const cave = caveOf('south-gallery');
    const d = cave.drains[0];
    const v = view(cave, d.x - 10, d.y);
    expect(v.drains).toHaveLength(1);
    // facing up the map is facing +y, so the drain, ten units east, is ten units to the right of the middle
    expect(v.drains[0].x).toBeCloseTo(10, 5);
    expect(v.drains[0].y).toBeCloseTo(0, 5);
    expect(v.drains[0].radius).toBe(d.radius);
    expect(v.drains[0].flow).toBe('water');
  });
});

describe('the picture', () => {
  const state = (cave: Cave) => ({
    open: false,
    secrets: cave.spec.secrets.map(() => false),
    walls: cave.spec.walls.map(() => false),
    wallDamage: cave.spec.walls.map(() => 0),
    lampsBroken: [],
    belts: [],
  });

  it('draws a flat strip for each current at its place, in the colour of what flows, and a collar and a pit for each drain', () => {
    for (const spec of WITH_CURRENTS) {
      const cave = caveOf(spec.id);
      const bare = new StaticScene(buildCave({ ...spec, currents: undefined })).groups(state(cave));
      const groups = new StaticScene(cave).groups(state(cave));
      expect(groups.length - bare.length, `${spec.id}: a strip a current, two groups a drain`).toBe(
        cave.currents.length + 2 * cave.drains.length,
      );
    }
    const cave = caveOf('east-gallery');
    const strips = new StaticScene(cave)
      .groups(state(cave))
      .filter((g) => g.albedo && g.albedo.join() === FLOW_LOOK.lava.albedo.join());
    expect(strips).toHaveLength(1);
    const c = cave.currents[0];
    expect(strips[0].matrices[12]).toBeCloseTo((c.x0 + c.x1) / 2, 3);
    expect(strips[0].matrices[13]).toBeCloseTo((c.y0 + c.y1) / 2, 3);
  });

  it('is plain: each flow its own colour, and no two alike', () => {
    const colours = (['water', 'lava', 'ice'] as const).map((f) => FLOW_LOOK[f].albedo.join());
    expect(new Set(colours).size).toBe(3);
  });

  it('cuts a drain into the floor as a hole is: level round it, and in the list the terrain cuts', () => {
    const cave = caveOf('south-gallery');
    const d = cave.drains[0];
    expect(pitsOf(cave)).toEqual([...cave.holes, d]);
    expect(floorHeight(pitsOf(cave), d.x + d.radius + 0.4, d.y)).toBeCloseTo(0, 6);
    // a cave without a drain is cut as it always was
    const bare = buildCave({ ...specOf('south-gallery'), currents: undefined });
    expect(pitsOf(bare)).toBe(bare.holes);
  });

  it('leaves the surface out where the drain’s collar lies, as it does where a hole’s does', () => {
    const cave = caveOf('south-gallery');
    const vertices = (c: Cave) =>
      buildTerrain(
        c,
        c.spec.secrets.map(() => false),
      ).groups.reduce((n, g) => n + g.mesh.positions.length / 3, 0);
    expect(vertices(cave), 'fewer vertices with the drain cut').toBeLessThan(vertices({ ...cave, drains: [] }));
  });
});

describe('the rules that must always hold', () => {
  it('notice a world whose holes are not the cave’s holes and then its drains, and a save that lost less than nothing', () => {
    const game = gameIn('warrens');
    expect(checkInvariants(game)).toEqual([]);
    (game.world as { holes: unknown }).holes = game.world.holes.slice(0, 2);
    expect(checkInvariants(game).join('\n')).toContain('the world has 2 holes');
    const other = gameIn('hollow');
    other.economy.save.drained = -3;
    expect(checkInvariants(other).join('\n')).toContain('down the drains: -3');
  });
});
