/**
 * The Spiderdozer's legs: eight of them, walking. The machine underneath is
 * the bulldozer, moved by the same physics on the same boxes; this only says
 * where its legs are, from where the body is and which way it faces, and it
 * is handed nothing else.
 *
 * A spider walks in two sets of four — the first and third legs on one side
 * with the second and fourth on the other, then the other set — and so does
 * this. A planted foot stays where it was put while the body moves on; when
 * a set's feet have been left far enough behind their rest under the body,
 * the set lifts together, swings forward to where its rest will be a moment
 * from now, and plants again. Standing still, nothing moves. Each leg is
 * two bones, a femur from the hip and a tibia to the foot, and the knee is
 * put where those lengths allow, up.
 *
 * `onStep` is told when a foot lands and where, for the footprint.
 */

export type V3 = [number, number, number];

export const LEGS = 8;
/** The bones, hip to knee and knee to foot. */
export const FEMUR = 2.6,
  TIBIA = 3.4;
/** How far out the feet may stand from the pivot: a spider's splay, well past the hull. */
export const REACH = { front: 4.4, back: 4.2, y: 4.7 };
/**
 * Where each foot rests under the body, in the machine's frame: the four on
 * the left, front to back, then the four on the right.
 */
export const REST: readonly (readonly [number, number])[] = [
  [3.0, 4.2],
  [1.1, 4.55],
  [-1.0, 4.55],
  [-2.9, 4.1],
  [3.0, -4.2],
  [1.1, -4.55],
  [-1.0, -4.55],
  [-2.9, -4.1],
];
/** Where each leg joins the hull, in the machine's frame: along the flanks, at the body's height. */
const HIPS: readonly V3[] = REST.map(([x, y]) => [x * 0.75, Math.sign(y) * 1.75, 1.7]);
/** The two sets that walk together. */
const SET_A = [0, 2, 5, 7],
  SET_B = [1, 3, 4, 6];

/** How far a set's feet may be left behind before it steps; how long a swing takes; how high; and how far ahead it aims. */
const STRIDE = 0.75,
  SWING = 0.2,
  LIFT = 0.9,
  LEAD = 0.12;

export interface Pose {
  x: number;
  y: number;
  yaw: number;
}

export interface LegPose {
  hip: V3;
  knee: V3;
  foot: V3;
  airborne: boolean;
  /** Landed in the last update: its foot moved, which a planted foot never does. */
  justLanded: boolean;
}

interface Leg {
  /** Where the foot is, in the world. */
  foot: V3;
  /** Where the swing started and where it ends, and how far through it is; -1 planted. */
  from: V3;
  to: V3;
  swing: number;
  justLanded: boolean;
}

export class SpiderGait {
  onStep: ((leg: number, x: number, y: number) => void) | null = null;
  private readonly legs: Leg[] = [];
  private pose: Pose | null = null;
  private last: 'A' | 'B' = 'B';

  /** Where each hip, knee and foot is now, in the world. */
  poses(): LegPose[] {
    const pose = this.pose ?? { x: 0, y: 0, yaw: 0 };
    return this.legs.map((leg, k) => {
      const hip = this.onBody(pose, HIPS[k]);
      return {
        hip,
        knee: knee(hip, leg.foot),
        foot: [...leg.foot],
        airborne: leg.swing >= 0,
        justLanded: leg.justLanded,
      };
    });
  }

  /** Forget where the feet were: they stand at rest under the next pose given. */
  reset() {
    this.legs.length = 0;
    this.pose = null;
  }

  /** The body has moved to `pose` over `dt`: the feet keep up. */
  update(dt: number, pose: Pose) {
    if (!this.legs.length) {
      for (let k = 0; k < LEGS; k++) {
        const foot = this.onBody(pose, [REST[k][0], REST[k][1], 0]);
        this.legs.push({ foot, from: foot, to: foot, swing: -1, justLanded: false });
      }
      this.pose = { ...pose };
      return;
    }
    const prev = this.pose!;
    this.pose = { ...pose };
    for (const leg of this.legs) leg.justLanded = false;

    // the swings under way go on, and land
    this.legs.forEach((leg, k) => {
      if (leg.swing < 0) return;
      leg.swing = Math.min(1, leg.swing + dt / SWING);
      const p = leg.swing;
      leg.foot = [
        leg.from[0] + (leg.to[0] - leg.from[0]) * p,
        leg.from[1] + (leg.to[1] - leg.from[1]) * p,
        Math.sin(p * Math.PI) * LIFT,
      ];
      if (p >= 1) {
        leg.foot = [leg.to[0], leg.to[1], 0];
        leg.swing = -1;
        leg.justLanded = true;
        this.onStep?.(k, leg.foot[0], leg.foot[1]);
      }
    });
    if (this.legs.some((leg) => leg.swing >= 0)) return;

    // all planted: the set that is not the last to step goes, if it has been left behind; the
    // other only if it is a long way behind, which a body moving evenly never leaves it
    const behind = (set: number[]) =>
      Math.max(...set.map((k) => Math.hypot(...sub(this.legs[k].foot, this.restNow(pose, k)))));
    const next = this.last === 'A' ? 'B' : 'A';
    const nextSet = next === 'A' ? SET_A : SET_B,
      otherSet = next === 'A' ? SET_B : SET_A;
    let go: number[] | null = null;
    if (behind(nextSet) > STRIDE) go = nextSet;
    else if (behind(otherSet) > STRIDE * 2) go = otherSet;
    if (!go) return;
    this.last = go === SET_A ? 'A' : 'B';
    // where the rest will be a moment from now, from how the body just moved
    const vx = dt > 0 ? (pose.x - prev.x) / dt : 0,
      vy = dt > 0 ? (pose.y - prev.y) / dt : 0,
      vyaw = dt > 0 ? turn(pose.yaw - prev.yaw) / dt : 0;
    const ahead: Pose = { x: pose.x + vx * LEAD, y: pose.y + vy * LEAD, yaw: pose.yaw + vyaw * LEAD };
    for (const k of go) {
      const leg = this.legs[k];
      leg.from = [...leg.foot];
      leg.to = this.restNow(ahead, k);
      leg.swing = 0;
    }
  }

  private restNow(pose: Pose, k: number): V3 {
    return this.onBody(pose, [REST[k][0], REST[k][1], 0]);
  }

  private onBody(pose: Pose, [lx, ly, lz]: readonly number[]): V3 {
    const c = Math.cos(pose.yaw),
      s = Math.sin(pose.yaw);
    return [pose.x + c * lx - s * ly, pose.y + s * lx + c * ly, lz];
  }
}

/** The knee for a leg from `hip` to `foot`: the two bones their length, bent upward. */
function knee(hip: V3, foot: V3): V3 {
  let [dx, dy, dz] = sub(foot, hip);
  let d = Math.hypot(dx, dy, dz);
  // never quite straight, and never folded past what the bones allow
  const most = FEMUR + TIBIA - 1e-3,
    least = Math.abs(FEMUR - TIBIA) + 1e-3;
  if (d > most || d < least) {
    const k = Math.max(least, Math.min(most, d)) / (d || 1);
    dx *= k;
    dy *= k;
    dz *= k;
    d = Math.hypot(dx, dy, dz);
  }
  const ux = dx / d,
    uy = dy / d,
    uz = dz / d;
  // up, in the plane of the leg: straight up less what lies along the leg
  let px = -uz * ux,
    py = -uz * uy,
    pz = 1 - uz * uz;
  const pl = Math.hypot(px, py, pz);
  if (pl < 1e-6) {
    px = 1;
    py = 0;
    pz = 0;
  } else {
    px /= pl;
    py /= pl;
    pz /= pl;
  }
  const cosA = Math.max(-1, Math.min(1, (FEMUR * FEMUR + d * d - TIBIA * TIBIA) / (2 * FEMUR * d)));
  const sinA = Math.sqrt(1 - cosA * cosA);
  return [
    hip[0] + (ux * cosA + px * sinA) * FEMUR,
    hip[1] + (uy * cosA + py * sinA) * FEMUR,
    hip[2] + (uz * cosA + pz * sinA) * FEMUR,
  ];
}

function sub(a: readonly number[], b: readonly number[]): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/** An angle brought round to -pi..pi. */
function turn(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
