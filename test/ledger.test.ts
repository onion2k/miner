/**
 * The ledger: what each cave held, what was brought out, paid in toll, lost down drains and left behind, which
 * finds were found, and three marks a cave. These are the plan's acceptance criteria for stage 2, and its edge
 * cases. Nothing here, nor in the ledger, counts time.
 */
import { describe, expect, it } from 'vitest';
import { Economy, caveStock, memoryStore, tollOf } from '../src/economy';
import { Game } from '../src/game';
import { checkInvariants } from '../src/invariants';
import { cardOf, held, heldBy, ledgerOf, rowOf, runHeld, runLine, type Row } from '../src/ledger';
import { GEODE_KIND, KIND_VALUE } from '../src/physics';
import { tileCentre, type Cave } from '../src/cave';
import { RUN, caveOf, gameIn, newEconomy, saveIn, specOf, withSeed } from './helpers';
import { told } from './current-helpers';

const DT = 1 / 60;
const still = { throttle: 0, steer: 0 };

const worth = (coins: number, gems: [number, number][]) => coins + gems.reduce((n, [k, m]) => n + m * KIND_VALUE[k], 0);

// ---- moving things about, as the other tests do ----

/** Put a body at a point, still and woken. */
function put(game: Game, i: number, x: number, y: number, z = 2) {
  const { world } = game;
  world.x[i] = x;
  world.y[i] = y;
  world.z[i] = z;
  world.vx[i] = world.vy[i] = world.vz[i] = 0;
  world.wake(i);
}

/** The slots of the bodies from a source, of a kind (any, if not said). */
function slotsOf(game: Game, from: number, kind?: number): number[] {
  const { world, stock } = game;
  const out: number[] = [];
  for (let i = 0; i < world.count; i++)
    if (world.alive[i] && stock.origin[i] === from && (kind === undefined ? world.kind[i] < 6 : world.kind[i] === kind))
      out.push(i);
  return out;
}

/** `n` of the bodies of a source (of any kind worth something) put at the hole, and stepped until they are banked. */
function bank(game: Game, from: number, n = Infinity) {
  const hole = game.cave.holes[0];
  const slots = slotsOf(game, from).slice(0, n);
  const before = game.economy.save.banked;
  // a few at a time, so that they fall in and do not pile up on the rim
  for (let b = 0; b < slots.length; b += 150) {
    const batch = slots.slice(b, b + 150);
    batch.forEach((i, k) =>
      put(
        game,
        i,
        hole.x + Math.cos(k * 2.399) * (0.4 + (k % 7) * 0.25),
        hole.y + Math.sin(k * 2.399) * (0.4 + (k % 7) * 0.25),
        2 + (k % 5) * 0.1,
      ),
    );
    for (let f = 0; f < 900 && batch.some((i) => game.world.alive[i] && game.stock.origin[i] === from); f++)
      game.step(DT, still);
  }
  expect(game.economy.save.banked, 'something was banked').toBeGreaterThan(before - (slots.length ? 1 : 0));
}

/** Coins of the heaps sent to a drain of the cave, and stepped until they have gone down it. Returns what was lost. */
function drain(game: Game, n: number): number {
  const d = game.cave.drains[0];
  const before = game.economy.save.drained;
  const slots = slotsOf(game, 0, 0).slice(0, n);
  slots.forEach((i, k) => put(game, i, d.x + Math.cos(k * 2.399) * 0.4, d.y + Math.sin(k * 2.399) * 0.4, 2 + k * 0.1));
  for (
    let f = 0;
    f < 600 &&
    slots.some(
      (i) =>
        game.world.alive[i] &&
        game.stock.origin[i] === 0 &&
        game.world.kind[i] === 0 &&
        Math.hypot(game.world.x[i] - d.x, game.world.y[i] - d.y) < 3,
    );
    f++
  )
    game.step(DT, still);
  return game.economy.save.drained - before;
}

/** The nth geode standing whole. */
function aGeode(game: Game, nth = 0): number {
  const slots = slotsOf(game, 255, GEODE_KIND);
  if (nth >= slots.length) throw new Error('no geode standing');
  return slots[nth];
}

/** Crack the nth geode standing, as a blast on it would. */
function crack(game: Game, nth = 0) {
  const i = aGeode(game, nth);
  const { world } = game;
  expect(game.crackGeodes({ x: world.x[i], y: world.y[i], z: world.z[i] }), 'a geode cracked').toBeGreaterThan(0);
}

/** A point a little past a way out's leaving line, for driving out. */
function pastTheLine(cave: Cave): [number, number] {
  const exit = cave.spec.exit!;
  const [x0, y0, x1, y1] = exit.tiles;
  const [ox, oy] = exit.out;
  const outer = tileCentre(
    cave.grid,
    ox < 0 ? x0 : ox > 0 ? x1 : (x0 + x1) / 2,
    oy < 0 ? y0 : oy > 0 ? y1 : (y0 + y1) / 2,
  );
  return [outer[0] - ox * 8, outer[1] - oy * 8];
}

/** Drive out through the way out, which is open, and say what the game told of the row. */
function leave(game: Game): Row {
  const [px, py] = pastTheLine(game.cave);
  Object.assign(game.dozer, { x: px, y: py, speed: 0 });
  game.step(DT, still);
  expect(game.left, 'the cave was left').toBe(true);
  return game.economy.save.ledger[game.economy.save.ledger.length - 1];
}

/** What the cave still holds of what has not been brought out: what lies, and what is yet to be spawned. */
function expectedLeft(game: Game): number {
  const spec = game.cave.spec;
  const { save } = game.economy;
  const unopened = spec.secrets.reduce((n, s, k) => n + (save.secrets[k] ? 0 : worth(s.loot.coins, s.loot.gems)), 0);
  const standing = spec.walls.reduce((n, w, k) => n + (save.walls[k] ? 0 : worth(0, w.treasure)), 0);
  const whole = game.stock.kinds[GEODE_KIND] * worth(0, spec.geodes?.holds ?? []);
  return game.stock.lyingAll() + unopened + standing + whole;
}

describe('what a cave holds (criterion 6)', () => {
  it('sums to 68,850 over the run: 36,310 in heaps and 32,540 in finds', () => {
    const by = RUN.map(heldBy);
    const sum = (key: 'heaps' | 'chambers' | 'sideRooms' | 'walls' | 'geodes') => by.reduce((n, b) => n + b[key], 0);
    expect(sum('heaps')).toBe(36_310);
    expect(sum('chambers')).toBe(10_260);
    expect(sum('sideRooms')).toBe(14_360);
    expect(sum('walls')).toBe(2_755);
    expect(sum('geodes')).toBe(5_165);
    expect(RUN.reduce((n, s) => n + held(s), 0)).toBe(68_850);
    expect(runHeld(RUN)).toBe(68_850);
  });

  it('is every source of the cave and nothing else: heaps, chambers, side rooms, walls and geodes', () => {
    for (const spec of RUN) {
      const b = heldBy(spec);
      expect(b.heaps, `${spec.id} heaps`).toBe(caveStock(spec).value);
      expect(held(spec), spec.id).toBe(b.heaps + b.chambers + b.sideRooms + b.walls + b.geodes);
    }
    // the South Gallery, worked by hand: 3,020 of heaps, a chamber of 960, a side room of 1,400, 75 in a wall, 2 geodes of 150
    expect(held(specOf('south-gallery'))).toBe(3020 + 960 + 1400 + 75 + 300);
  });
});

describe('a row’s parts add up (criterion 1)', () => {
  it('is held, taken, drained and left, from a cave where things were banked, drained and left in every way', () => {
    withSeed(21, () => {
      const game = gameIn('south-gallery', { toll: 0 });
      const spec = game.cave.spec;
      const before = rowOf(game);
      expect(before).toMatchObject({ cave: 'south-gallery', held: held(spec), taken: 0, toll: 0, drained: 0 });
      expect(before.left, 'nothing brought out: all of it is left').toBe(held(spec));
      // some of the heaps banked
      bank(game, 0, 300);
      // the chamber broken into, and some of its loot banked
      game.economy.reveal(0);
      bank(game, game.economy.sources.chamber(0), 40);
      // some of the heaps down a drain
      const lost = drain(game, 20);
      expect(lost, 'coins were lost down the drain').toBeGreaterThan(0);
      // a geode cracked, and one left whole
      crack(game, 0);
      const row = rowOf(game);
      expect(row.taken, 'what was banked, every source, toll included').toBe(game.economy.save.banked);
      expect(row.taken).toBeGreaterThan(300);
      expect(row.toll, 'the toll paid').toBe(game.economy.save.toll);
      expect(row.drained).toBe(lost);
      expect(row.taken + row.drained + row.left, 'the parts add up').toBe(row.held);
      expect(row.left).toBeGreaterThan(0);
      expect(checkInvariants(game)).toEqual([]);
    });
  });

  it('adds up in the first cave, a middle one and the last, at the start and after a little play', () => {
    withSeed(22, () => {
      for (const spec of [RUN[0], RUN[1], RUN[RUN.length - 1]]) {
        const game = gameIn(spec.id, { toll: 0 });
        game.step(DT, still);
        const row = rowOf(game);
        expect(row.taken + row.drained + row.left, spec.id).toBe(row.held);
        expect(row.cave).toBe(spec.id);
      }
    });
  });

  it('counts what was banked, toll and bank alike, and starts each cave at nought', () => {
    const e = newEconomy(saveIn('hollow', { toll: 0 }));
    expect(e.save.taken).toBe(0);
    e.deposit(1);
    e.deposit(25);
    e.deposit(100);
    expect(e.save.taken, 'the whole of every coin, the toll’s half as well').toBe(126);
    expect(e.save.toll + e.bank, 'it is the toll and the bank between them').toBe(126);
    e.grant(1000);
    expect(e.save.taken, 'money handed over is not banked in the cave').toBe(126);
    e.drain(40);
    expect(e.save.taken, 'what went down a drain was not banked').toBe(126);
  });
});

describe('what is not yet found is left behind (criterion 2)', () => {
  it('counts an unopened chamber, a standing wall’s treasure and a whole geode as left behind, and the rest where it lies', () => {
    withSeed(23, () => {
      const game = gameIn('south-gallery', { toll: 0 });
      const spec = game.cave.spec;
      const { sources } = game.economy;
      const at = () => rowOf(game).left;
      // all of it is left, and the whole of it is a heap, a side room behind its wall, and what is yet to come out
      expect(at()).toBe(held(spec));
      expect(expectedLeft(game)).toBe(held(spec));
      // not yet lying: the chamber's 960, the wall's 75, and the two geodes' 300
      const lying = game.stock.lyingAll();
      expect(held(spec) - lying).toBe(960 + 75 + 300);

      // a chamber broken into: its loot is lying now, and still left
      game.economy.reveal(0);
      expect(game.stock.lying(sources.chamber(0)), 'the chamber’s loot lies').toBe(960);
      expect(at(), 'opening it takes nothing from what is left').toBe(held(spec));
      expect(at()).toBe(expectedLeft(game));

      // a wall knocked down: its treasure lies
      game.economy.hitWall(0, 1e6);
      expect(game.stock.lying(sources.wall(0)), 'the wall’s treasure lies').toBe(75);
      expect(at()).toBe(held(spec));
      expect(at()).toBe(expectedLeft(game));

      // a geode cracked: its gems lie
      crack(game, 0);
      expect(game.stock.lying(sources.geodes()), 'a geode’s gems lie').toBe(150);
      expect(at()).toBe(held(spec));
      expect(at()).toBe(expectedLeft(game));

      // and what is banked is no longer left
      bank(game, sources.chamber(0), 20);
      const row = rowOf(game);
      expect(row.taken).toBeGreaterThan(0);
      expect(row.left).toBe(held(spec) - row.taken);
      expect(row.left).toBe(expectedLeft(game));
    });
  });

  it('counts a geode that went down the hole whole as left behind, and not as lying', () => {
    withSeed(24, () => {
      const game = gameIn('south-gallery', { toll: 0 });
      const spec = game.cave.spec;
      const gems = worth(0, spec.geodes!.holds);
      const lyingBefore = game.stock.lyingAll();
      const hole = game.cave.holes[0];
      const i = aGeode(game, 0);
      put(game, i, hole.x, hole.y, 3);
      for (let f = 0; f < 300 && game.world.alive[i]; f++) game.step(DT, still);
      expect(game.world.alive[i], 'the geode went down the hole').toBeFalsy();
      expect(game.stock.kinds[GEODE_KIND]).toBe(spec.geodes!.count - 1);
      expect(game.stock.lyingAll(), 'its gems were never spawned: they do not lie').toBe(lyingBefore);
      const row = rowOf(game);
      expect(row.taken, 'a stone worth nothing banked nothing').toBe(0);
      expect(row.left, 'but what it held is left behind, with all else').toBe(held(spec));
      expect(expectedLeft(game) + gems, 'neither lying nor standing: what it held is in left alone').toBe(row.left);
      expect(row.finds.geodes, 'and the stone was never cracked').toEqual({ cracked: 0, of: spec.geodes!.count });
      expect(checkInvariants(game)).toEqual([]);
    });
  });
});

describe('the run’s line (criterion 3)', () => {
  const rowOfCave = (id: string, taken: number, drained = 0): Row => ({
    cave: id,
    held: held(specOf(id)),
    taken,
    toll: 0,
    drained,
    left: held(specOf(id)) - taken - drained,
    finds: { chamber: 'none', sideRoom: 'none', wall: 'none', geodes: { cracked: 0, of: 0 } },
    marks: { clean: true, everyHeap: false, everyFind: false },
  });

  it('is the sum of the stored rows and the cave being played, of all that the mine holds', () => {
    const rows = [rowOfCave('hollow', 2580), rowOfCave('south-gallery', 4310, 120)];
    const game = gameIn('east-gallery', { ledger: rows, taken: 1900 });
    expect(game.economy.save.ledger).toEqual(rows);
    expect(runLine(game.economy, game)).toBe('brought out 8,790 of 68,850');
  });

  it('moves with what is banked now, and is nought on a new game', () => {
    const game = gameIn('hollow', { toll: 0 });
    expect(runLine(game.economy, game)).toBe('brought out 0 of 68,850');
    game.economy.deposit(1234);
    expect(runLine(game.economy, game)).toBe('brought out 1,234 of 68,850');
  });

  it('is read by the view with its rows, the cave being played, and the line', () => {
    const rows = [rowOfCave('hollow', 2580), rowOfCave('south-gallery', 4310, 120)];
    const game = gameIn('east-gallery', { ledger: rows, taken: 1900, drained: 60 });
    const view = ledgerOf(game.economy, game);
    expect(view.rows.map((r) => r.name)).toEqual(['The Hollow', 'South Gallery']);
    expect(view.now.name).toBe('East Gallery');
    expect(view.now.soFar).toBe(true);
    expect(view.rows[0].text).toBe('2,580 of 2,620');
    expect(view.now.text).toBe('1,900 of 7,990 so far');
    expect(view.line).toBe('brought out 8,790 of 68,850');
    expect(view.foot).toBe('The mine: brought out 8,790 of 68,850');
  });
});

describe('saved and reloaded, the ledger is as it was (criterion 4)', () => {
  it('keeps the rows a cave left, the taken of the cave being played, and what was cracked', () => {
    withSeed(25, () => {
      const store = memoryStore(saveIn('hollow', { toll: 0 }));
      const economy = new Economy(store, RUN);
      let game = new Game(economy, caveOf('hollow'));
      bank(game, 0, 400);
      crack(game, 0);
      economy.open();
      const row = leave(game);
      expect(row.cave).toBe('hollow');
      expect(row.taken).toBeGreaterThanOrEqual(400);
      game = new Game(economy, caveOf(economy.save.cave));
      economy.deposit(77);
      game.persist();
      const back = new Economy(memoryStore(store.json), RUN);
      expect(back.save.ledger).toEqual(economy.save.ledger);
      expect(back.save.ledger).toHaveLength(1);
      expect(back.save.taken).toBe(77);
      expect(back.save.cave).toBe('south-gallery');
    });
  });

  it('puts a save from before the ledger in with an empty one, and the taken worked out from its heaps', () => {
    const spec = specOf('east-gallery');
    const value = caveStock(spec).value;
    // 3,800 of heaps in the east gallery, 1,950 of it left: 1,850 has been brought out, and was before there was a ledger
    const raw = JSON.parse(saveIn('east-gallery', { left: [[], ...Array.from({ length: 0 }, () => [])] })) as Record<
      string,
      unknown
    >;
    delete raw.taken;
    delete raw.ledger;
    delete raw.cracked;
    delete raw.toll;
    raw.left = [[1500, 0, 20, 10, 0, 0, 0, 0, 0]];
    const lying = 1500 + 20 * KIND_VALUE[2] + 10 * KIND_VALUE[3];
    const e = newEconomy(JSON.stringify(raw));
    expect(e.save.ledger, 'no row was ever written').toEqual([]);
    expect(e.save.taken, 'the heaps’ worth less what lies').toBe(value - lying);
    // a save that says nothing of what lies has nothing worked out
    const bare = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
    bare.left = [];
    expect(newEconomy(JSON.stringify(bare)).save.taken).toBe(0);
  });

  it('counts the geodes of an old save that no longer stand as cracked, and a cave not yet begun as none', () => {
    // the South Gallery has two geodes: a save with one standing, from before they were counted, has cracked the other
    const raw = JSON.parse(saveIn('south-gallery')) as Record<string, unknown>;
    delete raw.cracked;
    raw.geodes = [-136, 4, 1.6];
    expect(newEconomy(JSON.stringify(raw)).save.cracked).toBe(1);
    raw.geodes = [];
    expect(newEconomy(JSON.stringify(raw)).save.cracked, 'none standing').toBe(2);
    raw.geodes = null;
    expect(newEconomy(JSON.stringify(raw)).save.cracked, 'not yet begun: all standing').toBe(0);
    // a count the save gives is kept, to the cave's own number
    raw.cracked = 1;
    expect(newEconomy(JSON.stringify(raw)).save.cracked).toBe(1);
    raw.cracked = 9;
    expect(newEconomy(JSON.stringify(raw)).save.cracked, 'no more than the cave has').toBe(2);
  });

  it('keeps taken at least the toll paid, for a save that says it paid more than it brought out', () => {
    const raw = JSON.parse(saveIn('hollow', { toll: 600 })) as Record<string, unknown>;
    delete raw.taken;
    raw.left = [];
    expect(newEconomy(JSON.stringify(raw)).save.taken, 'the toll is part of what was taken').toBeGreaterThanOrEqual(
      600,
    );
  });

  it('drops a row that is not made of numbers, one for a cave not in the run, a repeat, and any past six', () => {
    const good = (id: string): Row => ({
      cave: id,
      held: held(specOf(id)),
      taken: 5,
      toll: 2,
      drained: 0,
      left: held(specOf(id)) - 5,
      finds: { chamber: 'none', sideRoom: 'none', wall: 'none', geodes: { cracked: 0, of: 1 } },
      marks: { clean: true, everyHeap: false, everyFind: false },
    });
    const ids = RUN.slice(0, -1).map((c) => c.id);
    const bad: unknown[] = [
      { ...good('hollow'), taken: 'lots' },
      { ...good('hollow'), cave: 'the-moon' },
      { ...good('hollow'), left: null },
      { ...good('hollow'), marks: { clean: 1 } },
      { ...good('hollow'), finds: { chamber: 'maybe', sideRoom: 'none', wall: 'none', geodes: { cracked: 0, of: 1 } } },
      'a row',
      null,
      { ...good('hollow'), taken: -3 },
    ];
    const rows = [...bad, ...ids.map(good), good('hollow'), good('south-gallery')];
    const e = newEconomy(saveIn('east-gallery', { ledger: rows as Row[] }));
    expect(e.save.ledger, 'only the good, whole, once each, in order').toEqual(ids.map(good));
    // a row for every cave of the run, the last too, which no player leaves: the last is the one let go
    const many = newEconomy(saveIn('east-gallery', { ledger: RUN.map((c) => good(c.id)) }));
    expect(many.save.ledger.map((r) => r.cave)).toEqual(ids);
    expect(newEconomy(saveIn('hollow', { ledger: 'nonsense' as unknown as Row[] })).save.ledger).toEqual([]);
  });
});

describe('the marks (criterion 5)', () => {
  it('gives clean while nothing has gone down a drain, and takes it back at one coin', () => {
    const game = gameIn('south-gallery', { toll: 0 });
    expect(rowOf(game).marks.clean).toBe(true);
    game.economy.drain(1);
    expect(rowOf(game).marks.clean, 'one coin drained').toBe(false);
  });

  it('is clean when a brick, a barrel or a whole geode goes down a drain: they are worth nothing', () => {
    withSeed(26, () => {
      const game = gameIn('south-gallery', { toll: 0 });
      const d = game.cave.drains[0];
      const i = aGeode(game, 0);
      put(game, i, d.x, d.y, 3);
      for (let f = 0; f < 300 && game.world.alive[i]; f++) game.step(DT, still);
      expect(game.world.alive[i], 'the geode went down').toBeFalsy();
      expect(game.economy.save.drained).toBe(0);
      expect(rowOf(game).marks.clean).toBe(true);
    });
  });

  it('gives every heap when none of the heaps lies, and takes it back at one coin of them', () => {
    withSeed(27, () => {
      const game = gameIn('hollow', { toll: 0 });
      expect(rowOf(game).marks.everyHeap, 'the heaps all lie').toBe(false);
      bank(game, 0);
      expect(game.stock.lying(0)).toBe(0);
      expect(rowOf(game).marks.everyHeap, 'every heap banked').toBe(true);
      // a chamber’s or a wall’s loot lying is no heap: only the cave itself is held to it
      expect(game.stock.spawn(0, 0, 0, 2, 0, 0, 0, 0)).toBe(true);
      expect(game.stock.lying(0)).toBe(1);
      expect(rowOf(game).marks.everyHeap, 'one coin of the heaps lying').toBe(false);
    });
  });

  it('leaves what is lying from a chamber, a side room or a wall out of every heap', () => {
    withSeed(28, () => {
      const game = gameIn('south-gallery', { toll: 0 });
      bank(game, 0);
      // the side room lies behind its wall from the start, and the chamber and the wall’s treasure when they are opened
      game.economy.reveal(0);
      expect(game.stock.lyingAll()).toBeGreaterThan(0);
      expect(rowOf(game).marks.everyHeap).toBe(true);
    });
  });

  it('gives every find when every chamber is open, every wall down and every geode cracked', () => {
    withSeed(29, () => {
      const open = () => {
        const g = gameIn('south-gallery', { toll: 0 });
        g.economy.reveal(0);
        g.economy.hitWall(0, 1e6);
        return g;
      };
      // all found: true
      const all = open();
      crack(all, 0);
      expect(rowOf(all).marks.everyFind, 'one geode left whole').toBe(false);
      crack(all, 0);
      expect(rowOf(all).marks.everyFind, 'all found').toBe(true);
      expect(rowOf(all).finds).toEqual({
        chamber: 'found',
        sideRoom: 'found',
        wall: 'found',
        geodes: { cracked: 2, of: 2 },
      });
      // one geode whole
      const whole = open();
      crack(whole, 0);
      expect(rowOf(whole).marks.everyFind).toBe(false);
      expect(rowOf(whole).finds.geodes).toEqual({ cracked: 1, of: 2 });
      // one chamber shut
      const shut = gameIn('south-gallery', { toll: 0 });
      shut.economy.hitWall(0, 1e6);
      crack(shut, 0);
      crack(shut, 0);
      expect(rowOf(shut).marks.everyFind, 'a chamber shut').toBe(false);
      expect(rowOf(shut).finds.chamber).toBe('left');
      // one wall standing, and the side room behind it
      const standing = gameIn('south-gallery', { toll: 0 });
      standing.economy.reveal(0);
      crack(standing, 0);
      crack(standing, 0);
      expect(rowOf(standing).marks.everyFind, 'a wall standing').toBe(false);
      expect(rowOf(standing).finds).toMatchObject({ wall: 'left', sideRoom: 'left', chamber: 'found' });
    });
  });

  it('counts a cave with no finds of a kind as done in that kind, and a geode lost whole as not cracked', () => {
    withSeed(30, () => {
      // the Hollow has no chamber, side room or wall, and one geode
      const game = gameIn('hollow', { toll: 0 });
      expect(rowOf(game).finds).toEqual({
        chamber: 'none',
        sideRoom: 'none',
        wall: 'none',
        geodes: { cracked: 0, of: 1 },
      });
      expect(rowOf(game).marks.everyFind).toBe(false);
      // down the hole whole: gone, and not cracked
      const hole = game.cave.holes[0];
      const i = aGeode(game, 0);
      put(game, i, hole.x, hole.y, 3);
      for (let f = 0; f < 300 && game.world.alive[i]; f++) game.step(DT, still);
      expect(rowOf(game).marks.everyFind, 'a stone lost whole was never found').toBe(false);
      const other = gameIn('hollow', { toll: 0 });
      crack(other, 0);
      expect(rowOf(other).marks.everyFind, 'cracked, and there is nothing else to find').toBe(true);
    });
  });
});

describe('leaving a cave writes its row (edge cases)', () => {
  it('writes the row with what was paid of the toll, for a cave left by the nine tenths rule with the toll part paid', () => {
    withSeed(31, () => {
      const { events, named } = told();
      const game = gameIn('hollow', { toll: 0 }, events);
      bank(game, 0, 500);
      const paid = game.economy.save.toll;
      expect(paid, 'part of the toll is paid').toBeGreaterThan(0);
      expect(paid).toBeLessThan(tollOf(specOf('hollow')));
      expect(game.economy.owed()).toBeGreaterThan(0);
      // the way out opens by the share and not the toll, as it would at nine tenths
      game.economy.open();
      const taken = game.economy.save.taken;
      const row = leave(game);
      expect(row).toMatchObject({ cave: 'hollow', toll: paid, taken });
      expect(row.taken + row.drained + row.left).toBe(row.held);
      expect(named('caveLeft')).toHaveLength(1);
      expect(named('caveLeft')[0].args[2], 'the game hands the row on with the news').toEqual(row);
      // the next cave starts afresh, and owes its own
      expect(game.economy.save.taken).toBe(0);
      expect(game.economy.save.toll).toBe(0);
      expect(game.economy.save.ledger).toEqual([row]);
    });
  });

  it('writes a row of noughts for a cave left at once, with all it held left behind', () => {
    withSeed(32, () => {
      const game = gameIn('hollow', { toll: 0, open: true });
      const row = leave(game);
      expect(row).toMatchObject({ cave: 'hollow', taken: 0, toll: 0, drained: 0, left: held(specOf('hollow')) });
      expect(row.marks).toEqual({ clean: true, everyHeap: false, everyFind: false });
    });
  });

  it('writes a row for each cave left, in order, and a cave left again replaces its row', () => {
    withSeed(33, () => {
      const e = newEconomy(saveIn('hollow', { toll: 0, open: true }));
      let game = new Game(e, caveOf('hollow'));
      leave(game);
      game = new Game(e, caveOf(e.save.cave));
      e.open();
      leave(game);
      expect(e.save.ledger.map((r) => r.cave)).toEqual(['hollow', 'south-gallery']);
      // gone back to the first, as the test API can, and left again
      e.travel('hollow');
      e.open();
      game = new Game(e, caveOf('hollow'));
      e.deposit(10);
      leave(game);
      expect(
        e.save.ledger.map((r) => r.cave),
        'once each, in the run’s order',
      ).toEqual(['hollow', 'south-gallery']);
      expect(e.save.ledger[0].taken, 'the later row is the one kept').toBe(10);
    });
  });
});

describe('the last cave, which is never left', () => {
  it('has the live row, and once it is done with the vein running, takes more than it held and has nothing left', () => {
    withSeed(34, () => {
      const last = RUN[RUN.length - 1];
      const game = gameIn(last.id, {});
      const first = rowOf(game);
      expect(first.vein, 'not yet').toBeFalsy();
      expect(first.toll, 'no toll in the last cave').toBe(0);
      // everything brought out, and the game done
      game.economy.deposit(held(last));
      game.economy.open();
      expect(game.economy.save.done).toBe(true);
      const done = rowOf(game);
      expect(done).toMatchObject({ vein: true, left: 0, taken: held(last) });
      // the vein runs coins in, and one is pushed down the hole
      for (let f = 0; f < 60 * 30 && slotsOf(game, 0, 0).length === 0; f++) game.step(DT, still);
      const [coin] = slotsOf(game, 0, 0);
      expect(coin, 'the vein ran a coin in').toBeDefined();
      const hole = game.cave.holes[0];
      put(game, coin, hole.x, hole.y, 2);
      for (let f = 0; f < 300 && game.world.alive[coin]; f++) game.step(DT, still);
      const row = rowOf(game);
      expect(row.taken, 'more than the cave held').toBeGreaterThan(held(last));
      expect(row.left).toBe(0);
      expect(row.vein).toBe(true);
      expect(row.finds.geodes.of).toBe(last.geodes!.count);
      expect(
        checkInvariants(game),
        'the rule that the parts add up is held to a row stored, and this one is not',
      ).toEqual([]);
      // there is no way out to leave by
      game.economy.moveOn(row);
      expect(game.economy.save.ledger).toEqual([]);
    });
  });
});

describe('the card and the ledger, as words', () => {
  const row: Row = {
    cave: 'south-gallery',
    held: 5755,
    taken: 4310,
    toll: 1200,
    drained: 120,
    left: 1325,
    finds: { chamber: 'found', sideRoom: 'left', wall: 'left', geodes: { cracked: 1, of: 2 } },
    marks: { clean: false, everyHeap: true, everyFind: false },
  };

  it('has a bar of gold, blue and grey that is held to what the cave held, and its figures beside it', () => {
    const card = cardOf(row, 'South Gallery');
    expect(card.name).toBe('South Gallery');
    expect(card.figures).toBe('4,310 brought out · 120 drained · 1,325 left behind');
    expect(card.bar.out).toBeCloseTo(74.9, 1);
    expect(card.bar.drained).toBeCloseTo(2.1, 1);
    expect(card.bar.left).toBeCloseTo(23.0, 1);
    expect(card.bar.out + card.bar.drained + card.bar.left).toBeCloseTo(100, 5);
  });

  it('says each mark in a word, ◆ for the won and ◇ for the not', () => {
    const card = cardOf(row, 'South Gallery');
    expect(card.marks).toEqual([
      { word: 'clean', won: false, text: '◇ clean' },
      { word: 'every heap', won: true, text: '◆ every heap' },
      { word: 'every find', won: false, text: '◇ every find' },
    ]);
  });

  it('keeps a bar that took more than the cave held inside its track, the vein’s coins and all', () => {
    const card = cardOf({ ...row, taken: 22000, held: 21800, drained: 0, left: 0, vein: true }, 'The Deep');
    expect(card.bar.out + card.bar.drained + card.bar.left).toBeCloseTo(100, 5);
    expect(card.bar.left).toBe(0);
  });

  it('has a bar of nothing for a cave that held nothing, and does not divide by it', () => {
    const card = cardOf({ ...row, held: 0, taken: 0, drained: 0, left: 0 }, 'Nowhere');
    expect(card.bar).toEqual({ out: 0, drained: 0, left: 0 });
  });
});

describe('the ledger breaks no rule through a play of caves', () => {
  it('holds each stored row to its sum, and no more than six', () => {
    withSeed(35, () => {
      const e = newEconomy(saveIn('hollow', { toll: 0, open: true }));
      let game = new Game(e, caveOf('hollow'));
      for (let n = 0; n < RUN.length - 1; n++) {
        if (n > 0) e.open();
        leave(game);
        game = new Game(e, caveOf(e.save.cave));
        expect(checkInvariants(game), `after ${n + 1} left`).toEqual([]);
      }
      expect(e.save.ledger).toHaveLength(RUN.length - 1);
      expect(e.save.ledger.length).toBeLessThanOrEqual(RUN.length - 1);
    });
  });
});
