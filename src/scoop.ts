/**
 * The scoop: a bucket for the blade, worked by one button. Pressed with
 * nothing held, whatever is worth something in its mouth is lifted into the
 * bucket, nearest first, up to what the bucket holds, and carried; pressed
 * again, it is tipped out ahead at the dozer's speed and a little more.
 *
 * What is held is still in the cave. It is alive, counted by the stock and
 * the world, and drawn where the bucket puts it, but the physics does not
 * step it (`world.carried`), so it is not pushed, thrown by a blast, pulled
 * by the magnet, or able to fall down a hole, and it never counts toward
 * what is slowing the machine, which is why a full scoop drives at the
 * engine's top speed and the same pile pushed does not. With a load up the
 * blade is raised and pushes nothing; the hull still shoves.
 *
 * Without this, carrying would be pushing with extra steps: the point is a
 * way to move what the blade cannot reach, in a corner or against a wall, to
 * where the blade can take it. Headless: it knows the world's bodies and
 * where the machine is, and nothing of the page, the stock or the save.
 */
import { BLADE_AT, BLADE_FLAT, BLADE_RISE, HULL_HALF, type Dozer } from './dozer';
import { KIND_VALUE, type World } from './physics';

/** Where a point is in the dozer's own frame: along its heading, across it to the left, and up from the floor. */
export interface Local {
  x: number;
  y: number;
  z: number;
}

/** The mouth reaches from the hull's nose to this far past the blade, and as high as a heap of a few coins stands at its foot. */
export const MOUTH_DEEP = 3.4;
export const MOUTH_HIGH = 3.6;
/** How far past the blade's width, each side, the mouth reaches: a coin against a wing's tip is in it. */
const MOUTH_SLACK = 0.3;
/** What is tipped out goes this much faster than the dozer, along its heading, and a little up. */
export const TIP_EXTRA = 3;
const TIP_UP = 1.5;
/** How long the bucket takes to rise or lower, to tip, and for what is taken up to settle into it, in game seconds. */
export const LIFT_TIME = 0.35;
export const DUMP_TIME = 0.4;
export const GATHER_TIME = 0.25;
/** How far the bucket is tipped back to carry, and forward to pour, in radians about its lip; forward is down. */
export const TILT_BACK = -0.12;
export const TILT_POUR = 0.6;
/** Where each held body sits: spacing along and across the bucket, and up a layer. */
const SEAT_SPACING = 0.9;
const SEAT_LAYER = 0.5;
const SEAT_ROWS = 3;
const SEAT_FLOOR = 0.55;
/** How far into the bucket from the blade's face the first row sits. */
const SEAT_FROM = 0.9;
/** How far the bucket's floor reaches across, either side, for a blade this wide: the blade's straight middle, which the cheeks stand on. */
export function floorHalf(width: number): number {
  return (width / 2) * BLADE_FLAT;
}
/** How far in from a cheek the bodies seat reach, so that none is drawn through it. */
const SEAT_MARGIN = 0.9;

/** How many bodies sit across the bucket in a row. */
export function seatColumns(width: number): number {
  return Math.max(2, Math.floor(((floorHalf(width) - SEAT_MARGIN) * 2) / SEAT_SPACING) + 1);
}

/** Whether a point in the dozer's frame is in the mouth: past the hull, short of the bucket's lip, no wider than the blade. */
export function inMouth(p: Local, width: number): boolean {
  return (
    p.x >= HULL_HALF[0] &&
    p.x <= BLADE_AT + MOUTH_DEEP &&
    Math.abs(p.y) <= width / 2 + MOUTH_SLACK &&
    p.z >= 0 &&
    p.z <= MOUTH_HIGH
  );
}

/**
 * Where the nth body taken up sits in the bucket when it is level and down, in the dozer's frame: rows across
 * the bucket's floor from the blade's face forward, a layer on layer, each nudged a little so a heap does not
 * look gridded. The same place for the same n, with no chance in it.
 */
export function seat(n: number, width: number): Local {
  const cols = seatColumns(width);
  const layer = Math.floor(n / (cols * SEAT_ROWS)),
    inLayer = n % (cols * SEAT_ROWS);
  const row = Math.floor(inLayer / cols),
    col = inLayer % cols;
  // a different small shift for each, from n alone, so the same pile is drawn the same each time
  const nudge = (k: number) => (((Math.sin(n * 12.9898 + k * 78.233) * 43758.5453) % 1) + 1) % 1;
  // alternate layers are shifted a little each way, so the pile settles into the one below
  const shift = layer % 2 ? 0.25 : -0.25;
  return {
    x: BLADE_AT + SEAT_FROM + row * SEAT_SPACING + shift + (nudge(1) - 0.5) * 0.2,
    y: (col - (cols - 1) / 2) * SEAT_SPACING + shift + (nudge(2) - 0.5) * 0.2,
    z: SEAT_FLOOR + layer * SEAT_LAYER,
  };
}

/** How far the bucket is tipped, in radians, for how high it is lifted and how far through pouring: forward is down. */
export function bucketTilt(lift: number, dump: number): number {
  return TILT_BACK * lift * (1 - dump) + TILT_POUR * dump;
}

/**
 * A point of the bucket, in the dozer's frame when the bucket is level and down, as it is with the bucket
 * `lift` of the way up and `dump` of the way through pouring: raised, and tipped about its lip, which is where
 * the blade's face stands. The picture's matrix says the same (`placeTipped`), held equal by a test.
 */
export function bucketPoint(p: Local, lift: number, dump: number): Local {
  const a = bucketTilt(lift, dump);
  const dx = p.x - BLADE_AT;
  return {
    x: BLADE_AT + dx * Math.cos(a) + p.z * Math.sin(a),
    y: p.y,
    z: -dx * Math.sin(a) + p.z * Math.cos(a) + lift * BLADE_RISE,
  };
}

/** What a press did: how many bodies it took up, or how many it tipped out. */
export interface Pressed {
  took: number;
  tipped: number;
}

export class Scoop {
  /** The slots of the bodies in the bucket, the first taken first. */
  readonly held: number[] = [];
  /** How far up the bucket is, 0 to 1; it rises while there is a load in it, and the blade with it. */
  lift = 0;
  /** How far through pouring it is, 1 as the load goes and 0 a moment after. */
  dump = 0;
  /** Where each held body was when it was taken, in the dozer's frame, and for how long: it slides into its seat. */
  private readonly from: Local[] = [];
  private readonly age: number[] = [];

  /** `rock` says whether a point is in the rock, so that nothing is carried or tipped into it. */
  constructor(
    private readonly world: World,
    private readonly rock: (x: number, y: number) => boolean = () => false,
  ) {}

  /** A body in the dozer's frame. */
  private local(dozer: Dozer, i: number): Local {
    const { x, y, z } = this.world;
    const c = Math.cos(dozer.yaw),
      s = Math.sin(dozer.yaw);
    const dx = x[i] - dozer.x,
      dy = y[i] - dozer.y;
    return { x: dx * c + dy * s, y: -dx * s + dy * c, z: z[i] };
  }

  /** Whether the rock lies between the middle of the machine and a point: a coin on the far side of a wall is not in reach. */
  private shut(dozer: Dozer, x: number, y: number): boolean {
    // a point every unit or so along the way, which is finer than anything a wall is
    const steps = Math.max(1, Math.ceil(Math.hypot(x - dozer.x, y - dozer.y)));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      if (this.rock(dozer.x + (x - dozer.x) * t, dozer.y + (y - dozer.y) * t)) return true;
    }
    return false;
  }

  /**
   * The bodies in the mouth that are worth something, and are not held already, nearest the middle of the
   * blade first, taken up to `load` in all. How many it took.
   */
  take(dozer: Dozer, width: number, load: number): number {
    const { world } = this;
    const room = load - this.held.length;
    if (room <= 0) return 0;
    const found: { i: number; d: number; at: Local }[] = [];
    for (let i = 0; i < world.count; i++) {
      if (!world.alive[i] || world.carried[i] || !(KIND_VALUE[world.kind[i]] > 0)) continue;
      const at = this.local(dozer, i);
      if (!inMouth(at, width) || this.shut(dozer, world.x[i], world.y[i])) continue;
      found.push({ i, d: Math.hypot(at.x - (BLADE_AT + SEAT_FROM), at.y), at });
    }
    // the slot breaks a tie, so that two coins as near as each other are taken in the same order every time
    found.sort((a, b) => a.d - b.d || a.i - b.i);
    const taken = found.slice(0, room);
    for (const { i, at } of taken) {
      // a sleeper is woken first, or the world never knows it moved
      if (world.asleep[i]) world.wake(i);
      world.carried[i] = 1;
      world.vx[i] = world.vy[i] = world.vz[i] = 0;
      this.held.push(i);
      this.from.push(at);
      this.age.push(0);
    }
    return taken.length;
  }

  /** Everything held let go, out ahead at the dozer's speed and a little more. How many it tipped. */
  tip(dozer: Dozer): number {
    const { world } = this;
    const n = this.held.length;
    if (!n) return 0;
    const c = Math.cos(dozer.yaw),
      s = Math.sin(dozer.yaw);
    // forwards: a machine backing up still pours ahead of it
    const v = Math.max(0, dozer.speed) + TIP_EXTRA;
    for (const i of this.held) {
      world.carried[i] = 0;
      if (world.asleep[i]) world.wake(i);
      world.vx[i] = c * v;
      world.vy[i] = s * v;
      world.vz[i] = TIP_UP;
    }
    this.clear();
    this.dump = 1;
    return n;
  }

  /** The button: nothing held, take what is in the mouth; something held, tip it out. */
  press(dozer: Dozer, width: number, load: number): Pressed {
    if (this.held.length) return { took: 0, tipped: this.tip(dozer) };
    return { took: this.take(dozer, width, load), tipped: 0 };
  }

  /** Let go of the book-keeping, not the bodies: they were let go, or are gone. */
  private clear() {
    this.held.length = 0;
    this.from.length = 0;
    this.age.length = 0;
  }

  /**
   * The bucket and what is in it, put where they are this step: before the world's, which will not touch them.
   * The bucket rises while it holds something and lowers when it does not; each held body slides from where it
   * was taken into its seat, and is kept out of the rock, which the bucket's nose can reach when the machine
   * is up to a wall.
   */
  carry(dt: number, dozer: Dozer, width: number) {
    const { world } = this;
    // anything held that has gone from the world, or been let go by something else, is no longer in the bucket
    for (let k = this.held.length - 1; k >= 0; k--) {
      const i = this.held[k];
      if (world.alive[i] && world.carried[i]) continue;
      this.held.splice(k, 1);
      this.from.splice(k, 1);
      this.age.splice(k, 1);
    }
    // up while it holds something, and down when it does not; at the top it stays there
    if (this.held.length) this.lift = Math.min(1, this.lift + dt / LIFT_TIME);
    else this.lift = Math.max(0, this.lift - dt / LIFT_TIME);
    this.dump = Math.max(0, this.dump - dt / DUMP_TIME);
    const c = Math.cos(dozer.yaw),
      s = Math.sin(dozer.yaw);
    this.held.forEach((i, k) => {
      this.age[k] += dt;
      const t = Math.min(1, this.age[k] / GATHER_TIME);
      const e = t * t * (3 - 2 * t);
      const to = bucketPoint(seat(k, width), this.lift, this.dump);
      const from = this.from[k];
      const lx = from.x + (to.x - from.x) * e,
        ly = from.y + (to.y - from.y) * e,
        lz = from.z + (to.z - from.z) * e;
      const ox = c * lx - s * ly,
        oy = s * lx + c * ly;
      // against a wall the bucket's nose is in it: bring the body back toward the machine until it is not
      let back = 1;
      while (back > 0 && this.rock(dozer.x + ox * back, dozer.y + oy * back)) back -= 0.1;
      world.x[i] = dozer.x + ox * Math.max(0, back);
      world.y[i] = dozer.y + oy * Math.max(0, back);
      world.z[i] = lz;
      world.vx[i] = world.vy[i] = world.vz[i] = 0;
    });
  }
}
