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
/** The circle the hull is kept off the rock by. */
const BODY_RADIUS = 3.6;

/**
 * Where each piece of the blade sits in the dozer's own frame: along the
 * blade at `y`, ahead at `x`, turned by `turn` to lie along the curve. The
 * middle is one straight plate; each wing is a parabola swept forward, so
 * what the end of the blade meets is shepherded in toward the middle rather
 * than shed off the tip — which is what makes a coin against a wall
 * collectable.
 */
export function bladePieces(width: number): { x: number; y: number; turn: number; length: number }[] {
  const half = width / 2, flat = half * BLADE_FLAT, wing = half - flat;
  const sweep = WING_SWEEP * width;
  const out = [{ x: BLADE_AT, y: 0, turn: 0, length: flat * 2 }];
  const length = wing / WING_PIECES;
  for (const side of [-1, 1]) {
    for (let k = 0; k < WING_PIECES; k++) {
      const t = (k + 0.5) / WING_PIECES;
      const y = side * (flat + t * wing);
      // the tangent: the piece lies along (dx/dy, 1), a turn of -atan(dx/dy) from straight across
      out.push({ x: BLADE_AT + sweep * t * t, y, turn: -Math.atan((2 * sweep * t) / wing) * side, length: length * 1.15 });
    }
  }
  return out;
}

export class Dozer {
  x = 0; y = -14; yaw = Math.PI / 2;
  speed = 0;
  yawRate = 0;
  /** Distance travelled, for the treads. */
  odometer = 0;
  solid: Uint8Array;

  constructor(solid: Uint8Array) { this.solid = solid; }

  /**
   * `load` is how many coins the blade is shoving: a heap in front of the
   * blade is a heap the engine has to move, and a bigger engine moves it
   * faster. That is what the engine upgrades are for.
   */
  update(dt: number, drive: Drive, spec: DozerSpec, load = 0) {
    const { throttle, steer } = drive;
    const heavy = 1 + load * 0.014;
    const maxSpeed = spec.maxSpeed / heavy, accel = spec.accel / heavy;
    const reverseMax = spec.maxSpeed * 0.55;
    if (throttle > 0) this.speed += accel * dt;
    else if (throttle < 0) this.speed -= spec.accel * (this.speed > 0 ? 1.6 : 1) * dt;
    else this.speed *= Math.max(0, 1 - 5 * dt);
    if (this.speed > maxSpeed) this.speed += (maxSpeed - this.speed) * Math.min(1, 6 * dt);
    this.speed = Math.max(-reverseMax, Math.min(spec.maxSpeed, this.speed));
    if (Math.abs(this.speed) < 0.05 && !throttle) this.speed = 0;

    // a tracked vehicle turns standing still, and a little faster moving;
    // backing up, the stick means the other way, as it does in a car
    const moving = Math.min(1, Math.abs(this.speed) / spec.maxSpeed);
    const sign = this.speed < -0.3 ? -1 : 1;
    const wantRate = steer * spec.turnRate * (0.55 + 0.45 * moving) * sign;
    this.yawRate += (wantRate - this.yawRate) * Math.min(1, 10 * dt);
    this.yaw += this.yawRate * dt;

    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    this.x += c * this.speed * dt;
    this.y += s * this.speed * dt;
    this.odometer += this.speed * dt;
    this.keepOffRock();
  }

  private keepOffRock() {
    const tx = Math.floor((this.x - ORIGIN_X) / TILE), ty = Math.floor((this.y - ORIGIN_Y) / TILE);
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const nx = tx + ox, ny = ty + oy;
        const rock = nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS || this.solid[ny * COLS + nx];
        if (!rock) continue;
        const x0 = ORIGIN_X + nx * TILE, y0 = ORIGIN_Y + ny * TILE;
        const cx = Math.max(x0, Math.min(x0 + TILE, this.x)), cy = Math.max(y0, Math.min(y0 + TILE, this.y));
        let dx = this.x - cx, dy = this.y - cy;
        const d = Math.hypot(dx, dy);
        if (d >= BODY_RADIUS || d < 1e-4) continue;
        dx /= d; dy /= d;
        this.x += dx * (BODY_RADIUS - d); this.y += dy * (BODY_RADIUS - d);
        // the speed along the heading is what carried it in: take that back
        const head = Math.cos(this.yaw) * dx + Math.sin(this.yaw) * dy;
        if (head * this.speed < 0) this.speed *= 0.2;
      }
    }
  }

  /** The two boxes the coins feel: the blade and the hull. */
  pushers(spec: DozerSpec, out: Pusher[]): Pusher[] {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const vx = c * this.speed, vy = s * this.speed;
    out.length = 0;
    for (const piece of bladePieces(spec.bladeWidth)) {
      out.push({
        x: this.x + c * piece.x - s * piece.y, y: this.y + s * piece.x + c * piece.y, z: BLADE_HEIGHT / 2,
        yaw: this.yaw + piece.turn, hx: 0.3, hy: piece.length / 2, hz: BLADE_HEIGHT / 2,
        vx, vy, spin: this.yawRate, px: this.x, py: this.y,
      });
    }
    out.push({
      x: this.x, y: this.y, z: HULL_HALF[2],
      yaw: this.yaw, hx: HULL_HALF[0], hy: HULL_HALF[1], hz: HULL_HALF[2],
      vx, vy, spin: this.yawRate, px: this.x, py: this.y,
    });
    return out;
  }
}
