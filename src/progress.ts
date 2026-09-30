/**
 * Getting through the cave: when the room being cleared has given up enough
 * for the next to open, what going on into the next does, and what the
 * player is told of it.
 */
import { atGate, pastGate, type CaveSpec } from './cave';
import { CLEAR_SHARE } from './economy';

/** The parts of the economy that say where the player has got to. */
export interface Rooms {
  current(): number;
  next(): number | null;
  nextOpen(): boolean;
  readonly save: { readonly done: boolean };
}

/** "the South Gallery", "the Hollow". */
export function the(spec: CaveSpec, area: number): string {
  return `the ${spec.areas[area].name.replace(/^The /, '')}`;
}

/** Whether enough of the room being cleared is banked (`banked`, 0 to 1) for the next to open, if it has not. */
export function readyToOpen(rooms: Rooms, banked: number): boolean {
  return !rooms.save.done && !rooms.nextOpen() && banked >= CLEAR_SHARE;
}

/** How far through the room being cleared the player is, for the counters. */
export function progressText(spec: CaveSpec, rooms: Rooms, banked: number): string {
  if (rooms.save.done) return 'the cave is cleared';
  const next = rooms.next();
  return (
    `${spec.areas[rooms.current()].name}: ${Math.floor(banked * 100)}% banked` +
    (rooms.nextOpen()
      ? ` · on to ${the(spec, next!)}`
      : ` · ${Math.round(CLEAR_SHARE * 100)}% ${next === null ? 'clears the cave' : 'opens the next'}`)
  );
}

/**
 * Where the player stands against the next room's gate, once it is open:
 * through it and on among the next room's heaps, which seals the one behind;
 * up to it and in its corridor, which is the time to say so; or neither.
 */
export function atNextGate(spec: CaveSpec, rooms: Rooms, x: number, y: number): 'through' | 'at' | null {
  if (!rooms.nextOpen()) return null;
  const next = rooms.next()!;
  if (pastGate(spec, next, x, y)) return 'through';
  if (atGate(spec, next, x, y)) return 'at';
  return null;
}
