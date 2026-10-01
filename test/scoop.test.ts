/**
 * The scoop: a bucket on the blade that takes up what lies in its mouth, carries it and tips it out, worked by
 * Space. Its six acceptance criteria, then the edge cases of the checklist, each on a scene built by hand in
 * the Hollow's open floor, away from its heaps, so what is looked at is the scoop's and not the cave's.
 */
import { describe, expect, it } from 'vitest';
import { exitPoints, pastLeavingLine } from '../src/cave';
import { BLADE_AT, BLADE_HEIGHT, BLADE_RISE, Dozer, HULL_HALF, bladePieces } from '../src/dozer';
import { SCOOP, type Save } from '../src/economy';
import { Game, type GameEvents } from '../src/game';
import { checkInvariants } from '../src/invariants';
import { place, placeTipped } from '../src/matrix';
import { BRICK_KIND, KIND_VALUE, makeWorld } from '../src/physics';
import {
  DUMP_TIME,
  GATHER_TIME,
  LIFT_TIME,
  MOUTH_DEEP,
  MOUTH_HIGH,
  TIP_EXTRA,
  bucketPoint,
  bucketTilt,
  floorHalf,
  inMouth,
  seat,
  seatColumns,
  Scoop,
} from '../src/scoop';
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
const press = { scoop: true };

/** Open floor in the Hollow, clear of its heaps and of its hole, facing east. */
const SPOT = { x: -20, y: -26, yaw: 0 };

/** A game in the Hollow with the scoop of `size`, the dozer at `at`, stopped. */
function scene(size = 2, patch: Partial<Save> = {}, events: GameEvents = {}, at = SPOT): Game {
  const game = gameIn('hollow', { scoop: size, ...patch }, events);
  Object.assign(game.dozer, { ...at, speed: 0, yawRate: 0 });
  return game;
}

/** A world point `along` the dozer's heading and `across` it to the left. */
function ahead(game: Game, along: number, across = 0): [number, number] {
  const { x, y, yaw } = game.dozer;
  return [x + Math.cos(yaw) * along - Math.sin(yaw) * across, y + Math.sin(yaw) * along + Math.cos(yaw) * across];
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

/** A grid of coins in the mouth, `along` by `across`, each `gap` from the next, from `start` ahead of the pivot. */
function coinsInMouth(game: Game, along: number, across: number, gap = 0.9, start = BLADE_AT + 0.6, z = 0.6) {
  const slots: number[] = [];
  for (let a = 0; a < along; a++)
    for (let c = 0; c < across; c++) {
      const [x, y] = ahead(game, start + a * gap, (c - (across - 1) / 2) * gap);
      slots.push(lay(game, 0, x, y, z));
    }
  return slots;
}

function play(game: Game, frames: number, drive = still, controls: { scoop?: boolean } = {}) {
  for (let f = 0; f < frames; f++) game.step(DT, drive, f === 0 ? controls : {});
}

/** Whether each body held is where the bucket puts it, in the dozer's frame, to a few hundredths. */
function wherePut(game: Game, width = game.economy.spec().bladeWidth): string[] {
  const { world, dozer, scoop } = game;
  const bad: string[] = [];
  scoop.held.forEach((i, k) => {
    const want = bucketPoint(seat(k, width), scoop.lift, scoop.dump);
    const dx = world.x[i] - dozer.x,
      dy = world.y[i] - dozer.y;
    const lx = dx * Math.cos(dozer.yaw) + dy * Math.sin(dozer.yaw),
      ly = -dx * Math.sin(dozer.yaw) + dy * Math.cos(dozer.yaw);
    if (Math.hypot(lx - want.x, ly - want.y, world.z[i] - want.z) > 0.05) bad.push(`slot ${i} (${k}th)`);
  });
  return bad;
}

const heldValue = (game: Game) => game.scoop.held.reduce((n, i) => n + KIND_VALUE[game.world.kind[i]], 0);

describe('the mouth and the bucket, worked out without a game', () => {
  it('lies from the hull’s nose to a little past the blade, as wide as the blade and no higher than a few coins', () => {
    for (const width of [6.5, 8, 10, 12.5]) {
      expect(inMouth({ x: BLADE_AT + 1, y: 0, z: 0.5 }, width), `${width}: ahead of the blade`).toBe(true);
      expect(inMouth({ x: HULL_HALF[0] + 0.1, y: 0, z: 0.5 }, width), `${width}: at the hull’s nose`).toBe(true);
      expect(inMouth({ x: HULL_HALF[0] - 0.5, y: 0, z: 0.5 }, width), `${width}: under the hull`).toBe(false);
      expect(inMouth({ x: BLADE_AT + MOUTH_DEEP + 0.2, y: 0, z: 0.5 }, width), `${width}: too far`).toBe(false);
      expect(inMouth({ x: BLADE_AT + 1, y: width / 2 - 0.2, z: 0.5 }, width), `${width}: by a wing's tip`).toBe(true);
      expect(inMouth({ x: BLADE_AT + 1, y: width / 2 + 1, z: 0.5 }, width), `${width}: beside the blade`).toBe(false);
      expect(inMouth({ x: BLADE_AT + 1, y: 0, z: MOUTH_HIGH + 0.5 }, width), `${width}: out of reach above`).toBe(
        false,
      );
      expect(inMouth({ x: BLADE_AT + 1, y: 0, z: -1 }, width), `${width}: under the floor`).toBe(false);
    }
  });

  it('seats forty bodies, each in a place of its own, on the bucket’s floor and no wider, the same every time', () => {
    for (const width of [6.5, 8, 10, 12.5]) {
      const seats = Array.from({ length: SCOOP[3].load }, (_, n) => seat(n, width));
      expect(seatColumns(width)).toBeGreaterThanOrEqual(2);
      for (const [n, s] of seats.entries()) {
        expect(s.x, `${width}: ${n} ahead of the blade`).toBeGreaterThan(BLADE_AT + 0.3);
        expect(s.x, `${width}: ${n} short of the lip`).toBeLessThan(BLADE_AT + MOUTH_DEEP);
        expect(Math.abs(s.y), `${width}: ${n} between the cheeks`).toBeLessThan(floorHalf(width) - 0.3);
        expect(s.z, `${width}: ${n} above the floor`).toBeGreaterThan(0.3);
        expect(seat(n, width), 'no chance in it').toEqual(s);
      }
      // none sits inside another
      for (let a = 0; a < seats.length; a++)
        for (let b = a + 1; b < seats.length; b++)
          expect(
            Math.hypot(seats[a].x - seats[b].x, seats[a].y - seats[b].y, (seats[a].z - seats[b].z) * 1.6),
            `${width}: ${a} and ${b}`,
          ).toBeGreaterThan(0.3);
    }
  });

  it('rises and tips about its lip, and the picture’s matrix says the same', () => {
    expect(bucketPoint({ x: 5, y: 1, z: 2 }, 0, 0), 'at rest it is where it is modelled').toEqual({ x: 5, y: 1, z: 2 });
    const up = bucketPoint({ x: BLADE_AT, y: 0, z: 0 }, 1, 0);
    expect(up.z, 'the lip rises by the blade’s rise, and the tilt does not move it').toBeCloseTo(BLADE_RISE, 6);
    expect(bucketTilt(1, 0), 'tipped back to carry').toBeLessThan(0);
    expect(bucketTilt(0, 1), 'forward to pour').toBeGreaterThan(0);
    const out = new Float32Array(16);
    for (const [lift, dump] of [
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
        const want = bucketPoint(p, lift, dump);
        // the machine at (10, -4) turned 0.7 about the vertical
        const yaw = 0.7;
        placeTipped(out, 0, 10, -4, 0, yaw, BLADE_AT, lift * BLADE_RISE, bucketTilt(lift, dump));
        const got = [
          out[0] * p.x + out[4] * p.y + out[8] * p.z + out[12],
          out[1] * p.x + out[5] * p.y + out[9] * p.z + out[13],
          out[2] * p.x + out[6] * p.y + out[10] * p.z + out[14],
        ];
        const c = Math.cos(yaw),
          s = Math.sin(yaw);
        const expected = [10 + c * want.x - s * want.y, -4 + s * want.x + c * want.y, want.z];
        got.forEach((v, k) => expect(v, `lift ${lift}, dump ${dump}, axis ${k}`).toBeCloseTo(expected[k], 4));
      }
    }
    // nothing raised, nothing tipped: the plain placement, as the blade is drawn without a scoop
    const plain = new Float32Array(16);
    place(plain, 0, 3, 4, 0, 1.2);
    placeTipped(out, 0, 3, 4, 0, 1.2, BLADE_AT, 0, 0);
    plain.forEach((v, k) => expect(out[k]).toBeCloseTo(v, 6));
  });
});

describe('the blade, raised', () => {
  const k1 = new Dozer(grid(), TEST_GRID);
  it('is as it was with nothing lifted, bit for bit, and a drone is never lifted', () => {
    const d = new Dozer(grid(), TEST_GRID, 0.5, 3);
    Object.assign(d, { x: 10, y: -20, yaw: 0.4, speed: 5, yawRate: 0.2 });
    const plain = d.pushers(PLAYER_SPEC, []);
    expect(d.pushers(PLAYER_SPEC, [], 0)).toEqual(plain);
    const pieces = bladePieces(PLAYER_SPEC.bladeWidth);
    expect(plain).toHaveLength(pieces.length + 1);
    // what a blade piece's centre was, written out as it was before there was a lift
    plain.slice(0, pieces.length).forEach((p) => expect(p.z).toBe((BLADE_HEIGHT / 2) * 0.5));
  });

  it('stands clear of the floor with the scoop up, to the height of the rise, the hull as it was', () => {
    const plain = k1.pushers(PLAYER_SPEC, []).map((p) => ({ ...p }));
    const up = k1.pushers(PLAYER_SPEC, [], 1);
    const n = plain.length - 1;
    for (let k = 0; k < n; k++) {
      expect(up[k].z - up[k].hz, `piece ${k} off the floor`).toBeCloseTo(BLADE_RISE, 9);
      expect({ ...up[k], z: 0 }).toEqual({ ...plain[k], z: 0 });
    }
    expect(up[n], 'the hull still shoves').toEqual(plain[n]);
    const half = k1.pushers(PLAYER_SPEC, [], 0.5);
    expect(half[0].z - half[0].hz).toBeCloseTo(BLADE_RISE / 2, 9);
  });
});

describe('the scoop in the game (criteria 1 to 6)', () => {
  it('1: takes up coins against two walls, which the blade leaves behind', () => {
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
    // a coin that is not in the corner, and one the other side of the wall's thickness
    const far = world.spawn(0, xface - 0.6, yface - 12, 0.45);
    for (let f = 0; f < 60; f++) world.step(DT, () => {});
    const scoop = new Scoop(world, (x, y) => {
      const tx = Math.floor((x - ORIGIN_X) / 4),
        ty = Math.floor((y - ORIGIN_Y) / 4);
      return solid[ty * TEST_GRID.cols + tx] === 1;
    });

    // the machine cannot be driven nearer than this, and the blade's face is beyond the corner: the coin in
    // it lies between the hull's nose and the blade, where the blade has nothing to push it with
    const [cx, cy] = corner[0];
    const along = (cx - dozer.x) * Math.cos(dozer.yaw) + (cy - dozer.y) * Math.sin(dozer.yaw);
    expect(along, 'behind the blade’s plate').toBeLessThan(BLADE_AT);
    expect(along, 'past the hull').toBeGreaterThan(HULL_HALF[0]);
    for (let f = 0; f < 60; f++) world.step(DT, () => {});
    expect(scoop.take(dozer, PLAYER_SPEC.bladeWidth, 12)).toBe(3);
    expect(scoop.held.slice().sort()).toEqual(coins.slice().sort());
    for (const i of coins) expect(world.carried[i]).toBe(1);
    expect(world.carried[far], 'one that is not in the mouth is left').toBe(0);
  });

  it('4: takes only what is worth something, nearest the blade first, and never more than the load', () => {
    for (const size of [1, 2, 3]) {
      const game = scene(size);
      const laid = [...coinsInMouth(game, 4, 7), ...coinsInMouth(game, 4, 7, 0.9, BLADE_AT + 0.6, 1.7)];
      const junk = [
        lay(game, BRICK_KIND, ...ahead(game, BLADE_AT + 0.9, 0.3), 0.6),
        game.stock.spawnBarrel(...ahead(game, BLADE_AT + 1.9, -1.3)),
      ];
      // a ruby and a gold bar right at the blade's middle, which are the nearest of all
      const gems = [
        lay(game, 1, ...ahead(game, BLADE_AT + 0.9, -0.2), 1.1),
        lay(game, 5, ...ahead(game, BLADE_AT + 1.2, 0.6), 1.0),
      ];
      const outside = [
        lay(game, 0, ...ahead(game, BLADE_AT + MOUTH_DEEP + 1.5), 0.6),
        lay(game, 0, ...ahead(game, BLADE_AT + 1.5), 6),
      ];
      const load = SCOOP[size].load;
      play(game, 1, still, press);
      const { world, scoop } = game;
      expect(scoop.held.length, `size ${size}`).toBe(Math.min(load, laid.length + gems.length));
      expect(scoop.held.length).toBeLessThanOrEqual(load);
      for (const i of scoop.held) expect(KIND_VALUE[world.kind[i]], 'worth something').toBeGreaterThan(0);
      for (const i of junk) expect(world.carried[i], 'a brick or a barrel is not taken').toBe(0);
      for (const i of outside) expect(world.carried[i], 'out of the mouth is left').toBe(0);
      for (const i of gems) expect(scoop.held, 'the gems are worth taking').toContain(i);
      // nearest first: nothing left in the mouth is nearer the blade's middle than the farthest taken
      const near = (i: number) => {
        const [bx, by] = ahead(game, BLADE_AT + 0.9);
        return Math.hypot(world.x[i] - bx, world.y[i] - by);
      };
      const farthest = Math.max(...scoop.held.map(near));
      for (const i of laid)
        if (!scoop.held.includes(i)) expect(near(i) + 0.5, 'a nearer one left behind').toBeGreaterThanOrEqual(farthest);
      expect(checkInvariants(game)).toEqual([]);
    }
  });

  it('4: a full scoop pressed again tips out and does not take more', () => {
    const game = scene(1);
    coinsInMouth(game, 5, 7);
    play(game, 1, still, press);
    expect(game.scoop.held).toHaveLength(12);
    play(game, 1, still, press);
    expect(game.scoop.held, 'pressed again, it tips and holds nothing').toHaveLength(0);
  });

  it('2: a full scoop reaches the engine’s top speed, and the same pile pushed does not', () => {
    const speeds: Record<string, { speed: number; load: number }> = {};
    for (const scooped of [false, true]) {
      withSeed(2, () => {
        const game = scene(2);
        // 24 coins, four across and three deep and two high, against the blade
        const slots: number[] = [];
        for (let layer = 0; layer < 2; layer++)
          for (let a = 0; a < 3; a++)
            for (let c = 0; c < 4; c++)
              slots.push(lay(game, 0, ...ahead(game, BLADE_AT + 0.7 + a * 0.9, (c - 1.5) * 0.9), 0.5 + layer * 0.8));
        play(game, 60, still);
        if (scooped) play(game, 1, still, press);
        expect(game.scoop.held.length, scooped ? 'the pile is taken up' : 'nothing taken').toBe(scooped ? 24 : 0);
        let peak = 0;
        for (let f = 0; f < 150; f++) {
          game.step(DT, forward);
          peak = Math.max(peak, game.world.load);
        }
        speeds[scooped ? 'carried' : 'pushed'] = { speed: game.dozer.speed, load: peak };
        expect(checkInvariants(game)).toEqual([]);
      });
    }
    const top = PLAYER_SPEC.maxSpeed;
    expect(speeds.carried.speed, `carried: ${JSON.stringify(speeds.carried)}`).toBeGreaterThan(top * 0.99);
    expect(speeds.carried.load, 'what is held never counts toward the load').toBe(0);
    expect(speeds.pushed.speed, `pushed: ${JSON.stringify(speeds.pushed)}`).toBeLessThan(top * 0.9);
    expect(speeds.pushed.load).toBeGreaterThan(10);
  });

  it('5: with a load up the blade pushes nothing, which it does with none', () => {
    const run = (loaded: boolean) => {
      const game = scene(2);
      // coins in the strip between the hull and the blade's wing, which only the blade reaches
      const strip = [-1, 1].flatMap((side) =>
        [8, 11, 14, 17].map((a) => lay(game, 0, ...ahead(game, a, side * 3.0), 0.43)),
      );
      play(game, 60, still);
      if (loaded) {
        coinsInMouth(game, 2, 2);
        play(game, 1, still, press);
        play(game, Math.ceil(LIFT_TIME * 60) + 4, still);
        expect(game.scoop.lift, 'up').toBe(1);
      }
      const from = strip.map((i) => [game.world.x[i], game.world.y[i]]);
      play(game, 120, forward);
      return strip.map((i, k) => Math.hypot(game.world.x[i] - from[k][0], game.world.y[i] - from[k][1]));
    };
    const moved = run(true);
    for (const [k, d] of moved.entries()) expect(d, `coin ${k} not touched with the load up`).toBeLessThan(0.3);
    const control = run(false);
    expect(control.filter((d) => d > 1).length, 'the blade down shoves most of them').toBeGreaterThanOrEqual(4);
  });

  it('3: tipped at the hole’s edge, the load is banked', () => {
    withSeed(3, () => {
      const log: string[] = [];
      const game = scene(
        2,
        {},
        { tipped: (n) => log.push(`tipped ${n}`), scooped: (n) => log.push(`scooped ${n}`) },
        {
          x: 0,
          y: -22,
          yaw: Math.PI / 2,
        },
      );
      const hole = game.cave.holes[0];
      const laid = coinsInMouth(game, 3, 4);
      play(game, 1, still, press);
      expect(game.scoop.held).toHaveLength(laid.length);
      // up to the lip of the hole, and stopped
      for (let f = 0; f < 600 && Math.hypot(game.dozer.x - hole.x, game.dozer.y - hole.y) > hole.radius + 4.6; f++)
        game.step(DT, forward);
      play(game, 90, still);
      expect(Math.abs(game.dozer.speed)).toBeLessThan(0.1);
      expect(game.economy.bank, 'nothing banked while it was carried').toBe(0);
      expect(game.world.live, 'all still in the cave').toBeGreaterThanOrEqual(laid.length);
      play(game, 1, still, press);
      expect(game.scoop.held).toHaveLength(0);
      play(game, 240, still);
      expect(game.economy.bank, 'the load, banked').toBe(laid.length);
      expect(log).toEqual([`scooped ${laid.length}`, `tipped ${laid.length}`]);
      expect(checkInvariants(game)).toEqual([]);
    });
  });

  it('6: three levels, each dearer and larger, and an old save loads with none', () => {
    expect(SCOOP.map((s) => s.load)).toEqual([0, 12, 24, 40]);
    const loads = [1, 2, 3].map((size) => scene(size).economy.scoopLoad());
    expect(loads).toEqual([12, 24, 40]);
    expect(scene(0).economy.scoopLoad()).toBe(0);
  });

  it('does nothing with no scoop bought, whatever is pressed', () => {
    const game = scene(0);
    coinsInMouth(game, 3, 3);
    play(game, 30, still, press);
    expect(game.scoop.held).toHaveLength(0);
    expect(game.scoop.lift).toBe(0);
  });

  it('tips out ahead at the dozer’s speed and a little more, forwards even when backing up', () => {
    const game = scene(2);
    coinsInMouth(game, 2, 3);
    play(game, 1, still, press);
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
    coinsInMouth(back, 2, 3);
    play(back, 40, still, press);
    const there = back.scoop.held.slice();
    Object.assign(back.dozer, { speed: -5 });
    back.scoop.tip(back.dozer);
    for (const i of there) expect(back.world.vx[i], 'ahead, not behind').toBeCloseTo(TIP_EXTRA, 5);
  });

  it('puts what it holds where the bucket is, rising and settling in game time, and lowers the bucket when it is empty', () => {
    const game = scene(3);
    coinsInMouth(game, 4, 5);
    play(game, 1, still, press);
    expect(game.scoop.lift).toBeGreaterThan(0);
    expect(game.scoop.lift).toBeLessThan(1);
    play(game, Math.ceil((GATHER_TIME + LIFT_TIME) * 60) + 3, still);
    expect(game.scoop.lift).toBe(1);
    expect(wherePut(game)).toEqual([]);
    // driving turns it with the machine
    play(game, 60, { throttle: 0.5, steer: 1 });
    expect(wherePut(game)).toEqual([]);
    play(game, 1, still, press);
    expect(game.scoop.dump, 'pouring').toBeGreaterThan(0.9);
    play(game, Math.ceil(Math.max(LIFT_TIME, DUMP_TIME) * 60) + 3, still);
    expect(game.scoop.lift).toBe(0);
    expect(game.scoop.dump).toBe(0);
  });
});

describe('the scoop’s edge cases', () => {
  it('the hole: carried over it, nothing falls in; tipped over it, it does', () => {
    const game = scene(2, {}, {}, { x: 0, y: -24, yaw: Math.PI / 2 });
    coinsInMouth(game, 3, 3);
    play(game, 1, still, press);
    const n = game.scoop.held.length;
    expect(n).toBe(9);
    // driven right over the hole with it
    play(game, 300, forward);
    const hole = game.cave.holes[0];
    expect(Math.hypot(game.dozer.x - hole.x, game.dozer.y - hole.y), 'went by it').toBeLessThan(40);
    play(game, 100, { throttle: 0, steer: 0 });
    expect(game.economy.bank, 'carried over the hole, none went down').toBe(0);
    expect(game.scoop.held).toHaveLength(n);
    expect(checkInvariants(game)).toEqual([]);
  });

  it('leaving: the cave left with a load counts it lost, and the load is never carried to the next', () => {
    const lost: number[] = [];
    const game = scene(2, {}, { caveLeft: (_, n) => lost.push(n) });
    coinsInMouth(game, 3, 4);
    play(game, 1, still, press);
    play(game, 30, still);
    expect(game.scoop.held).toHaveLength(12);
    game.economy.open();
    const before = game.stock.lyingAll();
    expect(before, 'what the cave holds includes the load').toBeGreaterThanOrEqual(heldValue(game));
    const { beyond } = exitPoints(game.cave)!;
    expect(pastLeavingLine(game.cave, beyond.x, beyond.y)).toBe(true);
    Object.assign(game.dozer, { x: beyond.x, y: beyond.y });
    game.step(DT, still);
    expect(game.left).toBe(true);
    expect(lost, 'counted lost, the load with the rest').toEqual([before]);
    const next = new Game(game.economy, caveOf(game.economy.cave().id));
    expect(next.scoop.held, 'nothing carried into the next cave').toEqual([]);
    expect(checkInvariants(next)).toEqual([]);
  });

  it('save: reloaded with a load, the coins are back in their heaps and the bank is as it was; the load is not saved', () => {
    withSeed(7, () => {
      const game = scene(2);
      coinsInMouth(game, 3, 4);
      play(game, 1, still, press);
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
      for (let i = 0; i < again.world.count; i++) expect(again.world.carried[i]).toBe(0);
      expect(checkInvariants(again)).toEqual([]);
    });
  });

  it('save: a save from before the scoop plays with none, and the scoop is not in it', () => {
    const game = gameIn('hollow');
    expect(game.economy.save.scoop).toBe(0);
    game.step(DT, still, press);
    expect(game.scoop.held).toEqual([]);
  });

  it('blasts and the horn: a held body is left alone', () => {
    withSeed(8, () => {
      const names: string[] = [];
      const game = scene(2, { horn: true }, { blast: () => names.push('blast') });
      coinsInMouth(game, 3, 3);
      play(game, 1, still, press);
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
      game.honk();
      // a barrel close by, going off, and loose coins by it that are
      const bystander = lay(game, 0, ...ahead(game, 9, 6), 0.6);
      const barrel = game.stock.spawnBarrel(...ahead(game, 9, 5));
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

  it('the magnet and belts: held bodies are not pulled or carried off', () => {
    const magnet = scene(2, { magnet: 5 });
    coinsInMouth(magnet, 3, 3);
    play(magnet, 1, still, press);
    // loose coins well inside the magnet's reach, which pull in; the held ones stay where they were put
    for (let k = 0; k < 6; k++) lay(magnet, 0, ...ahead(magnet, 12 + k, 2), 0.6);
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
    coinsInMouth(south, 3, 3);
    play(south, 1, still, press);
    expect(south.scoop.held.length).toBeGreaterThan(0);
    play(south, 180, still);
    expect(wherePut(south), 'not carried off along the belt').toEqual([]);
    expect(checkInvariants(south)).toEqual([]);
  });

  it('rock: against a wall nothing held is in the rock, and tipped out it is not left in it', () => {
    const game = scene(3);
    coinsInMouth(game, 4, 5);
    play(game, 1, still, press);
    expect(game.scoop.held).toHaveLength(20);
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
    play(game, 1, forward, press);
    play(game, 240, still);
    expect(checkInvariants(game), 'nothing left in the rock').toEqual([]);
  });

  it('rock: nothing is taken from the far side of a wall', () => {
    const world = makeWorld(TEST_BODIES, grid(), TEST_GRID, []);
    const dozer = new Dozer(grid(), TEST_GRID);
    Object.assign(dozer, { x: 0, y: ORIGIN_Y + 100, yaw: 0 });
    const at = (along: number) => world.spawn(0, along, ORIGIN_Y + 100, 0.45);
    const before = at(BLADE_AT + 0.5);
    const behind = at(BLADE_AT + 2.5);
    // a thin wall across the mouth, just short of the second coin: the rock is the test's own
    const scoop = new Scoop(world, (x) => x > BLADE_AT + 1.5 && x < BLADE_AT + 2.0);
    expect(inMouth({ x: BLADE_AT + 2.5, y: 0, z: 0.45 }, PLAYER_SPEC.bladeWidth), 'in the mouth').toBe(true);
    scoop.take(dozer, PLAYER_SPEC.bladeWidth, 12);
    expect(scoop.held).toEqual([before]);
    expect(world.carried[behind]).toBe(0);
  });

  it('drones: never take it for their own, and a coin one had chosen that is taken up is let go', () => {
    const game = scene(2, { drones: 1 });
    coinsInMouth(game, 3, 3);
    const bot = game.bots[0];
    play(game, 1, still, press);
    const held = new Set(game.scoop.held);
    // whatever the foreman picks from here on, it is not in the bucket
    for (let f = 0; f < 600; f++) {
      game.step(DT, still);
      expect(held.has(bot.coin), `frame ${f}: the drone is after a held coin`).toBe(false);
    }
    expect(checkInvariants(game)).toEqual([]);
  });

  it('scale: forty held in the widest blade and the narrowest, and the width is the mouth’s', () => {
    for (const blade of [0, 3]) {
      const game = scene(3, { blade });
      const width = game.economy.spec().bladeWidth;
      // sixty coins across more than the narrowest's width, in two layers
      const across = Math.floor((width + 2) / 0.9);
      const laid = [...coinsInMouth(game, 4, across), ...coinsInMouth(game, 4, across, 0.9, BLADE_AT + 0.6, 1.5)];
      play(game, 1, still, press);
      const taken = game.scoop.held;
      expect(taken.length, `blade ${width}`).toBe(Math.min(40, laid.length));
      play(game, 90, still);
      expect(wherePut(game, width)).toEqual([]);
      expect(checkInvariants(game)).toEqual([]);
    }
    // the narrow blade reaches no wider than itself
    const narrow = scene(3, { blade: 0 });
    const out = lay(narrow, 0, ...ahead(narrow, BLADE_AT + 1.2, 6.5 / 2 + 1.2));
    const inside = lay(narrow, 0, ...ahead(narrow, BLADE_AT + 1.2, 6.5 / 2 - 0.3));
    play(narrow, 1, still, press);
    expect(narrow.scoop.held).toEqual([inside]);
    expect(narrow.world.carried[out]).toBe(0);
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
      play(game, 1, still, press);
      for (let f = 0; f < 480; f++) game.step(DT, still);
      expect(checkInvariants(game)).toEqual([]);
      play(game, 1, still, press);
      for (let f = 0; f < 240; f++) game.step(DT, still);
      expect(checkInvariants(game)).toEqual([]);
    });
  });

  it('hashes what it holds and in what order, so a run that parts on it is caught', () => {
    const game = scene(2);
    coinsInMouth(game, 3, 3);
    play(game, 1, still, press);
    play(game, 40, still);
    const a = hashGame(game);
    expect(hashGame(game), 'the same twice').toBe(a);
    game.scoop.held.reverse();
    expect(hashGame(game), 'a different order').not.toBe(a);
    game.scoop.held.reverse();
    game.scoop.lift = 0.5;
    expect(hashGame(game), 'a bucket at another height').not.toBe(a);
  });
});

describe('the invariants of the scoop', () => {
  const held = () => {
    const game = scene(2);
    coinsInMouth(game, 3, 3);
    play(game, 1, still, press);
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

  it('notice something carried that the scoop does not hold, and more held than it takes', () => {
    const a = held();
    const loose = lay(a, 0, ...ahead(a, 12), 3);
    a.world.carried[loose] = 1;
    expect(checkInvariants(a).join('\n')).toContain('carried, and the scoop does not hold it');
    // nine held, and a scoop of none: more than it takes
    const b = held();
    expect(b.scoop.held).toHaveLength(9);
    b.economy.save.scoop = 0;
    expect(checkInvariants(b).join('\n')).toContain('9 held, and the scoop takes 0');
  });
});
