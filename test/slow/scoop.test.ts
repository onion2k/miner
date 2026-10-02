/**
 * The scoop's first criterion, played: lowered, a bucket is as good at pushing as the blade it replaces. A
 * field of coins and gems on a bare floor is pushed sixty units in a straight line, on six seeds, by a blade
 * and by a bucket of the same width, and what each still has in front of it at the end is counted. Slow,
 * since each is a few hundred bodies stepped for seven seconds.
 */
import { describe, expect, it } from 'vitest';
import { gridOf } from '../../src/cave';
import { BLADE_AT, Dozer, type DozerSpec } from '../../src/dozer';
import { BLADE, SCOOP } from '../../src/economy';
import { makeWorld, type Pusher } from '../../src/physics';
import { PLAYER_SPEC } from '../helpers';

const DT = 1 / 60;
const SEEDS = [1, 2, 3, 4, 5, 6];
const BODIES = 220;

/** Chance from a seed, the test's own, so the same field is laid for the blade and for the bucket. */
function chance(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

/** How many of the field a machine still has in front of it after pushing it sixty units, and how long it took. */
function push(spec: DozerSpec, seed: number): { kept: number; seconds: number } {
  const grid = gridOf({ cols: 104, rows: 64 });
  const solid = new Uint8Array(grid.cols * grid.rows);
  const random = chance(seed);
  const world = makeWorld(4000, solid, grid, [], [], random);
  const dozer = new Dozer(solid, grid);
  Object.assign(dozer, { x: -80, y: 0, yaw: 0, speed: 0 });
  // wider than the widest bucket, and thinning out: what the edge of a heap is like
  const slots: number[] = [];
  for (let k = 0; k < BODIES; k++)
    slots.push(
      world.spawn(k % 12 === 0 ? 1 + (k % 4) : 0, -68 + random() * 14, (random() - 0.5) * 13, 0.6 + random() * 2),
    );
  for (let f = 0; f < 240; f++) world.step(DT, () => {});
  const boxes: Pusher[] = [];
  let frames = 0;
  while (dozer.x < -20 && frames < 60 * 60) {
    dozer.update(DT, { throttle: 1, steer: 0 }, spec, world.load);
    world.pushers = dozer.pushers(spec, boxes);
    world.magnet = {
      x: dozer.x + BLADE_AT + 1.2,
      y: dozer.y,
      radius: spec.magnetRadius,
      strength: spec.magnetStrength,
    };
    world.wakeNear(dozer.x + BLADE_AT, dozer.y, spec.bladeWidth + 4);
    world.step(DT, () => {});
    frames++;
  }
  let kept = 0;
  for (const i of slots)
    if (world.alive[i] && world.x[i] > dozer.x + BLADE_AT - 0.5 && world.x[i] < dozer.x + BLADE_AT + 9) kept++;
  return { kept, seconds: frames / 60 };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('criterion 1: lowered, the scoop keeps hold of as much as a blade of its width', () => {
  it.each([1, 2, 3])('size %i, over six seeds', (size) => {
    const width = SCOOP[size].width;
    const blade = SEEDS.map((seed) => push({ ...PLAYER_SPEC, bladeWidth: width }, seed));
    const bucket = SEEDS.map((seed) => push({ ...PLAYER_SPEC, bladeWidth: width, bucket: true }, seed));
    const said = `${width} across: the blade keeps ${blade.map((r) => r.kept).join(', ')} and the bucket ${bucket.map((r) => r.kept).join(', ')} of ${BODIES}`;
    // doing nothing is a failure: both got there, and both had something to show for it
    for (const r of [...blade, ...bucket]) {
      expect(r.seconds, said).toBeLessThan(30);
      expect(r.kept, said).toBeGreaterThan(20);
    }
    expect(mean(bucket.map((r) => r.kept)), said).toBeGreaterThanOrEqual(mean(blade.map((r) => r.kept)));
    // and on no seed is it much the worse: a tenth of the field is the most it gives away
    bucket.forEach((r, k) => expect(r.kept, `seed ${SEEDS[k]}: ${said}`).toBeGreaterThan(blade[k].kept - BODIES / 10));
    // it is slower only by what it is pushing: never by more than a quarter
    expect(mean(bucket.map((r) => r.seconds)), said).toBeLessThan(mean(blade.map((r) => r.seconds)) * 1.25);
  });
});

describe('what a scoop costs, against the blades that push as well', () => {
  const kept = (spec: DozerSpec) => mean(SEEDS.map((seed) => push(spec, seed).kept));
  /** What every level up to and including `level` costs together. */
  const upTo = (table: readonly { cost: number }[], level: number) =>
    table.slice(0, level + 1).reduce((n, row) => n + row.cost, 0);

  it('is dearer than them, at every size: a scoop does what they do and carries as well', () => {
    const blades = BLADE.map((b, level) => ({
      width: b.width,
      paid: upTo(BLADE, level),
      kept: kept({ ...PLAYER_SPEC, bladeWidth: b.width }),
    }));
    for (let size = 1; size < SCOOP.length; size++) {
      const bucket = kept({ ...PLAYER_SPEC, bladeWidth: SCOOP[size].width, bucket: true });
      const paid = upTo(SCOOP, size);
      // the dearest blade that pushes no better than this bucket: to match it by blades costs at least that
      const matched = blades.filter((b) => b.kept <= bucket + BODIES / 50).pop()!;
      const said = `scoop ${size} keeps ${bucket.toFixed(0)} for ${paid}; a blade ${matched.width} across keeps ${matched.kept.toFixed(0)} for ${matched.paid}`;
      expect(matched.paid, `${said}: it has a blade to be held to`).toBeGreaterThan(0);
      // half as much again, for the carrying, and no more than three times: dearer, not out of reach
      expect(paid, said).toBeGreaterThanOrEqual(matched.paid * 1.4);
      expect(paid, said).toBeLessThanOrEqual(matched.paid * 3.2);
    }
    // each size costs more than the last, and the steps grow, as every other line of the workshop's do
    for (let size = 2; size < SCOOP.length; size++)
      expect(SCOOP[size].cost).toBeGreaterThan(SCOOP[size - 1].cost * 1.5);
  });
});
