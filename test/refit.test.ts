/**
 * Fitting the blade or the scoop, and what each can break. Only the blade breaks a brick wall or the rock in front of a
 * hidden chamber: a bucket only dents them, and says so. Refitting costs nothing and may be done with the bucket
 * half way up or pouring, which sets what it holds down where it is. The rule itself is `Impacts`'s, tested in
 * `test/impacts.test.ts`; this is the game's end of it, a grade of engine at a time.
 */
import { describe, expect, it } from 'vitest';
import { BRICK, SECRET, tileCentre } from '../src/cave';
import { BLADE_AT, bladePieces } from '../src/dozer';
import { WALL_STRENGTH, type Save } from '../src/economy';
import { Game, type GameEvents } from '../src/game';
import { checkInvariants } from '../src/invariants';
import { BARREL_KIND, GEODE_KIND } from '../src/physics';
import { BOT_SPEC } from '../src/tools';
import { gameIn, withSeed } from './helpers';
import { told } from './current-helpers';

const DT = 1 / 60;
const still = { throttle: 0, steer: 0 };
const ENGINES = [0, 1, 2, 3, 4, 5];

/** A tile of the South Gallery's wall, and of the rock in front of its chamber. */
function tiles(game: Game): { wall: [number, number]; chamber: [number, number] } {
  const { cells, grid } = game.cave;
  const find = (cell: number): [number, number] => {
    const t = cells.indexOf(cell);
    expect(t, `a tile of ${cell}`).toBeGreaterThanOrEqual(0);
    return [t % grid.cols, (t / grid.cols) | 0];
  };
  return { wall: find(BRICK), chamber: find(SECRET) };
}

/** A game in the South Gallery with the engine of grade `engine` and `fitted` on, a scoop owned, driving at full speed. */
function charging(fitted: 'blade' | 'scoop', engine: number, patch: Partial<Save> = {}, events: GameEvents = {}): Game {
  const game = gameIn('south-gallery', { engine, scoop: 1, fitted, ...patch }, events);
  game.dozer.speed = 14;
  return game;
}

describe('the scoop fitted only dents brick (criterion 1)', () => {
  for (const engine of ENGINES) {
    it(`does a wall no damage and opens no chamber, square on at full speed, with engine Mk ${engine + 1}`, () => {
      const { events, named } = told();
      const game = charging('scoop', engine, {}, events);
      expect(game.economy.spec().bucket).toBe(true);
      const { wall, chamber } = tiles(game);
      game.dozer.onRock!(...wall, 1);
      expect(game.economy.save.wallDamage[0], 'no damage').toBe(0);
      expect(game.economy.save.walls[0]).toBe(false);
      expect(named('wallHit'), 'no hit on the wall').toHaveLength(0);
      expect(named('glanced').map((e) => e.args)).toEqual([['wall']]);
      game.dozer.onRock!(...chamber, 1);
      expect(game.economy.save.secrets[0], 'no chamber opened').toBe(false);
      expect(named('chamberOpened')).toHaveLength(0);
      expect(named('glanced').map((e) => e.args)).toEqual([['wall'], ['chamber']]);
      expect(checkInvariants(game)).toEqual([]);
    });
  }

  it('does it driving, not only told of the tile: the dozer flat out at the wall leaves it as it was', () => {
    withSeed(3, () => {
      const { events, named } = told();
      const game = charging('scoop', 5, {}, events);
      const [cx, cy] = tileCentre(game.cave.grid, ...tiles(game).wall);
      const free = (x: number, y: number) => {
        const tile = game.nav.tileOf(x, y);
        return tile >= 0 && !game.world.solid[tile];
      };
      // a run at the wall along a heading whose last twelve units are open floor
      let hit = false;
      for (let a = 0; a < 16 && !hit; a++) {
        const yaw = (a * Math.PI) / 8;
        const [x, y] = [cx - Math.cos(yaw) * 12, cy - Math.sin(yaw) * 12];
        if (
          ![0, 0.25, 0.5, 0.75, 1].every((s) =>
            free(cx - Math.cos(yaw) * 12 * s - Math.cos(yaw) * 3, cy - Math.sin(yaw) * 12 * s - Math.sin(yaw) * 3),
          )
        )
          continue;
        Object.assign(game.dozer, { x, y, yaw, speed: 14 });
        for (let f = 0; f < 90; f++) game.step(DT, { throttle: 1, steer: 0 });
        hit = named('glanced').length > 0;
      }
      expect(hit, 'the machine met the wall and glanced off').toBe(true);
      expect(game.economy.save.wallDamage[0]).toBe(0);
      expect(game.economy.save.walls[0]).toBe(false);
    });
  });
});

describe('the blade fitted breaks as it always did (criterion 2)', () => {
  for (const engine of ENGINES) {
    it(`hurts a wall and opens a chamber, square on at full speed, with engine Mk ${engine + 1}, a scoop owned or not`, () => {
      for (const scoop of [0, 1]) {
        const { events, named } = told();
        const game = charging('blade', engine, { scoop }, events);
        const { wall, chamber } = tiles(game);
        game.dozer.onRock!(...wall, 1);
        const grade = game.cave.spec.walls[0].grade;
        expect(game.economy.save.wallDamage[0], 'a full hit of the engine, up to the wall’s strength').toBe(
          Math.min(WALL_STRENGTH[grade], game.economy.ram(14)),
        );
        expect(named('glanced')).toHaveLength(0);
        game.dozer.onRock!(...chamber, 1);
        expect(game.economy.save.secrets[0], `chamber opened, scoop ${scoop}`).toBe(true);
        expect(named('chamberOpened')).toHaveLength(1);
      }
    });
  }
});

describe('refitting (criterion 3, edge cases)', () => {
  it('works the scoop’s buttons only while it is fitted', () => {
    const game = gameIn('hollow', { scoop: 1, fitted: 'blade' });
    game.step(DT, still, { scoop: 'lift' });
    expect(game.scoop.up, 'a bucket not fitted does not rise').toBe(false);
    game.economy.buy('fit:scoop');
    game.step(DT, still, { scoop: 'lift' });
    expect(game.scoop.up).toBe(true);
  });

  it('tells the page it glanced, with what it glanced off, and not more than once in a moment', () => {
    const { events, named } = told();
    const game = charging('scoop', 2, {}, events);
    const [tx, ty] = tiles(game).wall;
    for (let f = 0; f < 30; f++) {
      game.t += DT;
      game.dozer.onRock!(tx, ty, 1);
    }
    expect(named('glanced').length, 'half a second of leaning on it is one glance').toBe(1);
  });
});

/** Coins laid over the bucket's floor in the open Hollow, the dozer facing east, and the scoop sent up with them. */
function loaded(patch: Partial<Save> = {}, events: GameEvents = {}): Game {
  const game = gameIn('hollow', { scoop: 2, fitted: 'scoop', ...patch }, events);
  const { world, stock } = game;
  for (let i = 0; i < world.count; i++) {
    if (!world.alive[i]) continue;
    if (world.kind[i] === BARREL_KIND) stock.removeBarrel(i);
    else if (world.kind[i] === GEODE_KIND) stock.removeGeode(i);
  }
  Object.assign(game.dozer, { x: -20, y: -26, yaw: 0, speed: 0, yawRate: 0 });
  for (let a = 0; a < 4; a++)
    for (let c = 0; c < 4; c++) stock.spawn(0, -20 + BLADE_AT + 0.7 + a * 0.9, -26 + (c - 1.5) * 0.9, 0.6);
  game.step(DT, still, { scoop: 'lift' });
  return game;
}

describe('refitting with a load up sets it down where it is (criterion 6)', () => {
  it('sets every held body down, none carried, the bucket down and empty, and the load comes to rest on the floor', () => {
    const { events, named } = told();
    const game = loaded({}, events);
    for (let f = 0; f < 30; f++) game.step(DT, still);
    const held = [...game.scoop.held];
    expect(held.length, 'a load is up').toBeGreaterThanOrEqual(10);
    expect(game.scoop.up).toBe(true);
    const where = held.map((i) => [game.world.x[i], game.world.y[i]]);
    expect(game.economy.buy('fit:blade')).toBe(true);
    expect(game.scoop.held, 'nothing held').toHaveLength(0);
    expect(game.scoop.places).toHaveLength(0);
    expect(game.scoop).toMatchObject({ up: false, lift: 0, dump: 0 });
    held.forEach((i, k) => {
      expect(game.world.alive[i], 'still in the cave').toBe(1);
      expect(game.world.carried[i], 'carried by nothing').toBe(0);
      expect(game.world.x[i], 'where it was, across').toBeCloseTo(where[k][0], 3);
      expect(game.world.y[i], 'where it was, along').toBeCloseTo(where[k][1], 3);
    });
    expect(
      named('setDown').map((e) => e.args[0]),
      'the page is told',
    ).toEqual([held.length]);
    expect(checkInvariants(game)).toEqual([]);
    for (let f = 0; f < 120; f++) game.step(DT, still);
    for (const i of held) expect(game.world.z[i], `body ${i} is on the floor`).toBeLessThan(1.2);
    expect(checkInvariants(game)).toEqual([]);
  });

  it('does it with the bucket half way up', () => {
    const game = loaded();
    // the lift takes a third of a second: one frame into it is not at the top
    expect(game.scoop.lift).toBeGreaterThan(0);
    expect(game.scoop.lift).toBeLessThan(1);
    const held = [...game.scoop.held];
    expect(held.length).toBeGreaterThan(0);
    game.economy.buy('fit:blade');
    expect(game.scoop).toMatchObject({ up: false, lift: 0, dump: 0 });
    expect(game.scoop.held).toHaveLength(0);
    for (const i of held) expect(game.world.carried[i]).toBe(0);
    for (let f = 0; f < 120; f++) game.step(DT, still);
    expect(checkInvariants(game)).toEqual([]);
  });

  it('does it while the bucket is pouring', () => {
    const game = loaded();
    for (let f = 0; f < 30; f++) game.step(DT, still);
    game.step(DT, still, { scoop: 'tip' });
    expect(game.scoop.dump, 'pouring').toBeGreaterThan(0);
    game.economy.buy('fit:blade');
    expect(game.scoop).toMatchObject({ up: false, lift: 0, dump: 0 });
    expect(game.scoop.held).toHaveLength(0);
    for (let f = 0; f < 120; f++) game.step(DT, still);
    expect(checkInvariants(game)).toEqual([]);
  });

  it('does nothing to an empty bucket, and tells the page of each fitting', () => {
    const { events, named } = told();
    const game = gameIn('hollow', { scoop: 1, fitted: 'scoop' }, events);
    game.economy.buy('fit:blade');
    expect(named('setDown')).toHaveLength(0);
    expect(game.scoop).toMatchObject({ up: false, lift: 0, held: [] });
    game.economy.buy('fit:scoop');
    expect(named('setDown')).toHaveLength(0);
    expect(named('bought').map((e) => e.args)).toEqual([['fit:blade'], ['fit:scoop']]);
  });

  it('keeps what was held in the cave and counted, to be pushed like anything else', () => {
    const game = loaded();
    const live = game.world.live;
    game.economy.buy('fit:blade');
    expect(game.world.live).toBe(live);
    for (let f = 0; f < 60; f++) game.step(DT, still);
    expect(checkInvariants(game)).toEqual([]);
  });
});

describe('the drones are the drones whatever is fitted', () => {
  it('works with its own blade while the player’s scoop is fitted, and banks', () => {
    withSeed(9, () => {
      const game = gameIn('hollow', { scoop: 1, fitted: 'scoop', drones: 1, toll: 0 });
      const before = game.economy.save.banked;
      for (let f = 0; f < 60 * 120 && game.economy.save.banked === before; f++) game.step(DT, still);
      expect(game.economy.save.banked - before, 'the drone banked something').toBeGreaterThan(0);
      expect(game.economy.spec().bucket, 'while the player’s bucket was fitted').toBe(true);
      // what the world is pushed with: the player's is a bucket (a back, two walls and the hull), a drone's is a blade's pieces and its hull
      const owned = (owner: number) => game.world.pushers.filter((p) => p.owner === owner).length;
      expect(owned(game.dozer.owner), 'the player’s bucket').toBe(4);
      expect(owned(game.bots[0].dozer.owner), 'the drone’s blade').toBe(bladePieces(BOT_SPEC.bladeWidth).length + 1);
      expect(game.scoop.held).toHaveLength(0);
    });
  });
});
