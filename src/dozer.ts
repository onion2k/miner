/**
 * The bulldozer: a tracked thing that turns on the spot, drives forward and
 * back, and carries a blade. Its forward is its own +X, so `yaw` is its
 * heading. It is kinematic — it is not pushed back by coins — and what it
 * hands the physics is two boxes that shove: the blade and the hull.
 */
import { COLS, ORIGIN_X, ORIGIN_Y, ROWS, TILE } from './cave';
import type { Drive } from './input';
import type { Pusher } from './physics';

export interface DozerSpec {
  maxSpeed: number;
  accel: number;
  turnRate: number;
  bladeWidth: number;
  magnetRadius: number;
  magnetStrength: number;
}

/** The hull's footprint, from the pivot: half-length along and half-width across. */
export const HULL_HALF = [3.0, 2.5, 1.3] as const;
/** Where the blade's face stands ahead of the pivot. */
export const BLADE_AT = 4.3;
export const BLADE_HEIGHT = 3.0;
/** The blade: a straight middle for this fraction of its width, and a curved wing each end. */
export const BLADE_FLAT = 0.6;
/** Pieces per wing, and how far forward a wing's tip sweeps, as a fraction of the blade's width. */
export const WING_PIECES = 4;
export const WING_SWEEP = 0.24;
/** How far each track's middle is from the pivot, across. */
export const TRACK_GAUGE = 2.15;
/** The circle the hull is kept off the rock by. */
const BODY_RADIUS = 3.6;
/** How square on to the rock a machine has to be driving, as the cosine off straight at it, to be stopped rather than slide. */
const SQUARE_ON = 0.9;
/**
 * The capsule one machine is kept out of another by, in its own frame: a
 * segment along the heading from BODY_BACK to BODY_FRONT, fattened by
 * BODY_ROUND. It reaches the rear step behind and the blade's face in front,
 * and the tracks either side; the blade's wings stick out past it, which
 * lets two machines lock blades a little rather than bounce off air.
 */
const BODY_BACK = -0.9,
  BODY_FRONT = 1.8,
  BODY_ROUND = 2.8;

/**
 * Where each piece of the blade sits in the dozer's own frame: along the
 * blade at `y`, ahead at `x`, turned by `turn` to lie along the curve. The
 * middle is one straight plate; each wing is a parabola swept forward, so
 * what the end of the blade meets is shepherded in toward the middle rather
 * than shed off the tip — which is what makes a coin against a wall
 * collectable.
 */
export function bladePieces(width: number): { x: number; y: number; turn: number; length: number }[] {
  const half = width / 2,
    flat = half * BLADE_FLAT,
    wing = half - flat;
  const sweep = WING_SWEEP * width;
  const out = [{ x: BLADE_AT, y: 0, turn: 0, length: flat * 2 }];
  const length = wing / WING_PIECES;
  for (const side of [-1, 1]) {
    for (let k = 0; k < WING_PIECES; k++) {
      const t = (k + 0.5) / WING_PIECES;
      const y = side * (flat + t * wing);
      // the tangent: the piece lies along (dx/dy, 1), a turn of -atan(dx/dy) from straight across
      out.push({
        x: BLADE_AT + sweep * t * t,
        y,
        turn: -Math.atan((2 * sweep * t) / wing) * side,
        length: length * 1.15,
      });
    }
  }
  return out;
}

export class Dozer {
  x = 0;
  y = -14;
  yaw = Math.PI / 2;
  speed = 0;
  yawRate = 0;
  /**
   * How far each track's belt has run, left then right, for the tread bars.
   * Not the distance travelled: turning on the spot runs one track forward
   * and the other back while the machine goes nowhere.
   */
  trackLeft = 0;
  trackRight = 0;
  solid: Uint8Array;
  /**
   * Told of each rock tile the machine is up against, with how square on it
   * is driving at it: 1 straight at it, 0 along it, below 0 away. Before the
   * rock slows it, so its speed is what it hit the rock at. The player's
   * machine has one, for the rock that breaks; the robo-dozers do not.
   */
  onRock: ((tx: number, ty: number, square: number) => void) | null = null;

  /**
   * `scale` is the whole machine's size against the player's: the robo-dozers
   * are the same shape, smaller. `owner` names its boxes to the physics, so
   * each machine is slowed by its own load and not another's.
   */
  constructor(
    solid: Uint8Array,
    readonly scale = 1,
    readonly owner = 0,
  ) {
    this.solid = solid;
  }

  /**
   * `load` is how many coins the blade is shoving: a heap in front of the
   * blade is a heap the engine has to move, and a bigger engine moves it
   * faster. That is what the engine upgrades are for.
   */
  update(dt: number, drive: Drive, spec: DozerSpec, load = 0) {
    const { throttle, steer } = drive;
    const heavy = 1 + load * 0.014;
    const maxSpeed = spec.maxSpeed / heavy,
      accel = spec.accel / heavy;
    const reverseMax = spec.maxSpeed * 0.55;
    // The throttle is how far the lever is pushed, and sets the speed it drives up
    // to: a key is all the way, a slider on a phone anywhere between. Above that
    // speed, it eases back down to it.
    if (throttle > 0) {
      const top = maxSpeed * Math.min(1, throttle);
      if (this.speed < top) this.speed = Math.min(top, this.speed + accel * dt);
      else this.speed += (top - this.speed) * Math.min(1, 6 * dt);
    } else if (throttle < 0) {
      const top = -reverseMax * Math.min(1, -throttle);
      if (this.speed > top) this.speed = Math.max(top, this.speed - spec.accel * (this.speed > 0 ? 1.6 : 1) * dt);
      else this.speed += (top - this.speed) * Math.min(1, 6 * dt);
    } else this.speed *= Math.max(0, 1 - 5 * dt);
    this.speed = Math.max(-reverseMax, Math.min(spec.maxSpeed, this.speed));
    if (Math.abs(this.speed) < 0.05 && !throttle) this.speed = 0;

    // a tracked vehicle turns standing still, and a little faster moving.
    // Left turns the nose left whichever way it is going: a car's reversed
    // stick fights a view that holds the world still, and it lingered while
    // the speed crept back up through zero, so steering was backwards for a
    // moment after every reverse.
    const moving = Math.min(1, Math.abs(this.speed) / spec.maxSpeed);
    const wantRate = steer * spec.turnRate * (0.55 + 0.45 * moving);
    this.yawRate += (wantRate - this.yawRate) * Math.min(1, 10 * dt);
    this.yaw += this.yawRate * dt;

    const c = Math.cos(this.yaw),
      s = Math.sin(this.yaw);
    this.x += c * this.speed * dt;
    this.y += s * this.speed * dt;
    // a point on the left track, TRACK_GAUGE out along +y, moves at the speed less
    // the turn's share; the right track's gains it
    const turn = this.yawRate * TRACK_GAUGE * this.scale;
    this.trackLeft += (this.speed - turn) * dt;
    this.trackRight += (this.speed + turn) * dt;
    this.keepOffRock();
  }

  /**
   * Out of the rock, by the shortest way. What the push-out takes off is the
   * part of the move that went into the rock, so a machine that meets a wall
   * at a slant slides along it, and over the steps of a wall that runs across
   * the tiles. Only one that drives square into the rock is stopped by it:
   * one slowed at every touch stuck to any wall it grazed, and sat at the
   * mouth of a corridor it came at a little off the middle.
   *
   * Twice over, for a corner, where getting out of one tile is getting into
   * the next.
   */
  keepOffRock() {
    const reach = BODY_RADIUS * this.scale;
    if (this.rockAt(Math.floor((this.x - ORIGIN_X) / TILE), Math.floor((this.y - ORIGIN_Y) / TILE))) this.outOfRock();
    for (let pass = 0; pass < 2; pass++) {
      // the push out of every tile it is in, added up: along a wall that steps across the tiles
      // that is the wall's own slant, which no one tile's face is
      let pushX = 0,
        pushY = 0;
      const tx = Math.floor((this.x - ORIGIN_X) / TILE),
        ty = Math.floor((this.y - ORIGIN_Y) / TILE);
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = tx + ox,
            ny = ty + oy;
          if ((!ox && !oy) || !this.rockAt(nx, ny)) continue;
          const x0 = ORIGIN_X + nx * TILE,
            y0 = ORIGIN_Y + ny * TILE;
          const cx = Math.max(x0, Math.min(x0 + TILE, this.x)),
            cy = Math.max(y0, Math.min(y0 + TILE, this.y));
          const dx = this.x - cx,
            dy = this.y - cy;
          const d = Math.hypot(dx, dy);
          if (d >= reach || d < 1e-4) continue;
          const out = reach - d;
          if (pass === 0 && this.onRock)
            this.onRock(nx, ny, -((Math.cos(this.yaw) * dx + Math.sin(this.yaw) * dy) / d) * Math.sign(this.speed));
          this.x += (dx / d) * out;
          this.y += (dy / d) * out;
          pushX += (dx / d) * out;
          pushY += (dy / d) * out;
        }
      }
      const pushed = Math.hypot(pushX, pushY);
      if (pushed < 1e-5) break;
      // square on, the engine is pushing at the rock and gets nowhere: stop it; at a slant, let it slide
      const head = (Math.cos(this.yaw) * pushX + Math.sin(this.yaw) * pushY) / pushed;
      if (pass === 0 && head * Math.sign(this.speed) < -SQUARE_ON) this.speed *= 0.5;
    }
  }

  private rockAt(tx: number, ty: number): boolean {
    return tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS || this.solid[ty * COLS + tx] === 1;
  }

  /**
   * The middle is in the rock — a gate shut on it, or a shove from another
   * machine — and no push off a face gets it out of a wall several tiles
   * thick: it goes to the nearest open tile, in rings out from where it is.
   */
  private outOfRock() {
    const tx = Math.floor((this.x - ORIGIN_X) / TILE),
      ty = Math.floor((this.y - ORIGIN_Y) / TILE);
    for (let ring = 1; ring < 8; ring++) {
      let best: [number, number] | null = null,
        bestD = Infinity;
      for (let oy = -ring; oy <= ring; oy++) {
        for (let ox = -ring; ox <= ring; ox++) {
          if (Math.max(Math.abs(ox), Math.abs(oy)) !== ring || this.rockAt(tx + ox, ty + oy)) continue;
          const cx = ORIGIN_X + (tx + ox + 0.5) * TILE,
            cy = ORIGIN_Y + (ty + oy + 0.5) * TILE;
          const d = Math.hypot(cx - this.x, cy - this.y);
          if (d < bestD) {
            bestD = d;
            best = [cx, cy];
          }
        }
      }
      if (best) {
        this.x = best[0];
        this.y = best[1];
        this.speed = 0;
        return;
      }
    }
  }

  /** The boxes the coins feel: the blade's pieces and the hull, scaled to the machine. */
  pushers(spec: DozerSpec, out: Pusher[]): Pusher[] {
    const c = Math.cos(this.yaw),
      s = Math.sin(this.yaw);
    const vx = c * this.speed,
      vy = s * this.speed;
    const k = this.scale,
      owner = this.owner;
    out.length = 0;
    for (const piece of bladePieces(spec.bladeWidth)) {
      out.push({
        x: this.x + (c * piece.x - s * piece.y) * k,
        y: this.y + (s * piece.x + c * piece.y) * k,
        z: (BLADE_HEIGHT / 2) * k,
        yaw: this.yaw + piece.turn,
        hx: 0.3 * k,
        hy: (piece.length / 2) * k,
        hz: (BLADE_HEIGHT / 2) * k,
        vx,
        vy,
        spin: this.yawRate,
        px: this.x,
        py: this.y,
        owner,
      });
    }
    out.push({
      x: this.x,
      y: this.y,
      z: HULL_HALF[2] * k,
      yaw: this.yaw,
      hx: HULL_HALF[0] * k,
      hy: HULL_HALF[1] * k,
      hz: HULL_HALF[2] * k,
      vx,
      vy,
      spin: this.yawRate,
      px: this.x,
      py: this.y,
      owner,
    });
    return out;
  }
}

/** Where along each of two segments, 0 to 1, their closest points are. */
function closestOnSegments(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): [number, number] {
  const ux = bx - ax,
    uy = by - ay,
    vx = dx - cx,
    vy = dy - cy,
    wx = ax - cx,
    wy = ay - cy;
  const a = ux * ux + uy * uy,
    b = ux * vx + uy * vy,
    c = vx * vx + vy * vy;
  const d = ux * wx + uy * wy,
    e = vx * wx + vy * wy;
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const denom = a * c - b * b;
  // parallel segments have no one closest pair: any s will do, so take the middle
  let s = denom > 1e-8 ? clamp((b * e - c * d) / denom) : 0.5;
  let t = c > 1e-8 ? (b * s + e) / c : 0;
  if (t < 0) {
    t = 0;
    s = a > 1e-8 ? clamp(-d / a) : 0;
  } else if (t > 1) {
    t = 1;
    s = a > 1e-8 ? clamp((b - d) / a) : 0;
  }
  return [s, t];
}

/**
 * Two machines, pushed out of each other. Both are kinematic, so neither
 * gives way to the other by mass: each takes half the overlap, loses most of
 * whatever speed was carrying it in, and is put back off the rock, which the
 * push may have shoved it into.
 */
export function separate(a: Dozer, b: Dozer) {
  const ends = (m: Dozer) => {
    const c = Math.cos(m.yaw),
      s = Math.sin(m.yaw),
      k = m.scale;
    return [m.x + c * BODY_BACK * k, m.y + s * BODY_BACK * k, m.x + c * BODY_FRONT * k, m.y + s * BODY_FRONT * k];
  };
  const [a0x, a0y, a1x, a1y] = ends(a),
    [b0x, b0y, b1x, b1y] = ends(b);
  const [sa, sb] = closestOnSegments(a0x, a0y, a1x, a1y, b0x, b0y, b1x, b1y);
  const pax = a0x + (a1x - a0x) * sa,
    pay = a0y + (a1y - a0y) * sa;
  const pbx = b0x + (b1x - b0x) * sb,
    pby = b0y + (b1y - b0y) * sb;
  let nx = pax - pbx,
    ny = pay - pby;
  let d = Math.hypot(nx, ny);
  const reach = BODY_ROUND * (a.scale + b.scale);
  if (d >= reach) return;
  if (d < 1e-4) {
    // one's spine lies across the other's: push apart along the line between their pivots
    nx = a.x - b.x;
    ny = a.y - b.y;
    d = Math.hypot(nx, ny);
    if (d < 1e-4) {
      nx = 1;
      ny = 0;
      d = 1;
    }
  }
  nx /= d;
  ny /= d;
  const push = (reach - Math.min(d, reach)) / 2;
  a.x += nx * push;
  a.y += ny * push;
  b.x -= nx * push;
  b.y -= ny * push;
  // what was driving each into the other, square on: a glancing meeting slides, as on the rock
  if ((Math.cos(a.yaw) * nx + Math.sin(a.yaw) * ny) * Math.sign(a.speed) < -SQUARE_ON) a.speed *= 0.5;
  if ((Math.cos(b.yaw) * -nx + Math.sin(b.yaw) * -ny) * Math.sign(b.speed) < -SQUARE_ON) b.speed *= 0.5;
  a.keepOffRock();
  b.keepOffRock();
}
