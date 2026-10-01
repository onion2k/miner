/**
 * The blink between caves: the cutting stays lit until the last three tiles before the leaving line, "Keep
 * going" shows as it goes dark, the screen comes up from black after the swap, and the camera is turned by
 * as much as the heading turns. Without these the screen goes dark all the way down the cutting, the player
 * stops in the dark, and at four of the six changes the machine turns ninety degrees on the screen.
 */
import { describe, expect, it } from 'vitest';
import { ARRIVAL_DARK, TILE, arrival, darkness, headingTurn, tileCentre, type Cave } from '../src/cave';
import { Game } from '../src/game';
import { IDS, caveOf, gameIn, newEconomy, saveIn, specOf, withSeed } from './helpers';

const DT = 1 / 60;
const still = { throttle: 0, steer: 0 };

/** The cutting's outer tile centre and the way out, for a cave with a way out. */
function outer(cave: Cave) {
  const exit = cave.spec.exit!;
  const [x0, y0, x1, y1] = exit.tiles;
  const [ox, oy] = exit.out;
  const [x, y] = tileCentre(
    cave.grid,
    ox < 0 ? x0 : ox > 0 ? x1 : (x0 + x1) / 2,
    oy < 0 ? y0 : oy > 0 ? y1 : (y0 + y1) / 2,
  );
  return { x, y, ox, oy };
}

/** A point down the middle of the way out, `before` units short of the leaving line (negative: past it). */
function beforeLine(cave: Cave, before: number): [number, number] {
  const { x, y, ox, oy } = outer(cave);
  // the line is three tiles short of the outer edge, which is a tile centre and a half-tile on
  const back = 3 * TILE - TILE / 2 + before;
  return [x - ox * back, y - oy * back];
}

const withExit = IDS.filter((id) => specOf(id).exit);

describe.each(withExit)('the cutting out of %s (criterion 1)', (id) => {
  const cave = caveOf(id);

  it('is lit until three tiles short of the leaving line, then rises to black at it', () => {
    const ramp = 3 * TILE;
    expect(darkness(cave, true, ...beforeLine(cave, ramp + 20))).toBe(0);
    expect(darkness(cave, true, ...beforeLine(cave, ramp + 0.01))).toBe(0);
    expect(darkness(cave, true, ...beforeLine(cave, ramp * 0.5))).toBeCloseTo(0.5, 5);
    expect(darkness(cave, true, ...beforeLine(cave, ramp * 0.25))).toBeCloseTo(0.75, 5);
    expect(darkness(cave, true, ...beforeLine(cave, 0))).toBeCloseTo(1, 5);
    expect(darkness(cave, true, ...beforeLine(cave, -3))).toBe(1);
  });

  it('is no darker down it while the way out is shut, and the way in is as it was', () => {
    expect(darkness(cave, false, ...beforeLine(cave, 0))).toBe(0);
    const at = arrival(cave);
    expect(darkness(cave, true, at.x, at.y)).toBeGreaterThan(ARRIVAL_DARK * 0.7);
    expect(darkness(cave, true, at.x, at.y)).toBeLessThanOrEqual(ARRIVAL_DARK);
  });
});

describe('the camera at each change of cave (criterion 5)', () => {
  const at = (id: string, entry = false) => {
    const { spec } = caveOf(id);
    const [x, y] = entry ? spec.entry.out : spec.exit!.out;
    return Math.atan2(y, x);
  };

  it('turns by the new heading in minus the old heading out, at all six changes', () => {
    const quarter = Math.PI / 2;
    const expected: [string, string, number][] = [
      ['hollow', 'south-gallery', 0],
      ['south-gallery', 'east-gallery', -quarter],
      ['east-gallery', 'north-vault', -quarter],
      ['north-vault', 'warrens', 0],
      ['warrens', 'west-gallery', quarter],
      ['west-gallery', 'deep', -quarter],
    ];
    expect(expected.map(([from]) => from)).toEqual(withExit);
    for (const [from, to, turn] of expected) {
      expect(headingTurn(caveOf(from), caveOf(to)), `${from} to ${to}`).toBeCloseTo(turn, 9);
    }
  });

  it('gives the heading the machine has on the screen back again, whichever way it came out', () => {
    for (let n = 0; n + 1 < IDS.length; n++) {
      const from = IDS[n],
        to = IDS[n + 1];
      const turn = headingTurn(caveOf(from), caveOf(to));
      const out = at(from);
      const facing = arrival(caveOf(to)).yaw;
      // the new heading is the old one turned by the turn, so the camera turned by it sees no change
      const gap = Math.atan2(Math.sin(out + turn - facing), Math.cos(out + turn - facing));
      expect(gap, `${from} to ${to}`).toBeCloseTo(0, 9);
      expect(Math.abs(turn), 'by the shorter way').toBeLessThanOrEqual(Math.PI);
    }
  });

  it('is nothing from a cave with no way out', () => {
    expect(headingTurn(caveOf('deep'), caveOf('deep'))).toBe(0);
  });
});

describe('the rise from black after the swap (criterion 3)', () => {
  /** A game made by driving in from the cave before, which is how the page makes one. */
  const arrived = (id: string) => new Game(newEconomy(saveIn(id)), caveOf(id), {}, { speed: 5 });

  it('is black at the first instant and the arrival darkness from 0.4 s on, falling in between', () => {
    withSeed(1, () => {
      const game = arrived('south-gallery');
      const floor = darkness(game.cave, false, game.dozer.x, game.dozer.y);
      expect(floor).toBeGreaterThan(ARRIVAL_DARK * 0.7);
      expect(game.darkness(), 'at t = 0').toBe(1);
      const seen: number[] = [];
      Object.assign(game.dozer, { speed: 0 });
      for (let f = 0; f < 30; f++) {
        game.step(DT, still);
        seen.push(game.darkness());
      }
      // frame 12 is 0.2 s: half way down from black to the floor
      expect(seen[11]).toBeCloseTo(Math.max(floor, 0.5), 3);
      for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeLessThanOrEqual(seen[i - 1] + 1e-9);
      expect(seen[23] - floor, 'at 0.4 s').toBeCloseTo(0, 3);
      expect(seen[29], 'and after').toBeCloseTo(floor, 6);
    });
  });

  it('is not there for a game that began without arriving', () => {
    const game = gameIn('south-gallery');
    expect(game.darkness()).toBe(darkness(game.cave, false, game.dozer.x, game.dozer.y));
  });

  it('is black while the game that has been left waits to be swapped for the next', () => {
    withSeed(2, () => {
      const game = gameIn('hollow', { open: true });
      const [px, py] = beforeLine(game.cave, -3);
      const { ox, oy } = outer(game.cave);
      Object.assign(game.dozer, { x: px, y: py, yaw: Math.atan2(oy, ox), speed: 5 });
      game.step(DT, still);
      expect(game.left).toBe(true);
      expect(game.darkness()).toBe(1);
      expect(game.keepGoing()).toBe(1);
    });
  });
});

describe('the words (criterion 4)', () => {
  /** A game in the Hollow with its way out open, and the dozer put `before` units short of the leaving line. */
  const down = (before: number, open = true) => {
    const game = gameIn('hollow', { open });
    const [x, y] = beforeLine(game.cave, before);
    Object.assign(game.dozer, { x, y, speed: 0 });
    return game;
  };

  it('rise with the darkness down the way out, and are full by the leaving line', () => {
    withSeed(3, () => {
      expect(down(3 * TILE + 5).keepGoing(), 'not yet in the ramp').toBe(0);
      const early = down(3 * TILE * 0.75).keepGoing();
      const later = down(3 * TILE * 0.4).keepGoing();
      expect(early).toBeGreaterThan(0);
      expect(later).toBeGreaterThan(early);
      expect(down(0).keepGoing()).toBe(1);
      expect(down(0).keepGoing()).toBeLessThanOrEqual(1);
    });
  });

  it('are off on the cave’s floor, and with the way out shut', () => {
    withSeed(4, () => {
      const game = gameIn('hollow', { open: true });
      expect(game.keepGoing(), 'on the floor').toBe(0);
      expect(down(0, false).keepGoing(), 'down a way out that is shut').toBe(0);
    });
  });

  it('are off at the arrival in the way in once it has come up, and fall with the rise before', () => {
    withSeed(5, () => {
      const game = new Game(newEconomy(saveIn('south-gallery')), caveOf('south-gallery'), {}, { speed: 0 });
      expect(game.keepGoing(), 'at t = 0').toBe(1);
      const seen: number[] = [];
      for (let f = 0; f < 30; f++) {
        game.step(DT, still);
        seen.push(game.keepGoing());
      }
      expect(seen[11], 'half way up').toBeCloseTo(0.5, 3);
      for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeLessThanOrEqual(seen[i - 1] + 1e-9);
      expect(seen[29], 'gone after 0.4 s').toBe(0);
      // still at the dark outer end of the way in, and no words
      expect(game.darkness()).toBeGreaterThan(ARRIVAL_DARK * 0.7);
    });
  });

  it('are off for a game that began without arriving, at the arrival', () => {
    expect(gameIn('south-gallery').keepGoing()).toBe(0);
  });

  it('are off in the last cave, which has no way out to go down', () => {
    const game = gameIn('deep', { open: true });
    expect(game.keepGoing()).toBe(0);
  });
});
