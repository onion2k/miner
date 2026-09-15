/**
 * Each gallery is a world of its own: the South Gallery a jungle, the North
 * Vault ice, the East Gallery lava, and the West Gallery the future. The
 * hollow in the middle is the cave as it always was.
 *
 * A biome is how a room looks, and nothing of how it plays: its rock and
 * floor colours and the shape of its rock, the light its lamps give, what
 * grows or stands on its rock, a feature that glows, and what drifts in its
 * air. The rock the dozer runs into, the floor it drives on, and everything
 * the coins do are the same everywhere.
 *
 * A biome does not start at a line. How much of one there is at a point is
 * its weight, from nothing at the hollow's rim to all of it by the room's
 * near edge, down the corridor between. Stones, plants and lamps take their
 * colour by the weight, smoothly. The rock and floor are drawn a colour a
 * group, not a colour a vertex, so each patch of them takes the biome's
 * palette or the cave's own by the weight as a chance, through a patchy
 * noise: the biome creeps in, in patches that grow and join, rather than
 * fading.
 */
import type { Emit } from 'artshape-render/game/particles';
import type { Mesh } from 'artshape-render/mesh/types';
import { AREAS, ORIGIN_X, ORIGIN_Y, TILE, WINGS, hash } from './cave';
import { ball, box, cone, cylinder, frond, gem, lump, moved, scaled, tuft } from './meshes';
import { noise, smoothstep } from './noise';
import { FLOOR_TONES, ROCK_TONES, type Rgb } from './palette';
import { PLAIN_ROCK, TONES, type RockShape, type Samples, type TerrainStyle } from './terrain';

/** A shade: colour and roughness. */
export type Tone = [number, number, number, number];

export type BiomeName = 'jungle' | 'ice' | 'lava' | 'future';

export interface Biome {
  name: BiomeName;
  /** The floor's shades and the rock's (steep and dark, steep, the tops), as the cave's own are. */
  floor: Tone[];
  rock: Tone[];
  /** The colour of a stone lying on the rock, and of grit on the floor. */
  stone: { rock: Rgb; floor: Rgb };
  /** The colour a lamp's light is, and how bright against the cave's own: a dark room wants its lamps dimmer, or they light it like any other. */
  lamp: Rgb;
  lampBright: number;
  shape: RockShape;
}

/** The colour of the cave's own lamps. */
export const LAMP_COLOUR: Rgb = [1.0, 0.8, 0.55];

const JUNGLE: Biome = {
  name: 'jungle',
  floor: [
    [0.12, 0.1, 0.05, 0.95],
    [0.1, 0.13, 0.055, 0.95],
    [0.15, 0.19, 0.075, 0.9],
  ],
  rock: [
    [0.04, 0.06, 0.035, 0.9],
    [0.075, 0.11, 0.05, 0.85],
    [0.12, 0.27, 0.07, 0.9],
  ],
  stone: { rock: [0.07, 0.12, 0.05], floor: [0.1, 0.09, 0.05] },
  lamp: [1.0, 0.95, 0.6],
  lampBright: 0.9,
  shape: { rough: 1.1, ledge: 1.3, beds: 0.4, top: 1.05 },
};

const ICE: Biome = {
  name: 'ice',
  floor: [
    [0.19, 0.24, 0.31, 0.5],
    [0.24, 0.29, 0.37, 0.4],
    [0.31, 0.36, 0.43, 0.35],
  ],
  rock: [
    [0.07, 0.12, 0.21, 0.4],
    [0.13, 0.21, 0.33, 0.3],
    [0.4, 0.45, 0.52, 0.6],
  ],
  stone: { rock: [0.3, 0.37, 0.46], floor: [0.26, 0.31, 0.38] },
  lamp: [0.7, 0.85, 1.0],
  lampBright: 0.75,
  shape: { rough: 0.3, ledge: 0.5, beds: 0.15, top: 1.15 },
};

const LAVA: Biome = {
  name: 'lava',
  floor: [
    [0.035, 0.03, 0.03, 0.9],
    [0.05, 0.042, 0.038, 0.9],
    [0.065, 0.035, 0.025, 0.85],
  ],
  rock: [
    [0.025, 0.022, 0.024, 0.7],
    [0.05, 0.04, 0.04, 0.6],
    [0.11, 0.05, 0.035, 0.8],
  ],
  stone: { rock: [0.04, 0.035, 0.035], floor: [0.05, 0.04, 0.035] },
  lamp: [1.0, 0.55, 0.3],
  lampBright: 0.45,
  shape: { rough: 1.9, ledge: 1.6, beds: 0.2, top: 0.9 },
};

const FUTURE: Biome = {
  name: 'future',
  floor: [
    [0.05, 0.06, 0.075, 0.65],
    [0.08, 0.09, 0.11, 0.6],
    [0.02, 0.025, 0.035, 0.7],
  ],
  rock: [
    [0.025, 0.03, 0.045, 0.5],
    [0.05, 0.06, 0.08, 0.45],
    [0.09, 0.1, 0.13, 0.4],
  ],
  stone: { rock: [0.06, 0.07, 0.09], floor: [0.05, 0.055, 0.07] },
  lamp: [0.65, 0.85, 1.0],
  lampBright: 0.5,
  shape: { rough: 0.15, ledge: 0.25, beds: 1, top: 1 },
};

/** Each room's biome, by its index: none for the hollow. */
export const BIOMES: (Biome | null)[] = AREAS.map((_, a) => [null, JUNGLE, ICE, LAVA, FUTURE][a] ?? null);

// ---- how much of a biome there is where ----

/** Along a wing and across it, in world units. */
function onWing(area: number, x: number, y: number): [number, number] {
  const [dx, dy] = WINGS[area].dir;
  return dx ? [dx * x, y] : [dy * y, x];
}

/** The room whose biome is strongest at a point, and how strong, 0 to 1. The hollow and its walls are 0. */
export function biomeAt(x: number, y: number): { area: number; weight: number } {
  let best = { area: 0, weight: 0 };
  for (let a = 1; a < WINGS.length; a++) {
    if (!BIOMES[a]) continue;
    const { mouth, room } = WINGS[a];
    const [along, across] = onWing(a, x, y);
    // from a little past the hollow's rim, which stays as it was, to a little into the room
    const start = mouth * TILE + 5,
      whole = (room.along - room.half) * TILE + 8;
    const edge = (room.halfAcross + 3) * TILE;
    const weight =
      smoothstep(start, whole, along) * (1 - smoothstep(edge - 8, edge + 4, Math.abs(across - room.across * TILE)));
    if (weight > best.weight) best = { area: a, weight };
  }
  return best;
}

/** A colour of the cave's own, taken as far toward a biome's as the biome is strong at a point. */
export function tint(base: Rgb, x: number, y: number, pick: (b: Biome) => Rgb): Rgb {
  const { area, weight } = biomeAt(x, y);
  const biome = BIOMES[area];
  if (!biome || weight <= 0) return base;
  const to = pick(biome);
  return [0, 1, 2].map((i) => base[i] + (to[i] - base[i]) * weight) as Rgb;
}

/** The colour of a lamp's light where it stands, and its brightness against the cave's own lamps. */
export function lampColour(x: number, y: number): Rgb {
  return tint(LAMP_COLOUR, x, y, (b) => b.lamp.map((c) => c * b.lampBright) as Rgb);
}

/** The shade of a group of rock or floor, by the palette it was drawn from: 0 the cave's own, else a room's biome. */
export function groundTone(palette: number, rock: boolean, tone: number): Tone {
  const biome = BIOMES[palette];
  if (!biome) return (rock ? ROCK_TONES : FLOOR_TONES)[tone] as Tone;
  return (rock ? biome.rock : biome.floor)[tone];
}

/** How the terrain takes the biomes: which palette each patch is drawn from, its shades, and the rock's shape. */
export const BIOME_STYLE: TerrainStyle = {
  palette(x, y) {
    const { area, weight } = biomeAt(x, y);
    if (weight <= 0) return 0;
    // patches that grow as the weight does, ragged at the triangle's own size
    const threshold = 0.6 * noise(x * 0.16, y * 0.16, 91) + 0.4 * hash(Math.round(x * 3), Math.round(y * 3), 93);
    return weight >= 0.999 || weight > threshold ? area : 0;
  },
  tone(palette, x, y, rock, tone) {
    if (BIOMES[palette]?.name !== 'future' || rock) return tone;
    // the future's floor is panels, a tile each, alternating, with a dark seam round each
    const fx = (x - ORIGIN_X) / TILE,
      fy = (y - ORIGIN_Y) / TILE;
    const ex = fx - Math.floor(fx),
      ey = fy - Math.floor(fy);
    if (Math.min(ex, 1 - ex, ey, 1 - ey) < 0.07) return TONES - 1;
    return (Math.floor(fx) + Math.floor(fy)) & 1;
  },
  shape(x, y) {
    const { area, weight } = biomeAt(x, y);
    const to = BIOMES[area]?.shape;
    if (!to || weight <= 0) return PLAIN_ROCK;
    const mix = (k: keyof RockShape) => PLAIN_ROCK[k] + (to[k] - PLAIN_ROCK[k]) * weight;
    return { rough: mix('rough'), ledge: mix('ledge'), beds: mix('beds'), top: mix('top') };
  },
};

// ---- what stands in them ----

export type PropKind =
  | 'crystal'
  | 'snow'
  | 'icicle'
  | 'fern'
  | 'tuft'
  | 'vine'
  | 'trunk'
  | 'canopy'
  | 'stem'
  | 'cap'
  | 'column'
  | 'shard'
  | 'pool'
  | 'seep'
  | 'crate'
  | 'pylon'
  | 'neon';

/** The shape of each kind of prop, at unit size, standing on z = 0 unless said. */
export const PROP_MESHES: Record<PropKind, () => Mesh> = {
  crystal: () => moved(gem(1, 2, 6), 0, 0, 1),
  snow: () => lump(4),
  icicle: () => cone(1, 1, 6),
  fern: () => frond(7),
  tuft: () => tuft(9),
  vine: () => box(1, 1, 1),
  trunk: () => cylinder(1, 1, 6),
  canopy: () => lump(5),
  stem: () => cylinder(1, 1, 6),
  cap: () => scaled(ball(1, 4, 10), 1, 1, 0.45),
  column: () => cylinder(1, 1, 6),
  shard: () => moved(gem(1, 2, 4), 0, 0, 1),
  pool: () => cylinder(1, 1, 14),
  seep: () => box(1, 1, 1, true),
  crate: () => box(1, 1, 1),
  pylon: () => box(1, 1, 1),
  neon: () => box(1, 1, 1, true),
};

export interface Prop {
  kind: PropKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** A lean, about the prop's own sideways axis. */
  tilt: number;
  size: [number, number, number];
  colour: Rgb;
  roughness: number;
  /** The room it is drawn with, dark until it is open. */
  area: number;
}

/** A light that is part of a biome: how it beats, and the glow laid over it. */
export interface FeatureLight {
  x: number;
  y: number;
  z: number;
  colour: Rgb;
  radius: number;
  intensity: number;
  beat: 'steady' | 'flicker' | 'pulse' | 'blink';
  /** How big its glow is on the screen, at a unit distance; 0 for none. */
  glow: number;
  /** A phase for its beat, so no two beat together. */
  phase: number;
  area: number;
  biome: BiomeName;
}

export interface Decor {
  props: Prop[];
  lights: FeatureLight[];
}

/**
 * Everything each biome stands on its rock, and the lights that are part of
 * it, placed on the terrain's own sample points. Only ever on the rock, or
 * flat on the floor at its foot, so nothing stands where the dozer drives
 * that it would drive through. The same every time for the same terrain.
 */
export function decorate(s: Samples): Decor {
  const props: Prop[] = [],
    lights: FeatureLight[] = [];
  const { gx, gy, depth } = s;
  const finite = (k: number) => (k >= 0 && k < depth.length && Number.isFinite(depth[k]) ? depth[k] : 0);
  for (let j = 1; j < gy - 1; j++) {
    for (let i = 1; i < gx - 1; i++) {
      const k = j * gx + i,
        d = depth[k];
      if (!Number.isFinite(d) || s.area[k] === 255) continue;
      const x = s.x[k],
        y = s.y[k];
      const { area: b, weight: w } = biomeAt(x, y);
      const biome = BIOMES[b];
      if (!biome || w < 0.05) continue;
      const h = (salt: number) => hash(i, j, 300 + salt);
      const r = h(0);
      // the way into the rock here, and along the wall square to it
      const gxd = finite(k + 1) - finite(k - 1),
        gyd = finite(k + gx) - finite(k - gx);
      const gl = Math.hypot(gxd, gyd) || 1;
      const along = Math.atan2(gyd, gxd) + Math.PI / 2;
      const at: Place = { x, y, z: s.z[k], d, area: s.area[k], w, h, along, nx: gxd / gl, ny: gyd / gl, i, j };
      if (biome.name === 'ice') ice(at, r, props, lights);
      else if (biome.name === 'jungle') jungle(at, r, props, lights, s);
      else if (biome.name === 'lava') lava(at, r, props, lights, s);
      else future(at, r, props, lights);
    }
  }
  return { props, lights };
}

interface Place {
  x: number;
  y: number;
  /** The surface's height here. */
  z: number;
  /** How far into the rock. */
  d: number;
  area: number;
  /** The biome's weight here. */
  w: number;
  h: (salt: number) => number;
  /** The way along the wall. */
  along: number;
  /** The way into the rock, a unit long. */
  nx: number;
  ny: number;
  i: number;
  j: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** The highest of the surface in the square `reach` samples round a point. */
function highest(s: Samples, i: number, j: number, reach: number): number {
  let top = -Infinity;
  for (let v = Math.max(0, j - reach); v <= Math.min(s.gy - 1, j + reach); v++)
    for (let u = Math.max(0, i - reach); u <= Math.min(s.gx - 1, i + reach); u++)
      top = Math.max(top, s.z[v * s.gx + u]);
  return top;
}

/** Ice: clusters of crystals at the foot of the rock, some glowing from inside; drifts of snow; spires of ice on the tops. */
function ice(p: Place, r: number, props: Prop[], lights: FeatureLight[]) {
  const { x, y, z, d, area, w, h } = p;
  if (d >= 1.2 && d < 2.6 && r < 0.06 * w) {
    const glowing = h(1) < 0.45;
    const n = 3 + Math.floor(h(2) * 4);
    for (let m = 0; m < n; m++) {
      const a = h(10 + m) * Math.PI * 2,
        out = 0.15 + h(20 + m) * 0.6;
      const radius = 0.35 + h(30 + m) * 0.45,
        height = (2 + h(40 + m) * 2.5) * (glowing ? 1.3 : 1);
      props.push({
        kind: 'crystal',
        x: x + Math.cos(a) * out,
        y: y + Math.sin(a) * out,
        z: z - 0.4,
        yaw: a,
        tilt: (h(50 + m) - 0.5) * 0.7,
        size: [radius, radius, height / 2],
        colour: glowing ? [0.8, 1.6, 2.0] : [0.45, 0.65, 0.85],
        roughness: 0.08,
        area,
      });
    }
    if (glowing)
      lights.push({
        x,
        y,
        z: z + 2,
        colour: [0.45, 0.85, 1.0],
        radius: 18,
        intensity: 9,
        beat: 'pulse',
        glow: 6,
        phase: h(3) * 6,
        area,
        biome: 'ice',
      });
  } else if (d > 0.1 && d < 1.1 && r < 0.22 * w) {
    const size = Math.min(0.7 + h(1) * 0.8, d + 0.9);
    props.push({
      kind: 'snow',
      x,
      y,
      z: -0.1,
      yaw: h(2) * Math.PI * 2,
      tilt: 0,
      size: [size, size * (0.6 + h(3) * 0.4), 0.3 + h(4) * 0.2],
      colour: [0.6, 0.66, 0.74],
      roughness: 0.85,
      area,
    });
  } else if (d > 3 && r < 0.05 * w) {
    const radius = 0.3 + h(1) * 0.4;
    props.push({
      kind: 'icicle',
      x,
      y,
      z: z - 0.3,
      yaw: 0,
      tilt: (h(2) - 0.5) * 0.3,
      size: [radius, radius, 2 + h(3) * 3],
      colour: [0.5, 0.65, 0.82],
      roughness: 0.15,
      area,
    });
  }
}

/** Jungle: ferns at the foot of the rock, grass at the foot of that, vines down its faces, trees on its tops, and glowing mushrooms. */
function jungle(p: Place, r: number, props: Prop[], lights: FeatureLight[], s: Samples) {
  const { x, y, z, d, area, w, h, i, j } = p;
  const green = (t: number): Rgb => [lerp(0.06, 0.2, t), lerp(0.25, 0.5, t), lerp(0.04, 0.08, t)];
  if (d >= 0.8 && d < 1.8 && r < 0.04 * w) {
    const n = 3 + Math.floor(h(1) * 3);
    for (let m = 0; m < n; m++) {
      const a = h(10 + m) * Math.PI * 2,
        out = h(20 + m) * 0.6;
      const mx = x + Math.cos(a) * out,
        my = y + Math.sin(a) * out;
      const height = 0.5 + h(30 + m) * 0.8,
        cap = 0.3 + h(40 + m) * 0.35,
        stem = cap * 0.28;
      props.push({
        kind: 'stem',
        x: mx,
        y: my,
        z: z - 0.1,
        yaw: 0,
        tilt: 0,
        size: [stem, stem, height],
        colour: [0.8, 0.8, 0.7],
        roughness: 0.7,
        area,
      });
      props.push({
        kind: 'cap',
        x: mx,
        y: my,
        z: z - 0.1 + height,
        yaw: a,
        tilt: 0,
        size: [cap, cap, cap],
        colour: [0.35, 1.3, 0.75],
        roughness: 0.4,
        area,
      });
    }
    lights.push({
      x,
      y,
      z: z + 1.5,
      colour: [0.4, 1.0, 0.6],
      radius: 12,
      intensity: 4,
      beat: 'pulse',
      glow: 3.5,
      phase: h(2) * 6,
      area,
      biome: 'jungle',
    });
  } else if (d >= 0.9 && d < 2.4 && r < 0.35 * w) {
    const size = Math.min(0.9 + h(1), d);
    props.push({
      kind: 'fern',
      x,
      y,
      z: z - 0.05,
      yaw: h(2) * Math.PI * 2,
      tilt: 0,
      size: [size, size, size * (0.8 + h(3) * 0.4)],
      colour: green(h(4)),
      roughness: 0.8,
      area,
    });
  } else if (d === 0 && r < 0.6 * w && [-1, 1, -s.gx, s.gx].some((o) => s.depth[j * s.gx + i + o] > 0)) {
    const size = 0.8 + h(1) * 0.8;
    props.push({
      kind: 'tuft',
      x,
      y,
      z: -0.05,
      yaw: h(2) * Math.PI * 2,
      tilt: 0,
      size: [size, size, size],
      colour: green(0.5 + h(3) * 0.5),
      roughness: 0.9,
      area,
    });
  } else if (d >= 0.5 && d < 1.3 && r < 0.12 * w) {
    const top = highest(s, i, j, 3) - 0.3;
    if (top > 1)
      props.push({
        kind: 'vine',
        x,
        y,
        z: 0,
        yaw: p.along,
        tilt: 0,
        size: [0.15, 0.15, top],
        colour: [0.04, 0.16, 0.035],
        roughness: 0.9,
        area,
      });
  } else if (d > 3.5 && r < 0.02 * w) {
    const height = 2.5 + h(1) * 2,
      radius = 0.35 + h(2) * 0.15;
    props.push({
      kind: 'trunk',
      x,
      y,
      z: z - 0.3,
      yaw: 0,
      tilt: (h(3) - 0.5) * 0.2,
      size: [radius, radius, height],
      colour: [0.18, 0.11, 0.06],
      roughness: 0.9,
      area,
    });
    for (let m = 0; m < 3; m++) {
      const a = (m / 3) * Math.PI * 2 + h(4),
        size = 1.2 + h(10 + m) * 0.8;
      props.push({
        kind: 'canopy',
        x: x + Math.cos(a) * 0.7,
        y: y + Math.sin(a) * 0.7,
        z: z - 0.3 + height + h(20 + m) * 0.5,
        yaw: a,
        tilt: 0,
        size: [size, size, size * 0.7],
        colour: green(h(30 + m) * 0.6),
        roughness: 0.85,
        area,
      });
    }
  }
}

/** Lava: pools of it on the tops, glowing and lighting the rock round them; lava seeping at the foot of the rock; basalt columns and obsidian. */
function lava(p: Place, r: number, props: Prop[], lights: FeatureLight[], s: Samples) {
  const { x, y, z, d, area, w, h, i, j } = p;
  if (d > 3 && r < 0.012 * w) {
    const radius = 1.2 + h(1) * 1.2;
    const surface = highest(s, i, j, 1) - 0.15;
    props.push({
      kind: 'pool',
      x,
      y,
      z: surface,
      yaw: 0,
      tilt: 0,
      size: [radius, radius, 0.1],
      colour: [4, 0.7, 0.05],
      roughness: 1,
      area,
    });
    lights.push({
      x,
      y,
      z: surface + 1.8,
      colour: [1.0, 0.45, 0.12],
      radius: 20,
      intensity: 8,
      beat: 'flicker',
      glow: 5,
      phase: h(2) * 6,
      area,
      biome: 'lava',
    });
  } else if (d > 0.5 && d < 1.5 && r < 0.3 * w) {
    // lava seeping out along the foot of the rock, flat on the floor: from the sample a tile's
    // fraction into the rock, down the slope to where it meets the floor
    props.push({
      kind: 'seep',
      x: x - p.nx * (d - 0.1),
      y: y - p.ny * (d - 0.1),
      z: 0.02,
      yaw: p.along,
      tilt: 0,
      size: [0.8 + h(1) * 0.8, 0.12 + h(2) * 0.1, 0.03],
      colour: [2.6, 0.6, 0.08],
      roughness: 1,
      area,
    });
  } else if (d >= 1.5 && d < 3 && r < 0.12 * w) {
    const n = 1 + Math.floor(h(1) * 3);
    for (let m = 0; m < n; m++) {
      const a = h(10 + m) * Math.PI * 2,
        out = m ? 0.6 : 0;
      const radius = Math.min(0.35 + h(20 + m) * 0.4, Math.max(0.2, d - 0.2));
      props.push({
        kind: 'column',
        x: x + Math.cos(a) * out,
        y: y + Math.sin(a) * out,
        z: z - 0.5,
        yaw: h(30 + m),
        tilt: 0,
        size: [radius, radius, 1.5 + h(40 + m) * 3],
        colour: [0.035, 0.032, 0.034],
        roughness: 0.75,
        area,
      });
    }
  } else if (d > 2 && r < 0.03 * w) {
    const radius = 0.3 + h(1) * 0.3;
    props.push({
      kind: 'shard',
      x,
      y,
      z: z - 0.4,
      yaw: h(2) * Math.PI * 2,
      tilt: (h(3) - 0.5) * 0.8,
      size: [radius, radius, 0.5 + h(4) * 0.75],
      colour: [0.02, 0.02, 0.025],
      roughness: 0.05,
      area,
    });
  }
}

/** The future: neon strips along the foot of the walls, in cyan and magenta; crates; pylons on the tops with beacons blinking. */
function future(p: Place, r: number, props: Prop[], lights: FeatureLight[]) {
  const { x, y, z, d, area, w, h } = p;
  const cyan = noise(x * 0.03, y * 0.03, 97) < 0.5;
  if (d > 0.5 && d < 1.5 && w > 0.35) {
    // a strip along the foot of the wall, halfway up the slope from the floor to here
    const sx = x - p.nx * d * 0.5,
      sy = y - p.ny * d * 0.5,
      sz = z * 0.45;
    props.push({
      kind: 'neon',
      x: sx,
      y: sy,
      z: sz,
      yaw: p.along,
      tilt: 0,
      size: [1.4, 0.18, 0.25],
      colour: cyan ? [0.4, 2.8, 3.4] : [3.2, 0.4, 2.6],
      roughness: 0.3,
      area,
    });
    if (r < 0.08 * w)
      lights.push({
        x: sx - p.nx,
        y: sy - p.ny,
        z: sz + 0.8,
        colour: cyan ? [0.2, 0.9, 1.0] : [1.0, 0.2, 0.8],
        radius: 12,
        intensity: 4,
        beat: 'steady',
        glow: 0,
        phase: 0,
        area,
        biome: 'future',
      });
  } else if (d > 3 && r < 0.005 * w) {
    const height = 3 + h(1) * 2;
    props.push({
      kind: 'pylon',
      x,
      y,
      z: z - 0.3,
      yaw: p.along,
      tilt: 0,
      size: [0.6, 0.6, height],
      colour: [0.14, 0.15, 0.17],
      roughness: 0.35,
      area,
    });
    lights.push({
      x,
      y,
      z: z - 0.3 + height + 0.3,
      colour: [1.0, 0.15, 0.1],
      radius: 8,
      intensity: 3,
      beat: 'blink',
      glow: 3,
      phase: h(2) * 6,
      area,
      biome: 'future',
    });
  } else if (d >= 1.8 && d < 2.6 && r < 0.12 * w) {
    const size = 0.9 + h(1) * 0.5;
    const colour: Rgb = h(2) < 0.6 ? [0.1, 0.12, 0.15] : [0.35, 0.18, 0.04];
    props.push({
      kind: 'crate',
      x,
      y,
      z: z - 0.1,
      yaw: p.along,
      tilt: 0,
      size: [size, size, size],
      colour,
      roughness: 0.6,
      area,
    });
    if (h(3) < 0.3)
      props.push({
        kind: 'crate',
        x,
        y,
        z: z - 0.1 + size,
        yaw: p.along + 0.4,
        tilt: 0,
        size: [size * 0.8, size * 0.8, size * 0.8],
        colour,
        roughness: 0.6,
        area,
      });
  }
}

// ---- what drifts in their air ----

/**
 * Something drifting in a biome's air at a point: snow falling, a firefly,
 * an ember, a mote of light. Null for the hollow.
 */
export function airParticle(area: number, x: number, y: number, random: () => number): Emit | null {
  switch (BIOMES[area]?.name) {
    case 'ice':
      return {
        position: [x, y, 9 + random() * 6],
        velocity: [0.4, 0.2, -1.3],
        spread: 0.5,
        count: 1,
        life: 7,
        size: 0.09,
        colour: [0.9, 0.95, 1],
        alpha: 0.9,
        gravity: 0,
        floor: 0,
      };
    case 'jungle':
      return {
        position: [x, y, 0.8 + random() * 3],
        velocity: [0, 0, 0.15],
        spread: 0.7,
        count: 1,
        life: 3,
        lifeSpread: 0.5,
        size: 0.1,
        growth: -0.02,
        colour: [1.4, 2.0, 0.4],
        alpha: 0,
        gravity: 0,
        floor: 0,
      };
    case 'lava':
      return {
        position: [x, y, 0.4 + random() * 3],
        velocity: [0, 0, 1.4],
        spread: 0.8,
        count: 1,
        life: 2.5,
        size: 0.07,
        growth: -0.02,
        colour: [3, 1, 0.2],
        alpha: 0,
        gravity: 0,
        floor: 0,
      };
    case 'future':
      return {
        position: [x, y, 0.5 + random() * 5],
        velocity: [0, 0, 0.6],
        spread: 0.2,
        count: 1,
        life: 2,
        size: 0.06,
        colour: [0.4, 1.6, 2.0],
        alpha: 0,
        gravity: 0,
        floor: -1,
      };
    case undefined:
      return null;
  }
}

/** Something off a feature now and then: embers up off a lava pool, a glint off a crystal, spores off a mushroom. */
export function featureParticle(l: FeatureLight): Emit | null {
  switch (l.biome) {
    case 'lava':
      return {
        position: [l.x, l.y, l.z - 1.6],
        velocity: [0, 0, 4],
        spread: 1.5,
        count: 3,
        life: 1.6,
        lifeSpread: 0.5,
        size: 0.1,
        growth: -0.05,
        colour: [3.5, 1.2, 0.2],
        alpha: 0,
        gravity: -0.05,
        floor: 0,
      };
    case 'ice':
      return {
        position: [l.x, l.y, l.z - 0.5],
        velocity: [0, 0, 0.5],
        spread: 1,
        count: 1,
        life: 1.2,
        size: 0.12,
        growth: -0.08,
        colour: [1.2, 2.2, 2.8],
        alpha: 0,
        gravity: 0,
        floor: 0,
      };
    case 'jungle':
      return {
        position: [l.x, l.y, l.z - 0.8],
        velocity: [0, 0, 0.4],
        spread: 0.6,
        count: 2,
        life: 2.5,
        size: 0.06,
        colour: [0.8, 2.0, 1.0],
        alpha: 0,
        gravity: 0,
        floor: 0,
      };
    case 'future':
      return null;
  }
}

/** How bright a feature's light is at time `t`, as a share of its full intensity. */
export function beat(l: FeatureLight, t: number): number {
  const p = l.phase;
  switch (l.beat) {
    case 'flicker':
      return 0.75 + 0.15 * Math.sin(t * 11 + p) + 0.1 * Math.sin(t * 23 + p * 2);
    case 'pulse':
      return 0.7 + 0.3 * Math.sin(t * 1.6 + p);
    case 'blink':
      return (t * 0.8 + p) % 1 < 0.15 ? 1 : 0.05;
    case 'steady':
      return 1;
  }
}
