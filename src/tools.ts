/**
 * The help you can buy: conveyor belts that carry what lands on them to the
 * hole, and drones that go and fetch things.
 */
import type { BeltSpec } from './cave';
import { HOLE } from './cave';
import { KIND_VALUE, type Belt, type World } from './physics';

/** A belt's physics strip, from its spec. */
export function beltOf(spec: BeltSpec): Belt {
  const dx = spec.x1 - spec.x0, dy = spec.y1 - spec.y0;
  const len = Math.hypot(dx, dy) || 1;
  return {
    cx: (spec.x0 + spec.x1) / 2, cy: (spec.y0 + spec.y1) / 2,
    half: len / 2, width: spec.width,
    dx: dx / len, dy: dy / len, speed: spec.speed,
  };
}

const DRONE_SPEED = 16;
const HOVER = 9;
const HANG = 1.7;

type DroneState = 'seek' | 'descend' | 'carry' | 'rest';

export class Drone {
  x: number; y: number; z = HOVER;
  yaw = 0;
  /** Rotor spin, for drawing. */
  spin = 0;
  state: DroneState = 'rest';
  target = -1;
  private rest = 0.5;
  private stuck = 0;

  constructor(x: number, y: number) { this.x = x; this.y = y; }

  update(dt: number, world: World) {
    this.spin += dt * 40;
    switch (this.state) {
      case 'rest':
        this.hover(dt);
        if ((this.rest -= dt) <= 0) { this.state = 'seek'; this.target = this.pick(world); }
        return;
      case 'seek': {
        if (!this.valid(world)) { this.target = this.pick(world); if (this.target < 0) { this.state = 'rest'; this.rest = 1; return; } }
        const i = this.target;
        if (this.fly(dt, world.x[i], world.y[i], HOVER)) { this.state = 'descend'; this.stuck = 0; }
        return;
      }
      case 'descend': {
        if (!this.valid(world)) { this.state = 'seek'; return; }
        const i = this.target;
        this.stuck += dt;
        if (this.fly(dt, world.x[i], world.y[i], world.z[i] + HANG, 0.6) || this.stuck > 2.5) {
          world.carried[i] = 1; world.wake(i);
          world.vx[i] = world.vy[i] = world.vz[i] = 0;
          this.state = 'carry';
        }
        return;
      }
      case 'carry': {
        const i = this.target;
        if (!world.alive[i]) { this.state = 'seek'; return; }
        const arrived = this.fly(dt, HOLE.x, HOLE.y, HOVER, 1.2);
        world.x[i] = this.x; world.y[i] = this.y; world.z[i] = this.z - HANG;
        if (arrived) {
          world.carried[i] = 0; world.vz[i] = -4;
          this.target = -1; this.state = 'rest'; this.rest = 0.4;
        }
        return;
      }
    }
  }

  private valid(world: World) {
    const i = this.target;
    return i >= 0 && world.alive[i] === 1 && world.carried[i] === 0;
  }

  private hover(dt: number) { this.fly(dt, this.x, this.y, HOVER); }

  /** Toward a point; true when there. */
  private fly(dt: number, tx: number, ty: number, tz: number, within = 0.8): boolean {
    const dx = tx - this.x, dy = ty - this.y, dz = tz - this.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < within) return true;
    const step = Math.min(d, DRONE_SPEED * dt);
    this.x += (dx / d) * step; this.y += (dy / d) * step; this.z += (dz / d) * step;
    if (Math.hypot(dx, dy) > 0.5) {
      const want = Math.atan2(dy, dx);
      let diff = want - this.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.yaw += diff * Math.min(1, 6 * dt);
    }
    return false;
  }

  /** The best of a handful of random bodies: value first, then nearness. */
  private pick(world: World): number {
    let best = -1, bestScore = -Infinity;
    for (let k = 0; k < 24; k++) {
      const i = (Math.random() * world.count) | 0;
      if (!world.alive[i] || world.carried[i]) continue;
      const d = Math.hypot(world.x[i] - this.x, world.y[i] - this.y);
      const score = KIND_VALUE[world.kind[i]] * 10 - d * 0.1;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return best;
  }
}
