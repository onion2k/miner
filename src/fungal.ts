/**
 * The fungal biome, the Warrens': spongy purple rock, a plum floor, and pale
 * violet-green lamps, with mushrooms of its own growing on it. Kept apart
 * from `biomes.ts`, which wires every biome in, so this one's dressing can be
 * worked on without touching the others'.
 */
import type { Emit } from 'artshape-render/game/particles';
import type { Mesh } from 'artshape-render/mesh/types';
import type { Biome, FeatureLight, Place, Prop } from './biomes';
import { ball, cone, cylinder, lump, moved, scaled } from './meshes';
import type { Rgb } from './palette';
import type { Samples } from './terrain';

export const FUNGAL: Biome = {
  name: 'fungal',
  floor: [
    [0.1, 0.045, 0.085, 0.95],
    [0.12, 0.05, 0.1, 0.95],
    [0.15, 0.065, 0.13, 0.9],
    // the foot: spent spores and rot against the rock
    [0.07, 0.03, 0.06, 0.95],
  ],
  rock: [
    [0.05, 0.025, 0.08, 0.9],
    [0.11, 0.05, 0.17, 0.85],
    [0.24, 0.1, 0.3, 0.9],
  ],
  stone: { rock: [0.12, 0.08, 0.14], floor: [0.1, 0.07, 0.09] },
  lamp: [0.75, 1.0, 0.85],
  lampBright: 0.55,
  shape: { rough: 1.5, ledge: 0.7, beds: 0.15, top: 1.15 },
};

/** What grows in it. */
export type FungalPropKind = 'shroomStem' | 'shroomCap' | 'shelf' | 'spores' | 'gills';

export const FUNGAL_MESHES: Record<FungalPropKind, () => Mesh> = {
  shroomStem: () => cylinder(1, 1, 7),
  // a dome, its rim a little below the stem's top so it hangs over it
  shroomCap: () => scaled(ball(1, 4, 10), 1, 1, 0.5),
  // a bracket, flat on top and round at its lip, standing out from the rock
  shelf: () => scaled(lump(11, 3, 8), 1, 1, 0.3),
  spores: () => scaled(lump(3, 3, 7), 1, 1, 0.55),
  gills: () => moved(cone(1, 1, 5), 0, 0, 0),
};

/** The three colours a cap glows, so no cave of them reads as one lamp. */
const GLOW: Rgb[] = [
  [0.75, 0.4, 1.0],
  [0.3, 1.0, 0.9],
  [0.55, 1.0, 0.45],
];

/** The cap's own colour for a glow: past one, so it reads as lit from inside. */
const glowing = (c: Rgb): Rgb => [c[0] * 1.6, c[1] * 1.6, c[2] * 1.6];

/** The colour of a cap that does not glow: dull violets and browns, from a share. */
const dull = (t: number): Rgb => [0.45 + t * 0.4, 0.15 + t * 0.12, 0.4 + t * 0.3];

/**
 * Fungal: tall mushrooms against the rock, some with a glowing cap that pulses; clusters of small ones at its
 * foot; shelf fungi stepping up its face; and spore puffs and gills along the floor's edge. Sparse in light, so
 * the cave is dark between the caps.
 */
export function fungal(p: Place, r: number, props: Prop[], lights: FeatureLight[], s: Samples) {
  const { x, y, z, d, w, h, i, j } = p;
  const cap = (mx: number, my: number, mz: number, radius: number, colour: Rgb, yaw: number, rough: number) =>
    props.push({
      kind: 'shroomCap',
      x: mx,
      y: my,
      z: mz,
      yaw,
      tilt: 0,
      size: [radius, radius, radius],
      colour,
      roughness: rough,
    });
  const stem = (mx: number, my: number, mz: number, radius: number, height: number, lean: number) =>
    props.push({
      kind: 'shroomStem',
      x: mx,
      y: my,
      z: mz,
      yaw: 0,
      tilt: lean,
      size: [radius, radius, height],
      colour: [0.75, 0.62, 0.7],
      roughness: 0.75,
    });
  const light = (lx: number, ly: number, lz: number, colour: Rgb, big: number) =>
    lights.push({
      x: lx,
      y: ly,
      z: lz,
      colour,
      radius: 9 + big * 4,
      intensity: 2.5 + big * 1.5,
      beat: 'pulse',
      glow: 2 + big,
      phase: h(2) * 6,
      biome: 'fungal',
    });
  if (d >= 0.8 && d < 2.2 && r < 0.03 * w) {
    // a giant, leaning a little away from the wall
    const height = 3 + h(1) * 3,
      radius = 1.3 + h(3) * 0.9,
      lean = (h(4) - 0.5) * 0.2;
    const glow = h(5) < 0.45 ? GLOW[Math.floor(h(6) * 3) % 3] : null;
    stem(x, y, z - 0.3, radius * 0.22, height, lean);
    cap(x, y, z - 0.3 + height, radius, glow ? glowing(glow) : dull(h(7)), h(8) * 6.3, glow ? 0.4 : 0.6);
    if (glow) light(x, y, z + height + 0.2, glow, 1);
  } else if (d >= 0.8 && d < 2.0 && r < 0.065 * w) {
    // a cluster of small ones, one of which may glow
    const n = 3 + Math.floor(h(1) * 3);
    const glow = h(5) < 0.15 ? GLOW[Math.floor(h(6) * 3) % 3] : null;
    for (let m = 0; m < n; m++) {
      const a = h(10 + m) * Math.PI * 2,
        out = h(20 + m) * 0.7;
      const mx = x + Math.cos(a) * out,
        my = y + Math.sin(a) * out;
      const height = 0.5 + h(30 + m) * 1.1,
        radius = 0.35 + h(40 + m) * 0.45;
      const lit = glow && m === 0;
      stem(mx, my, z - 0.1, radius * 0.25, height, 0);
      cap(mx, my, z - 0.1 + height, radius, lit ? glowing(glow) : dull(h(50 + m)), a, lit ? 0.4 : 0.6);
    }
    if (glow) light(x, y, z + 1.3, glow, 0);
  } else if (d >= 0.5 && d < 2.6 && r < 0.05 * w) {
    // shelf fungi in a short flight up the face, each a step above and along from the last
    const n = 2 + Math.floor(h(1) * 3);
    const base = h(2);
    for (let m = 0; m < n; m++) {
      const size = 0.55 - m * 0.06 + h(10 + m) * 0.2;
      props.push({
        kind: 'shelf',
        x: x + Math.cos(p.along) * m * 0.3 - p.nx * 0.1,
        y: y + Math.sin(p.along) * m * 0.3 - p.ny * 0.1,
        z: z - 0.3 + m * 0.45,
        yaw: p.along + (h(20 + m) - 0.5) * 0.6,
        tilt: 0,
        size: [size * 1.3, size, 0.5],
        colour: [0.5 + base * 0.3, 0.2 + base * 0.15, 0.4 + base * 0.2],
        roughness: 0.7,
      });
    }
  } else if (d === 0 && r < 0.3 * w && [-1, 1, -s.gx, s.gx].some((o) => s.depth[j * s.gx + i + o] > 0)) {
    // low on the floor's edge: a puff of spores, or gills like a tuft
    const size = 0.5 + h(1) * 0.6;
    const puff = h(2) < 0.5;
    props.push({
      kind: puff ? 'spores' : 'gills',
      x,
      y,
      z: -0.05,
      yaw: h(3) * Math.PI * 2,
      tilt: 0,
      size: puff ? [size, size, size] : [size * 0.25, size * 0.25, size * 0.9],
      colour: puff ? [0.4, 0.3, 0.45] : [0.3 + h(4) * 0.2, 0.18, 0.3],
      roughness: 0.9,
    });
  }
}

/** What drifts in its air near the eye: a spore, slow and rising, barely there. */
export function fungalAir(x: number, y: number, random: () => number): Emit | null {
  return {
    position: [x, y, 0.5 + random() * 4],
    velocity: [0.05, 0.03, 0.25],
    spread: 0.3,
    count: 1,
    life: 5,
    lifeSpread: 0.4,
    size: 0.07,
    growth: -0.01,
    colour: [0.7, 0.55, 1.1],
    alpha: 0,
    gravity: 0,
    floor: 0,
  };
}

/** A puff of spores off a glowing cap, drifting up and out. */
export function fungalParticle(l: FeatureLight): Emit | null {
  return {
    position: [l.x, l.y, l.z - 0.4],
    velocity: [0, 0, 0.5],
    spread: 0.9,
    count: 3,
    life: 3,
    lifeSpread: 0.4,
    size: 0.08,
    growth: -0.02,
    colour: [l.colour[0] * 2, l.colour[1] * 2, l.colour[2] * 2],
    alpha: 0,
    gravity: 0,
    floor: 0,
  };
}
