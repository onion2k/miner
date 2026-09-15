/**
 * What lights the cave each frame, and the glows laid over it.
 *
 * The cave is pitch black: what is seen is what a lamp or a machine's lights
 * fall on. The dozer's headlights, the first of which casts a shadow, and a
 * small light over its cab; the lamps still standing in rooms in play that
 * are near enough the screen to show; the lamps over the hole; each drone's
 * lights and turning beacon; a cracking floor's glow; the red line that
 * seals the room behind; the magnet.
 *
 * The glows are screen-space layers: the hole as something goes down it, a
 * cracking floor, the sealing line, a lamp's glass, and the magnet's reach.
 *
 * Built into a pool of lights and a buffer of glows for whoever draws them;
 * nothing here draws.
 */
import { EFFECT_STRIDE } from 'artshape-render/game/renderer';
import { LightPool } from 'artshape-render/game/lights';
import { HOLE, type Lamp } from './cave';
import { HOLE_LAMPS, HOLE_LAMP_HEIGHT, LAMP_BRIGHT, LAMP_LIGHTS, LAMP_REACH, lampsInView, type View } from './lamps';
import { project } from './matrix';

/** A machine with lights: where it is and which way it faces. */
export interface Lit {
  x: number;
  y: number;
  yaw: number;
}

/** A cracking floor, as it glows. */
export interface Glowing {
  x: number;
  y: number;
  /** 0 to 1. */
  glow: number;
  /** Whether it is about to go, when it flickers. */
  warning: boolean;
}

export interface LightState {
  t: number;
  view: View;
  dozer: Lit;
  bots: readonly Lit[];
  lamps: readonly Lamp[];
  lampOn: (k: number) => boolean;
  fountains: readonly Glowing[];
  /** The last room's vein, glowing once the cave is done. */
  vein: { x: number; y: number } | null;
  /** Where the line that seals the room behind is, while the player is at the next gate. */
  sealing: [number, number] | null;
  magnet: { x: number; y: number; radius: number; strength: number } | null;
  /** How bright the hole glows, 0 to 3. */
  holePulse: number;
}

export class SceneLights {
  readonly lights: LightPool;
  readonly quads: Float32Array<ArrayBuffer>;
  /** How many glows are in `quads`. */
  count = 0;
  /** The lights that cast a shadow, by index in the pool. */
  readonly shadowed: number[] = [];
  /** The lamps lit near the eye this frame, nearest first. */
  readonly lampsLit: number[] = [];

  constructor(
    lightCapacity: number,
    private readonly effectCapacity: number,
  ) {
    this.lights = new LightPool(lightCapacity);
    this.quads = new Float32Array(effectCapacity * EFFECT_STRIDE);
  }

  build(s: LightState): this {
    this.placeLights(s);
    this.placeGlows(s);
    return this;
  }

  private placeLights(s: LightState) {
    const { lights, shadowed } = this;
    const { t, dozer } = s;
    lights.clear();
    shadowed.length = 0;
    const c = Math.cos(dozer.yaw),
      sn = Math.sin(dozer.yaw);
    for (const side of [1, -1]) {
      const i = lights.add({
        position: [dozer.x + c * 2.6 - sn * side * 0.9, dozer.y + sn * 2.6 + c * side * 0.9, 3.0],
        radius: 64,
        colour: [1.0, 0.92, 0.7],
        intensity: 16,
        direction: [c, sn, -0.2],
        cone: [20, 36],
      });
      if (side === 1) shadowed.push(i);
    }
    // a small light over the cab, so the machine can be seen in the dark: it lights the dozer, not the floor
    lights.add({
      position: [dozer.x - c * 0.8, dozer.y - sn * 0.8, 6.5],
      radius: 7,
      colour: [1.0, 0.9, 0.75],
      intensity: 1.2,
    });
    // the lamps whose light reaches the screen, the nearest the eye first, as many as fit
    for (const k of lampsInView(s.lamps, s.lampOn, s.view, this.lampsLit).slice(0, LAMP_LIGHTS)) {
      const l = s.lamps[k];
      const flicker = 0.92 + 0.08 * Math.sin(t * 13 + k * 7) * Math.sin(t * 3.1 + k);
      // bright, and far-reaching enough that between them nowhere on the floor is dark
      lights.add({
        position: [l.x, l.y, l.height],
        radius: LAMP_REACH,
        colour: [1.0, 0.8, 0.55],
        intensity: LAMP_BRIGHT * flicker,
      });
    }
    // The lamps hanging over the hole, green-white: they light the hole, its rim and what goes down
    // it from above, so it can be found in the dark. Only while the hole is near enough the screen
    // for their light to show.
    const hole = project(s.view.viewProjection, HOLE.x, HOLE.y, 0);
    if (hole && Math.abs(hole[0]) < 1.5 && Math.abs(hole[1]) < 1.5) {
      for (const [x, y] of HOLE_LAMPS)
        lights.add({ position: [x, y, HOLE_LAMP_HEIGHT - 0.6], radius: 36, colour: [0.7, 1.0, 0.6], intensity: 14 });
    }
    if (s.vein)
      lights.add({
        position: [s.vein.x, s.vein.y, 5.5],
        radius: 12,
        colour: [1.0, 0.7, 0.3],
        intensity: 1.6 + 0.4 * Math.sin(t * 7),
      });
    for (const b of s.bots) {
      const bc = Math.cos(b.yaw),
        bs = Math.sin(b.yaw);
      lights.add({
        position: [b.x + bc * 1.8, b.y + bs * 1.8, 2.2],
        radius: 44,
        colour: [1.0, 0.92, 0.7],
        intensity: 10,
        direction: [bc, bs, -0.24],
        cone: [20, 36],
      });
      // the beacon, turning
      const beat = 0.5 + 0.5 * Math.sin(t * 6 + b.x);
      lights.add({
        position: [b.x - bc * 1.0, b.y - bs * 1.0, 3.2],
        radius: 9,
        colour: [1.0, 0.45, 0.1],
        intensity: 1 + 2 * beat,
      });
    }
    for (const f of s.fountains) {
      if (f.glow <= 0) continue;
      const flicker = f.warning ? 0.7 + 0.3 * Math.sin(t * 30) : 1;
      lights.add({
        position: [f.x, f.y, 2],
        radius: 10 + f.glow * 14,
        colour: [1.0, 0.55, 0.2],
        intensity: f.glow * 5 * flicker,
      });
    }
    if (s.sealing) {
      // the line that seals the room behind, down the corridor ahead: a red light on it, pulsing
      const [sx, sy] = s.sealing;
      lights.add({ position: [sx, sy, 3], radius: 20, colour: [1.0, 0.25, 0.1], intensity: 3 + 2.5 * Math.sin(t * 8) });
    }
    const m = s.magnet;
    if (m)
      lights.add({
        position: [m.x, m.y, 1.2],
        radius: m.radius * 0.8,
        colour: [0.45, 0.7, 1.0],
        intensity: 0.6 + m.strength * 0.03,
      });
  }

  private placeGlows(s: LightState) {
    const { quads, effectCapacity } = this;
    const { t } = s;
    const vp = s.view.viewProjection;
    let n = 0;
    const put = (values: number[]) => {
      quads.set(values, n * EFFECT_STRIDE);
      n++;
    };
    const p = s.holePulse > 0.02 ? project(vp, HOLE.x, HOLE.y, 0) : null;
    if (p) {
      // the hole is dark like the rest, and flares only as something goes down it
      const size = ((HOLE.radius * 2.2) / p[2]) * (1 + s.holePulse * 0.5);
      put([p[0], p[1], size * 0.9, s.holePulse * 0.9, 0.5, 1.0, 0.35, 1.8]);
    }
    for (const f of s.fountains) {
      if (f.glow <= 0) continue;
      const q = project(vp, f.x, f.y, 0.2);
      if (!q || n >= effectCapacity) continue;
      put([
        q[0],
        q[1],
        (6 / q[2]) * (0.6 + f.glow * 0.6),
        f.glow * (f.warning ? 0.5 + 0.3 * Math.sin(t * 30) : 1.2),
        1.0,
        0.5,
        0.15,
        2.2,
      ]);
    }
    if (s.sealing && n < effectCapacity) {
      const q = project(vp, s.sealing[0], s.sealing[1], 0.2);
      if (q) put([q[0], q[1], 14 / q[2], 0.5 + 0.3 * Math.sin(t * 8), 1.0, 0.25, 0.1, 1.6]);
    }
    // each lamp lit near the eye, a glow round its head: the light is in the glass, not on it
    for (const k of this.lampsLit) {
      if (n >= effectCapacity - 1) break;
      const l = s.lamps[k];
      const q = project(vp, l.x, l.y, l.height);
      if (!q || Math.abs(q[0]) > 1.2 || Math.abs(q[1]) > 1.2) continue;
      put([q[0], q[1], 5 / q[2], 0.85 + 0.1 * Math.sin(t * 13 + k * 7), 1.0, 0.75, 0.4, 2.0]);
    }
    for (const [x, y] of HOLE_LAMPS) {
      if (n >= effectCapacity - 1) break;
      const q = project(vp, x, y, HOLE_LAMP_HEIGHT - 0.6);
      if (!q || Math.abs(q[0]) > 1.2 || Math.abs(q[1]) > 1.2) continue;
      put([q[0], q[1], 5 / q[2], 0.9, 0.7, 1.0, 0.6, 2.0]);
    }
    const m = s.magnet;
    if (m && n < effectCapacity) {
      const q = project(vp, m.x, m.y, 0.2);
      if (q)
        put([
          q[0],
          q[1],
          (m.radius * 1.1) / q[2],
          0.08 + m.strength * 0.004 + 0.03 * Math.sin(t * 5),
          0.45,
          0.7,
          1.0,
          1.0,
        ]);
    }
    this.count = n;
  }
}
