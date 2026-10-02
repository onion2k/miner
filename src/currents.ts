/**
 * Currents: strips of the floor that are always running, and what the page and
 * the cave need to know of one without asking the physics. A current is a belt
 * that nobody bought and nothing switches off, so the physics carries what lies
 * on it with its belt; what is here is where a current's belt is, where its
 * drain is, and how far a point is from it, for the cave that is carved
 * round it, the nav that keeps the drones off it and the tests that hold every
 * route clear of what stands in the way.
 *
 * Without this one place for it, the cave, the game and the scene would each
 * work out where a drain stands, and a drain that is a hand's breadth out in
 * one of them is a coin that falls down it unseen.
 *
 * It imports types only, so the cave can build on it and the tools can build on
 * the cave.
 */
import type { CurrentSpec, Flow, HoleSpec } from './cave';
import type { Belt } from './physics';

/** How far short of the drain's rim a current ends: near enough that the floor's slope into the pit takes what it carries, as a belt's end is. */
export const DRAIN_GAP = 2;
/** How far short of a hole's rim a current to a hole ends, on the same count. */
export const HOLE_GAP = 2;

/** The current's belt for the physics: the same strip a belt is, always running. */
export function currentBelt(c: CurrentSpec): Belt {
  const dx = c.x1 - c.x0,
    dy = c.y1 - c.y0;
  const len = Math.hypot(dx, dy) || 1;
  return {
    cx: (c.x0 + c.x1) / 2,
    cy: (c.y0 + c.y1) / 2,
    half: len / 2,
    width: c.width,
    dx: dx / len,
    dy: dy / len,
    speed: c.speed,
  };
}

/** The unit step along a current, from its head to its end. */
export function flowOf(c: CurrentSpec): [number, number] {
  const len = Math.hypot(c.x1 - c.x0, c.y1 - c.y0) || 1;
  return [(c.x1 - c.x0) / len, (c.y1 - c.y0) / len];
}

/** The drain a current ends in, centred a rim's gap past its end; null for a current that runs to a hole. */
export function drainOf(c: CurrentSpec): HoleSpec | null {
  if (!c.drain) return null;
  const [dx, dy] = flowOf(c);
  const past = c.drain.radius + DRAIN_GAP;
  // on a whole unit each way, where the cave's spec aimed it: the lattice the floor is drawn on, so that the
  // collar meets the floor in a straight edge
  return {
    x: Math.round(c.x1 + dx * past),
    y: Math.round(c.y1 + dy * past),
    radius: c.drain.radius,
    depth: c.drain.depth,
  };
}

/** What flows into the drain nearest a point: for the colour of a splash where something went down. Water if the cave has none. */
export function drainFlow(currents: readonly CurrentSpec[], x: number, y: number): Flow {
  let flow: Flow = 'water',
    best = Infinity;
  for (const c of currents) {
    const d = drainOf(c);
    if (!d) continue;
    const away = Math.hypot(d.x - x, d.y - y);
    if (away < best) {
      best = away;
      flow = c.flow;
    }
  }
  return flow;
}

/**
 * What a body on a current settles to, as a share of the current's speed: the belt draws it on and the floor
 * drags at it, and this is where the two meet. The picture of a current moves at this pace and not the belt's
 * own, or the water would outrun the coins it carries; a test rides a coin down every current to hold it true.
 */
export const RIDE = 0.72;

type Rgb = [number, number, number];

/**
 * How each flow is drawn: the kind of surface it is, its two colours, how rough it is, how big its pattern is
 * for a unit of the strip, and how much light it gives out of itself. Chosen from a mock of two looks each
 * (`docs/plans/currents-mock.html`): water that ripples and glints, with foam along its banks; lava as dark
 * plates on glowing cracks; ice as a frosted slide with snow drifting down it. The cave is dark, so water and
 * ice are what the headlights and lamps make of them, and only lava is seen by its own light.
 */
export const FLOW_LOOK = {
  water: {
    kind: 'ripple',
    albedo: [0.02, 0.12, 0.2] as Rgb,
    second: [0.1, 0.42, 0.55] as Rgb,
    roughness: 0.08,
    scale: 1,
    glow: 0,
    /** The foam along each bank: its colour, how wide it lies, and how fine its pattern is beside the stream's. */
    foam: [0.75, 0.9, 0.95] as Rgb,
    foamWidth: 0.8,
    foamScale: 2.2,
  },
  lava: {
    kind: 'crust',
    albedo: [0.05, 0.03, 0.028] as Rgb,
    second: [1, 0.24, 0.03] as Rgb,
    roughness: 0.85,
    scale: 1,
    glow: 4,
  },
  ice: {
    kind: 'drift',
    // bluer and darker than the vault's own pale floor, or a slide laid on ice is lost in it
    albedo: [0.16, 0.36, 0.6] as Rgb,
    second: [0.92, 0.96, 1] as Rgb,
    roughness: 0.22,
    scale: 1,
    glow: 0,
  },
} as const;

/** The lights along a flow of lava, which lights what lies beside it: how far apart, how high, and what each gives. */
export const LAVA_LIGHT = {
  every: 6,
  z: 1.8,
  colour: [1, 0.36, 0.06] as Rgb,
  radius: 13,
  intensity: 5,
} as const;

/** Where the lights along a current stand: over its middle line, evenly, and none for a flow that gives no light. */
export function flowLights(c: CurrentSpec): [number, number][] {
  if (c.flow !== 'lava') return [];
  const length = Math.hypot(c.x1 - c.x0, c.y1 - c.y0);
  const n = Math.max(2, Math.round(length / LAVA_LIGHT.every));
  const [ux, uy] = flowOf(c);
  return Array.from({ length: n }, (_, k) => {
    const along = ((k + 0.5) / n) * length;
    return [c.x0 + ux * along, c.y0 + uy * along];
  });
}

/** The same colours for the map, as CSS: what a current is drawn in, which is what it looks like. */
export const FLOW_MAP = {
  water: 'rgba(70, 150, 235, 0.95)',
  lava: 'rgba(245, 100, 30, 0.95)',
  ice: 'rgba(190, 235, 255, 0.95)',
} as const;
