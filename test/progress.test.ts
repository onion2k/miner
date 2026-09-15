import { describe, expect, it } from 'vitest';
import { AREAS, ORDER, buildCave, sealPoint, gateCentre, WINGS } from '../src/cave';
import { CLEAR_SHARE } from '../src/economy';
import { atNextGate, progressText, readyToOpen, the, type Rooms } from '../src/progress';

const rooms = (n: number, nextOpen: boolean, done = false): Rooms => ({
  current: () => ORDER[n],
  next: () => ORDER[n + 1] ?? null,
  nextOpen: () => nextOpen,
  save: { done },
});

describe('getting through the cave', () => {
  it('opens the next room at the share, not before, and not twice', () => {
    expect(readyToOpen(rooms(1, false), CLEAR_SHARE - 0.01)).toBe(false);
    expect(readyToOpen(rooms(1, false), CLEAR_SHARE)).toBe(true);
    expect(readyToOpen(rooms(1, true), 1)).toBe(false);
    expect(readyToOpen(rooms(ORDER.length - 1, false, true), 1)).toBe(false);
  });

  it('says how far through the room the player is, and what comes next', () => {
    expect(progressText(rooms(0, false), 0.456)).toBe(`${AREAS[ORDER[0]].name}: 45% banked · 90% opens the next`);
    expect(progressText(rooms(1, true), 0.95)).toContain(`on to ${the(ORDER[2])}`);
    expect(progressText(rooms(ORDER.length - 1, false), 0.2)).toContain('clears the cave');
    expect(progressText(rooms(ORDER.length - 1, false, true), 1)).toBe('the cave is cleared');
    expect(the(0)).toBe('the Hollow');
  });

  it('knows the player is at the next gate, and then through it', () => {
    const cave = buildCave();
    const next = ORDER[1];
    const [dx, dy] = WINGS[next].dir;
    const [sx, sy] = sealPoint(cave, next);
    const [gx, gy] = gateCentre(cave, next);
    expect(atNextGate(rooms(0, false), sx + dx * 4, sy + dy * 4)).toBeNull();
    expect(atNextGate(rooms(0, true), 0, 0)).toBeNull();
    expect(atNextGate(rooms(0, true), gx, gy)).toBe('at');
    expect(atNextGate(rooms(0, true), sx + dx * 4, sy + dy * 4)).toBe('through');
  });
});
