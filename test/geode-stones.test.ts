/**
 * The geode: a boulder worth nothing whole, cracked open by a barrel's blast into the gems it held, which are a
 * bonus over and above the cave. ('geode' is also a biome, tested in `geode.test.ts`; this is the body.)
 *
 * Each of the plan's acceptance criteria is a test here, and the edge cases of the checklist after them.
 */
import { describe, expect, it } from 'vitest';
import { BLAST_RADIUS, Barrels } from '../src/barrels';
import { OPEN, ROCK, TILE, buildCave, nearCutting, type CaveSpec, type GemKind } from '../src/cave';
import { CRACK_RADIUS, cracked, scatter } from '../src/geode-stones';
import { CLEAR_SHARE, Economy, caveStock, memoryStore, sourcesOf } from '../src/economy';
import { Game, type GameEvents } from '../src/game';
import { checkInvariants } from '../src/invariants';
import { BARREL_KIND, GEODE_KIND, KINDS, KIND_RADIUS, KIND_VALUE, makeWorld } from '../src/physics';
import { NO_SOURCE, Stock, capacityOf } from '../src/stock';
import { beltOf } from '../src/tools';
import {
  IDS,
  RUN,
  TEST_BODIES,
  caveOf,
  floodIn,
  gameIn,
  saveIn,
  specOf,
  tileIn,
  withSeed,
  leavingRow,
} from './helpers';

const DT = 1 / 60;
const STILL = { throttle: 0, steer: 0 };
const R = KIND_RADIUS[GEODE_KIND];
/** Open floor in the Hollow, clear of its heaps and its hole, and a wall's length from any rock. */
const AT = { x: -10, y: -26 };
const world = () => {
  const cave = caveOf('hollow');
  return makeWorld(TEST_BODIES, cave.solid(true), cave.grid, cave.holes);
};
const slotsOf = (game: Game, kind: number) =>
  [...Array(game.world.count).keys()].filter((i) => game.world.alive[i] && game.world.kind[i] === kind);
/** The gems of every kind in a game that came from the geodes. */
const geodeGems = (game: Game) => {
  const from = sourcesOf(game.cave.spec).geodes();
  return [1, 2, 3, 4, 5].flatMap((k) => slotsOf(game, k)).filter((i) => game.stock.origin[i] === from);
};
/** What a geode of the cave holds, in all, and what that is worth. */
const heldBy = (spec: CaveSpec) => (spec.geodes?.holds ?? []).reduce((n, [, m]) => n + m, 0);
const worth = (spec: CaveSpec) => (spec.geodes?.holds ?? []).reduce((v, [k, m]) => v + KIND_VALUE[k] * m, 0);
/** A game on `id` with nothing in the cave to get in the way: no barrels, no geodes. */
function emptyGame(id: string, patch = {}, events: GameEvents = {}) {
  const game = gameIn(id, patch, events);
  for (const i of slotsOf(game, BARREL_KIND)) game.stock.removeBarrel(i);
  for (const i of slotsOf(game, GEODE_KIND)) game.stock.removeGeode(i);
  return game;
}
const run = (game: Game, frames: number) => {
  for (let f = 0; f < frames; f++) game.step(DT, STILL);
};

describe('the geode, as a body', () => {
  it('is kind 8, worth nothing, and bigger than a barrel', () => {
    expect(GEODE_KIND).toBe(8);
    expect(KINDS).toBe(9);
    expect(KIND_VALUE[GEODE_KIND]).toBe(0);
    expect(R).toBeGreaterThan(KIND_RADIUS[BARREL_KIND]);
  });
});

describe('cracking (criterion 1: a blast inside the radius cracks, one outside does not)', () => {
  it('names the geodes a blast reaches and no others', () => {
    const w = world();
    const near = w.spawn(GEODE_KIND, -30 + CRACK_RADIUS - 1, 10, R);
    const far = w.spawn(GEODE_KIND, -30 + CRACK_RADIUS + 1, 10, R);
    const coin = w.spawn(0, -30 + 1, 10, 0.42);
    const gone = w.spawn(GEODE_KIND, -30 + 2, 10, R);
    w.remove(gone);
    const held = w.spawn(GEODE_KIND, -30, 12, R);
    w.carried[held] = 1;
    const hit = cracked({ x: -30, y: 10, z: 1 }, w);
    expect(hit).toEqual([near]);
    expect(hit).not.toContain(far);
    expect(hit).not.toContain(coin);
    expect(CRACK_RADIUS).toBeLessThan(BLAST_RADIUS);
  });

  it('cracks in a game: the barrel goes off, the geode is gone, and its gems lie about where it stood', () => {
    withSeed(11, () => {
      const cracks: [number, number, number][] = [];
      const game = emptyGame('hollow', {}, { geodeCracked: (x, y, n) => cracks.push([x, y, n]) });
      const g = game.stock.spawnGeode(AT.x, AT.y);
      const b = game.stock.spawnBarrel(AT.x + 4, AT.y);
      expect(g).toBeGreaterThanOrEqual(0);
      game.barrels.light(b, 0.05);
      run(game, 20);
      expect(slotsOf(game, GEODE_KIND)).toEqual([]);
      expect(game.stock.kinds[GEODE_KIND]).toBe(0);
      expect(cracks).toHaveLength(1);
      expect(cracks[0][2]).toBe(heldBy(game.cave.spec));
      expect(geodeGems(game)).toHaveLength(heldBy(game.cave.spec));
      expect(checkInvariants(game)).toEqual([]);
    });
  });

  it('leaves a geode a blast did not reach whole, though it throws it', () => {
    withSeed(12, () => {
      const game = emptyGame('hollow');
      const g = game.stock.spawnGeode(AT.x + CRACK_RADIUS + 2, AT.y);
      const b = game.stock.spawnBarrel(AT.x, AT.y);
      game.barrels.light(b, 0.05);
      run(game, 20);
      expect(game.world.alive[g]).toBe(1);
      expect(game.stock.kinds[GEODE_KIND]).toBe(1);
    });
  });
});

describe('what the gems are (criterion 2: they pay, and are over and above the cave)', () => {
  it('are banked for their worth and leave the share of the cave banked where it was', () => {
    withSeed(13, () => {
      const game = emptyGame('hollow');
      const sources = sourcesOf(game.cave.spec);
      const hole = game.cave.holes[0];
      const before = { bank: game.economy.bank, share: game.stock.banked(), lying: game.stock.lying() };
      game.stock.spawnGeode(AT.x, AT.y);
      expect(game.crackGeodes({ x: AT.x, y: AT.y, z: 1 })).toBe(1);
      expect(game.stock.lying(sources.geodes())).toBe(worth(game.cave.spec));
      // the gems, put in the hole one at a time
      for (const i of geodeGems(game)) {
        game.world.x[i] = hole.x;
        game.world.y[i] = hole.y;
        game.world.z[i] = 0.4;
        game.world.vx[i] = game.world.vy[i] = game.world.vz[i] = 0;
        game.world.wake(i);
      }
      run(game, 240);
      expect(game.economy.bank - before.bank).toBe(worth(game.cave.spec));
      expect(game.stock.lying(sources.geodes())).toBe(0);
      expect(game.stock.banked(), 'the cave is no nearer cleared').toBe(before.share);
      expect(game.stock.lying()).toBe(before.lying);
      expect(game.stock.banked()).toBeLessThan(CLEAR_SHARE);
      expect(checkInvariants(game)).toEqual([]);
    });
  });
});

describe('a chain of barrels (criterion 3)', () => {
  it('cracks every geode the blasts reach, each barrel’s own', () => {
    withSeed(14, () => {
      let blasts = 0;
      const game = emptyGame('hollow', {}, { blast: () => blasts++ });
      // three barrels ten apart, each lit by the one before; every geode is in reach of one barrel only
      const [a, b, c] = [-34, -24, -14].map((x) => game.stock.spawnBarrel(x, 24));
      const geodes = [
        [-41, 24],
        [-24, 18],
        [-7, 24],
      ].map(([x, y]) => game.stock.spawnGeode(x, y));
      expect([a, b, c, ...geodes].every((i) => i >= 0)).toBe(true);
      game.barrels.light(a, 0.05);
      run(game, 300);
      expect(blasts).toBe(3);
      expect(slotsOf(game, BARREL_KIND)).toEqual([]);
      expect(slotsOf(game, GEODE_KIND)).toEqual([]);
      expect(geodeGems(game)).toHaveLength(3 * heldBy(game.cave.spec));
      expect(checkInvariants(game)).toEqual([]);
    });
  });
});

describe('down the hole whole (criterion 4)', () => {
  it('banks nothing, owes nothing, and is gone from the counts', () => {
    withSeed(15, () => {
      const game = emptyGame('hollow');
      const hole = game.cave.holes[0];
      const bank = game.economy.bank,
        lying = game.stock.lyingAll(),
        left = JSON.stringify(game.stock.left);
      const g = game.stock.spawnGeode(hole.x + 1, hole.y);
      run(game, 360);
      expect(game.world.alive[g]).toBe(0);
      expect(game.stock.kinds[GEODE_KIND]).toBe(0);
      expect(game.economy.bank).toBe(bank);
      expect(game.stock.lyingAll()).toBe(lying);
      expect(JSON.stringify(game.stock.left)).toBe(left);
      expect(checkInvariants(game)).toEqual([]);
    });
  });
});

describe('the stock of geodes', () => {
  const cave = caveOf('hollow');
  const mk = () => {
    const w = world();
    return { w, stock: new Stock(cave, w, capacityOf(cave.spec).kinds, cave.barrels) };
  };

  it('counts one in the world from no source, takes it out again, and records where each stands', () => {
    const { w, stock } = mk();
    const a = stock.spawnGeode(-30, 10);
    const b = stock.spawnGeode(-50, 20, 1.7);
    expect(stock.origin[a]).toBe(NO_SOURCE);
    expect(stock.kinds[GEODE_KIND]).toBe(2);
    expect(stock.geodeRecord()).toEqual([-30, 10, +(R + 0.05).toFixed(2), -50, 20, 1.7]);
    stock.removeGeode(a);
    stock.removeGeode(a);
    expect(w.alive[a]).toBe(0);
    expect(stock.kinds[GEODE_KIND]).toBe(1);
    expect(stock.geodeRecord()).toEqual([-50, 20, 1.7]);
    expect(stock.collect(GEODE_KIND, b)).toBe(0);
    expect(stock.lying()).toBe(0);
  });

  it('refuses more than it has room to draw', () => {
    const { stock } = mk();
    const room = capacityOf(cave.spec).kinds[GEODE_KIND];
    expect(room).toBeGreaterThanOrEqual(cave.spec.geodes!.count);
    const made = Array.from({ length: room + 1 }, (_, k) => stock.spawnGeode(-60 + k * 4, -30));
    expect(made.slice(0, room).every((i) => i >= 0)).toBe(true);
    expect(made[room]).toBe(-1);
  });

  it('has room for every gem every geode holds, over what the cave’s own content needs', () => {
    for (const spec of RUN) {
      const bare = capacityOf({ ...spec, geodes: undefined });
      const cap = capacityOf(spec);
      const held = new Array<number>(6).fill(0);
      for (const [kind, n] of spec.geodes?.holds ?? []) held[kind] += n * spec.geodes!.count;
      for (let kind = 1; kind <= 5; kind++)
        expect(cap.kinds[kind] - bare.kinds[kind], `${spec.id} kind ${kind}`).toBe(held[kind]);
    }
  });

  it('has a source of its own, last, for a cave with geodes, and none for one without', () => {
    for (const spec of RUN) {
      const s = sourcesOf(spec);
      const without = sourcesOf({ ...spec, geodes: undefined });
      expect(without.count).toBe(1 + spec.secrets.length + spec.stashes.length + spec.walls.length);
      expect(s.count).toBe(without.count + (spec.geodes ? 1 : 0));
      expect(s.geodes()).toBe(spec.geodes ? s.count - 1 : -1);
      // nothing already numbered moves
      if (spec.walls.length) expect(s.wall(spec.walls.length - 1)).toBe(without.wall(spec.walls.length - 1));
    }
  });
});

describe('saved and reloaded (criterion 5)', () => {
  it('puts whole geodes back where they lay and the gems of a cracked one back by count', () => {
    withSeed(16, () => {
      const game = gameIn('hollow');
      const spec = game.cave.spec;
      const sources = sourcesOf(spec);
      const whole = slotsOf(game, GEODE_KIND);
      expect(whole).toHaveLength(spec.geodes!.count);
      // push the first geode a little off its spot, and crack another that was set down
      game.world.x[whole[0]] += 0.5;
      game.stock.spawnGeode(AT.x, AT.y);
      expect(game.crackGeodes({ x: AT.x, y: AT.y, z: 1 })).toBe(1);
      game.persist();
      const json = JSON.stringify(game.economy.save);
      const lying = game.stock.left[sources.geodes()].slice();
      expect(lying.reduce((a, b) => a + b, 0)).toBe(heldBy(spec));
      const saved = game.economy.save.geodes!;
      expect(saved).toHaveLength(whole.length * 3);
      const again = new Game(new Economy(memoryStore(json), RUN), caveOf('hollow'));
      const back = slotsOf(again, GEODE_KIND).map((i) => [again.world.x[i], again.world.y[i]]);
      expect(back).toHaveLength(whole.length);
      back.forEach(([x, y], k) => {
        expect(Math.abs(x - saved[k * 3])).toBeLessThan(0.3);
        expect(Math.abs(y - saved[k * 3 + 1])).toBeLessThan(0.3);
      });
      expect(again.stock.left[sources.geodes()], 'the gems by count').toEqual(lying);
      expect(geodeGems(again)).toHaveLength(heldBy(spec));
      expect(checkInvariants(again)).toEqual([]);
    });
  });

  it('stands a cave just begun’s geodes where they start, and none for a save that has none left', () => {
    withSeed(17, () => {
      const fresh = gameIn('hollow');
      expect(slotsOf(fresh, GEODE_KIND)).toHaveLength(fresh.cave.geodes.length);
      expect(fresh.cave.geodes.length).toBeGreaterThan(0);
      const none = gameIn('hollow', { geodes: [] });
      expect(slotsOf(none, GEODE_KIND)).toEqual([]);
      expect(none.stock.left[sourcesOf(none.cave.spec).geodes()].every((n) => n === 0)).toBe(true);
    });
  });
});

describe('a save one source short keeps its progress (criterion 6)', () => {
  it('appends the geodes’ empty row to a save from before there was one, and keeps the rest', () => {
    for (const id of ['west-gallery', 'warrens', 'deep']) {
      const spec = specOf(id);
      const s = sourcesOf(spec);
      const left = Array.from({ length: s.count - 1 }, (_, k) => [100 + k, 0, 5, 0, 0, 0, 0, 0]);
      const economy = new Economy(memoryStore(saveIn(id, { left })), RUN);
      expect(economy.save.left, id).toHaveLength(s.count);
      expect(economy.save.left.slice(0, -1), id).toEqual(left);
      expect(economy.save.left[s.geodes()], id).toEqual([]);
    }
  });
});

describe('what is in the cave when it is built (criterion 7)', () => {
  it.each(IDS)('%s: its geodes are all placed, on floor joined to a hole, and clear of everything', (id) => {
    const cave = caveOf(id);
    const spec = cave.spec;
    expect(cave.geodes, 'every geode placed').toHaveLength(spec.geodes?.count ?? 0);
    expect(cave.geodes.length).toBeGreaterThan(0);
    expect(cave.geodes.length).toBeLessThanOrEqual(cave.barrels.length);
    expect(spec.barrels).toBeGreaterThanOrEqual(spec.geodes?.count ?? 0);
    const joined = new Set<number>();
    for (const h of spec.holes)
      for (const j of floodIn(cave, tileIn(cave, h.x, h.y), (u) => cave.cells[u] === OPEN)) joined.add(j);
    const { cols } = cave.grid;
    cave.geodes.forEach((g, n) => {
      const t = tileIn(cave, g.x, g.y);
      expect(joined.has(t), `geode ${n} on floor joined to a hole`).toBe(true);
      // floor all round it, so it is never against rock
      for (const o of [-cols - 1, -cols, -cols + 1, -1, 0, 1, cols - 1, cols, cols + 1])
        expect(cave.cells[t + o], `geode ${n} has rock beside it`).toBe(OPEN);
      for (const h of spec.holes) expect(Math.hypot(h.x - g.x, h.y - g.y)).toBeGreaterThan(h.radius + 6);
      for (const h of spec.heaps)
        expect(Math.hypot(h.x - g.x, h.y - g.y)).toBeGreaterThan(Math.sqrt(h.coins) * 0.36 + 4);
      for (const l of cave.lamps) expect(Math.hypot(l.x - g.x, l.y - g.y)).toBeGreaterThan(4);
      for (const b of cave.barrels) expect(Math.hypot(b.x - g.x, b.y - g.y), 'not on a barrel').toBeGreaterThan(R + 4);
      expect(nearCutting(cave.grid, spec, g.x, g.y, 2)).toBe(false);
      for (const { spec: b } of spec.belts) {
        const dx = b.x1 - b.x0,
          dy = b.y1 - b.y0;
        const k = Math.max(0, Math.min(1, ((g.x - b.x0) * dx + (g.y - b.y0) * dy) / (dx * dx + dy * dy)));
        expect(Math.hypot(g.x - (b.x0 + dx * k), g.y - (b.y0 + dy * k))).toBeGreaterThan(b.width / 2 + 2);
      }
      cave.geodes.slice(0, n).forEach((o) => {
        expect(Math.hypot(o.x - g.x, o.y - g.y), 'apart from each other').toBeGreaterThan(3 * R);
      });
    });
  });

  it('is the same every time, and does not move the barrels', () => {
    for (const spec of RUN) {
      const a = buildCave(spec),
        b = buildCave({ ...spec, geodes: undefined });
      expect(a.geodes).toEqual(buildCave(spec).geodes);
      expect(a.barrels, `${spec.id}: barrels as they were without geodes`).toEqual(b.barrels);
      expect(b.geodes).toEqual([]);
    }
  });

  it('stands clear of the currents and drains each cave really has', () => {
    const R = KIND_RADIUS[GEODE_KIND];
    let currents = 0;
    for (const spec of RUN) {
      const cave = buildCave(spec);
      for (const g of cave.geodes) {
        for (const c of cave.currents) {
          currents++;
          // how far the geode is from the current's middle line, between its two ends
          const dx = c.x1 - c.x0,
            dy = c.y1 - c.y0;
          const k = Math.max(0, Math.min(1, ((g.x - c.x0) * dx + (g.y - c.y0) * dy) / (dx * dx + dy * dy)));
          const d = Math.hypot(g.x - (c.x0 + dx * k), g.y - (c.y0 + dy * k));
          expect(d, `${spec.id}: a geode at ${g.x},${g.y} in ${c.id}`).toBeGreaterThan(c.width / 2 + R);
        }
        for (const d of cave.drains)
          expect(Math.hypot(g.x - d.x, g.y - d.y), `${spec.id}: a geode over a drain`).toBeGreaterThan(d.radius + R);
      }
    }
    // doing nothing is a failure: every cave has a current, so every geode was held to one
    expect(currents).toBeGreaterThanOrEqual(RUN.reduce((n, s) => n + (s.geodes?.count ?? 0), 0));
  });

  it('keeps clear of a current, by its width and a margin, wherever one is laid', () => {
    for (const spec of RUN) {
      const g = buildCave(spec).geodes[0];
      // a current laid straight through the first geode’s place
      const current = {
        id: 'test',
        flow: 'water' as const,
        x0: g.x - 30,
        y0: g.y,
        x1: g.x + 30,
        y1: g.y,
        width: 6,
        speed: 4,
      };
      const cave = buildCave({ ...spec, currents: [current] });
      expect(cave.geodes, `${spec.id}: still all placed`).toHaveLength(spec.geodes!.count);
      for (const o of cave.geodes) {
        const k = Math.max(0, Math.min(1, (o.x - current.x0) / (current.x1 - current.x0)));
        const d = Math.hypot(o.x - (current.x0 + (current.x1 - current.x0) * k), o.y - current.y0);
        expect(d, `${spec.id}: a geode at ${o.x},${o.y} in the current`).toBeGreaterThan(current.width / 2 + R);
      }
      // and one that ends in a drain keeps clear of the drain, too
      const drain = { ...current, id: 'drain', y0: g.y + 1, y1: g.y + 1, drain: { radius: 5, depth: 3 } };
      for (const o of buildCave({ ...spec, currents: [drain] }).geodes)
        expect(Math.hypot(o.x - drain.x1, o.y - drain.y1)).toBeGreaterThan(drain.drain.radius + R);
    }
  });

  it('holds about a twentieth of its cave in each geode, for every cave', () => {
    for (const spec of RUN) {
      const share = worth(spec) / caveStock(spec).value;
      expect(share, spec.id).toBeGreaterThan(0.035);
      expect(share, spec.id).toBeLessThan(0.065);
    }
  });
});

describe('edge cases', () => {
  it('leaves whole geodes behind with the cave: never lost, none carried over', () => {
    withSeed(18, () => {
      const game = gameIn('hollow');
      expect(game.stock.lyingAll(), 'a whole geode is nothing to lose').toBe(caveStock(game.cave.spec).value);
      game.economy.open();
      game.economy.moveOn(leavingRow(game.economy));
      expect(game.economy.save.geodes).toBeNull();
      const next = new Game(game.economy, caveOf(game.economy.cave().id));
      expect(next.stock.kinds[GEODE_KIND]).toBe(next.cave.geodes.length);
      expect(next.stock.left[sourcesOf(next.cave.spec).geodes()].every((n) => n === 0)).toBe(true);
    });
  });

  it('is not lit or cracked by anyone’s machine pushing it: only a barrel’s blast does that', () => {
    const w = world();
    const g = w.spawn(GEODE_KIND, -30, 10, R);
    const barrels = new Barrels(w);
    const box = (owner: number) => ({
      x: -30 - R - 0.3,
      y: 10,
      z: 1.2,
      yaw: 0,
      hx: 0.4,
      hy: 3,
      hz: 1.2,
      vx: 0,
      vy: 0,
      spin: 0,
      px: -30 - R - 0.3,
      py: 10,
      owner,
    });
    expect(barrels.hitBy([box(0)], 0)).toEqual([]);
    expect(barrels.hitBy([box(1)], 0)).toEqual([]);
    expect(barrels.light(g)).toBe(false);
    expect(w.alive[g]).toBe(1);
  });

  it('is not worked by the drones: it comes from no source', () => {
    const game = emptyGame('hollow');
    const g = game.stock.spawnGeode(AT.x, AT.y);
    expect(game.stock.origin[g]).toBe(NO_SOURCE);
  });

  it('is carried by a running belt, like anything else on it', () => {
    const cave = caveOf('south-gallery');
    const w = makeWorld(TEST_BODIES, cave.solid(true), cave.grid, cave.holes);
    const { spec: belt } = cave.spec.belts[0];
    w.belts = [beltOf(belt)];
    const mx = (belt.x0 + belt.x1) / 2,
      my = (belt.y0 + belt.y1) / 2;
    const g = w.spawn(GEODE_KIND, mx, my, R);
    for (let f = 0; f < 120; f++) w.step(DT, () => {});
    expect(Math.hypot(w.x[g] - mx, w.y[g] - my)).toBeGreaterThan(1);
  });

  it('hops to the horn, is let be by the magnet, and the rules still hold', () => {
    withSeed(19, () => {
      const game = emptyGame('hollow', { horn: true, magnet: 3 });
      Object.assign(game.dozer, { x: AT.x - 6, y: AT.y, yaw: 0 });
      const g = game.stock.spawnGeode(AT.x, AT.y);
      game.honk();
      expect(game.world.vz[g]).toBeGreaterThan(0);
      run(game, 120);
      expect(game.world.alive[g]).toBe(1);
      expect(checkInvariants(game)).toEqual([]);
    });
  });

  it('cracks against rock, and throws nothing into it', () => {
    withSeed(20, () => {
      const game = emptyGame('south-gallery');
      const { cave } = game;
      // an open tile with rock to its east and open floor to its west, away from every hole
      const { cols, rows } = cave.grid;
      let spot: [number, number] | null = null;
      for (let t = cols * 3; t < cols * (rows - 3) && !spot; t++) {
        const ok = [-3, -2, -1, 0].every((o) => cave.cells[t + o] === OPEN) && cave.cells[t + 1] === ROCK;
        if (!ok) continue;
        const x = cave.grid.originX + ((t % cols) + 0.5) * TILE,
          y = cave.grid.originY + (Math.floor(t / cols) + 0.5) * TILE;
        if (cave.holes.every((h) => Math.hypot(h.x - x, h.y - y) > h.radius + 8)) spot = [x, y];
      }
      expect(spot, 'a wall to stand against').not.toBeNull();
      const [x, y] = spot!;
      game.stock.spawnGeode(x + 0.3, y);
      const b = game.stock.spawnBarrel(x - 6, y);
      game.barrels.light(b, 0.05);
      run(game, 240);
      expect(slotsOf(game, GEODE_KIND)).toEqual([]);
      expect(geodeGems(game)).toHaveLength(heldBy(game.cave.spec));
      expect(checkInvariants(game)).toEqual([]);
    });
  });
});

describe('every geode cracked at once, at capacity', () => {
  it.each(IDS)('%s: all of them, spare ones too, break no rule', (id) => {
    withSeed(21, () => {
      // in the last cave the vein is running, too
      const game = emptyGame(id, id === IDS[IDS.length - 1] ? { done: true } : {});
      const spot = buildCave(game.cave.spec).geodes[0];
      const room = capacityOf(game.cave.spec).kinds[GEODE_KIND];
      // one on each tile of the 3 by 3 of floor round the first geode's place, the middle first: all within a blast's reach
      const around = [0, 1, 3, 5, 7, 2, 4, 6, 8].map((n) => [(n % 3) - 1, Math.floor(n / 3) - 1]);
      expect(room).toBeLessThanOrEqual(around.length);
      for (const [dx, dy] of around.slice(0, room)) game.stock.spawnGeode(spot.x + dx * TILE, spot.y + dy * TILE);
      expect(game.stock.kinds[GEODE_KIND]).toBe(room);
      expect(game.stock.spawnGeode(spot.x, spot.y)).toBe(-1);
      expect(game.crackGeodes({ x: spot.x, y: spot.y, z: 1 })).toBe(room);
      expect(game.stock.kinds[GEODE_KIND]).toBe(0);
      run(game, 120);
      expect(checkInvariants(game)).toEqual([]);
      const cap = capacityOf(game.cave.spec).kinds;
      game.stock.kinds.forEach((n, k) => expect(n, `${id} kind ${k}`).toBeLessThanOrEqual(cap[k] || Infinity));
    });
  });
});

describe('where the gems go (scatter)', () => {
  it('throws each gem out and up from the geode, the same way for the same geode, no two on the same spot', () => {
    const holds: [GemKind, number][] = [
      [1, 3],
      [3, 2],
      [4, 1],
    ];
    const a = scatter(holds, 10, 20, R, 5);
    expect(a).toHaveLength(6);
    expect(scatter(holds, 10, 20, R, 5)).toEqual(a);
    expect(a.map((p) => p.kind).sort()).toEqual([1, 1, 1, 3, 3, 4]);
    for (const p of a) {
      expect(Math.hypot(p.x - 10, p.y - 20)).toBeLessThan(R);
      expect(p.vz).toBeGreaterThan(0);
      expect(Math.hypot(p.vx, p.vy)).toBeGreaterThan(1);
    }
    expect(new Set(a.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`)).size).toBe(6);
  });
});
