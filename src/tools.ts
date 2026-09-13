/**
 * The help you can buy: conveyor belts that carry what lands on them to the
 * hole, and drones that go and fetch things.
 */
import type { BeltSpec, Area } from './cave';
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

import { Dozer, type DozerSpec } from './dozer';
import type { Drive } from './input';

/** What a robo-dozer is: smaller and slower than the player's, and tireless. */
export const BOT_SCALE = 0.68;
export const BOT_SPEC: DozerSpec = { maxSpeed: 7.5, accel: 12, turnRate: 1.9, bladeWidth: 7, magnetRadius: 0, magnetStrength: 0 };
/** How far from the hole's centre a bot stops pushing and backs away. */
const STOP_AT = HOLE.radius + 5;

type BotState = 'seek' | 'approach' | 'push' | 'retreat';

/**
 * A robo-dozer: it picks a heap, drives round to the far side of it, pushes
 * a load toward the hole, backs off, and goes again. It steers like the
 * player's machine — the same tank model, the same boxes — so what it does
 * to the coins is what the player could have done.
 */
export class Bot {
  readonly dozer: Dozer;
  state: BotState = 'seek';
  private target: [number, number] = [0, 0];
  private timer = 0;
  private stuck = 0;
  private lastX = 0; private lastY = 0;

  constructor(solid: Uint8Array, owner: number, x: number, y: number) {
    this.dozer = new Dozer(solid, BOT_SCALE, owner);
    this.dozer.x = x; this.dozer.y = y; this.dozer.yaw = Math.random() * Math.PI * 2;
    this.lastX = x; this.lastY = y;
  }

  get x() { return this.dozer.x; }
  get y() { return this.dozer.y; }
  get yaw() { return this.dozer.yaw; }

  update(dt: number, world: World, load: number) {
    const d = this.dozer;
    let drive: Drive = { throttle: 0, steer: 0 };
    this.timer -= dt;
    switch (this.state) {
      case 'seek': {
        const i = this.pick(world);
        if (i < 0) { this.timer = 1; break; }
        // the far side of the coin from the hole, a machine's length back
        const bx = world.x[i], by = world.y[i];
        const dx = bx - HOLE.x, dy = by - HOLE.y;
        const len = Math.hypot(dx, dy) || 1;
        this.target = [bx + (dx / len) * 6, by + (dy / len) * 6];
        this.state = 'approach'; this.timer = 14; this.stuck = 0;
        break;
      }
      case 'approach': {
        const [tx, ty] = this.target;
        const dist = Math.hypot(tx - d.x, ty - d.y);
        drive = this.toward(tx, ty);
        if (dist < 2.5 || this.timer <= 0) { this.state = 'push'; this.timer = 16; this.stuck = 0; }
        break;
      }
      case 'push': {
        const dist = Math.hypot(HOLE.x - d.x, HOLE.y - d.y);
        drive = this.toward(HOLE.x, HOLE.y);
        // a full blade is slow going, which is fine; an empty one has lost its load and should look again
        if (dist < STOP_AT || this.timer <= 0 || (this.timer < 12 && load === 0 && dist > 20)) { this.state = 'retreat'; this.timer = 1.4; }
        break;
      }
      case 'retreat':
        drive = { throttle: -1, steer: 0 };
        if (this.timer <= 0) this.state = 'seek';
        break;
    }
    // stuck against something: back off and think again
    if (this.state !== 'retreat') {
      const moved = Math.hypot(d.x - this.lastX, d.y - this.lastY);
      this.stuck = moved < 0.25 * dt * 10 && drive.throttle > 0 ? this.stuck + dt : 0;
      if (this.stuck > 2) { this.state = 'retreat'; this.timer = 1.2; this.stuck = 0; }
    }
    this.lastX = d.x; this.lastY = d.y;
    d.update(dt, drive, BOT_SPEC, load);
  }

  /** Steer to face a point and drive at it, turning on the spot when it is well off the nose. */
  private toward(tx: number, ty: number): Drive {
    const d = this.dozer;
    let diff = Math.atan2(ty - d.y, tx - d.x) - d.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const steer = Math.max(-1, Math.min(1, diff * 2.5));
    const throttle = Math.abs(diff) < 0.5 ? 1 : Math.abs(diff) < 1.3 ? 0.4 : 0;
    return { throttle, steer };
  }

  /** The best of a handful of random coins: the dearest, then the nearest, and never one already at the hole. */
  private pick(world: World): number {
    let best = -1, bestScore = -Infinity;
    for (let k = 0; k < 24; k++) {
      const i = (Math.random() * world.count) | 0;
      if (!world.alive[i] || world.carried[i]) continue;
      const toHole = Math.hypot(world.x[i] - HOLE.x, world.y[i] - HOLE.y);
      if (toHole < STOP_AT + 4) continue;
      const dist = Math.hypot(world.x[i] - this.x, world.y[i] - this.y);
      const score = KIND_VALUE[world.kind[i]] * 4 - dist * 0.3 - toHole * 0.1;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return best;
  }
}

/**
 * A fountain: now and then the floor of a room cracks, glows for a moment,
 * and throws up a spray of coins for a few seconds. Nothing to react to,
 * just somewhere to wander over to.
 */
export class Fountain {
  state: 'idle' | 'warn' | 'spray' = 'idle';
  x = 0; y = 0;
  /** How bright the crack is, 0 to 1, for the light and the glow. */
  glow = 0;
  private timer: number;
  private spill = 0;

  constructor(private area: Area) {
    this.timer = 12 + Math.random() * 18;
  }

  /** Steps the fountain; `spawn` is asked for each coin, and `crack` once when the floor goes. */
  update(dt: number, spawn: (kind: number, x: number, y: number, z: number, vx: number, vy: number, vz: number) => boolean, crack: () => void) {
    this.timer -= dt;
    switch (this.state) {
      case 'idle':
        this.glow = Math.max(0, this.glow - dt);
        if (this.timer <= 0) {
          const [x, y] = this.area.cracks[(Math.random() * this.area.cracks.length) | 0];
          this.x = x; this.y = y;
          this.state = 'warn'; this.timer = 2.6;
          crack();
        }
        return;
      case 'warn':
        this.glow = Math.min(1, this.glow + dt / 2);
        if (this.timer <= 0) { this.state = 'spray'; this.timer = 3.5; }
        return;
      case 'spray': {
        this.glow = 1;
        this.spill += dt * 22;
        while (this.spill >= 1) {
          this.spill--;
          let kind = 0;
          const roll = Math.random();
          let acc = 0;
          for (const [k, p] of this.area.vein.gems) { acc += p * 2; if (roll < acc) { kind = k; break; } }
          const a = Math.random() * Math.PI * 2, spread = 3 + Math.random() * 5;
          if (!spawn(kind, this.x, this.y, 0.8, Math.cos(a) * spread, Math.sin(a) * spread, 18 + Math.random() * 10)) { this.timer = 0; break; }
        }
        if (this.timer <= 0) { this.state = 'idle'; this.timer = 28 + Math.random() * 22; }
        return;
      }
    }
  }
}
