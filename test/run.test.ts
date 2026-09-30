/**
 * The run: one cave after another. The way out is rock until the cave is
 * cleared, opens when it is, sends the dozer on into the next cave when it is
 * driven through, and the next cave starts afresh with what the player carries.
 * Each of these is an acceptance criterion of the plan, so a change that breaks
 * one says which.
 */
import { describe, expect, it } from 'vitest';
import {
  EXIT,
  OPEN,
  arrival,
  buildCave,
  darkness,
  pastLeavingLine,
  tileCentre,
  type Cave,
  type CaveSpec,
} from '../src/cave';
import { CLEAR_SHARE, Economy, caveStock, memoryStore } from '../src/economy';
import { Game, type GameEvents } from '../src/game';
import { checkInvariants } from '../src/invariants';
import { onward } from '../scripts/run';
import { BARREL_KIND } from '../src/physics';
import { NO_SOURCE } from '../src/stock';
import { RUN, caveOf, gameIn, newEconomy, saveIn, specOf, withSeed } from './helpers';

const DT = 1 / 60;
const still = { throttle: 0, steer: 0 };

/** A note of every event the game tells, by name, with its arguments. */
function told() {
  const log: { name: string; args: unknown[] }[] = [];
  const events: GameEvents = new Proxy(
    {},
    {
      get:
        (_, name: string) =>
        (...args: unknown[]) =>
          log.push({ name, args }),
    },
  );
  return { log, events, named: (name: string) => log.filter((e) => e.name === name) };
}

/** Everything in the cave that counts toward clearing it, sent down the hole. */
function sendDown(game: Game) {
  const { world, stock } = game;
  const hole = game.cave.holes[0];
  let n = 0;
  for (let i = 0; i < world.count; i++) {
    if (!world.alive[i] || stock.origin[i] !== 0) continue;
    const a = n++ * 2.399;
    const r = 0.5 + (n % 9) * 0.3;
    world.x[i] = hole.x + Math.cos(a) * r;
    world.y[i] = hole.y + Math.sin(a) * r;
    world.z[i] = 2 + (n % 5) * 0.1;
    world.vx[i] = world.vy[i] = world.vz[i] = 0;
    world.wake(i);
  }
}

/** Clear the cave: everything counted is pushed into the hole, until the way out opens or the cave is done. */
function clear(game: Game) {
  sendDown(game);
  for (let f = 0; f < 2400 && !game.economy.save.open && !game.economy.save.done; f++) game.step(DT, still);
}

/** A point in a way out's cutting a little past its leaving line, and the direction out. */
function pastTheLine(cave: Cave): [number, number] {
  const exit = cave.spec.exit!;
  const [x0, y0, x1, y1] = exit.tiles;
  const [ox, oy] = exit.out;
  const outer = tileCentre(
    cave.grid,
    ox < 0 ? x0 : ox > 0 ? x1 : (x0 + x1) / 2,
    oy < 0 ? y0 : oy > 0 ? y1 : (y0 + y1) / 2,
  );
  // two tiles short of the outer end, which is past the line three short of it
  return [outer[0] - ox * 8, outer[1] - oy * 8];
}

describe('the way out is rock until the cave is cleared (criterion 1)', () => {
  it('is EXIT cells that are solid while shut and floor once open, in every cave but the last', () => {
    RUN.forEach((spec, n) => {
      const cave = caveOf(spec.id);
      const exits: number[] = [];
      cave.cells.forEach((c, t) => c === EXIT && exits.push(t));
      if (n === RUN.length - 1) {
        expect(spec.exit, 'the last cave has no way out').toBeNull();
        expect(exits, 'and no cells for one').toHaveLength(0);
        return;
      }
      expect(exits.length, `${spec.id} way out`).toBeGreaterThan(0);
      const shut = cave.solid(false),
        open = cave.solid(true);
      for (const t of exits) {
        expect(shut[t], `${spec.id} exit tile ${t} shut`).toBe(1);
        expect(open[t], `${spec.id} exit tile ${t} open`).toBe(0);
      }
    });
  });

  it('does nothing when rammed: it is not a hidden chamber', () => {
    withSeed(1, () => {
      const { log, events } = told();
      const game = gameIn('hollow', {}, events);
      const cave = game.cave;
      // up against the mouth, square on, flat out
      const mouth = [...cave.cells.keys()].filter((t) => cave.cells[t] === EXIT);
      const first = mouth.reduce((best, t) => (t % cave.grid.cols < best % cave.grid.cols ? t : best));
      const [mx, my] = tileCentre(cave.grid, first % cave.grid.cols, (first / cave.grid.cols) | 0);
      Object.assign(game.dozer, { x: mx - 30, y: my, yaw: 0, speed: 11 });
      for (let f = 0; f < 240; f++) game.step(DT, { throttle: 1, steer: 0 });
      expect(game.dozer.x, 'the dozer is held by the rock').toBeLessThan(mx);
      expect(game.economy.save.open).toBe(false);
      // no chamber burst, no wall hurt or hollow knock, no way out opened, no leaving
      const heard = log.map((e) => e.name);
      for (const name of ['exitOpened', 'chamberOpened', 'knock', 'wallHit', 'wallDown', 'caveLeft', 'done'])
        expect(heard, `${name} told of`).not.toContain(name);
      expect(game.world.solid[game.nav.tileOf(mx, my)]).toBe(1);
    });
  });
});

describe('clearing the cave opens the way out (criterion 2)', () => {
  it('opens at CLEAR_SHARE banked, with exitOpened at the mouth, and not before', () => {
    withSeed(2, () => {
      const { events, named } = told();
      const game = gameIn('hollow', {}, events);
      expect(game.stock.banked()).toBe(0);
      game.step(DT, still);
      expect(game.economy.save.open).toBe(false);
      expect(named('exitOpened')).toHaveLength(0);
      clear(game);
      expect(game.stock.banked()).toBeGreaterThanOrEqual(CLEAR_SHARE);
      expect(game.economy.save.open).toBe(true);
      const opened = named('exitOpened');
      expect(opened).toHaveLength(1);
      const [faces, heading] = opened[0].args as [[number, number][], [number, number]];
      expect(faces.length).toBeGreaterThan(0);
      expect(heading).toHaveLength(2);
      // the faces are where the rock met the floor, and the rock there is gone
      for (const [x, y] of faces) expect(game.world.solid[game.nav.tileOf(x, y)]).toBe(0);
      expect(checkInvariants(game)).toEqual([]);
    });
  });

  it('opens exactly when enough is banked: a hair under CLEAR_SHARE it stays shut, at it it opens', () => {
    withSeed(3, () => {
      const hollow = specOf('hollow');
      const { value } = caveStock(hollow);
      // what is left, all in coins, to come to a share of the cave's worth
      const leftFor = (share: number) => [[Math.round(value * (1 - share)), 0, 0, 0, 0, 0, 0, 0]];
      const under = gameIn('hollow', { left: leftFor(CLEAR_SHARE - 0.02) });
      expect(under.stock.banked()).toBeLessThan(CLEAR_SHARE);
      under.step(DT, still);
      expect(under.economy.save.open, 'a little short').toBe(false);
      const { events, named } = told();
      const over = gameIn('hollow', { left: leftFor(CLEAR_SHARE + 0.01) }, events);
      expect(over.stock.banked()).toBeGreaterThanOrEqual(CLEAR_SHARE);
      over.step(DT, still);
      expect(over.economy.save.open, 'enough').toBe(true);
      for (let f = 0; f < 120; f++) over.step(DT, still);
      expect(named('exitOpened'), 'once, and not again').toHaveLength(1);
    });
  });

  it('stays open across a reload', () => {
    withSeed(4, () => {
      const store = memoryStore();
      const economy = new Economy(store, RUN);
      const game = new Game(economy, caveOf('hollow'));
      clear(game);
      expect(economy.save.open).toBe(true);
      game.persist();
      const again = new Game(new Economy(memoryStore(store.json), RUN), caveOf('hollow'));
      expect(again.economy.save.open).toBe(true);
      const exit = [...again.cave.cells.keys()].filter((t) => again.cave.cells[t] === EXIT);
      for (const t of exit) expect(again.world.solid[t], 'the way out is still open after a reload').toBe(0);
      expect(checkInvariants(again)).toEqual([]);
    });
  });
});

describe('driving through the way out (criterion 3)', () => {
  it('is dark down the way out, and black at the leaving line', () => {
    const cave = caveOf('hollow');
    const [px, py] = pastTheLine(cave);
    expect(pastLeavingLine(cave, px, py)).toBe(true);
    expect(darkness(cave, true, px, py)).toBeCloseTo(1, 5);
    // on the cave's floor, there is no dark
    expect(darkness(cave, true, 0, 0)).toBe(0);
    expect(pastLeavingLine(cave, 0, 0)).toBe(false);
    // the way in is dark at its outer end and light at the floor
    const start = arrival(cave);
    expect(darkness(cave, false, start.x, start.y)).toBeGreaterThan(0.6);
    expect(darkness(cave, false, start.x, start.y)).toBeLessThanOrEqual(0.85);
  });

  it('sends caveLeft and builds the next cave, the dozer at the outer end of its way in, facing in, at its speed', () => {
    withSeed(5, () => {
      const { events, named } = told();
      const game = gameIn('hollow', {}, events);
      clear(game);
      const [px, py] = pastTheLine(game.cave);
      // short of the line: nothing yet
      const [ox, oy] = game.cave.spec.exit!.out;
      Object.assign(game.dozer, { x: px - ox * 12, y: py - oy * 12, yaw: Math.atan2(oy, ox), speed: 9 });
      game.step(DT, still);
      expect(named('caveLeft')).toHaveLength(0);
      expect(game.economy.save.cave).toBe('hollow');
      // past it
      Object.assign(game.dozer, { x: px, y: py, yaw: Math.atan2(oy, ox), speed: 9 });
      game.step(DT, still);
      const left = named('caveLeft');
      expect(left).toHaveLength(1);
      expect(left[0].args[0]).toBe('hollow');
      expect(left[0].args[1]).toBeGreaterThanOrEqual(0);
      expect(game.economy.save.cave).toBe('south-gallery');
      expect(game.economy.save.open).toBe(false);
      // the owner builds the next
      const next = onward(game, game.economy, RUN, events);
      const a = arrival(next.cave);
      expect(next.cave.spec.id).toBe('south-gallery');
      expect(next.dozer.x).toBeCloseTo(a.x, 6);
      expect(next.dozer.y).toBeCloseTo(a.y, 6);
      expect(next.dozer.speed).toBeCloseTo(game.dozer.speed, 6);
      // facing in: against the way out of the cave along its way in
      const [ex, ey] = next.cave.spec.entry.out;
      expect(Math.cos(next.dozer.yaw)).toBeCloseTo(-ex, 6);
      expect(Math.sin(next.dozer.yaw)).toBeCloseTo(-ey, 6);
      expect(next.cave.cells[next.nav.tileOf(next.dozer.x, next.dozer.y)]).toBe(OPEN);
      expect(darkness(next.cave, false, next.dozer.x, next.dozer.y)).toBeGreaterThan(0.6);
      expect(checkInvariants(next)).toEqual([]);
    });
  });

  it('counts what is left in the cave as lost, lit barrels too, and a lit fuse never goes off in the next', () => {
    withSeed(6, () => {
      const { events, named } = told();
      const game = gameIn('hollow', {}, events);
      const barrel = [...Array(game.world.count).keys()].find(
        (i) => game.world.alive[i] && game.world.kind[i] === BARREL_KIND,
      )!;
      game.barrels.light(barrel, 30);
      clear(game);
      const stillThere = game.stock.left.reduce((sum, kinds) => sum + kinds.reduce((n, c) => n + c, 0), 0);
      const [px, py] = pastTheLine(game.cave);
      Object.assign(game.dozer, { x: px, y: py, speed: 0 });
      game.step(DT, still);
      const lost = named('caveLeft')[0].args[1] as number;
      expect(lost).toBeGreaterThan(0);
      expect(stillThere).toBeGreaterThan(0);
      const next = onward(game, game.economy, RUN, events);
      expect(next.barrels.lit).toEqual([]);
      for (let f = 0; f < 120; f++) next.step(DT, still);
      expect(next.barrels.lit).toEqual([]);
    });
  });

  it('is finished once it has left: it does not send caveLeft twice', () => {
    withSeed(7, () => {
      const { events, named } = told();
      const game = gameIn('hollow', {}, events);
      clear(game);
      const [px, py] = pastTheLine(game.cave);
      Object.assign(game.dozer, { x: px, y: py, speed: 0 });
      for (let f = 0; f < 10; f++) game.step(DT, still);
      expect(named('caveLeft')).toHaveLength(1);
      expect(game.economy.save.cave).toBe('south-gallery');
    });
  });

  // each cave's way out is opened as banking enough would (the clearing itself is tried in the Hollow above), so
  // that each cave is its own short test and none is long enough to be hurt by a busy machine
  it.each(RUN.slice(0, -1).map((c, n) => [c.id, n] as const))(
    'works in %s: open the way out, leave it, arrive in the next cave',
    (id, n) => {
      withSeed(10 + n, () => {
        const { events, named } = told();
        const game = gameIn(id, {}, events);
        game.economy.open();
        expect(game.economy.save.open, `${id} opened`).toBe(true);
        expect(named('exitOpened'), `${id} exitOpened`).toHaveLength(1);
        const [px, py] = pastTheLine(game.cave);
        Object.assign(game.dozer, { x: px, y: py, speed: 0 });
        game.step(DT, still);
        expect(named('caveLeft')[0].args[0]).toBe(id);
        const next = onward(game, game.economy, RUN, events);
        expect(next.cave.spec.id, `${id} leads on`).toBe(RUN[n + 1].id);
        expect(checkInvariants(next), `${id} arrival`).toEqual([]);
      });
    },
  );
});

describe('what carries over, and what starts fresh (criterion 4)', () => {
  it('keeps the bank, engine, blade, magnet, drones and cosmetics, and starts the rest of the cave afresh', () => {
    withSeed(8, () => {
      const east = specOf('east-gallery');
      const json = saveIn('south-gallery', {
        bank: 777,
        banked: 5000,
        engine: 3,
        blade: 2,
        magnet: 4,
        drones: 2,
        paint: 'red',
        paints: ['yellow', 'red'],
        body: 'spider',
        bodies: ['dozer', 'spider'],
        horn: true,
        flag: true,
        open: true,
        belts: ['south-belt'],
        secrets: [true],
        walls: [true],
        wallDamage: [40],
        rubble: [1, 2, 0.5, 1],
        lampsBroken: [3, 5],
        barrels: [1, 2, 1.05],
      });
      const { events } = told();
      const economy = newEconomy(json);
      const game = new Game(economy, caveOf('south-gallery'), events);
      const [px, py] = pastTheLine(game.cave);
      Object.assign(game.dozer, { x: px, y: py, speed: 0 });
      game.step(DT, still);
      expect(economy.save.cave).toBe('east-gallery');
      const s = economy.save;
      expect([s.bank, s.banked, s.engine, s.blade, s.magnet, s.drones]).toEqual([777, 5000, 3, 2, 4, 2]);
      expect([s.paint, s.paints, s.body, s.bodies, s.horn, s.flag]).toEqual([
        'red',
        ['yellow', 'red'],
        'spider',
        ['dozer', 'spider'],
        true,
        true,
      ]);
      expect(s.open).toBe(false);
      expect(s.belts).toEqual([]);
      expect(s.secrets).toEqual(east.secrets.map(() => false));
      expect(s.walls).toEqual(east.walls.map(() => false));
      expect(s.wallDamage).toEqual(east.walls.map(() => 0));
      expect(s.rubble).toEqual([]);
      expect(s.lampsBroken).toEqual([]);
      expect(s.barrels).toBeNull();
      expect(s.left).toHaveLength(1 + east.secrets.length + east.stashes.length + east.walls.length);
      expect(s.left.every((row) => row.length === 0)).toBe(true);
      // and the next game is whole: its heaps, its barrels, nothing lost from before
      const next = onward(game, economy, RUN, events);
      expect(next.stock.banked()).toBe(0);
      expect(next.bots).toHaveLength(2);
      expect(checkInvariants(next)).toEqual([]);
    });
  });

  it('puts the drones by the new cave’s first hole, never in the way in', () => {
    withSeed(9, () => {
      const { events } = told();
      const game = gameIn('hollow', { drones: 3, open: true }, events);
      const [px, py] = pastTheLine(game.cave);
      Object.assign(game.dozer, { x: px, y: py });
      game.step(DT, still);
      const next = onward(game, game.economy, RUN, events);
      const hole = next.cave.holes[0];
      for (const b of next.bots) {
        expect(Math.hypot(b.x - hole.x, b.y - hole.y), 'by the hole').toBeLessThan(40);
        expect(next.cave.cells[next.nav.tileOf(b.x, b.y)], 'on the floor').toBe(OPEN);
      }
    });
  });
});

describe('the last cave (criterion 5)', () => {
  it('has no way out: clearing it ends the game, its vein running and its floor cracking', () => {
    withSeed(11, () => {
      const { events, named } = told();
      const last = RUN[RUN.length - 1];
      const game = gameIn(last.id, {}, events);
      expect(game.economy.isLast()).toBe(true);
      clear(game);
      expect(game.economy.save.done).toBe(true);
      expect(game.economy.save.open).toBe(false);
      expect(named('done')).toHaveLength(1);
      expect(named('exitOpened')).toHaveLength(0);
      expect(game.fountains).toHaveLength(1);
      const before = game.world.live;
      for (let f = 0; f < 60 * 12; f++) game.step(DT, still);
      expect(game.world.live, 'the vein has added something to push').toBeGreaterThan(before);
      // nothing to leave by
      game.economy.moveOn();
      expect(game.economy.save.cave).toBe(last.id);
      expect(checkInvariants(game)).toEqual([]);
    });
  });
});

describe('reloading keeps the player’s place (criterion 6)', () => {
  it('mid-cave, with the way out open, and after leaving', () => {
    withSeed(12, () => {
      const store = memoryStore();
      const economy = new Economy(store, RUN);
      const game = new Game(economy, caveOf('hollow'));
      for (let f = 0; f < 120; f++) game.step(DT, { throttle: 1, steer: 0.2 });
      game.persist();
      let again = new Economy(memoryStore(store.json), RUN);
      expect(again.save.cave).toBe('hollow');
      expect(again.save.open).toBe(false);
      clear(game);
      game.persist();
      again = new Economy(memoryStore(store.json), RUN);
      expect(again.save.cave).toBe('hollow');
      expect(again.save.open).toBe(true);
      const [px, py] = pastTheLine(game.cave);
      Object.assign(game.dozer, { x: px, y: py });
      game.step(DT, still);
      const next = onward(game, economy, RUN, {});
      next.persist();
      again = new Economy(memoryStore(store.json), RUN);
      expect(again.save.cave).toBe('south-gallery');
      expect(again.save.open).toBe(false);
      expect(again.save.banked).toBe(economy.save.banked);
      const reloaded = new Game(again, caveOf('south-gallery'));
      expect(checkInvariants(reloaded)).toEqual([]);
    });
  });
});

describe('twenty changes of cave leave nothing bigger than one does (criterion 9, the game’s side)', () => {
  /** A little cave, all there is to a run of twenty-one of them: a room, a hole, a heap, a way in and a way out. */
  const small = (id: string): CaveSpec => ({
    id,
    name: id,
    blurb: 'a room',
    biome: null,
    cols: 56,
    rows: 24,
    shapes: [{ kind: 'ellipse', cx: 28, cy: 12, rx: 14, ry: 8, seed: 1 }],
    holes: [{ x: 0, y: 0, radius: 5.5, depth: 14 }],
    heaps: [{ x: 16, y: 0, coins: 60, gems: [] }],
    vein: { x: 20, y: 8, every: 5, coins: 1, gems: [] },
    cracks: [[20, 8]],
    belts: [],
    entry: { tiles: [2, 10, 18, 13], out: [-1, 0] },
    exit: { tiles: [38, 10, 53, 13], out: [1, 0] },
    secrets: [],
    walls: [],
    stashes: [],
    barrels: 1,
  });

  it('leaves the world, the economy’s listeners and the save no bigger after twenty than after one', () => {
    withSeed(13, () => {
      const run = Array.from({ length: 21 }, (_, k) => small(`cave-${k}`));
      const economy = new Economy(memoryStore(), run);
      let game = new Game(economy, buildCave(run[0]));
      const sizes = () => ({
        bodies: game.world.live,
        slots: game.world.count,
        listeners: economy.listening,
        bots: game.bots.length,
        left: economy.save.left.length,
        saveBytes: JSON.stringify(economy.save).length,
      });
      const seen: ReturnType<typeof sizes>[] = [];
      for (let k = 0; k < 20; k++) {
        clear(game);
        expect(economy.save.open, `cave ${k} opened`).toBe(true);
        const [px, py] = pastTheLine(game.cave);
        Object.assign(game.dozer, { x: px, y: py, speed: 0 });
        game.step(DT, still);
        game = onward(game, economy, run, {});
        game.persist();
        seen.push(sizes());
      }
      expect(economy.save.cave).toBe('cave-20');
      // the save's size is a few digits of where things lie, which is not growth
      const { saveBytes: bytes19, ...last } = seen[19];
      const { saveBytes: bytes0, ...first } = seen[0];
      expect(last, 'after twenty changes, what one change left').toEqual(first);
      expect(bytes19).toBeLessThan(bytes0 * 1.25);
    });
  });

  it('builds the next cave from nothing: a world of its own, with only its own bodies in it', () => {
    withSeed(14, () => {
      const { events } = told();
      const game = gameIn('hollow', { open: true, drones: 1 }, events);
      const [px, py] = pastTheLine(game.cave);
      Object.assign(game.dozer, { x: px, y: py });
      game.step(DT, still);
      const next = onward(game, game.economy, RUN, events);
      expect(next.world).not.toBe(game.world);
      expect(next.stock).not.toBe(game.stock);
      for (let i = 0; i < next.world.count; i++)
        if (next.world.alive[i])
          expect(
            next.stock.origin[i] === NO_SOURCE || next.stock.origin[i] < next.economy.sources.count,
            `body ${i} from a source the cave has`,
          ).toBe(true);
    });
  });
});
