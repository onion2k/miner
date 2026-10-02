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
 * What the strip is made of, by flow, as the page draws it plainly until the renderer can animate it: a
 * colour for the bed, and how rough it is. The cave is dark and the renderer has no light of its own for a
 * surface, so these are what the headlights and the lamps pick out.
 */
export const FLOW_LOOK = {
  water: { albedo: [0.1, 0.32, 0.6] as [number, number, number], roughness: 0.15 },
  lava: { albedo: [0.95, 0.32, 0.06] as [number, number, number], roughness: 0.6 },
  ice: { albedo: [0.62, 0.84, 0.96] as [number, number, number], roughness: 0.1 },
} as const;

/** The same colours for the map, as CSS: what a current is drawn in, which is what it looks like. */
export const FLOW_MAP = {
  water: 'rgba(70, 150, 235, 0.95)',
  lava: 'rgba(245, 100, 30, 0.95)',
  ice: 'rgba(190, 235, 255, 0.95)',
} as const;
