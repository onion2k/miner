import { describe, expect, it } from 'vitest';
import { aimFor, shownArrow, type Aim } from '../src/aim';
import type { PointerPlacement } from '../src/hud';
import { exitPoints, nearestHole } from '../src/cave';
import { RUN, caveOf } from './helpers';

describe('where the gold arrow points', () => {
  it('at the way out once it is open, wherever the machine is, in every cave that has one', () => {
    for (const spec of RUN.filter((c) => c.exit)) {
      const cave = caveOf(spec.id);
      const mouth = exitPoints(cave)!.mouth;
      for (const from of [
        { x: 0, y: 0 },
        { x: mouth.x, y: mouth.y },
        { x: -60, y: 30 },
      ]) {
        const aim = aimFor(cave, true, from)!;
        expect(aim, `${spec.id} from ${from.x},${from.y}`).toMatchObject({ x: mouth.x, y: mouth.y, always: true });
        expect(aim.label).toBe('the way out');
      }
    }
  });

  it('at nothing once the machine is down the way out itself, where the mouth is behind it and the way on is straight', () => {
    for (const spec of RUN.filter((c) => c.exit)) {
      const cave = caveOf(spec.id);
      const { mouth, beyond } = exitPoints(cave)!;
      const halfway = { x: (mouth.x + beyond.x) / 2, y: (mouth.y + beyond.y) / 2 };
      expect(aimFor(cave, true, halfway), `${spec.id} halfway down`).toBeNull();
      expect(aimFor(cave, true, beyond), `${spec.id} at the far end`).toBeNull();
      // a little short of the mouth, on the cave's side, it is still the way to go
      const [ox, oy] = spec.exit!.out;
      const short = { x: mouth.x - ox * 6, y: mouth.y - oy * 6 };
      expect(aimFor(cave, true, short), `${spec.id} short of the mouth`).not.toBeNull();
    }
  });

  it('at the nearest hole while the way out is shut, and only while that is off the screen', () => {
    for (const spec of RUN) {
      const cave = caveOf(spec.id);
      const from = { x: 37, y: -21 };
      const hole = nearestHole(cave.holes, from.x, from.y);
      const aim = aimFor(cave, false, from)!;
      expect(aim, spec.id).toMatchObject({ x: hole.x, y: hole.y, always: false });
      expect(aim.label).toBe('the hole');
    }
  });

  it('at the hole in the last cave, which has no way out to point at', () => {
    const last = caveOf(RUN[RUN.length - 1].id);
    expect(last.spec.exit).toBeNull();
    const aim = aimFor(last, true, { x: 10, y: 10 })!;
    expect(aim.label).toBe('the hole');
    expect(aim.always).toBe(false);
  });

  it('at nothing once the game is done: the vein is running and nothing is left to go to', () => {
    expect(aimFor(caveOf('hollow'), false, { x: 0, y: 0 }, true)).toBeNull();
  });
});

describe('whether the arrow is shown', () => {
  const over: PointerPlacement = { over: true, x: 100, y: 100 };
  const edge: PointerPlacement = { over: false, x: 10, y: 300, ux: -1, uy: 0 };
  const hole: Aim = { x: 0, y: 0, label: 'the hole', always: false };
  const way: Aim = { x: 50, y: 0, label: 'the way out', always: true };

  it('never points at a hole that is in view, but does at one out of it', () => {
    expect(shownArrow(hole, over)).toBeNull();
    expect(shownArrow(hole, edge)).toBe(edge);
  });

  it('points at the way out whether it is in view or not', () => {
    expect(shownArrow(way, over)).toBe(over);
    expect(shownArrow(way, edge)).toBe(edge);
  });

  it('shows nothing where there is nothing to point at, or no saying which way', () => {
    expect(shownArrow(null, edge)).toBeNull();
    expect(shownArrow(way, null)).toBeNull();
  });
});
