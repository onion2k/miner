/**
 * The Spiderdozer's legs: eight of them, walking. The gait is its own
 * module, handed only where the machine is and which way it faces, and it
 * says where every hip, knee and foot is. What it must do: keep a planted
 * foot where it was while the body moves on, lift and swing a leg only when
 * it has been left behind, never lift more than half the legs at once and
 * alternate which half, reach no further than a spider's legs would, and
 * say when a foot lands, for the footprint.
 */
import { describe, expect, it } from 'vitest';
import { FEMUR, LEGS, REACH, REST, SpiderGait, TIBIA } from '../src/spider';

const DT = 1 / 60;
type Pose = { x: number; y: number; yaw: number };

/** Walk the gait along a path, calling `each` after every step of the clock. */
function walk(gait: SpiderGait, seconds: number, pose: (t: number) => Pose, each?: (t: number) => void) {
  for (let f = 1; f <= seconds * 60; f++) {
    gait.update(DT, pose(f * DT));
    each?.(f * DT);
  }
}
const forward = (speed: number) => (t: number) => ({ x: speed * t, y: 0, yaw: 0 });
const A = [0, 2, 5, 7],
  B = [1, 3, 4, 6];

describe('the spider’s gait', () => {
  it('has eight legs, splayed like a spider’s, hips at the hull’s flanks', () => {
    expect(LEGS).toBe(8);
    expect(REST).toHaveLength(LEGS);
    for (const [x, y] of REST) {
      expect(Math.abs(y)).toBeGreaterThan(3.2);
      expect(Math.abs(y)).toBeLessThanOrEqual(REACH.y);
      expect(x).toBeLessThanOrEqual(REACH.front);
      expect(x).toBeGreaterThanOrEqual(-REACH.back);
    }
    // four a side, mirrored
    expect(REST.filter(([, y]) => y > 0)).toHaveLength(4);
    const gait = new SpiderGait();
    gait.update(DT, { x: 0, y: 0, yaw: 0 });
    for (const leg of gait.poses()) {
      expect(Math.abs(leg.hip[1])).toBeLessThan(2.0);
      expect(leg.hip[2]).toBeGreaterThan(1);
      expect(leg.hip[2]).toBeLessThan(2.6);
    }
  });

  it('stands still on planted feet, and takes no step', () => {
    const gait = new SpiderGait();
    const landed: number[] = [];
    gait.onStep = (leg) => landed.push(leg);
    walk(gait, 2, () => ({ x: 3, y: -5, yaw: 0.4 }));
    expect(landed).toEqual([]);
    for (const leg of gait.poses()) {
      expect(leg.airborne).toBe(false);
      expect(leg.foot[2]).toBeCloseTo(0, 6);
    }
  });

  it('walks: every leg steps, feet stay put while planted, and no more than half are in the air', () => {
    const gait = new SpiderGait();
    const steps = new Array<number>(LEGS).fill(0);
    gait.onStep = (leg) => steps[leg]++;
    let planted = gait.poses().map((l) => [...l.foot]);
    let mostInAir = 0;
    walk(gait, 3, forward(8), () => {
      const poses = gait.poses();
      let inAir = 0;
      poses.forEach((l, k) => {
        if (l.airborne) inAir++;
        else if (!gait.poses()[k].airborne && planted[k] && !l.justLanded) {
          // a planted foot does not slide
          expect(Math.hypot(l.foot[0] - planted[k][0], l.foot[1] - planted[k][1])).toBeLessThan(1e-6);
        }
        expect(l.foot[2]).toBeGreaterThanOrEqual(-1e-6);
        expect(l.foot[2]).toBeLessThanOrEqual(1.2);
      });
      planted = poses.map((l) => [...l.foot]);
      mostInAir = Math.max(mostInAir, inAir);
    });
    for (let k = 0; k < LEGS; k++) expect(steps[k], `leg ${k} stepped`).toBeGreaterThanOrEqual(2);
    expect(mostInAir).toBeGreaterThan(0);
    expect(mostInAir).toBeLessThanOrEqual(LEGS / 2);
  });

  it('lifts the legs in two alternating sets, as a spider does', () => {
    const gait = new SpiderGait();
    // each swing as it begins: the legs that lifted this frame, which set they are, in order.
    // One set lifts the frame the other lands, so there is no frame with every foot down to wait for.
    const swings: ('A' | 'B')[] = [];
    let wasUp = new Array<boolean>(LEGS).fill(false);
    walk(gait, 3, forward(8), () => {
      const up = gait.poses().map((l) => l.airborne);
      const lifted = up.map((u, k) => (u && !wasUp[k] ? k : -1)).filter((k) => k >= 0);
      wasUp = up;
      if (!lifted.length) return;
      const inA = lifted.every((k) => A.includes(k)),
        inB = lifted.every((k) => B.includes(k));
      expect(inA || inB, `legs ${lifted.join(',')} lifted together`).toBe(true);
      swings.push(inA ? 'A' : 'B');
      // and never both sets in the air at once
      const air = up.map((u, k) => (u ? k : -1)).filter((k) => k >= 0);
      expect(air.every((k) => A.includes(k)) || air.every((k) => B.includes(k)), `in the air: ${air.join(',')}`).toBe(
        true,
      );
    });
    expect(swings.length).toBeGreaterThan(3);
    for (let k = 1; k < swings.length; k++) expect(swings[k], `swing ${k}`).not.toBe(swings[k - 1]);
  });

  it('keeps each leg’s bones their length, knee up, wherever the foot is', () => {
    const gait = new SpiderGait();
    walk(gait, 2, forward(10), () => {
      for (const l of gait.poses()) {
        expect(Math.hypot(...sub(l.knee, l.hip))).toBeCloseTo(FEMUR, 3);
        expect(Math.hypot(...sub(l.foot, l.knee))).toBeCloseTo(TIBIA, 3);
        expect(l.knee[2]).toBeGreaterThan(l.foot[2]);
      }
    });
  });

  it('steps round when the body turns on the spot', () => {
    const gait = new SpiderGait();
    let steps = 0;
    gait.onStep = () => steps++;
    walk(gait, 3, (t) => ({ x: 0, y: 0, yaw: t * 1.5 }));
    expect(steps).toBeGreaterThanOrEqual(LEGS);
  });

  it('says where a foot lands, once a landing', () => {
    const gait = new SpiderGait();
    const landings: [number, number][] = [];
    gait.onStep = (_, x, y) => landings.push([x, y]);
    walk(gait, 2, forward(8));
    expect(landings.length).toBeGreaterThan(8);
    // where it said the foot landed is where the foot then stood
    const last = landings[landings.length - 1];
    const stood = gait.poses().some((l) => Math.hypot(l.foot[0] - last[0], l.foot[1] - last[1]) < 1e-3);
    expect(stood).toBe(true);
  });
});

function sub(a: readonly number[], b: readonly number[]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
