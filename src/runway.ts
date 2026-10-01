/**
 * The runway lights down each cave's cuttings: a row of small amber lights along both edges of the way in, and
 * of the way out once it is open, with a brighter pulse running along them like an airport's approach lights.
 * Worked out apart from the page, so where they stand and which way the pulse runs are tested and not guessed
 * at from a picture. Without them a game that starts at the dark outer end of the way in is a black screen with
 * two headlights in it, and looks as if it had broken; with them the way on is plain.
 *
 * The pulse runs toward the cave's floor down the way in, so it leads the machine in, and away from the floor
 * down the way out, so it leads the machine on to the next cave.
 */
import { TILE, tileCentre, type Cave, type Cutting } from './cave';

/** Which of a cave's cuttings a light is in. */
export type RunwaySide = 'in' | 'out';

export interface RunwayLight {
  x: number;
  y: number;
  /** How high it stands: low, on the floor, so it lights the cutting's floor and not the rock's face. */
  z: number;
  cutting: RunwaySide;
  /** Its place along the cutting: 0 at the cave's floor, 1 at the outer end. */
  along: number;
}

/** The tiles between one light and the next, down a row. */
export const RUNWAY_SPACING = 2;
/** How far a light stands in from the rock, in world units: close enough to mark the edge, clear of the rock's foot. */
export const RUNWAY_INSET = 0.8;
/** How high a light stands. */
export const RUNWAY_HEIGHT = 0.35;
/** How long the pulse takes to run the length of the row, and so how often one starts, in seconds. */
export const RUNWAY_PERIOD = 1.2;
/** How bright a light is between pulses, as a share of its full brightness. */
export const RUNWAY_STEADY = 0.55;
/** How wide the pulse is, as a share of the row's length. */
const PULSE_WIDTH = 0.09;

/** The lights of one cutting: a light every two tiles down each of its two edges. */
function row(cave: Cave, c: Cutting, cutting: RunwaySide): RunwayLight[] {
  const [x0, y0, x1, y1] = c.tiles;
  const [ox, oy] = c.out;
  const length = ox ? x1 - x0 + 1 : y1 - y0 + 1;
  const out: RunwayLight[] = [];
  for (let a = 0; a < length; a += RUNWAY_SPACING) {
    for (const side of [-1, 1]) {
      // `a` tiles in from the cutting's inner end, on the tile at one edge or the other
      const tx = ox ? (ox > 0 ? x0 + a : x1 - a) : side < 0 ? x0 : x1,
        ty = oy ? (oy > 0 ? y0 + a : y1 - a) : side < 0 ? y0 : y1;
      const [cx, cy] = tileCentre(cave.grid, tx, ty);
      // the middle of an edge tile is two units from the rock, so the light goes on toward it by what is left
      const nudge = TILE / 2 - RUNWAY_INSET;
      out.push({
        x: cx + (ox ? 0 : side * nudge),
        y: cy + (ox ? side * nudge : 0),
        z: RUNWAY_HEIGHT,
        cutting,
        along: a / length,
      });
    }
  }
  return out;
}

/** Every runway light of a cave: the way in's always, and the way out's once it is open. */
export function runwayLights(cave: Cave, open: boolean): RunwayLight[] {
  const { entry, exit } = cave.spec;
  return [...row(cave, entry, 'in'), ...(open && exit ? row(cave, exit, 'out') : [])];
}

/**
 * How bright a runway light is at time `t`, as a share of its full brightness: a steady glow with a pulse
 * passing along the row, toward the cave's floor down the way in and away from it down the way out.
 */
export function runwayBeat(light: Pick<RunwayLight, 'cutting' | 'along'>, t: number): number {
  // 0 at the moment the pulse is at this light: the way in's counts down the row's length, the way out's up it
  const q = (((t / RUNWAY_PERIOD + (light.cutting === 'in' ? light.along : -light.along)) % 1) + 1) % 1;
  const near = Math.min(q, 1 - q) / PULSE_WIDTH;
  return RUNWAY_STEADY + (1 - RUNWAY_STEADY) * Math.exp(-near * near);
}
