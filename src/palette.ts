/**
 * The colours things are drawn in, kept in one place so the static scene,
 * the moving one and the particles agree: a gem set in a wall is the colour
 * of the same gem loose, and a wall's dust is its bricks' colour.
 *
 * Colours are linear RGB; where a fourth number follows, it is roughness.
 */
import { BAR, BARREL_KIND, BRICK_KIND } from './physics';

export type Rgb = [number, number, number];

export const COIN_COLOUR: Rgb = [1.0, 0.56, 0.08];
/** The colour of each kind of gem, for one set in a wall as for one loose. */
export const GEM_ALBEDO: Rgb[] = [
  [0, 0, 0],
  [1.0, 0.06, 0.12],
  [0.08, 0.95, 0.35],
  [0.12, 0.35, 1.0],
  [0.9, 0.97, 1.0],
];
export const BAR_COLOUR: Rgb = [1.0, 0.72, 0.18];
/** A barrel's body, standing; it flashes other colours when its fuse is lit. */
export const BARREL_COLOUR: Rgb = [0.55, 0.08, 0.05];
/** The colour of each grade of wall, clay, stone and iron-bound, and how rough. */
export const WALL_COLOUR: [number, number, number, number][] = [
  [0, 0, 0, 0],
  [0.58, 0.24, 0.16, 0.85],
  [0.46, 0.45, 0.47, 0.8],
  [0.2, 0.22, 0.27, 0.45],
];
/** The floor's shades, and the rock's: steep and dark, steep, and the tops; roughness last. */
export const FLOOR_TONES = [
  [0.27, 0.19, 0.12, 0.95],
  [0.3, 0.212, 0.134, 0.95],
  [0.325, 0.232, 0.148, 0.93],
  // the foot of the rock: the floor a shade darker and greyer where the scree lies
  [0.215, 0.158, 0.105, 0.96],
];
export const ROCK_TONES = [
  [0.045, 0.047, 0.06, 0.9],
  [0.08, 0.082, 0.1, 0.88],
  [0.12, 0.1, 0.082, 0.92],
];
/** The colour of the floor where a track has pressed it down. */
export const TRACK_MARK: Rgb = [0.185, 0.13, 0.08];
/** How much of its own colour something in a room not open shows: next to none, so no light spilling through the rock shows there. */
export const UNSEEN = 0.02;

/** The colour a kind of thing is, loose: a coin, a gem, a gold bar, a clay brick, a barrel. Every kind has one. */
export function kindColour(kind: number): Rgb {
  if (kind === 0) return COIN_COLOUR;
  if (kind === BAR) return BAR_COLOUR;
  if (kind === BRICK_KIND) return WALL_COLOUR[1].slice(0, 3) as Rgb;
  if (kind === BARREL_KIND) return BARREL_COLOUR;
  return GEM_ALBEDO[kind] ?? COIN_COLOUR;
}
