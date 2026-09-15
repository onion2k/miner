/**
 * The last room's vein, once the cave is cleared: a coin now and then out of
 * the rock, and a gem now and then, so there is still something to push.
 */
import type { Vein } from './cave';

/** A body thrown out of the vein: its kind, where, and how fast. */
export type Drop = (kind: number, x: number, y: number, z: number, vx: number, vy: number, vz: number) => void;

export class VeinTrickle {
  private timer: number;

  constructor(
    private readonly vein: Vein,
    private readonly random: () => number = Math.random,
  ) {
    this.timer = random();
  }

  /** Time passes: a drop, when one is due. */
  update(dt: number, drop: Drop) {
    this.timer -= dt;
    if (this.timer > 0) return;
    const v = this.vein;
    this.timer = v.every * (0.7 + this.random() * 0.6);
    let kind = 0;
    const roll = this.random();
    let acc = 0;
    for (const [k, p] of v.gems) {
      acc += p;
      if (roll < acc) {
        kind = k;
        break;
      }
    }
    const a = this.random() * Math.PI * 2;
    drop(kind, v.x + Math.cos(a) * 0.6, v.y + Math.sin(a) * 0.6, 6.5, Math.cos(a) * 3, Math.sin(a) * 3, 1);
  }
}
