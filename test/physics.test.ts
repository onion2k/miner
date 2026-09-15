import { describe, expect, it } from 'vitest';
import { AREAS, BODY_CAPACITY, HOLE, buildCave } from '../src/cave';
import { KIND_RADIUS, KIND_VALUE, World, type Pusher } from '../src/physics';
import { beltOf } from '../src/tools';
import { Dozer } from '../src/dozer';
import { COLS, ORIGIN_X, TILE } from '../src/cave';
import { grid, tileAt, withSeed } from './helpers';

const DT = 1 / 60;
const cave = buildCave();
const openSolid = () => cave.solid(AREAS.map(() => true));

/** The private parts of the world the invariants are about. */
interface Innards {
  awake: Int32Array;
  awakeCount: number;
  listed: Uint8Array;
  sleepHead: Int32Array;
  sleepPrev: Int32Array;
  sleepCell: Int32Array;
  next: Int32Array;
  cellOf(x: number, y: number): number;
}

/**
 * The bookkeeping the stepping relies on, between steps: the awake list has
 * no repeats and everything awake is on it; every sleeper's cell chain links
 * both ways and says which cell it is; and a sleeper not listed to be sorted
 * out lies in the cell it is chained in. Returns what is wrong, if anything.
 */
function problems(world: World): string[] {
  const w = world as unknown as Innards;
  const out: string[] = [];
  const onList = new Uint8Array(world.capacity);
  for (let k = 0; k < w.awakeCount; k++) {
    const i = w.awake[k];
    if (onList[i]) out.push(`body ${i} twice on the awake list`);
    if (!w.listed[i]) out.push(`body ${i} on the awake list and not flagged`);
    onList[i] = 1;
  }
  let chained = 0;
  for (let c = 0; c < w.sleepHead.length; c++) {
    for (let i = w.sleepHead[c], prev = -1; i >= 0; prev = i, i = w.next[i]) {
      if (chained++ > world.count) return [...out, 'a sleeper chain runs round on itself'];
      if (w.sleepPrev[i] !== prev) out.push(`sleeper ${i} links back to ${w.sleepPrev[i]}, not ${prev}`);
      if (w.sleepCell[i] !== c) out.push(`sleeper ${i} chained in cell ${c} thinks it is in ${w.sleepCell[i]}`);
      if (!onList[i] && !(world.alive[i] && world.asleep[i])) out.push(`stale sleeper ${i} not listed`);
    }
  }
  let withCell = 0;
  for (let i = 0; i < world.count; i++) {
    if (w.sleepCell[i] >= 0) withCell++;
    if (!world.alive[i]) continue;
    if (!world.asleep[i] && !onList[i]) out.push(`awake body ${i} missing from the awake list`);
    else if (world.asleep[i] && !onList[i]) {
      if (w.sleepCell[i] < 0) out.push(`sleeper ${i} in no cell`);
      else if (w.sleepCell[i] !== w.cellOf(world.x[i], world.y[i])) out.push(`sleeper ${i} has moved out of its cell`);
    }
  }
  if (withCell !== chained) out.push(`${withCell} bodies think they are chained, ${chained} are`);
  return out;
}

/** A box driven round a circle through a heap, as a blade is. */
function sweeper(cx: number, cy: number, radius: number, t: number, prev: Pusher | null, owner = 0): Pusher {
  const a = t * 0.6,
    x = cx + Math.cos(a) * radius,
    y = cy + Math.sin(a) * radius;
  return {
    x,
    y,
    z: 1.5,
    yaw: a + Math.PI / 2,
    hx: 0.4,
    hy: 3.5,
    hz: 1.5,
    vx: prev ? (x - prev.x) / DT : 0,
    vy: prev ? (y - prev.y) / DT : 0,
    spin: 0.6,
    px: prev?.x ?? x,
    py: prev?.y ?? y,
    owner,
  };
}

describe('the physics', () => {
  it('lets a dropped coin come to rest on the floor, and sleep', () => {
    const world = new World(16, openSolid());
    const i = world.spawn(0, -30, 10, 5);
    for (let f = 0; f < 180; f++) world.step(DT, () => {});
    expect(world.z[i]).toBeCloseTo(KIND_RADIUS[0], 2);
    expect(world.asleep[i]).toBe(1);
  });

  it('banks what goes down the hole, once, and frees its slot', () => {
    const world = new World(16, openSolid());
    const kinds = [0, 1, 4, 5];
    for (const k of kinds) world.spawn(k, HOLE.x + (Math.random() - 0.5), HOLE.y + (Math.random() - 0.5), 2);
    const banked: number[] = [];
    for (let f = 0; f < 240; f++) world.step(DT, (kind) => banked.push(kind));
    expect(banked.sort()).toEqual(kinds);
    expect(world.live).toBe(0);
    expect(banked.reduce((s, k) => s + KIND_VALUE[k], 0)).toBe(1 + 10 + 100 + 250);
    // the freed slots are used again before any new one
    world.spawn(0, -30, 10, 1);
    expect(world.count).toBe(kinds.length);
  });

  it('refuses a body when full', () => {
    const world = new World(2, openSolid());
    expect(world.spawn(0, -30, 10, 1)).toBe(0);
    expect(world.spawn(0, -31, 10, 1)).toBe(1);
    expect(world.spawn(0, -32, 10, 1)).toBe(-1);
  });

  it('keeps its sleep bookkeeping straight, and every body out of the rock, while blades churn a heap', () => {
    withSeed(7, () => {
      const world = new World(BODY_CAPACITY, openSolid());
      const heap = AREAS[0].heaps[0];
      for (let k = 0; k < 900; k++) {
        const r = Math.sqrt(Math.random()) * 9,
          a = Math.random() * Math.PI * 2;
        world.spawn(k % 50 === 0 ? 2 : 0, heap.x + Math.cos(a) * r, heap.y + Math.sin(a) * r, 1 + Math.random() * 6);
      }
      let pushers: Pusher[] = [];
      for (let f = 0; f < 600; f++) {
        const t = f * DT;
        // the blades only start after the heap has settled, so sleepers get woken and moved
        pushers =
          f < 120
            ? []
            : [
                sweeper(heap.x, heap.y, 7, t, pushers[0] ?? null),
                sweeper(heap.x + 2, heap.y - 1, 4, -t, pushers[1] ?? null, 1),
              ];
        world.pushers = pushers;
        for (const p of pushers) world.wakeNear(p.x, p.y, 6);
        world.step(DT, () => {});
        const wrong = problems(world);
        if (wrong.length) expect.fail(`frame ${f}: ${wrong.slice(0, 5).join('; ')}`);
      }
      for (let i = 0; i < world.count; i++) {
        if (!world.alive[i]) continue;
        const t = tileAt(world.x[i], world.y[i]);
        expect(t, `body ${i} off the grid`).toBeGreaterThanOrEqual(0);
        expect(world.solid[t], `body ${i} in rock at ${world.x[i]},${world.y[i]}`).toBe(0);
        expect(world.z[i]).toBeGreaterThan(-HOLE.depth);
      }
    });
  });

  it('never lets a blade push a coin into the rock, or through a wall a tile thick', () => {
    const spec = { maxSpeed: 17, accel: 28, turnRate: 2.2, bladeWidth: 12.5, magnetRadius: 0, magnetStrength: 0 };
    for (const thick of [1, 2]) {
      const solid = grid((tx) => tx >= 40 && tx < 40 + thick);
      const face = ORIGIN_X + 40 * TILE;
      for (const angle of [0, 0.3, -0.5]) {
        withSeed(7 + thick, () => {
          const world = new World(2000, solid);
          // a band of coins against the wall, and a big blade driven at them, backed off, and driven at them again
          for (let k = 0; k < 500; k++)
            world.spawn(0, face - 0.5 - Math.random() * 4, -10 + Math.random() * 20, 0.5 + Math.random() * 2);
          for (let f = 0; f < 60; f++) world.step(DT, () => {});
          const dozer = new Dozer(solid);
          dozer.x = face - 16;
          dozer.y = 0;
          dozer.yaw = angle;
          const pushers: Pusher[] = [];
          for (let f = 0; f < 60 * 5; f++) {
            dozer.update(DT, { throttle: f % 120 < 90 ? 1 : -1, steer: 0 }, spec, world.load);
            world.pushers = dozer.pushers(spec, pushers);
            world.wakeNear(dozer.x + Math.cos(dozer.yaw) * 4.3, dozer.y + Math.sin(dozer.yaw) * 4.3, 10);
            world.step(DT, () => {});
          }
          for (let i = 0; i < world.count; i++) {
            if (!world.alive[i]) continue;
            const t = tileAt(world.x[i], world.y[i]);
            if (solid[t]) expect.fail(`wall ${thick} thick, blade at ${angle}: coin ${i} in the rock`);
            if (world.x[i] > face)
              expect.fail(`wall ${thick} thick, blade at ${angle}: coin ${i} through to ${world.x[i].toFixed(1)}`);
          }
          expect(COLS).toBeGreaterThan(40 + thick);
        });
      }
    }
  });

  it('carries a coin along a running belt', () => {
    const belt = AREAS.find((a) => a.belt)!.belt!.spec;
    const world = new World(16, openSolid());
    world.belts = [beltOf(belt)];
    const b = world.belts[0];
    const start = { x: b.cx - b.dx * b.half * 0.5, y: b.cy - b.dy * b.half * 0.5 };
    const i = world.spawn(0, start.x, start.y, 1);
    for (let f = 0; f < 120; f++) world.step(DT, () => {});
    const along = (world.x[i] - start.x) * b.dx + (world.y[i] - start.y) * b.dy;
    expect(along).toBeGreaterThan(3);
  });
});
