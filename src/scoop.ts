/**
 * The scoop: a bucket that takes the blade's place. Lowered, it lies on the ground and pushes as a blade
 * does, its walls funnelling what it meets to its back (`bucketPieces` in `dozer.ts` is what the physics
 * feels of it). Raised, everything worth something over its floor goes up with it, each where it lay, and is
 * carried; lowered again, the load is set down inside it, to be pushed along with what is gathered next;
 * tipped, the load is poured out ahead and the empty bucket comes down by itself.
 *
 * What is held is still in the cave. It is alive, counted by the stock and the world, and drawn where the
 * bucket puts it, but the physics does not step it (`world.carried`), so it is not pushed, thrown by a blast,
 * pulled by the magnet, or able to fall down a hole, and it never counts toward what is slowing the machine,
 * which is why a full bucket raised drives at the engine's top speed and the same pile pushed does not.
 * Raised, the bucket pushes nothing; the hull still shoves.
 *
 * Without the lowering, a load could only be what one place holds; with it, a player scoops, moves, sets down
 * and scoops again before going to the hole. Headless: it knows the world's bodies and where the machine is,
 * and nothing of the page, the stock or the save.
 */
import { BLADE_AT, BLADE_HEIGHT, BLADE_RISE, BUCKET_BACK, BUCKET_DEEP, HULL_HALF, type Dozer } from './dozer';
import { KIND_VALUE, type World } from './physics';

/** Where a point is in the dozer's own frame: along its heading, across it to the left, and up from the floor. */
export interface Local {
  x: number;
  y: number;
  z: number;
}

/**
 * The most one lift takes. Far more than lies over a floor in play (a heap pushed sixty units leaves some
 * hundred and sixty in the widest bucket): it is here so that what is held has a ceiling to be held to.
 */
export const SCOOP_MOST = 300;
/** How far over the walls' tops a body may ride and still go up with the bucket: the crown of a heap in it. */
const OVER_WALLS = 0.6;
/** How far outside a wall's middle line a body's own middle may be and still count as inside: the wall's thickness. */
const WALL_SLACK = 0.15;
/** What is tipped out goes this much faster than the dozer, along its heading, and a little up. */
export const TIP_EXTRA = 3;
const TIP_UP = 1.5;
/** How long the bucket takes to rise or come down, and to tip, in game seconds. */
export const LIFT_TIME = 0.35;
export const DUMP_TIME = 0.4;
/** How far the bucket is tipped back to carry, and forward to pour, in radians about its back's foot; forward is down. */
export const TILT_BACK = -0.12;
export const TILT_POUR = 0.6;

/**
 * Whether a point in the dozer's frame is over the bucket's floor: between the walls, from the back out to
 * the mouth, and no higher than a heap stands over them. Behind the back, as far as the hull's nose and no
 * wider than the back, counts too: up against rock the back stands in the rock, and what it could not push
 * lies there, which is the coin in a corner a scoop is for.
 */
export function overFloor(p: Local, width: number): boolean {
  if (p.z < 0 || p.z > BLADE_HEIGHT + OVER_WALLS) return false;
  const back = (width * BUCKET_BACK) / 2;
  if (p.x >= HULL_HALF[0] && p.x < BLADE_AT) return Math.abs(p.y) <= back;
  if (p.x < BLADE_AT || p.x > BLADE_AT + BUCKET_DEEP) return false;
  // the walls flare from the back's ends out to the bucket's width at the mouth
  const half = back + ((width / 2 - back) * (p.x - BLADE_AT)) / BUCKET_DEEP;
  return Math.abs(p.y) <= half + WALL_SLACK;
}

/** How far the bucket is tipped, in radians, for how high it is lifted and how far through pouring: forward is down. */
export function bucketTilt(lift: number, dump: number): number {
  return TILT_BACK * lift * (1 - dump) + TILT_POUR * dump;
}

/**
 * A point of the bucket, in the dozer's frame when the bucket is level and down, as it is with the bucket
 * `lift` of the way up and `dump` of the way through pouring: raised, and tipped about the foot of its back,
 * which is where the blade's face stood. The picture's matrix says the same (`placeTipped`), held equal by a test.
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

export class Scoop {
  /** The slots of the bodies in the bucket, the first taken first. */
  readonly held: number[] = [];
  /** Where each of them lay in the bucket when it was taken, in the dozer's frame: it is carried there. */
  readonly places: Local[] = [];
  /** Whether the bucket has been sent up: it rises to the top and stays, until it is lowered or tipped. */
  up = false;
  /** How far up the bucket is, 0 to 1. Off the ground it pushes nothing. */
  lift = 0;
  /** How far through pouring it is, 1 as the load goes and 0 a moment after. */
  dump = 0;

  /** `rock` says whether a point is in the rock, so that nothing is taken through it, carried into it or set down in it. */
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
   * The bucket sent up. On the ground, everything worth something over its floor goes with it, each where it
   * lies; in the air, on its way down, it only goes back up with what it has. How many it took.
   */
  raise(dozer: Dozer, width: number): number {
    this.up = true;
    // a bucket in the air is over nothing: what lies under it is on the floor, not in it
    if (this.lift > 0) return 0;
    const { world } = this;
    const found: { i: number; d: number; at: Local }[] = [];
    for (let i = 0; i < world.count; i++) {
      if (!world.alive[i] || world.carried[i] || !(KIND_VALUE[world.kind[i]] > 0)) continue;
      const at = this.local(dozer, i);
      if (!overFloor(at, width) || this.shut(dozer, world.x[i], world.y[i])) continue;
      found.push({ i, d: Math.hypot(at.x - BLADE_AT, at.y), at });
    }
    // past the ceiling, which no load in play reaches, the nearest the back are the ones taken; the slot
    // breaks a tie, so that two as near as each other are taken in the same order every time
    found.sort((a, b) => a.d - b.d || a.i - b.i);
    const taken = found.slice(0, SCOOP_MOST - this.held.length);
    for (const { i, at } of taken) {
      // a sleeper is woken first, or the world never knows it moved
      if (world.asleep[i]) world.wake(i);
      world.carried[i] = 1;
      world.vx[i] = world.vy[i] = world.vz[i] = 0;
      this.held.push(i);
      this.places.push(at);
    }
    return taken.length;
  }

  /** The bucket sent down. What it holds comes down with it, and is set down when it lands (`carry` says how many). */
  lower() {
    this.up = false;
  }

  /** The button that works it up and down. How many it took, if it went up. */
  toggle(dozer: Dozer, width: number): number {
    if (this.up) {
      this.lower();
      return 0;
    }
    return this.raise(dozer, width);
  }

  /**
   * Everything held let go, out ahead at the dozer's speed and a little more, and the bucket sent down: it has
   * nothing to stay up for. Does nothing to a bucket on the ground. How many it tipped.
   */
  tip(dozer: Dozer): number {
    const { world } = this;
    this.up = false;
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

  /**
   * The bucket taken off, or put away, in whatever state it is in: what it holds is set down where it is, loose and
   * on its way to the floor, and the bucket is down, level and empty. For refitting, which can come at any moment of
   * the lift or the pour. How many it set down.
   */
  setDown(): number {
    const { world } = this;
    const n = this.held.length;
    for (const i of this.held) {
      if (!world.alive[i] || !world.carried[i]) continue;
      world.carried[i] = 0;
      if (world.asleep[i]) world.wake(i);
      world.vx[i] = world.vy[i] = world.vz[i] = 0;
    }
    this.clear();
    this.up = false;
    this.lift = 0;
    this.dump = 0;
    return n;
  }

  /** Let go of the book-keeping, not the bodies: they were let go, or are gone. */
  private clear() {
    this.held.length = 0;
    this.places.length = 0;
  }

  /**
   * The bucket and what is in it, put where they are this step: before the world's, which will not touch
   * them. The bucket rises while it is sent up and comes down when it is not; each held body is where it lay
   * in the bucket, raised and tipped with it, and kept out of the rock, which the bucket's nose can reach when
   * the machine is up to a wall. Landed, what it holds is set down where it is, on the floor between the
   * walls, to be pushed like anything else. How many were set down this step.
   */
  carry(dt: number, dozer: Dozer): number {
    const { world } = this;
    // anything held that has gone from the world, or been let go by something else, is no longer in the bucket
    for (let k = this.held.length - 1; k >= 0; k--) {
      const i = this.held[k];
      if (world.alive[i] && world.carried[i]) continue;
      this.held.splice(k, 1);
      this.places.splice(k, 1);
    }
    if (this.up) this.lift = Math.min(1, this.lift + dt / LIFT_TIME);
    else this.lift = Math.max(0, this.lift - dt / LIFT_TIME);
    this.dump = Math.max(0, this.dump - dt / DUMP_TIME);
    const c = Math.cos(dozer.yaw),
      s = Math.sin(dozer.yaw);
    const vx = c * dozer.speed,
      vy = s * dozer.speed;
    const landed = !this.up && this.lift === 0;
    this.held.forEach((i, k) => {
      const at = bucketPoint(this.places[k], this.lift, this.dump);
      const ox = c * at.x - s * at.y,
        oy = s * at.x + c * at.y;
      // against a wall the bucket's nose is in it: bring the body back toward the machine until it is not
      let back = 1;
      while (back > 0 && this.rock(dozer.x + ox * back, dozer.y + oy * back)) back -= 0.1;
      world.x[i] = dozer.x + ox * Math.max(0, back);
      world.y[i] = dozer.y + oy * Math.max(0, back);
      world.z[i] = at.z;
      if (landed) {
        // on the floor again, and moving as the bucket that carried it is
        world.carried[i] = 0;
        world.vx[i] = vx;
        world.vy[i] = vy;
        world.vz[i] = 0;
      } else world.vx[i] = world.vy[i] = world.vz[i] = 0;
    });
    if (!landed) return 0;
    const n = this.held.length;
    this.clear();
    return n;
  }
}
