/**
 * Barrels that go off. One stands about in each room like anything else on
 * the floor, and can be pushed about like anything else. Hit one with the
 * dozer and its fuse is lit: it flashes, faster and faster, and a few seconds
 * later it goes off, and everything lying near it is thrown outward and up.
 * A barrel near one going off has its own fuse lit, shorter, so a row of
 * them goes off one after another.
 *
 * Only the player lights a fuse; a drone pushing a barrel about does not. A
 * barrel is a body in the world, of its own kind; this keeps the fuses, and
 * works out what a hit is and what a blast does. The world is handed in, and
 * nothing else of the game.
 */
import { BARREL_KIND, type Pusher, type World } from './physics';

/** How long a fuse burns once the player hits a barrel, in seconds. */
export const FUSE = 3;
/** How far a blast reaches, and how hard it throws what is at its middle: outward, and up. */
export const BLAST_RADIUS = 13,
  BLAST_PUSH = 30,
  BLAST_LIFT = 16;
/** How soon a barrel caught in a blast goes off, at the blast's middle and at its edge. */
const CHAIN_NEAR = 0.35,
  CHAIN_FAR = 0.9;
/** How fast a fuse flashes as it is lit, and as it is about to go, in flashes a second. */
const FLASH_SLOW = 2.5,
  FLASH_FAST = 12;
/** How near a barrel has to be to a box of the player's machine to have been hit by it. */
const CONTACT = 0.15;

/** A barrel going off: where, for the bang, the flash and the dust. */
export interface Blast {
  x: number;
  y: number;
  z: number;
  /** How many things it threw. */
  thrown: number;
}

interface Fuse {
  /** How long it has to go, in seconds. */
  left: number;
  /** How far round its flash is: flashing when this is in the first half of a turn. */
  phase: number;
}

export class Barrels {
  private readonly fuses = new Map<number, Fuse>();

  constructor(private readonly world: World) {}

  /** The barrels with fuses burning, by slot. */
  get lit(): number[] {
    return [...this.fuses.keys()];
  }

  /** How long a barrel's fuse has to go, or null if it is not lit. */
  fuseLeft(i: number): number | null {
    return this.fuses.get(i)?.left ?? null;
  }

  /** Whether a lit barrel is in the bright half of a flash. */
  flashing(i: number): boolean {
    const fuse = this.fuses.get(i);
    return !!fuse && fuse.phase % 1 < 0.5;
  }

  /**
   * A barrel gone from the world some other way than going off — down the
   * hole, or sealed in with its room — has its fuse put out at once, so a
   * barrel put in its slot after it does not go off in its place.
   */
  forget(i: number) {
    this.fuses.delete(i);
  }

  /** Light a barrel's fuse to go in `seconds`, or sooner if it is already burning shorter. Whether it was not lit before. */
  light(i: number, seconds = FUSE): boolean {
    if (!this.world.alive[i] || this.world.kind[i] !== BARREL_KIND) return false;
    const fuse = this.fuses.get(i);
    if (fuse) {
      fuse.left = Math.min(fuse.left, seconds);
      return false;
    }
    this.fuses.set(i, { left: seconds, phase: 0 });
    return true;
  }

  /**
   * The player's machine, as the boxes it pushes with, has hit whatever
   * barrels it is up against, if it is moving: their fuses lit. The slots of
   * those newly lit.
   */
  hitBy(pushers: readonly Pusher[], owner: number): number[] {
    const { world } = this;
    const out: number[] = [];
    for (let i = 0; i < world.count; i++) {
      if (!world.alive[i] || world.kind[i] !== BARREL_KIND || this.fuses.has(i)) continue;
      const r = world.r[i] + CONTACT;
      for (const p of pushers) {
        if (p.owner !== owner) continue;
        const dx = world.x[i] - p.x,
          dy = world.y[i] - p.y,
          dz = world.z[i] - p.z;
        const c = Math.cos(p.yaw),
          s = Math.sin(p.yaw);
        const lx = c * dx + s * dy,
          ly = -s * dx + c * dy;
        const qx = lx - Math.max(-p.hx, Math.min(p.hx, lx)),
          qy = ly - Math.max(-p.hy, Math.min(p.hy, ly)),
          qz = dz - Math.max(-p.hz, Math.min(p.hz, dz));
        if (qx * qx + qy * qy + qz * qz < r * r) {
          if (this.light(i)) out.push(i);
          break;
        }
      }
    }
    return out;
  }

  /**
   * Time passes on the fuses: each flashes faster as it burns down, and those
   * that have burned out go off, throwing what is near them and lighting the
   * barrels near them. `remove` takes a barrel gone off out of the world.
   * The blasts, in the order they went.
   */
  update(dt: number, remove: (i: number) => void): Blast[] {
    const { world } = this;
    const blasts: Blast[] = [];
    for (const [i, fuse] of [...this.fuses]) {
      // gone down the hole, or sealed in with its room, and its slot perhaps something else by now
      if (!world.alive[i] || world.kind[i] !== BARREL_KIND) {
        this.fuses.delete(i);
        continue;
      }
      fuse.left -= dt;
      const urgency = 1 - Math.max(0, Math.min(1, fuse.left / FUSE));
      fuse.phase += dt * (FLASH_SLOW + (FLASH_FAST - FLASH_SLOW) * urgency * urgency);
      if (fuse.left > 0) continue;
      this.fuses.delete(i);
      const x = world.x[i],
        y = world.y[i],
        z = world.z[i];
      remove(i);
      blasts.push({ x, y, z, thrown: this.blast(x, y, z) });
    }
    return blasts;
  }

  /**
   * Everything within the blast's reach thrown outward from it and up, the
   * nearer the harder, and woken so it goes; barrels caught in it lit to go
   * soon after. How many things were thrown.
   */
  blast(x: number, y: number, z: number): number {
    const { world } = this;
    let thrown = 0;
    for (let i = 0; i < world.count; i++) {
      if (!world.alive[i] || world.carried[i]) continue;
      const dx = world.x[i] - x,
        dy = world.y[i] - y;
      const d = Math.hypot(dx, dy, (world.z[i] - z) * 0.5);
      if (d >= BLAST_RADIUS) continue;
      const near = 1 - d / BLAST_RADIUS;
      const len = Math.hypot(dx, dy) || 1;
      const ux = d > 1e-3 ? dx / len : 0,
        uy = d > 1e-3 ? dy / len : 0;
      world.wake(i);
      world.vx[i] += ux * BLAST_PUSH * near;
      world.vy[i] += uy * BLAST_PUSH * near;
      world.vz[i] += BLAST_LIFT * near + 2;
      // and a tumble, for the look of it
      world.wx[i] += (hashish(i, 1) - 0.5) * 30 * near;
      world.wy[i] += (hashish(i, 2) - 0.5) * 30 * near;
      if (world.kind[i] === BARREL_KIND) this.light(i, CHAIN_NEAR + (CHAIN_FAR - CHAIN_NEAR) * (d / BLAST_RADIUS));
      thrown++;
    }
    return thrown;
  }
}

/** A number in [0, 1) that is the same for the same slot and salt, for a tumble with no Math.random in it. */
function hashish(i: number, salt: number): number {
  const h = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return h - Math.floor(h);
}
