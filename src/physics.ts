/**
 * The coins, as spheres.
 *
 * A coin is drawn as a coin but collides as a ball a little smaller than
 * its rim, which is what lets three thousand of them be stepped in
 * JavaScript at a hundred and twenty hertz: a sphere pair is one distance.
 * The lie is covered by how they are drawn — flat when they rest on the
 * floor, tumbling when they fly, and at whatever tilt they landed with in a
 * heap — and by the cartoon chunkiness of the coin itself.
 *
 * Bodies sleep. A heap at rest is most of the cave, and a heap at rest costs
 * nothing: only an awake body looks for its neighbours, and it wakes what it
 * touches. The blade wakes what it reaches before it reaches it.
 */
import { COLS, HOLE, ORIGIN_X, ORIGIN_Y, ROWS, TILE } from './cave';

export const KIND_VALUE = [1, 10, 25, 40, 100];
/** Collision radius per kind: coin, ruby, emerald, sapphire, diamond. */
export const KIND_RADIUS = [0.42, 1.0, 1.0, 1.0, 1.15];
export const KIND_NAME = ['coin', 'ruby', 'emerald', 'sapphire', 'diamond'];

const STEP = 1 / 120;
const GRAVITY = 70;
const RESTITUTION = 0.08;
const FRICTION = 0.45;
const FLOOR_DRAG = 5.5;
/** A body that has moved less than this over a window of steps goes to sleep. */
const SLEEP_DRIFT = 0.25;
const SLEEP_STEPS = 40;
const CELL = 2.5;

/** A box that moves through the coins and shoves them: the blade, the hull. */
export interface Pusher {
  x: number; y: number; z: number;
  yaw: number;
  hx: number; hy: number; hz: number;
  vx: number; vy: number;
  /** Turn rate, for the velocity of a point out along the blade, about the pivot. */
  spin: number;
  px: number; py: number;
  /** Whose box it is: 0 the player, then the robo-dozers. Each has its own load count. */
  owner: number;
}

/** A strip of floor that carries what rests on it. */
export interface Belt {
  cx: number; cy: number;
  /** Half-length along its direction and half-width across. */
  half: number; width: number;
  dx: number; dy: number;
  speed: number;
}

export class World {
  readonly capacity: number;
  /** One past the highest slot ever used; slots below it may be dead. */
  count = 0;
  live = 0;
  readonly alive: Uint8Array;
  readonly kind: Uint8Array;
  readonly x: Float32Array; readonly y: Float32Array; readonly z: Float32Array;
  readonly vx: Float32Array; readonly vy: Float32Array; readonly vz: Float32Array;
  readonly r: Float32Array;
  /** Orientation, four floats a body, for drawing. */
  readonly q: Float32Array;
  readonly wx: Float32Array; readonly wy: Float32Array; readonly wz: Float32Array;
  readonly asleep: Uint8Array;
  /** Where each body was when the sleep window opened. */
  private readonly sx: Float32Array; private readonly sy: Float32Array; private readonly sz: Float32Array;
  private steps = 0;
  /** Held by a drone: not stepped, still drawn where the drone puts it. */
  readonly carried: Uint8Array;
  private readonly onFloor: Uint8Array;
  private readonly free: number[] = [];

  pushers: Pusher[] = [];
  belts: Belt[] = [];
  /** How many bodies the pushers were shoving on the last step: the blade's load. */
  load = 0;
  /** The same, per owner: the player at 0, then each robo-dozer. */
  loads: number[] = [];
  /** A pull toward a point, on whatever lies within `radius` of it on the floor. */
  magnet: { x: number; y: number; radius: number; strength: number } | null = null;
  private loadNow: number[] = [];
  /** Which tiles are rock right now; the game rewrites it when a gate opens. */
  solid: Uint8Array;

  private readonly gx: number; private readonly gy: number;
  private readonly head: Int32Array;
  private readonly next: Int32Array;
  private accumulator = 0;

  constructor(capacity: number, solid: Uint8Array) {
    this.capacity = capacity;
    this.solid = solid;
    const n = capacity;
    this.alive = new Uint8Array(n); this.kind = new Uint8Array(n);
    this.x = new Float32Array(n); this.y = new Float32Array(n); this.z = new Float32Array(n);
    this.vx = new Float32Array(n); this.vy = new Float32Array(n); this.vz = new Float32Array(n);
    this.r = new Float32Array(n); this.q = new Float32Array(n * 4);
    this.wx = new Float32Array(n); this.wy = new Float32Array(n); this.wz = new Float32Array(n);
    this.asleep = new Uint8Array(n);
    this.sx = new Float32Array(n); this.sy = new Float32Array(n); this.sz = new Float32Array(n);
    this.carried = new Uint8Array(n); this.onFloor = new Uint8Array(n);
    this.gx = Math.ceil((COLS * TILE) / CELL) + 2;
    this.gy = Math.ceil((ROWS * TILE) / CELL) + 2;
    this.head = new Int32Array(this.gx * this.gy);
    this.next = new Int32Array(n);
  }

  /** Put a body in the world, awake. Returns its slot, or -1 with the world full. */
  spawn(kind: number, x: number, y: number, z: number, vx = 0, vy = 0, vz = 0): number {
    let i: number;
    if (this.free.length) i = this.free.pop()!;
    else if (this.count < this.capacity) i = this.count++;
    else return -1;
    this.alive[i] = 1; this.kind[i] = kind; this.r[i] = KIND_RADIUS[kind];
    this.x[i] = x; this.y[i] = y; this.z[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    const yaw = Math.random() * Math.PI, tilt = (Math.random() - 0.5) * 0.6;
    // a random yaw and a small tilt: a coin dropped, not placed
    const q = this.q;
    q[i * 4] = Math.sin(tilt / 2) * Math.cos(yaw); q[i * 4 + 1] = Math.sin(tilt / 2) * Math.sin(yaw);
    q[i * 4 + 2] = Math.sin(yaw) * 0.1; q[i * 4 + 3] = Math.cos(tilt / 2);
    this.normalise(i);
    this.wx[i] = 0; this.wy[i] = 0; this.wz[i] = 0;
    this.asleep[i] = 0; this.carried[i] = 0; this.onFloor[i] = 0;
    this.sx[i] = x; this.sy[i] = y; this.sz[i] = z;
    this.live++;
    return i;
  }

  /** Take a body out of the world for good. */
  remove(i: number) {
    if (!this.alive[i]) return;
    this.alive[i] = 0; this.carried[i] = 0;
    this.free.push(i);
    this.live--;
  }

  private normalise(i: number) {
    const q = this.q, o = i * 4;
    const l = Math.hypot(q[o], q[o + 1], q[o + 2], q[o + 3]) || 1;
    q[o] /= l; q[o + 1] /= l; q[o + 2] /= l; q[o + 3] /= l;
  }

  wake(i: number) {
    this.asleep[i] = 0;
    // a fresh window, so what woke it has time to move it
    this.sx[i] = this.x[i]; this.sy[i] = this.y[i]; this.sz[i] = this.z[i];
  }

  /** Wake everything within `radius` of a point — ahead of a blade, say. */
  wakeNear(x: number, y: number, radius: number) {
    const r2 = radius * radius;
    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i] || !this.asleep[i]) continue;
      const dx = this.x[i] - x, dy = this.y[i] - y;
      if (dx * dx + dy * dy < r2) this.wake(i);
    }
  }

  wakeAll() { for (let i = 0; i < this.count; i++) this.wake(i); }

  /** Advance by `dt` seconds in fixed steps, reporting what fell in the hole. */
  step(dt: number, collect: (kind: number, x: number, y: number) => void) {
    this.accumulator = Math.min(this.accumulator + dt, STEP * 4);
    while (this.accumulator >= STEP) {
      this.accumulator -= STEP;
      this.substep(collect);
    }
  }

  private substep(collect: (kind: number, x: number, y: number) => void) {
    const n = this.count;
    const { x, y, z, vx, vy, vz, alive, asleep, carried } = this;
    const window = ++this.steps % SLEEP_STEPS === 0;
    this.loadNow.length = 0;
    // integrate
    for (let i = 0; i < n; i++) {
      if (!alive[i] || asleep[i] || carried[i]) continue;
      vz[i] -= GRAVITY * STEP;
      x[i] += vx[i] * STEP; y[i] += vy[i] * STEP; z[i] += vz[i] * STEP;
      this.onFloor[i] = 0;
    }
    this.hash();
    this.pairs();
    for (let i = 0; i < n; i++) {
      if (!alive[i] || carried[i]) continue;
      if (asleep[i]) { this.belt(i); this.push(i); continue; }
      this.walls(i);
      this.push(i);
      this.belt(i);
      this.pull(i);
      this.floor(i, collect);
      if (!alive[i]) continue;
      // A slow body is slowed further, which takes the fizz out of a
      // settling heap. Sleep is judged on where it has got to, not how fast
      // it says it is going: a stack of spheres under gravity carries
      // velocity it never turns into distance, and would never rest by speed.
      const speed2 = vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i];
      if (speed2 < 1.5) { vx[i] *= 0.96; vy[i] *= 0.96; vz[i] *= 0.96; }
      if (window) {
        const dx = x[i] - this.sx[i], dy = y[i] - this.sy[i], dz = z[i] - this.sz[i];
        if (dx * dx + dy * dy + dz * dz < SLEEP_DRIFT * SLEEP_DRIFT) {
          asleep[i] = 1; vx[i] = vy[i] = vz[i] = 0; this.wx[i] = this.wy[i] = this.wz[i] = 0;
        }
        this.sx[i] = x[i]; this.sy[i] = y[i]; this.sz[i] = z[i];
      }
      this.turn(i);
    }
    this.loads = this.loadNow.slice();
    this.load = this.loads[0] ?? 0;
  }

  private cellOf(px: number, py: number): number {
    const cx = Math.max(0, Math.min(this.gx - 1, ((px - ORIGIN_X) / CELL + 1) | 0));
    const cy = Math.max(0, Math.min(this.gy - 1, ((py - ORIGIN_Y) / CELL + 1) | 0));
    return cy * this.gx + cx;
  }

  private hash() {
    this.head.fill(-1);
    const { head, next, alive, carried } = this;
    for (let i = 0; i < this.count; i++) {
      if (!alive[i] || carried[i]) continue;
      const c = this.cellOf(this.x[i], this.y[i]);
      next[i] = head[c]; head[c] = i;
    }
  }

  private pairs() {
    const { x, y, z, vx, vy, vz, r, alive, asleep, carried, head, next, gx } = this;
    for (let i = 0; i < this.count; i++) {
      if (!alive[i] || asleep[i] || carried[i]) continue;
      const c = this.cellOf(x[i], y[i]);
      const cx = c % gx, cy = (c / gx) | 0;
      for (let oy = -1; oy <= 1; oy++) {
        const ny = cy + oy; if (ny < 0 || ny >= this.gy) continue;
        for (let ox = -1; ox <= 1; ox++) {
          const nx = cx + ox; if (nx < 0 || nx >= gx) continue;
          for (let j = head[ny * gx + nx]; j >= 0; j = next[j]) {
            // an awake pair is done once, from the lower index; a sleeper is
            // never the outer body, so it is done from the awake one
            if (j === i || (!asleep[j] && j < i)) continue;
            const dx = x[j] - x[i], dy = y[j] - y[i], dz = z[j] - z[i];
            const rr = r[i] + r[j];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 >= rr * rr || d2 < 1e-8) continue;
            const d = Math.sqrt(d2);
            const nxx = dx / d, nyy = dy / d, nzz = dz / d;
            const pen = rr - d;
            const rvx = vx[j] - vx[i], rvy = vy[j] - vy[i], rvz = vz[j] - vz[i];
            const vn = rvx * nxx + rvy * nyy + rvz * nzz;
            // a sleeper is woken only by something arriving with intent
            if (asleep[j]) {
              if (vn < -1.2 || pen > 0.3) this.wake(j);
              else {
                // i rests against a sleeping j: j is a wall, i is stopped by it
                x[i] -= nxx * pen; y[i] -= nyy * pen; z[i] -= nzz * pen;
                if (vn < 0) { vx[i] += nxx * vn; vy[i] += nyy * vn; vz[i] += nzz * vn; }
                vx[i] *= 0.98; vy[i] *= 0.98;
                this.onFloor[i] |= nzz < -0.5 ? 1 : 0;
                continue;
              }
            }
            const mi = r[i] * r[i] * r[i], mj = r[j] * r[j] * r[j];
            const wi = mj / (mi + mj), wj = mi / (mi + mj);
            // part of the overlap a step, past a little slop: all of it at
            // once makes a heap pop and fizz and never settle
            const fix = Math.max(0, pen - 0.01) * 0.45;
            x[i] -= nxx * fix * wi; y[i] -= nyy * fix * wi; z[i] -= nzz * fix * wi;
            x[j] += nxx * fix * wj; y[j] += nyy * fix * wj; z[j] += nzz * fix * wj;
            if (vn < 0) {
              // a slow touch does not bounce at all
              const jn = -(1 + (vn < -1.5 ? RESTITUTION : 0)) * vn;
              vx[i] -= nxx * jn * wi; vy[i] -= nyy * jn * wi; vz[i] -= nzz * jn * wi;
              vx[j] += nxx * jn * wj; vy[j] += nyy * jn * wj; vz[j] += nzz * jn * wj;
              // friction along the tangent, capped by the normal impulse
              const tx = rvx - vn * nxx, ty = rvy - vn * nyy, tz = rvz - vn * nzz;
              const tl = Math.hypot(tx, ty, tz);
              if (tl > 1e-5) {
                const jt = Math.min(tl, FRICTION * jn);
                const fx = (tx / tl) * jt, fy = (ty / tl) * jt, fz = (tz / tl) * jt;
                vx[i] += fx * wi; vy[i] += fy * wi; vz[i] += fz * wi;
                vx[j] -= fx * wj; vy[j] -= fy * wj; vz[j] -= fz * wj;
                // and a tumble from it
                const k = 0.5;
                this.wx[i] += (nyy * fz - nzz * fy) * k; this.wy[i] += (nzz * fx - nxx * fz) * k; this.wz[i] += (nxx * fy - nyy * fx) * k;
                this.wx[j] -= (nyy * fz - nzz * fy) * k; this.wy[j] -= (nzz * fx - nxx * fz) * k; this.wz[j] -= (nxx * fy - nyy * fx) * k;
              }
            }
            if (nzz < -0.5) this.onFloor[i] |= 1;
            if (nzz > 0.5) this.onFloor[j] |= 1;
          }
        }
      }
    }
  }

  /** The rock: the tiles around a body, as boxes it cannot enter. */
  private walls(i: number) {
    const { x, y, vx, vy, r, solid } = this;
    const px = x[i], py = y[i], rad = r[i];
    const tx = Math.floor((px - ORIGIN_X) / TILE), ty = Math.floor((py - ORIGIN_Y) / TILE);
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const nx = tx + ox, ny = ty + oy;
        const rock = nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS || solid[ny * COLS + nx];
        if (!rock) continue;
        const x0 = ORIGIN_X + nx * TILE, y0 = ORIGIN_Y + ny * TILE;
        const cx = Math.max(x0, Math.min(x0 + TILE, px)), cy = Math.max(y0, Math.min(y0 + TILE, py));
        let dx = px - cx, dy = py - cy;
        let d = Math.hypot(dx, dy);
        if (d >= rad) continue;
        if (d < 1e-4) {
          // inside the block: out the nearest face
          const lx = px - (x0 + TILE / 2), ly = py - (y0 + TILE / 2);
          if (Math.abs(lx) > Math.abs(ly)) { dx = Math.sign(lx) || 1; dy = 0; } else { dx = 0; dy = Math.sign(ly) || 1; }
          d = 0;
          x[i] += dx * (TILE / 2 + rad - Math.abs(lx)) * Math.abs(dx);
          y[i] += dy * (TILE / 2 + rad - Math.abs(ly)) * Math.abs(dy);
        } else {
          dx /= d; dy /= d;
          x[i] += dx * (rad - d); y[i] += dy * (rad - d);
        }
        const vn = vx[i] * dx + vy[i] * dy;
        if (vn < 0) { vx[i] -= dx * vn * 1.1; vy[i] -= dy * vn * 1.1; }
      }
    }
  }

  /** The blade and the hull: oriented boxes that shove. */
  private push(i: number) {
    const { x, y, z, vx, vy, vz, r } = this;
    for (const p of this.pushers) {
      const dx = x[i] - p.x, dy = y[i] - p.y, dz = z[i] - p.z;
      const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
      const lx = c * dx + s * dy, ly = -s * dx + c * dy, lz = dz;
      const rad = r[i];
      if (Math.abs(lx) > p.hx + rad || Math.abs(ly) > p.hy + rad || Math.abs(lz) > p.hz + rad) continue;
      const qx = Math.max(-p.hx, Math.min(p.hx, lx)), qy = Math.max(-p.hy, Math.min(p.hy, ly)), qz = Math.max(-p.hz, Math.min(p.hz, lz));
      let nx = lx - qx, ny = ly - qy, nz = lz - qz;
      let d = Math.hypot(nx, ny, nz);
      if (d >= rad) continue;
      if (d < 1e-4) {
        // centre inside the box: leave by the nearest face, never downward
        const ex = p.hx - Math.abs(lx), ey = p.hy - Math.abs(ly), ez = p.hz - lz;
        if (ex <= ey && ex <= ez) { nx = Math.sign(lx) || 1; ny = 0; nz = 0; d = -ex; }
        else if (ey <= ez) { nx = 0; ny = Math.sign(ly) || 1; nz = 0; d = -ey; }
        else { nx = 0; ny = 0; nz = 1; d = -ez; }
      } else { nx /= d; ny /= d; nz /= d; }
      const pen = rad - d;
      // back to the world
      const wnx = c * nx - s * ny, wny = s * nx + c * ny, wnz = nz;
      if (this.asleep[i]) this.wake(i);
      x[i] += wnx * pen; y[i] += wny * pen; z[i] += wnz * pen;
      // the box's velocity at the point of contact: its own, plus the turn
      const ox = x[i] - p.px, oy = y[i] - p.py;
      const pvx = p.vx - p.spin * oy, pvy = p.vy + p.spin * ox;
      const vn = vx[i] * wnx + vy[i] * wny + vz[i] * wnz;
      const pvn = pvx * wnx + pvy * wny;
      if (vn < pvn) {
        const j = pvn - vn;
        vx[i] += wnx * j; vy[i] += wny * j; vz[i] += wnz * j;
      }
      // dragged along with the face a little, which is how a blade carries a load
      vx[i] += (pvx - vx[i]) * 0.15; vy[i] += (pvy - vy[i]) * 0.15;
      if (Math.abs(wnz) < 0.5) this.loadNow[p.owner] = (this.loadNow[p.owner] ?? 0) + 1;
    }
  }

  /** The magnet: a pull that grows toward the point, on things low enough to be on the floor. */
  private pull(i: number) {
    const m = this.magnet;
    if (!m || this.z[i] > this.r[i] + 1.5) return;
    const dx = m.x - this.x[i], dy = m.y - this.y[i];
    const d = Math.hypot(dx, dy);
    if (d >= m.radius || d < 0.5) return;
    const k = (m.strength * (1 - d / m.radius) * STEP) / d;
    this.vx[i] += dx * k; this.vy[i] += dy * k;
  }

  private belt(i: number) {
    const { x, y, z, vx, vy, r } = this;
    for (const b of this.belts) {
      const dx = x[i] - b.cx, dy = y[i] - b.cy;
      const along = dx * b.dx + dy * b.dy, across = -dx * b.dy + dy * b.dx;
      if (Math.abs(along) > b.half || Math.abs(across) > b.width / 2 || z[i] > r[i] + 0.6) continue;
      if (this.asleep[i]) this.wake(i);
      const k = 0.12;
      vx[i] += (b.dx * b.speed - vx[i]) * k; vy[i] += (b.dy * b.speed - vy[i]) * k;
      // gathered toward the centre line, so the belt delivers to one place
      vx[i] += -b.dy * -across * 0.6 * k; vy[i] += b.dx * -across * 0.6 * k;
    }
  }

  private floor(i: number, collect: (kind: number, x: number, y: number) => void) {
    const { x, y, z, vx, vy, vz, r } = this;
    const dx = x[i] - HOLE.x, dy = y[i] - HOLE.y;
    const d = Math.hypot(dx, dy);
    if (d < HOLE.radius) {
      // over the hole: nothing under it, and the pit's wall around it
      if (z[i] < 0 && d > HOLE.radius - r[i]) {
        const nx = dx / d, ny = dy / d;
        const fix = d - (HOLE.radius - r[i]);
        x[i] -= nx * fix; y[i] -= ny * fix;
        const vn = vx[i] * nx + vy[i] * ny;
        if (vn > 0) { vx[i] -= nx * vn; vy[i] -= ny * vn; }
      }
      if (z[i] < -HOLE.depth + 3) { collect(this.kind[i], x[i], y[i]); this.remove(i); }
      return;
    }
    if (z[i] < r[i]) {
      z[i] = r[i];
      if (vz[i] < 0) vz[i] = -vz[i] * RESTITUTION;
      const drag = 1 / (1 + FLOOR_DRAG * STEP);
      vx[i] *= drag; vy[i] *= drag;
      this.onFloor[i] = 1;
      // a coin near the rim tips in: the floor slopes to the hole a little
      if (d < HOLE.radius + 2.5) {
        vx[i] -= (dx / d) * 6 * STEP; vy[i] -= (dy / d) * 6 * STEP;
      }
    }
  }

  /** The cosmetic spin: flat when on the floor, tumbling when not. */
  private turn(i: number) {
    const q = this.q, o = i * 4;
    if (this.onFloor[i] && this.z[i] <= this.r[i] + 0.05) {
      // ease to flat, whichever face is nearer up
      const zz = 1 - 2 * (q[o] * q[o] + q[o + 1] * q[o + 1]);
      const k = 0.12;
      if (zz >= 0) { q[o] *= 1 - k; q[o + 1] *= 1 - k; }
      else {
        // toward a half turn about the axis it is already tilted round
        const l = Math.hypot(q[o], q[o + 1]) || 1;
        q[o] += (q[o] / l - q[o]) * k; q[o + 1] += (q[o + 1] / l - q[o + 1]) * k;
        q[o + 3] *= 1 - k;
      }
      this.normalise(i);
      this.wx[i] *= 0.7; this.wy[i] *= 0.7; this.wz[i] *= 0.7;
      return;
    }
    const wx = this.wx[i], wy = this.wy[i], wz = this.wz[i];
    const w2 = wx * wx + wy * wy + wz * wz;
    if (w2 < 1e-6) return;
    const cap = 12;
    const scale = w2 > cap * cap ? cap / Math.sqrt(w2) : 1;
    const hx = wx * scale * STEP * 0.5, hy = wy * scale * STEP * 0.5, hz = wz * scale * STEP * 0.5;
    const qx = q[o], qy = q[o + 1], qz = q[o + 2], qw = q[o + 3];
    q[o] += hx * qw + hy * qz - hz * qy;
    q[o + 1] += hy * qw + hz * qx - hx * qz;
    q[o + 2] += hz * qw + hx * qy - hy * qx;
    q[o + 3] += -hx * qx - hy * qy - hz * qz;
    this.normalise(i);
    this.wx[i] *= 0.985; this.wy[i] *= 0.985; this.wz[i] *= 0.985;
  }
}
