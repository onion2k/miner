/**
 * The crystal geode, the Deep's: violet rock faced with crystal, a slate floor
 * and magenta-white lamps, with crystals of its own in it. Kept apart
 * from `biomes.ts`, which wires every biome in, so this one's dressing can be
 * worked on without touching the others'.
 */
import type { Emit } from 'artshape-render/game/particles';
import type { Mesh } from 'artshape-render/mesh/types';
import type { Biome, FeatureLight, Place, Prop } from './biomes';
import type { Rgb } from './palette';
import { gem, lump, moved, pointed, scaled } from './meshes';
import type { Samples } from './terrain';

export const GEODE: Biome = {
  name: 'geode',
  floor: [
    [0.04, 0.036, 0.055, 0.6],
    [0.055, 0.048, 0.075, 0.5],
    [0.07, 0.06, 0.095, 0.45],
    // the foot: crystal grit against the rock
    [0.05, 0.045, 0.07, 0.6],
  ],
  rock: [
    [0.06, 0.03, 0.1, 0.35],
    [0.14, 0.06, 0.22, 0.3],
    [0.36, 0.2, 0.48, 0.25],
  ],
  stone: { rock: [0.25, 0.12, 0.35], floor: [0.12, 0.1, 0.16] },
  lamp: [1.0, 0.75, 1.0],
  lampBright: 0.32,
  shape: { rough: 0.6, ledge: 0.9, beds: 0.1, top: 1.25 },
};

/** What stands in it: clusters set in the wall, spires against it, and glints and grit along the floor's edge. */
export type GeodePropKind = 'cluster' | 'spire' | 'glint' | 'grit';

/** Meshes joined into one, for a prop made of several crystals; the faces are flat, so nothing needs sharing. */
function joined(parts: Mesh[]): Mesh {
  const count = (k: 'positions' | 'normals' | 'uvs') => parts.reduce((n, m) => n + m[k].length, 0);
  const positions = new Float32Array(count('positions')),
    normals = new Float32Array(count('normals')),
    uvs = new Float32Array(count('uvs')),
    indices = new Uint32Array(parts.reduce((n, m) => n + m.indices.length, 0));
  let v = 0,
    n = 0;
  for (const m of parts) {
    positions.set(m.positions, v * 3);
    normals.set(m.normals, v * 3);
    uvs.set(m.uvs, v * 2);
    for (let k = 0; k < m.indices.length; k++) indices[n + k] = m.indices[k] + v;
    v += m.positions.length / 3;
    n += m.indices.length;
  }
  return { positions, normals, uvs, indices };
}

/** One crystal grown from the origin along a direction, `length` long, so that it is rooted in whatever it grows from. */
function crystal(radius: number, length: number, dx: number, dy: number, dz: number): Mesh {
  const l = Math.hypot(dx, dy, dz) || 1;
  const rooted = moved(gem(radius, length, 6), 0, 0, length / 2);
  return pointed(rooted, [0, 0, 0], [(dx / l) * length, (dy / l) * length, (dz / l) * length]);
}

/** A cluster at unit size, out along +X from a point on the rock face: a fan of crystals, the long one in the middle. */
function clusterMesh(): Mesh {
  const fan: [number, number, number, number, number][] = [
    // radius, length, then the way it points: out of the wall, along it and up
    [0.34, 2.0, 1, 0, 0.1],
    [0.26, 1.5, 1, 0.55, 0.45],
    [0.26, 1.6, 1, -0.5, 0.3],
    [0.22, 1.1, 0.8, 0.2, 0.95],
    [0.2, 1.0, 0.9, -0.35, -0.6],
    [0.16, 0.7, 0.7, 0.9, -0.3],
  ];
  return joined(fan.map(([r, len, dx, dy, dz]) => crystal(r, len, dx, dy, dz)));
}

/** A spire at unit size: a long crystal on a short one, a little off true, with a small one leaning at its foot. */
function spireMesh(): Mesh {
  return joined([
    moved(gem(0.5, 2, 6), 0, 0, 1),
    moved(scaled(gem(0.32, 2, 6), 1, 1, 0.45), 0.55, 0.15, 0.45),
    crystal(0.18, 0.5, 0.5, -0.4, 0.8),
  ]);
}

export const GEODE_MESHES: Record<GeodePropKind, () => Mesh> = {
  cluster: clusterMesh,
  spire: spireMesh,
  glint: () => moved(gem(1, 2, 4), 0, 0, 1),
  grit: () => lump(11, 3, 5),
};

/** The colours a crystal can be: a pale one, a violet and a magenta, and the lit of each (past 1, so the light seems to come from inside). */
const DULL: Rgb[] = [
  [0.34, 0.12, 0.6],
  [0.45, 0.15, 0.7],
  [0.28, 0.14, 0.62],
];
const LIT: Rgb[] = [
  [3.2, 0.7, 3.0],
  [1.8, 0.8, 3.4],
  [3.4, 1.8, 3.6],
];
/** The light a lit crystal gives, matched to LIT by index: magenta, violet and a white-pink with a little of both. */
const GLOW: Rgb[] = [
  [1.0, 0.25, 0.85],
  [0.6, 0.3, 1.0],
  [1.0, 0.7, 1.0],
];

/**
 * Geode: clusters set in the wall face, spires standing against it, and glints
 * and grit along the floor's edge. Some clusters and spires are lit from
 * inside and give a light of their own, but few, so the hall is mostly dark
 * between them.
 */
export function geode(p: Place, r: number, props: Prop[], lights: FeatureLight[], _s: Samples) {
  const { x, y, z, d, w, h } = p;
  const out = Math.atan2(-p.ny, -p.nx);
  const pick = (v: number) => Math.min(2, Math.floor(v * 3));
  if (d >= 1.0 && d < 2.8 && r < 0.12 * w) {
    // a cluster: rooted a little inside the rock face, its crystals reaching out of it
    const lit = h(1) < 0.18,
      c = pick(h(2)),
      size = 1.3 + h(3) * 1.1;
    props.push({
      kind: 'cluster',
      x: x + p.nx * 0.3,
      y: y + p.ny * 0.3,
      z: z - 0.3 + h(4) * 0.8,
      yaw: out,
      tilt: 0,
      size: [size, size, size],
      colour: lit ? LIT[c] : DULL[c],
      roughness: 0.1,
    });
    if (lit) light(p, x + p.nx * -0.5, y + p.ny * -0.5, z + 1.2, c, 0.6, 'pulse', lights);
  } else if (d >= 1.6 && d < 3.4 && r >= 0.12 * w && r < 0.19 * w) {
    // a spire, standing against the rock
    const lit = h(1) < 0.18,
      c = pick(h(2)),
      width = 0.7 + h(3) * 0.5,
      height = 2.5 + h(4) * 2.5;
    props.push({
      kind: 'spire',
      x,
      y,
      z: z - 0.4,
      yaw: h(5) * Math.PI * 2,
      tilt: (h(6) - 0.5) * 0.25,
      size: [width, width, height / 2],
      colour: lit ? LIT[c] : DULL[c],
      roughness: 0.08,
    });
    if (lit) light(p, x, y, z - 0.4 + height, c, 1, h(7) < 0.7 ? 'pulse' : 'steady', lights);
  } else if (d > 0.1 && d < 1.1 && r >= 0.19 * w && r < 0.6 * w) {
    // grit and now and then a glint, flat on the floor's edge
    if (h(1) < 0.3) {
      const size = 0.12 + h(2) * 0.14;
      props.push({
        kind: 'glint',
        x,
        y,
        z: -0.05,
        yaw: h(3) * Math.PI * 2,
        tilt: (h(4) - 0.5) * 0.8,
        size: [size, size, size * 1.6],
        colour: h(5) < 0.5 ? [1.6, 0.8, 2.0] : [0.9, 0.5, 1.4],
        roughness: 0.05,
      });
    } else {
      const size = Math.min(0.3 + h(2) * 0.4, d + 0.5);
      props.push({
        kind: 'grit',
        x,
        y,
        z: -0.12,
        yaw: h(3) * Math.PI * 2,
        tilt: 0,
        size: [size, size * (0.6 + h(4) * 0.4), 0.2 + h(5) * 0.15],
        colour: [0.2, 0.12, 0.28],
        roughness: 0.4,
      });
    }
  }
}

/** A light that is part of a lit crystal. */
function light(
  p: Place,
  x: number,
  y: number,
  z: number,
  c: number,
  scale: number,
  beat: 'pulse' | 'steady',
  lights: FeatureLight[],
) {
  lights.push({
    x,
    y,
    z,
    colour: GLOW[c],
    radius: 7 * scale + 3,
    intensity: 6 * scale + 3,
    beat,
    glow: 14 * scale + 6,
    phase: p.h(8) * 6,
    biome: 'geode',
  });
}

/** What drifts in its air near the eye: slow motes, and now and then a faint glint. */
export function geodeAir(x: number, y: number, random: () => number): Emit | null {
  const glint = random() < 0.25;
  return {
    position: [x, y, 0.8 + random() * 5],
    velocity: [0.05, 0.03, glint ? 0.08 : 0.2],
    spread: 0.3,
    count: 1,
    life: glint ? 2.5 : 5,
    lifeSpread: 0.4,
    size: glint ? 0.06 : 0.04,
    growth: -0.005,
    colour: glint ? [1.6, 1.0, 2.2] : [0.9, 0.5, 1.4],
    alpha: 0,
    gravity: 0,
    floor: 0,
  };
}

/** A glint off a lit crystal, now and then. */
export function geodeParticle(l: FeatureLight): Emit | null {
  return {
    position: [l.x, l.y, l.z - 0.4],
    velocity: [0, 0, 0.3],
    spread: 0.7,
    count: 1,
    life: 1.4,
    size: 0.09,
    growth: -0.06,
    colour: [2.0, 1.2, 2.6],
    alpha: 0,
    gravity: 0,
    floor: 0,
  };
}
