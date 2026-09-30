import { describe, expect, it } from 'vitest';
import { KINDS, KIND_NAME, KIND_VALUE } from '../src/physics';
import { kindColour } from '../src/palette';
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
    expect(tally.holePulse[0]).toBeGreaterThan(1);
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
    expect(tally.holePulse).toEqual([0]);
    expect(tally.heat).toBeLessThan(0.01);
  });

  it('flares the hole a thing went down and no other, and lets each die away', () => {
    const tally = new Tally(2);
    tally.add(1, 1);
    expect(tally.holePulse[0]).toBe(0);
    expect(tally.holePulse[1]).toBeGreaterThan(0.5);
    for (let f = 0; f < 120; f++) tally.fade(1 / 60);
    expect(tally.holePulse).toEqual([0, 0]);
  });
});

describe('the colour of each kind of thing', () => {
  it('is there for every kind, so nothing going down the hole is without one', () => {
    for (let k = 0; k < KINDS; k++) {
      const c = kindColour(k);
      expect(c, KIND_NAME[k]).toHaveLength(3);
      for (const v of c) expect(Number.isFinite(v), KIND_NAME[k]).toBe(true);
    }
  });
});
