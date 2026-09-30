/**
 * What the gold arrow points at. The way out, once it is open, is always
 * pointed at, since it is where to go. Otherwise it is the nearest hole, but
 * only while that is off the screen: with the hole in view there is nothing
 * to say. Which of the two, and where, is the game's to say; the page only
 * turns it into an arrow at the edge of the screen or a marker over the place.
 */
import { downWayOut, exitPoints, nearestHole, type Cave } from './cave';
import type { PointerPlacement } from './hud';

/** A place to point at, and what to call it. */
export interface Aim {
  x: number;
  y: number;
  label: string;
  /** Pointed at even when it is in view; otherwise only while it is off the screen. */
  always: boolean;
}

/**
 * The way out once it is open, else the hole nearest `from`; none once the game is done, nor while the
 * machine is down the way out, where the mouth it would point at is behind it.
 */
export function aimFor(cave: Cave, open: boolean, from: { x: number; y: number }, done = false): Aim | null {
  if (done || (open && downWayOut(cave, from.x, from.y))) return null;
  const out = open ? exitPoints(cave) : null;
  if (out) return { ...out.mouth, label: 'the way out', always: true };
  const hole = nearestHole(cave.holes, from.x, from.y);
  return { x: hole.x, y: hole.y, label: 'the hole', always: false };
}

/**
 * Where the arrow is drawn, if it is: the way out always, a hole only while it is off the screen. `placement` is
 * where the target falls on the screen, null when there is no saying which way it lies.
 */
export function shownArrow(aim: Aim | null, placement: PointerPlacement | null): PointerPlacement | null {
  if (!aim || !placement) return null;
  return aim.always || !placement.over ? placement : null;
}
