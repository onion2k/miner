/**
 * The scoop: a bucket that takes the blade's place. It lies on the ground and pushes as a blade does, its
 * flared walls funnelling what it meets to its back; raised, it lifts everything over its floor and carries
 * it; lowered, it sets its load down inside itself, to gather more; tipped, it pours the load out ahead. Its
 * acceptance criteria, then the edge cases of the checklist, each on a scene built by hand in the Hollow's
 * open floor or on a bare floor of the test's own, so what is looked at is the scoop's and not the cave's.
 *
 * Criterion 1, that it keeps hold of as much as a blade over a long push, is played on six seeds in
 * `test/slow/scoop.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { exitPoints, pastLeavingLine } from '../src/cave';
import {
  BLADE_AT,
  BLADE_HEIGHT,
  BLADE_RISE,
  BUCKET_BACK,
  BUCKET_DEEP,
  Dozer,
  HULL_HALF,
  bladePieces,
  bucketPieces,
  type DozerSpec,
} from '../src/dozer';
import { SCOOP, type Save } from '../src/economy';
import { Game, type Controls, type GameEvents } from '../src/game';
import { checkInvariants } from '../src/invariants';
import { place, placeTipped } from '../src/matrix';
import { BARREL_KIND, BRICK_KIND, GEODE_KIND, KIND_VALUE, makeWorld } from '../src/physics';
import { DUMP_TIME, LIFT_TIME, SCOOP_MOST, TIP_EXTRA, bucketPoint, bucketTilt, overFloor, Scoop } from '../src/scoop';
import { hashGame } from '../scripts/determinism';
import {
  PLAYER_SPEC,
  RUN,
  TEST_BODIES,
  TEST_GRID,
  ORIGIN_X,
  ORIGIN_Y,
  caveOf,
  gameIn,
  grid,
  newEconomy,
  withSeed,
} from './helpers';

const DT = 1 / 60;
const still = { throttle: 0, steer: 0 };
const forward = { throttle: 1, steer: 0 };
const lift: Controls = { scoop: 'lift' };
const tip: Controls = { scoop: 'tip' };
/** The frames the bucket takes to rise or to come down, and a few over. */
const TRAVEL = Math.ceil(LIFT_TIME * 60) + 4;
const BUCKET: DozerSpec = { ...PLAYER_SPEC, bladeWidth: 9, bucket: true };

/** Open floor in the Hollow, clear of its heaps and of its hole, facing east. */
const SPOT = { x: -20, y: -26, yaw: 0 };

/**
 * A game in the Hollow with the scoop of `size`, the dozer at `at`, stopped, and the cave's own barrels and
 * geode taken out of it: a bucket is wide, and one of them standing at a wall's tip is a load, a fuse lit or a
 * blast that the test did not lay.
 */
function scene(size = 2, patch: Partial<Save> = {}, events: GameEvents = {}, at = SPOT): Game {
  const game = gameIn('hollow', { scoop: size, ...patch }, events);
  const { world, stock } = game;
  for (let i = 0; i < world.count; i++) {
    if (!world.alive[i]) continue;
    if (world.kind[i] === BARREL_KIND) stock.removeBarrel(i);
    else if (world.kind[i] === GEODE_KIND) stock.removeGeode(i);
  }
  Object.assign(game.dozer, { ...at, speed: 0, yawRate: 0 });
  return game;
}

/** A world point `along` the dozer's heading and `across` it to the left. */
function ahead(game: Game, along: number, across = 0): [number, number] {
  const { x, y, yaw } = game.dozer;
  return [x + Math.cos(yaw) * along - Math.sin(yaw) * across, y + Math.sin(yaw) * along + Math.cos(yaw) * across];
}

/** Where a body is in the dozer's own frame. */
function local(game: Game, i: number) {
  const { world, dozer } = game;
  const dx = world.x[i] - dozer.x,
    dy = world.y[i] - dozer.y;
  return {
    x: dx * Math.cos(dozer.yaw) + dy * Math.sin(dozer.yaw),
    y: -dx * Math.sin(dozer.yaw) + dy * Math.cos(dozer.yaw),
    z: world.z[i],
  };
}

/** A body of `kind` laid at a point of the cave, from the cave's own count, and its slot. */
function lay(game: Game, kind: number, x: number, y: number, z = 0.6): number {
  const { world, stock } = game;
  // the Hollow has no walls, so no room for their bricks: a test that wants one makes room
  if (kind === BRICK_KIND) game.capacity.kinds[BRICK_KIND] = Math.max(game.capacity.kinds[BRICK_KIND], 4);
  const ok = kind === BRICK_KIND ? stock.spawnBrick(1, x, y, z) >= 0 : stock.spawn(kind, x, y, z);
  expect(ok, `room for a ${kind}`).toBe(true);
  for (let i = world.count - 1; i >= 0; i--)
    if (
      world.alive[i] &&
      world.x[i] === Math.fround(x) &&
      world.y[i] === Math.fround(y) &&
      world.z[i] === Math.fround(z)
    )
      return i;
  throw new Error('laid and lost');
}

/** A grid of coins over the bucket's floor, `along` by `across`, each `gap` from the next, from `start` ahead of the pivot. */
function coinsInBucket(game: Game, along: number, across: number, gap = 0.9, start = BLADE_AT + 0.7, z = 0.6) {
  const slots: number[] = [];
  for (let a = 0; a < along; a++)
    for (let c = 0; c < across; c++) {
      const [x, y] = ahead(game, start + a * gap, (c - (across - 1) / 2) * gap);
      slots.push(lay(game, 0, x, y, z));
    }
  return slots;
}

function play(game: Game, frames: number, drive = still, controls: Controls = {}) {
  for (let f = 0; f < frames; f++) game.step(DT, drive, f === 0 ? controls : {});
}

/** Whether each body held is where the bucket carries it: where it lay in the bucket, raised and tipped with it. */
function wherePut(game: Game): string[] {
  const { scoop } = game;
  const bad: string[] = [];
  scoop.held.forEach((i, k) => {
    const want = bucketPoint(scoop.places[k], scoop.lift, scoop.dump);
    const at = local(game, i);
    if (Math.hypot(at.x - want.x, at.y - want.y, at.z - want.z) > 0.05) bad.push(`slot ${i} (${k}th)`);
  });
  return bad;
}

const heldValue = (game: Game) => game.scoop.held.reduce((n, i) => n + KIND_VALUE[game.world.kind[i]], 0);

describe('the bucket’s shape, worked out without a game', () => {
  it('is a straight back and a wall each side flaring out to its width at the mouth', () => {
    for (const width of [9, 11.5, 14]) {
      const pieces = bucketPieces(width);
      expect(pieces, 'a back and two walls').toHaveLength(3);
      const [back, ...walls] = pieces;
      expect(back).toMatchObject({ x: BLADE_AT, y: 0, turn: 0 });
      expect(back.length).toBeCloseTo(width * BUCKET_BACK, 6);
      expect(walls.map((w) => Math.sign(w.y)).sort()).toEqual([-1, 1]);
      for (const w of walls) {
        const side = Math.sign(w.y);
        // a piece lies along its own length, which is across the machine turned by `turn`
        const ends = [-1, 1].map((e) => ({
          x: w.x - Math.sin(w.turn) * (w.length / 2) * e,
          y: w.y + Math.cos(w.turn) * (w.length / 2) * e,
        }));
        const [near, far] = ends.sort((a, b) => a.x - b.x);
        expect(near.x, `${width}: the wall starts at the back`).toBeCloseTo(BLADE_AT, 5);
        expect(near.y * side, 'at the back’s end').toBeCloseTo((width * BUCKET_BACK) / 2, 5);
        expect(far.x, 'and ends at the mouth').toBeCloseTo(BLADE_AT + BUCKET_DEEP, 5);
        expect(far.y * side, 'the mouth is the bucket’s width').toBeCloseTo(width / 2, 5);
      }
    }
  });

  it('has a floor between its walls, from the hull’s nose to the mouth, as high as the walls', () => {
    for (const width of [9, 11.5, 14]) {
      const back = (width * BUCKET_BACK) / 2;
      const at = (x: number, y: number, z = 0.5) => overFloor({ x, y, z }, width);
      expect(at(BLADE_AT + 1, 0), `${width}: in the middle`).toBe(true);
      expect(at(BLADE_AT + 0.3, back - 0.2), 'at the back, by a wall').toBe(true);
      expect(at(BLADE_AT + 0.3, back + 0.6), 'beside the back, outside the wall').toBe(false);
      expect(at(BLADE_AT + BUCKET_DEEP - 0.1, width / 2 - 0.3), 'at the mouth, by a wall’s tip').toBe(true);
      expect(at(BLADE_AT + BUCKET_DEEP - 0.1, width / 2 + 0.5), 'beside the mouth').toBe(false);
      expect(at(BLADE_AT + BUCKET_DEEP + 0.4, 0), 'past the mouth').toBe(false);
      // up against rock the back stands in it, and what it could not push lies between it and the hull
      expect(at(HULL_HALF[0] + 0.1, 0), 'behind the back, at the hull’s nose').toBe(true);
      expect(at(HULL_HALF[0] - 0.5, 0), 'under the hull').toBe(false);
      expect(at(BLADE_AT + 1, 0, BLADE_HEIGHT + 1.5), 'above the walls').toBe(false);
      expect(at(BLADE_AT + 1, 0, -1), 'under the floor').toBe(false);
    }
  });

  it('rises and tips about its back’s foot, and the picture’s matrix says the same', () => {
    expect(bucketPoint({ x: 5, y: 1, z: 2 }, 0, 0), 'at rest it is where it is modelled').toEqual({ x: 5, y: 1, z: 2 });
    const up = bucketPoint({ x: BLADE_AT, y: 0, z: 0 }, 1, 0);
    expect(up.z, 'the back’s foot rises by the rise, and the tilt does not move it').toBeCloseTo(BLADE_RISE, 6);
    expect(bucketTilt(1, 0), 'tipped back to carry').toBeLessThan(0);
    expect(bucketTilt(0, 1), 'forward to pour').toBeGreaterThan(0);
    const out = new Float32Array(16);
    for (const [up, dump] of [
      [0, 0],
      [1, 0],
      [0.4, 0],
      [1, 0.5],
      [0, 1],
    ]) {
      for (const p of [
        { x: BLADE_AT, y: 0, z: 1 },
        { x: BLADE_AT + 3, y: 2, z: 0.5 },
        { x: BLADE_AT - 0.2, y: -3, z: 3 },
      ]) {
        const want = bucketPoint(p, up, dump);
        // the machine at (10, -4) turned 0.7 about the vertical
        const yaw = 0.7;
        placeTipped(out, 0, 10, -4, 0, yaw, BLADE_AT, up * BLADE_RISE, bucketTilt(up, dump));
        const got = [
          out[0] * p.x + out[4] * p.y + out[8] * p.z + out[12],
          out[1] * p.x + out[5] * p.y + out[9] * p.z + out[13],
          out[2] * p.x + out[6] * p.y + out[10] * p.z + out[14],
        ];
        const c = Math.cos(yaw),
          s = Math.sin(yaw);
        const expected = [10 + c * want.x - s * want.y, -4 + s * want.x + c * want.y, want.z];
        got.forEach((v, k) => expect(v, `lift ${up}, dump ${dump}, axis ${k}`).toBeCloseTo(expected[k], 4));
      }
    }
    // nothing raised, nothing tipped: the plain placement, as the blade is drawn without a scoop
    const plain = new Float32Array(16);
    place(plain, 0, 3, 4, 0, 1.2);
    placeTipped(out, 0, 3, 4, 0, 1.2, BLADE_AT, 0, 0);
    plain.forEach((v, k) => expect(out[k]).toBeCloseTo(v, 6));
  });
});

describe('what the physics feels (criterion 8)', () => {
  const k1 = new Dozer(grid(), TEST_GRID);

  it('is the blade as it was for a machine with no bucket, bit for bit, and a drone is never lifted', () => {
    const d = new Dozer(grid(), TEST_GRID, 0.5, 3);
    Object.assign(d, { x: 10, y: -20, yaw: 0.4, speed: 5, yawRate: 0.2 });
    const plain = d.pushers(PLAYER_SPEC, []);
    expect(d.pushers(PLAYER_SPEC, [], 0)).toEqual(plain);
    expect(d.pushers({ ...PLAYER_SPEC, bucket: false }, [], 0)).toEqual(plain);
    const pieces = bladePieces(PLAYER_SPEC.bladeWidth);
    expect(plain).toHaveLength(pieces.length + 1);
    // what a blade piece's centre was, written out as it was before there was a lift
    plain.slice(0, pieces.length).forEach((p) => expect(p.z).toBe((BLADE_HEIGHT / 2) * 0.5));
  });

  it('is the bucket for a machine with one: a back and two walls on the ground, each as tall as the blade', () => {
    Object.assign(k1, { x: 0, y: 0, yaw: 0, speed: 0, yawRate: 0 });
    const boxes = k1.pushers(BUCKET, []);
    const pieces = bucketPieces(BUCKET.bladeWidth);
    expect(boxes, 'the bucket’s three and the hull').toHaveLength(pieces.length + 1);
    boxes.slice(0, pieces.length).forEach((b, k) => {
      expect(b.z - b.hz, `piece ${k} stands on the ground`).toBeCloseTo(0, 9);
      expect(b.z + b.hz, `piece ${k} is as tall as the blade`).toBeCloseTo(BLADE_HEIGHT, 9);
      expect(b.x).toBeCloseTo(pieces[k].x, 9);
      expect(b.y).toBeCloseTo(pieces[k].y, 9);
      expect(b.yaw).toBeCloseTo(pieces[k].turn, 9);
      expect(b.hy).toBeCloseTo(pieces[k].length / 2, 9);
    });
  });

  it('stands clear of the floor when raised, to the height of the rise, the hull as it was', () => {
    Object.assign(k1, { x: 0, y: 0, yaw: 0, speed: 0, yawRate: 0 });
    const down = k1.pushers(BUCKET, []).map((p) => ({ ...p }));
    const up = k1.pushers(BUCKET, [], 1);
    const n = down.length - 1;
    for (let k = 0; k < n; k++) {
      expect(up[k].z - up[k].hz, `piece ${k} off the floor`).toBeCloseTo(BLADE_RISE, 9);
      expect({ ...up[k], z: 0 }).toEqual({ ...down[k], z: 0 });
    }
    expect(up[n], 'the hull still shoves').toEqual(down[n]);
    const half = k1.pushers(BUCKET, [], 0.5);
    expect(half[0].z - half[0].hz).toBeCloseTo(BLADE_RISE / 2, 9);
  });
});

describe('the scoop in the game (criteria 2 to 7)', () => {
  it('2: funnels what a wall’s tip meets to the back, between the walls', () => {
    const world = makeWorld(TEST_BODIES, grid(), TEST_GRID, []);
    const dozer = new Dozer(grid(), TEST_GRID);
    Object.assign(dozer, { x: -60, y: 0, yaw: 0, speed: 0 });
    const width = BUCKET.bladeWidth;
    // a coin each side, just inside where the walls' tips will pass, well ahead of the mouth
    const coins = [-1, 1].map((side) => world.spawn(0, -40, side * (width / 2 - 0.5), 0.45));
    for (let f = 0; f < 30; f++) world.step(DT, () => {});
    const boxes = [] as ReturnType<Dozer['pushers']>;
    for (let f = 0; f < 60 * 6; f++) {
      dozer.update(DT, forward, BUCKET, world.load);
      world.pushers = dozer.pushers(BUCKET, boxes);
      world.wakeNear(dozer.x + BLADE_AT, dozer.y, width);
      world.step(DT, () => {});
    }
    expect(dozer.x, 'driven well past where they lay').toBeGreaterThan(-20);
    for (const i of coins) {
      const along = world.x[i] - dozer.x,
        across = Math.abs(world.y[i] - dozer.y);
      expect(overFloor({ x: along, y: world.y[i] - dozer.y, z: world.z[i] }, width), `coin ${i} is in the bucket`).toBe(
        true,
      );
      expect(across, 'brought in from the tip toward the back').toBeLessThan(width / 2 - 0.9);
    }
  });

  it('3: raising takes every coin, gem and bar over the floor and nothing outside it, each where it lay', () => {
    for (const size of [1, 2, 3]) {
      const game = scene(size);
      const width = SCOOP[size].width;
      expect(game.economy.spec().bladeWidth).toBe(width);
      const inside = [
        ...coinsInBucket(game, 3, 5),
        ...coinsInBucket(game, 3, 5, 0.9, BLADE_AT + 0.7, 1.7),
        lay(game, 1, ...ahead(game, BLADE_AT + 2.9, width / 2 - 1.4), 1.1),
        lay(game, 5, ...ahead(game, BLADE_AT + 3.1, -(width / 2 - 1.4)), 1.0),
      ];
      const junk = [
        lay(game, BRICK_KIND, ...ahead(game, BLADE_AT + 3.0, 0.3), 2.6),
        game.stock.spawnBarrel(...ahead(game, BLADE_AT + 3.1, -1.3), 3.2),
      ];
      const outside = [
        lay(game, 0, ...ahead(game, BLADE_AT + BUCKET_DEEP + 1.5), 0.6),
        lay(game, 0, ...ahead(game, BLADE_AT + 0.4, width / 2 - 0.2), 0.6),
        lay(game, 0, ...ahead(game, BLADE_AT + 1.5), BLADE_HEIGHT + 3),
      ];
      const lay0 = new Map(inside.map((i) => [i, local(game, i)]));
      play(game, 1, still, lift);
      const { world, scoop } = game;
      expect(scoop.up, 'on its way up').toBe(true);
      expect(
        scoop.held.slice().sort((a, b) => a - b),
        `size ${size}: all of it, however many`,
      ).toEqual(inside.slice().sort((a, b) => a - b));
      expect(scoop.held.length, 'more than the old scoop’s twelve').toBeGreaterThan(12);
      for (const i of junk) expect(world.carried[i], 'a brick or a barrel is not lifted').toBe(0);
      for (const i of outside) expect(world.carried[i], 'what is not over the floor is left').toBe(0);
      scoop.held.forEach((i, k) => {
        const was = lay0.get(i)!;
        expect(scoop.places[k].x).toBeCloseTo(was.x, 4);
        expect(scoop.places[k].y).toBeCloseTo(was.y, 4);
        expect(scoop.places[k].z).toBeCloseTo(was.z, 4);
      });
      play(game, TRAVEL, still);
      expect(scoop.lift).toBe(1);
      expect(wherePut(game), 'each where it lay, raised with the bucket').toEqual([]);
      play(game, 60, { throttle: 0.5, steer: 1 });
      expect(wherePut(game), 'and turned with the machine').toEqual([]);
      expect(checkInvariants(game)).toEqual([]);
    }
  });

  it('4: raised, it pushes nothing, which lowered it does', () => {
    const run = (raised: boolean) => {
      const game = scene(2);
      // coins in line with the bucket's back, wide of the hull, which only the bucket reaches
      const strip = [-1, 1].flatMap((side) =>
        [8, 11, 14, 17].map((a) => lay(game, 0, ...ahead(game, a, side * 3.0), 0.43)),
      );
      play(game, 60, still);
      if (raised) {
        play(game, 1, still, lift);
        play(game, TRAVEL, still);
        expect(game.scoop.lift, 'up, with nothing in it').toBe(1);
        expect(game.scoop.held).toEqual([]);
      }
      const from = strip.map((i) => [game.world.x[i], game.world.y[i]]);
      play(game, 120, forward);
      return strip.map((i, k) => Math.hypot(game.world.x[i] - from[k][0], game.world.y[i] - from[k][1]));
    };
    const moved = run(true);
    for (const [k, d] of moved.entries()) expect(d, `coin ${k} not touched with the bucket up`).toBeLessThan(0.3);
    const control = run(false);
    expect(control.filter((d) => d > 1).length, 'the bucket down shoves most of them').toBeGreaterThanOrEqual(4);
  });

  it('4: a full bucket raised reaches the engine’s top speed, and the same pile pushed does not', () => {
    const speeds: Record<string, { speed: number; load: number }> = {};
    for (const raised of [false, true]) {
      withSeed(2, () => {
        const game = scene(2);
        const pile = [...coinsInBucket(game, 3, 5), ...coinsInBucket(game, 3, 5, 0.9, BLADE_AT + 0.7, 1.4)];
        play(game, 60, still);
        if (raised) play(game, 1, still, lift);
        expect(game.scoop.held.length, raised ? 'the pile is lifted' : 'nothing lifted').toBe(raised ? pile.length : 0);
        let peak = 0;
        for (let f = 0; f < 150; f++) {
          game.step(DT, forward);
          peak = Math.max(peak, game.world.load);
        }
        speeds[raised ? 'carried' : 'pushed'] = { speed: game.dozer.speed, load: peak };
        expect(checkInvariants(game)).toEqual([]);
      });
    }
    const top = PLAYER_SPEC.maxSpeed;
    expect(speeds.carried.speed, `carried: ${JSON.stringify(speeds.carried)}`).toBeGreaterThan(top * 0.99);
    expect(speeds.carried.load, 'what is held never counts toward the load').toBe(0);
    expect(speeds.pushed.speed, `pushed: ${JSON.stringify(speeds.pushed)}`).toBeLessThan(top * 0.9);
    expect(speeds.pushed.load).toBeGreaterThan(10);
  });

  it('5: lowering sets the load down inside the bucket, to be pushed, and raising again takes it with what was gathered since', () => {
    withSeed(5, () => {
      const log: string[] = [];
      const game = scene(
        2,
        {},
        { scooped: (n) => log.push(`scooped ${n}`), setDown: (n) => log.push(`set down ${n}`) },
      );
      const width = SCOOP[2].width;
      const first = coinsInBucket(game, 2, 4);
      play(game, 1, still, lift);
      expect(game.scoop.held).toHaveLength(first.length);
      play(game, TRAVEL, still);
      // somewhere else, with the load up
      play(game, 60, forward);
      play(game, 60, still);
      play(game, 1, still, lift);
      expect(game.scoop.up, 'on its way down').toBe(false);
      expect(game.scoop.held, 'still held until it is down').toHaveLength(first.length);
      play(game, TRAVEL, still);
      expect(game.scoop.lift).toBe(0);
      expect(game.scoop.held, 'set down').toEqual([]);
      for (const i of first) {
        expect(game.world.carried[i], 'on the floor again').toBe(0);
        expect(overFloor(local(game, i), width), 'inside the bucket').toBe(true);
      }
      play(game, 40, still);
      for (const i of first) expect(game.world.z[i], 'lying on the floor').toBeLessThan(1.3);
      // more, further on: driven into, they are gathered with the first lot
      const more = [0, 1, 2, 3, 4, 5].map((k) => lay(game, 0, ...ahead(game, 14 + (k % 2), (k - 2.5) * 0.9), 0.43));
      play(game, 150, forward);
      play(game, 40, still);
      play(game, 1, still, lift);
      const held = new Set(game.scoop.held);
      for (const i of first) expect(held.has(i), `the first lot’s ${i} came along and is lifted again`).toBe(true);
      expect(more.filter((i) => held.has(i)).length, 'and what was gathered since').toBeGreaterThanOrEqual(5);
      expect(log.slice(0, 2)).toEqual([`scooped ${first.length}`, `set down ${first.length}`]);
      expect(log[2]).toBe(`scooped ${held.size}`);
      expect(checkInvariants(game)).toEqual([]);
    });
  });

  it('6: tipped at the hole’s edge, the load is banked, and the bucket comes down empty', () => {
    withSeed(3, () => {
      const log: string[] = [];
      const game = scene(
        2,
        {},
        { tipped: (n) => log.push(`tipped ${n}`), scooped: (n) => log.push(`scooped ${n}`) },
        { x: 0, y: -22, yaw: Math.PI / 2 },
      );
      const hole = game.cave.holes[0];
      const laid = coinsInBucket(game, 3, 4);
      play(game, 1, still, lift);
      expect(game.scoop.held).toHaveLength(laid.length);
      // up to the lip of the hole, and stopped
      for (
        let f = 0;
        f < 600 && Math.hypot(game.dozer.x - hole.x, game.dozer.y - hole.y) > hole.radius + BLADE_AT + BUCKET_DEEP - 2;
        f++
      )
        game.step(DT, forward);
      play(game, 90, still);
      expect(Math.abs(game.dozer.speed)).toBeLessThan(0.1);
      expect(game.economy.bank, 'nothing banked while it was carried').toBe(0);
      play(game, 1, still, tip);
      expect(game.scoop.held, 'poured').toHaveLength(0);
      expect(game.scoop.dump, 'pouring').toBeGreaterThan(0.9);
      play(game, 240, still);
      expect(game.economy.bank, 'the load, banked').toBe(laid.length);
      expect(game.scoop.up, 'the bucket came down by itself').toBe(false);
      expect(game.scoop.lift).toBe(0);
      expect(game.scoop.dump).toBe(0);
      expect(log).toEqual([`scooped ${laid.length}`, `tipped ${laid.length}`]);
      expect(checkInvariants(game)).toEqual([]);
    });
  });

  it('7: three sizes, each wider, and the machine has a bucket and no blade once one is bought', () => {
    expect(SCOOP.map((s) => s.width)).toEqual([0, 9, 11.5, 14]);
    for (const size of [1, 2, 3]) {
      // whatever blade was bought, the bucket is its own width
      for (const blade of [0, 3]) {
        const spec = scene(size, { blade }).economy.spec();
        expect(spec.bladeWidth).toBe(SCOOP[size].width);
        expect(spec.bucket).toBe(true);
      }
    }
    const none = scene(0, { blade: 2 }).economy.spec();
    expect(none.bucket ?? false, 'no scoop: a blade').toBe(false);
    expect(none.bladeWidth).toBe(10);
    // and it is the bucket's boxes the world is handed
    const game = scene(1);
    play(game, 1, still);
    const mine = game.world.pushers.filter((p) => p.owner === game.dozer.owner);
    expect(mine, 'a back, two walls and the hull').toHaveLength(4);
  });

  it('does nothing with no scoop bought, whatever is pressed', () => {
    const game = scene(0);
    coinsInBucket(game, 3, 3);
    play(game, 30, still, lift);
    play(game, 30, still, tip);
    expect(game.scoop.held).toHaveLength(0);
    expect(game.scoop.lift).toBe(0);
    expect(game.scoop.up).toBe(false);
  });

  it('tips out ahead at the dozer’s speed and a little more, forwards even when backing up', () => {
    const game = scene(2);
    coinsInBucket(game, 2, 3);
    play(game, 1, still, lift);
    play(game, 40, still);
    const held = game.scoop.held.slice();
    Object.assign(game.dozer, { speed: 6 });
    game.scoop.tip(game.dozer);
    for (const i of held) {
      expect(game.world.carried[i]).toBe(0);
      expect(game.world.vx[i], 'at the dozer’s speed and more').toBeCloseTo(6 + TIP_EXTRA, 5);
      expect(game.world.vy[i]).toBeCloseTo(0, 5);
    }
    const back = scene(2);
    coinsInBucket(back, 2, 3);
    play(back, 40, still, lift);
    const there = back.scoop.held.slice();
    Object.assign(back.dozer, { speed: -5 });
    back.scoop.tip(back.dozer);
    for (const i of there) expect(back.world.vx[i], 'ahead, not behind').toBeCloseTo(TIP_EXTRA, 5);
  });

  it('rises and comes down in game time; tipping with nothing in it, or while it is down, only brings it down', () => {
    const game = scene(3);
    coinsInBucket(game, 3, 5);
    play(game, 1, still, lift);
    expect(game.scoop.lift).toBeGreaterThan(0);
    expect(game.scoop.lift).toBeLessThan(1);
    play(game, TRAVEL, still);
    expect(game.scoop.lift).toBe(1);
    play(game, 1, still, tip);
    play(game, Math.ceil(Math.max(LIFT_TIME, DUMP_TIME) * 60) + 3, still);
    expect([game.scoop.lift, game.scoop.dump, game.scoop.up]).toEqual([0, 0, false]);
    // down and empty: a tip does nothing
    play(game, 20, still, tip);
    expect([game.scoop.lift, game.scoop.up]).toEqual([0, false]);
    // up and empty: a tip brings it down
    play(game, 1, forward, lift);
    play(game, TRAVEL, forward);
    expect(game.scoop.lift).toBe(1);
    play(game, 1, still, tip);
    play(game, TRAVEL, still);
    expect([game.scoop.lift, game.scoop.up]).toEqual([0, false]);
  });

  it('goes back up with what it holds when raised again half way down, and takes nothing more until it is on the ground', () => {
    const game = scene(2);
    const first = coinsInBucket(game, 2, 3);
    play(game, 1, still, lift);
    play(game, TRAVEL, still);
    play(game, 1, still, lift);
    play(game, 6, still);
    expect(game.scoop.lift).toBeGreaterThan(0);
    expect(game.scoop.lift).toBeLessThan(1);
    // something under it, on the floor, as it hangs half way
    const under = lay(game, 0, ...ahead(game, BLADE_AT + 1.5), 0.43);
    play(game, 1, still, lift);
    expect(game.scoop.up).toBe(true);
    expect(game.scoop.held.slice().sort((a, b) => a - b)).toEqual(first.slice().sort((a, b) => a - b));
    expect(game.world.carried[under], 'what lies under a bucket in the air is not in it').toBe(0);
  });
});

describe('the scoop’s edge cases', () => {
  it('the hole: carried over it, nothing falls in; lowered at its lip, what is in the bucket goes down', () => {
    const game = scene(2, {}, {}, { x: 0, y: -24, yaw: Math.PI / 2 });
    coinsInBucket(game, 3, 3);
    play(game, 1, still, lift);
    const n = game.scoop.held.length;
    expect(n).toBe(9);
    // driven right over the hole with it
    play(game, 300, forward);
    const hole = game.cave.holes[0];
    expect(Math.hypot(game.dozer.x - hole.x, game.dozer.y - hole.y), 'went by it').toBeLessThan(40);
    play(game, 100, still);
    expect(game.economy.bank, 'carried over the hole, none went down').toBe(0);
    expect(game.scoop.held).toHaveLength(n);
    expect(checkInvariants(game)).toEqual([]);
    // back at the lip, the bucket over the hole, and lowered: its floor is no floor there
    Object.assign(game.dozer, { x: hole.x, y: hole.y - hole.radius - BLADE_AT - 0.5, yaw: Math.PI / 2, speed: 0 });
    play(game, 1, still, lift);
    play(game, TRAVEL + 240, still);
    expect(game.scoop.held).toEqual([]);
    expect(game.economy.bank, 'set down over the hole, most of it fell in').toBeGreaterThanOrEqual(n - 3);
    expect(checkInvariants(game)).toEqual([]);
  });

  it('leaving: the cave left with a load up, or set down in the bucket, counts it lost, and none is carried to the next', () => {
    for (const setDown of [false, true]) {
      const lost: number[] = [];
      const game = scene(2, {}, { caveLeft: (_, n) => lost.push(n) });
      coinsInBucket(game, 3, 4);
      play(game, 1, still, lift);
      play(game, TRAVEL, still);
      expect(game.scoop.held).toHaveLength(12);
      if (setDown) {
        play(game, 1, still, lift);
        play(game, TRAVEL, still);
        expect(game.scoop.held).toEqual([]);
      }
      game.economy.open();
      const before = game.stock.lyingAll();
      expect(before, 'what the cave holds includes the load').toBeGreaterThanOrEqual(setDown ? 12 : heldValue(game));
      const { beyond } = exitPoints(game.cave)!;
      expect(pastLeavingLine(game.cave, beyond.x, beyond.y)).toBe(true);
      Object.assign(game.dozer, { x: beyond.x, y: beyond.y });
      game.step(DT, still);
      expect(game.left).toBe(true);
      expect(lost, 'counted lost, the load with the rest').toEqual([before]);
      const next = new Game(game.economy, caveOf(game.economy.cave().id));
      expect(next.scoop.held, 'nothing carried into the next cave').toEqual([]);
      expect(next.scoop.up).toBe(false);
      expect(checkInvariants(next)).toEqual([]);
    }
  });

  it('save: reloaded with a load, the coins are back in their heaps and the bank is as it was; the load is not saved', () => {
    withSeed(7, () => {
      const game = scene(2);
      coinsInBucket(game, 3, 4);
      play(game, 1, still, lift);
      play(game, 60, still);
      expect(game.scoop.held).toHaveLength(12);
      game.economy.deposit(5);
      game.persist();
      const json = JSON.stringify(game.economy.save);
      expect(json, 'no load in the save').not.toContain('held');
      const again = new Game(newEconomy(json), caveOf('hollow'));
      expect(again.economy.bank).toBe(game.economy.bank);
      expect(again.stock.left, 'every coin counted, those held with the rest').toEqual(game.stock.left);
      expect(again.world.live, 'the same bodies, the held ones back in their heaps').toBe(game.world.live);
      expect(again.scoop.held).toEqual([]);
      expect(again.scoop.up, 'and the bucket down').toBe(false);
      for (let i = 0; i < again.world.count; i++) expect(again.world.carried[i]).toBe(0);
      expect(checkInvariants(again)).toEqual([]);
    });
  });

  it('save: one from before the scoop plays with a blade, and one with the old scoop plays with a bucket of that size', () => {
    const game = gameIn('hollow');
    expect(game.economy.save.scoop).toBe(0);
    game.step(DT, still, lift);
    expect(game.scoop.held).toEqual([]);
    expect(game.scoop.up).toBe(false);
    const old = gameIn('hollow', { scoop: 2, blade: 3 });
    expect(old.economy.spec()).toMatchObject({ bladeWidth: SCOOP[2].width, bucket: true });
  });

  it('blasts and the horn: a raised load is left alone, and what is set down in the bucket is thrown like anything', () => {
    withSeed(8, () => {
      const names: string[] = [];
      const game = scene(2, { horn: true }, { blast: () => names.push('blast') });
      coinsInBucket(game, 3, 3);
      play(game, 1, still, lift);
      const held = game.scoop.held.slice();
      // honked at the moment they are taken, while they are still low enough and near enough to be startled
      for (const i of held) expect(game.world.z[i], 'low enough to hop').toBeLessThan(3);
      const spin = held.map((i) => [game.world.wx[i], game.world.wy[i], game.world.vz[i]]);
      game.honk();
      held.forEach((i, k) => {
        expect(game.world.carried[i]).toBe(1);
        expect([game.world.wx[i], game.world.wy[i], game.world.vz[i]], 'not made to hop or spin').toEqual(spin[k]);
      });
      play(game, 40, still);
      // a barrel close by, going off, and loose coins by it that are
      const bystander = lay(game, 0, ...ahead(game, 9, 7), 0.6);
      const barrel = game.stock.spawnBarrel(...ahead(game, 9, 6));
      game.barrels.light(barrel, 0.05);
      for (let f = 0; f < 90 && !names.length; f++) game.step(DT, still);
      expect(names, 'the barrel went off').toEqual(['blast']);
      play(game, 10, still);
      expect(game.world.vz[bystander] !== 0 || game.world.z[bystander] > 1, 'a loose coin was thrown').toBe(true);
      expect(wherePut(game), 'what is held is where it was put').toEqual([]);
      for (const i of held) expect(game.world.carried[i]).toBe(1);
      expect(checkInvariants(game)).toEqual([]);
    });
  });

  it('barrels: one met by a wall of the bucket has its fuse lit, as by the blade', () => {
    const lit: number[] = [];
    const game = scene(2, {}, { fuseLit: (i) => lit.push(i) });
    const width = SCOOP[2].width;
    // wide of the hull and of the bucket's back, where only a wall will meet it
    const barrel = game.stock.spawnBarrel(...ahead(game, 16, width / 2 - 0.9));
    play(game, 30, still);
    play(game, 150, forward);
    expect(lit, 'lit by the wall').toEqual([barrel]);
  });

  it('lamps: one met by a wall of the bucket goes over, lowered or raised, where a blade as wide passes it by', () => {
    const run = (save: Partial<Save>, raised = false) => {
      const broken: number[] = [];
      const game = gameIn('hollow', save, { lampBroken: (k) => broken.push(k) });
      const width = SCOOP[2].width;
      // a lamp and a heading that put the lamp just inside a wall's tip with the machine on open floor
      const tip = { x: BLADE_AT + BUCKET_DEEP - 0.2, y: width / 2 - 0.1 };
      const open = (x: number, y: number) => {
        for (let a = 0; a < 8; a++) {
          const t = game.nav.tileOf(x + Math.cos(a * 0.785) * 4, y + Math.sin(a * 0.785) * 4);
          if (t < 0 || game.world.solid[t] === 1) return false;
        }
        return true;
      };
      for (const [k, l] of game.cave.lamps.entries())
        for (let turn = 0; turn < 16; turn++) {
          const yaw = (turn * Math.PI) / 8;
          const x = l.x - (Math.cos(yaw) * tip.x - Math.sin(yaw) * tip.y),
            y = l.y - (Math.sin(yaw) * tip.x + Math.cos(yaw) * tip.y);
          if (!open(x, y)) continue;
          // no other lamp near enough to go over with it
          const others = game.cave.lamps.filter((o) => o !== l && Math.hypot(o.x - x, o.y - y) < 12);
          if (others.length) continue;
          Object.assign(game.dozer, { x, y, yaw, speed: 0, yawRate: 0 });
          if (raised) {
            play(game, 1, still, lift);
            play(game, TRAVEL, still);
            expect(game.scoop.lift).toBe(1);
          }
          play(game, 2, still);
          return { k, broken, saved: game.economy.save.lampsBroken };
        }
      throw new Error('no lamp of the Hollow can be come at so');
    };
    const down = run({ scoop: 2 });
    expect(down.broken, 'the wall knocked it over').toEqual([down.k]);
    expect(down.saved).toEqual([down.k]);
    const up = run({ scoop: 2 }, true);
    expect(up.broken, 'a raised bucket’s wall meets the post all the same').toEqual([up.k]);
    // the widest blade, which is wider than this bucket: its wings pass a lamp by, as they always did
    const blade = run({ blade: 3 });
    expect(blade.broken).toEqual([]);
  });

  it('the magnet, belts and currents: a raised load is not pulled or carried off', () => {
    const magnet = scene(2, { magnet: 5 });
    coinsInBucket(magnet, 3, 3);
    play(magnet, 1, still, lift);
    // loose coins well inside the magnet's reach, which pull in; the held ones stay where they were put
    for (let k = 0; k < 6; k++) lay(magnet, 0, ...ahead(magnet, 14 + k, 2), 0.6);
    play(magnet, 120, still);
    expect(wherePut(magnet)).toEqual([]);

    const south = gameIn('south-gallery', { scoop: 2, belts: ['south-belt'] });
    const belt = south.cave.spec.belts[0].spec;
    Object.assign(south.dozer, {
      x: belt.x0 + (belt.x1 - belt.x0) * 0.5 - 4.3,
      y: belt.y0 + (belt.y1 - belt.y0) * 0.5,
      yaw: Math.atan2(belt.y1 - belt.y0, belt.x1 - belt.x0),
      speed: 0,
    });
    south.dozer.keepOffRock();
    coinsInBucket(south, 3, 3);
    play(south, 1, still, lift);
    expect(south.scoop.held.length).toBeGreaterThan(0);
    play(south, 180, still);
    expect(wherePut(south), 'not carried off along the belt').toEqual([]);
    expect(checkInvariants(south)).toEqual([]);

    const hollow = scene(2);
    const brook = hollow.cave.currents[0];
    Object.assign(hollow.dozer, {
      x: brook.x0 - 4.3,
      y: brook.y0,
      yaw: Math.atan2(brook.y1 - brook.y0, brook.x1 - brook.x0),
      speed: 0,
    });
    hollow.dozer.keepOffRock();
    coinsInBucket(hollow, 2, 3);
    play(hollow, 1, still, lift);
    expect(hollow.scoop.held.length).toBeGreaterThan(0);
    play(hollow, 180, still);
    expect(wherePut(hollow), 'not carried off down the brook').toEqual([]);
    expect(hollow.economy.bank).toBe(0);
  });

  it('rock: against a wall nothing held is in the rock, and tipped or set down there nothing is left in it', () => {
    for (const how of [tip, lift]) {
      const game = scene(3);
      coinsInBucket(game, 3, 5);
      play(game, 1, still, lift);
      expect(game.scoop.held).toHaveLength(15);
      // west along the open floor into the cave's wall, and held to it
      Object.assign(game.dozer, { yaw: Math.PI });
      const inRock = () =>
        game.scoop.held.filter((i) => {
          const t = game.nav.tileOf(game.world.x[i], game.world.y[i]);
          return t < 0 || game.world.solid[t] === 1;
        });
      for (let f = 0; f < 300; f++) {
        game.step(DT, forward);
        expect(inRock(), `frame ${f}`).toEqual([]);
      }
      expect(game.dozer.x, 'got to the wall').toBeLessThan(-40);
      play(game, 1, forward, how);
      for (let f = 0; f < 240; f++) {
        game.step(DT, still);
        expect(checkInvariants(game), `frame ${f}: nothing left in the rock`).toEqual([]);
      }
      expect(game.scoop.held).toEqual([]);
    }
  });

  it('rock: takes up coins in a corner of two walls, where the back stands in the rock, and nothing from the far side of a wall', () => {
    // a corner of two walls, north and east, and the dozer driven as far into it as it will go
    const solid = grid((tx, ty) => tx >= 90 || ty >= 40);
    const world = makeWorld(TEST_BODIES, solid, TEST_GRID, []);
    const xface = ORIGIN_X + 90 * 4,
      yface = ORIGIN_Y + 40 * 4;
    const dozer = new Dozer(solid, TEST_GRID);
    Object.assign(dozer, { x: xface - 3, y: yface - 3, yaw: Math.PI / 4 });
    dozer.keepOffRock();
    const corner = [
      [xface - 0.6, yface - 0.6],
      [xface - 1.8, yface - 0.6],
      [xface - 0.6, yface - 1.8],
    ];
    const coins = corner.map(([x, y]) => world.spawn(0, x, y, 0.45));
    const far = world.spawn(0, xface - 0.6, yface - 12, 0.45);
    for (let f = 0; f < 60; f++) world.step(DT, () => {});
    const rock = (x: number, y: number) => {
      const tx = Math.floor((x - ORIGIN_X) / 4),
        ty = Math.floor((y - ORIGIN_Y) / 4);
      return solid[ty * TEST_GRID.cols + tx] === 1;
    };
    const scoop = new Scoop(world, rock);
    const [cx, cy] = corner[0];
    const along = (cx - dozer.x) * Math.cos(dozer.yaw) + (cy - dozer.y) * Math.sin(dozer.yaw);
    expect(along, 'behind the bucket’s back').toBeLessThan(BLADE_AT);
    expect(along, 'past the hull').toBeGreaterThan(HULL_HALF[0]);
    expect(scoop.raise(dozer, 9)).toBe(3);
    expect(scoop.held.slice().sort()).toEqual(coins.slice().sort());
    expect(world.carried[far], 'one that is not over the floor is left').toBe(0);

    // and a thin wall across the bucket: what lies beyond it is not reached through it
    const bare = makeWorld(TEST_BODIES, grid(), TEST_GRID, []);
    const d = new Dozer(grid(), TEST_GRID);
    Object.assign(d, { x: 0, y: ORIGIN_Y + 100, yaw: 0 });
    const at = (a: number) => bare.spawn(0, a, ORIGIN_Y + 100, 0.45);
    const before = at(BLADE_AT + 0.5);
    const behind = at(BLADE_AT + 2.5);
    const walled = new Scoop(bare, (x) => x > BLADE_AT + 1.5 && x < BLADE_AT + 2.0);
    expect(overFloor({ x: BLADE_AT + 2.5, y: 0, z: 0.45 }, 9), 'over the floor').toBe(true);
    walled.raise(d, 9);
    expect(walled.held).toEqual([before]);
    expect(bare.carried[behind]).toBe(0);
  });

  it('drones: never take a raised load for their own', () => {
    const game = scene(2, { drones: 1 });
    coinsInBucket(game, 3, 3);
    const bot = game.bots[0];
    play(game, 1, still, lift);
    const held = new Set(game.scoop.held);
    // whatever the foreman picks from here on, it is not in the bucket
    for (let f = 0; f < 600; f++) {
      game.step(DT, still);
      expect(held.has(bot.coin), `frame ${f}: the drone is after a held coin`).toBe(false);
    }
    expect(checkInvariants(game)).toEqual([]);
  });

  it('scale: a lift takes what fits and never more than its ceiling', () => {
    const world = makeWorld(TEST_BODIES, grid(), TEST_GRID, []);
    const dozer = new Dozer(grid(), TEST_GRID);
    Object.assign(dozer, { x: 0, y: 0, yaw: 0 });
    // far more than a bucket could hold, all of it over the floor: stacked where no pile would stand
    const n = SCOOP_MOST + 40;
    for (let k = 0; k < n; k++)
      world.spawn(0, BLADE_AT + 0.5 + (k % 5) * 0.5, ((k % 7) - 3) * 0.5, 0.4 + (k % 9) * 0.3);
    const scoop = new Scoop(world);
    expect(scoop.raise(dozer, 14)).toBe(SCOOP_MOST);
    expect(scoop.held).toHaveLength(SCOOP_MOST);
    let carried = 0;
    for (let i = 0; i < world.count; i++) carried += world.carried[i];
    expect(carried, 'the rest are left on the floor').toBe(SCOOP_MOST);
  });

  it('the end: with the vein running in the last cave, it is worked and breaks no rule', () => {
    withSeed(9, () => {
      const last = RUN[RUN.length - 1];
      const game = gameIn(last.id, { done: true, scoop: 3 });
      expect(game.economy.isLast()).toBe(true);
      const vein = game.cave.spec.vein;
      Object.assign(game.dozer, { x: vein.x - 8, y: vein.y, yaw: 0, speed: 0 });
      game.dozer.keepOffRock();
      play(game, 240, still);
      play(game, 1, still, lift);
      for (let f = 0; f < 240; f++) game.step(DT, still);
      expect(checkInvariants(game)).toEqual([]);
      play(game, 1, still, lift);
      for (let f = 0; f < 240; f++) game.step(DT, still);
      expect(checkInvariants(game)).toEqual([]);
      play(game, 1, still, lift);
      play(game, TRAVEL, still);
      play(game, 1, still, tip);
      for (let f = 0; f < 240; f++) game.step(DT, still);
      expect(checkInvariants(game)).toEqual([]);
    });
  });

  it('hashes what it holds and in what order, and whether it is up, so a run that parts on it is caught', () => {
    const game = scene(2);
    coinsInBucket(game, 3, 3);
    play(game, 1, still, lift);
    play(game, 40, still);
    const a = hashGame(game);
    expect(hashGame(game), 'the same twice').toBe(a);
    game.scoop.held.reverse();
    expect(hashGame(game), 'a different order').not.toBe(a);
    game.scoop.held.reverse();
    game.scoop.lift = 0.5;
    expect(hashGame(game), 'a bucket at another height').not.toBe(a);
    game.scoop.lift = 1;
    game.scoop.up = false;
    expect(hashGame(game), 'a bucket told to come down').not.toBe(a);
  });
});

describe('the invariants of the scoop', () => {
  const held = () => {
    const game = scene(2);
    coinsInBucket(game, 3, 3);
    play(game, 1, still, lift);
    play(game, 20, still);
    expect(checkInvariants(game)).toEqual([]);
    return game;
  };

  it('notice a held body that is not carried, one that is gone, and one worth nothing', () => {
    const a = held();
    a.world.carried[a.scoop.held[0]] = 0;
    expect(checkInvariants(a).join('\n')).toContain('held, and not carried');
    const b = held();
    b.world.remove(b.scoop.held[0]);
    expect(checkInvariants(b).join('\n')).toContain('not in the world');
    const c = held();
    const brick = lay(c, BRICK_KIND, 0, -30, 1);
    c.world.carried[brick] = 1;
    c.scoop.held.push(brick);
    expect(checkInvariants(c).join('\n')).toContain('worth nothing');
  });

  it('notice a held body that is in the rock, which only the scoop keeps it out of', () => {
    const game = held();
    const rock = game.world.solid.findIndex((s) => s === 1);
    const { cols, originX, originY } = game.cave.grid;
    const i = game.scoop.held[0];
    game.world.x[i] = originX + ((rock % cols) + 0.5) * 4;
    game.world.y[i] = originY + (Math.floor(rock / cols) + 0.5) * 4;
    expect(checkInvariants(game).join('\n')).toContain('is held, in the rock');
  });

  it('notice something carried that the scoop does not hold, a load with no scoop to hold it, and more than a lift takes', () => {
    const a = held();
    const loose = lay(a, 0, ...ahead(a, 12), 3);
    a.world.carried[loose] = 1;
    expect(checkInvariants(a).join('\n')).toContain('carried, and the scoop does not hold it');
    const b = held();
    expect(b.scoop.held).toHaveLength(9);
    b.economy.save.scoop = 0;
    expect(checkInvariants(b).join('\n')).toContain('9 held, and there is no scoop');
    const c = held();
    const one = c.scoop.held[0];
    while (c.scoop.held.length <= SCOOP_MOST) c.scoop.held.push(one);
    expect(checkInvariants(c).join('\n')).toContain(`held, and a lift takes ${SCOOP_MOST}`);
  });
});
