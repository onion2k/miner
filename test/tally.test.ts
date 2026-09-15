import { describe, expect, it } from 'vitest';
import { KIND_VALUE } from '../src/physics';
import { Tally } from '../src/tally';

describe('the tally of a run', () => {
  it('adds up a run, gets hotter the faster things arrive, and ends after a pause', () => {
    const tally = new Tally();
    let heat = 0;
    for (let k = 0; k < 10; k++) heat = tally.add(0);
    heat = tally.add(1);
    expect(tally.summary()).toEqual({
      value: 10 + KIND_VALUE[1],
      count: 11,
      parts: ['10 coins', '1 ruby'],
      over: false,
    });
    expect(heat).toBeGreaterThan(0.3);
    expect(tally.holePulse).toBeGreaterThan(1);
    expect(tally.tick(1)).toBe(false);
    expect(tally.tick(0.5)).toBe(true);
    expect(tally.summary().over).toBe(true);
    tally.reset();
    expect(tally.summary()).toMatchObject({ value: 0, count: 0, parts: [] });
    // and a run over does not end again
    expect(tally.tick(1)).toBe(false);
  });

  it('lets the glow and the heat die away', () => {
    const tally = new Tally();
    for (let k = 0; k < 20; k++) tally.add(0);
    for (let f = 0; f < 120; f++) tally.fade(1 / 60);
    expect(tally.holePulse).toBe(0);
    expect(tally.heat).toBeLessThan(0.01);
  });
});
