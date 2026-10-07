/**
 * The rules that must always hold of a game in a run of caves, each shown to
 * be noticed when it is broken: a rule nothing has been seen to break is a
 * rule nothing may be checking.
 */
import { describe, expect, it } from 'vitest';
import { EXIT } from '../src/cave';
import { checkInvariants } from '../src/invariants';
import type { Row } from '../src/ledger';
import { RUN, gameIn, newGame, withSeed } from './helpers';

const DT = 1 / 60;
const still = { throttle: 0, steer: 0 };

describe('the invariants of a run', () => {
  it.each(['hollow', 'south-gallery', 'east-gallery', 'north-vault', 'west-gallery'])(
    'hold of a game just begun in %s, and after a little play',
    (id) => {
      withSeed(1, () => {
        const game = gameIn(id);
        expect(checkInvariants(game), id).toEqual([]);
        for (let f = 0; f < 30; f++) game.step(DT, still);
        expect(checkInvariants(game), id).toEqual([]);
      });
    },
  );

  it('notice a save that is not in a cave of the run, or not in the cave the game is in', () => {
    const game = newGame();
    game.economy.save.cave = 'the-moon';
    expect(checkInvariants(game).join('\n')).toContain('not in the run');
    game.economy.save.cave = 'south-gallery';
    expect(checkInvariants(game).join('\n')).toContain('the game is in hollow and the save in south-gallery');
  });

  it('notice a list of the cave that is not the cave’s size', () => {
    withSeed(2, () => {
      const game = gameIn('south-gallery');
      const save = game.economy.save;
      save.secrets.push(false);
      save.walls.pop();
      save.wallDamage.push(0);
      save.left.push([]);
      save.rubble.push(1);
      save.barrels = [1, 2];
      save.geodes = [1, 2];
      const said = checkInvariants(game).join('\n');
      for (const what of ['secrets', 'walls', 'wallDamage', 'left', 'rubble', 'barrels', 'geodes'])
        expect(said, `a wrong ${what} noticed`).toContain(what);
    });
  });

  it('notice a scoop of no size the workshop sells, and a drain that has taken less than nothing', () => {
    const game = gameIn('hollow');
    game.economy.save.scoop = 4;
    game.economy.save.drained = -1;
    const said = checkInvariants(game).join('\n');
    expect(said).toContain('the scoop: 4');
    expect(said).toContain('down the drains: -1');
  });

  it('notice what is fitted that is neither the blade nor the scoop, and a scoop fitted where there is none', () => {
    const game = gameIn('hollow', { scoop: 1 });
    expect(checkInvariants(game)).toEqual([]);
    game.economy.save.fitted = 'wrench' as never;
    expect(checkInvariants(game).join('\n')).toContain('what is fitted: wrench');
    const bare = gameIn('hollow');
    bare.economy.save.fitted = 'scoop';
    expect(checkInvariants(bare).join('\n')).toContain('the scoop is fitted, and there is none');
  });

  it('notice a bucket that is not fitted and is up or holds something', () => {
    const game = gameIn('hollow', { scoop: 1, fitted: 'blade' });
    expect(checkInvariants(game)).toEqual([]);
    game.scoop.up = true;
    expect(checkInvariants(game).join('\n')).toContain('the bucket is not fitted and holds 0, up true');
    game.scoop.up = false;
    game.scoop.dump = 0.5;
    expect(checkInvariants(game).join('\n')).toContain('the bucket is not fitted');
  });

  it('notice a geode that is from a source, and a coin in the geodes’ gems', () => {
    withSeed(3, () => {
      const game = gameIn('hollow');
      const g = game.stock.spawnGeode(-10, -26);
      expect(checkInvariants(game)).toEqual([]);
      game.stock.origin[g] = 0;
      expect(checkInvariants(game).join('\n')).toContain('a geode');
      game.stock.origin[g] = 255;
      // a coin counted to the geodes' source, as if it had been thrown out of one
      const from = game.economy.sources.geodes();
      expect(game.stock.spawn(0, -10, -30, 1, 0, 0, 0, from)).toBe(true);
      expect(checkInvariants(game).join('\n')).toContain("the geodes' gems include 1 coin");
    });
  });

  it('notice a lamp broken that the cave has not', () => {
    const game = gameIn('hollow');
    game.economy.save.lampsBroken.push(game.cave.lamps.length);
    expect(checkInvariants(game).join('\n')).toContain('a lamp knocked over that the cave has not');
  });

  it('notice a belt the cave does not have', () => {
    const game = gameIn('south-gallery');
    game.economy.save.belts.push('east-belt');
    expect(checkInvariants(game).join('\n')).toContain('a belt bought that the cave has not: east-belt');
  });

  it('notice a way out that is open in the last cave, or the game done short of it', () => {
    const last = gameIn('deep');
    last.economy.save.open = true;
    expect(checkInvariants(last).join('\n')).toContain('the last cave has its way out open');
    const first = newGame();
    first.economy.save.done = true;
    expect(checkInvariants(first).join('\n')).toContain('which is not the last cave');
  });

  it('notice enough banked with the way out shut, once the game has had a step to notice it', () => {
    withSeed(3, () => {
      const game = newGame();
      game.step(DT, still);
      // everything banked, and the way out not opened
      game.stock.left[0].fill(0);
      expect(checkInvariants(game).join('\n')).toContain('the way out is shut');
    });
  });

  it('notice a way out whose rock is not as the save says', () => {
    withSeed(4, () => {
      const game = newGame();
      const t = [...game.cave.cells.keys()].find((i) => game.cave.cells[i] === EXIT)!;
      game.world.solid[t] = 0;
      expect(checkInvariants(game).join('\n')).toContain('the way out is shut and its rock is not');
      game.world.solid[t] = 1;
      game.economy.save.open = true;
      expect(checkInvariants(game).join('\n')).toContain('the way out is open and its rock is not');
    });
  });

  it('notice a ledger that does not add up, has too many rows, a cave not in the run, or one twice', () => {
    const row = (cave: string, over: Partial<Row> = {}): Row => ({
      cave,
      held: 100,
      taken: 60,
      toll: 20,
      drained: 10,
      left: 30,
      finds: { chamber: 'none', sideRoom: 'none', wall: 'none', geodes: { cracked: 0, of: 0 } },
      marks: { clean: false, everyHeap: false, everyFind: false },
      ...over,
    });
    const game = gameIn('east-gallery');
    const save = game.economy.save;
    save.ledger = [row('hollow'), row('south-gallery')];
    expect(checkInvariants(game), 'rows that add up').toEqual([]);
    save.ledger = [row('hollow', { left: 31 })];
    expect(checkInvariants(game).join('\n')).toContain('the ledger: hollow took 60, drained 10 and left 31 of 100');
    // a row of the last cave's vein is the one allowed to pass what it held
    save.ledger = [row('hollow', { taken: 140, left: 0, vein: true })];
    expect(checkInvariants(game)).toEqual([]);
    save.ledger = [row('the-moon')];
    expect(checkInvariants(game).join('\n')).toContain('a row for the-moon, which is not in the run');
    save.ledger = [row('hollow'), row('hollow')];
    expect(checkInvariants(game).join('\n')).toContain('hollow twice');
    save.ledger = RUN.map((c) => row(c.id));
    expect(checkInvariants(game).join('\n')).toContain(`${RUN.length} rows, and a run leaves ${RUN.length - 1} caves`);
  });

  it('notice a cave that has taken less than the toll it has paid, and a count of geodes that is not a count', () => {
    const game = gameIn('south-gallery', { toll: 0 });
    game.economy.save.toll = 500;
    game.economy.save.taken = 499;
    expect(checkInvariants(game).join('\n')).toContain('the ledger: 499 taken, 500 of the toll paid');
    game.economy.save.taken = 500;
    game.economy.save.cracked = -1;
    expect(checkInvariants(game).join('\n')).toContain('the ledger: -1 geodes cracked');
    game.economy.save.cracked = 2;
    expect(checkInvariants(game)).toEqual([]);
  });

  it('ask nothing of a game that has been left: its save is of the next cave', () => {
    withSeed(5, () => {
      const game = gameIn('hollow', { open: true });
      game.left = true;
      game.economy.save.cave = 'south-gallery';
      expect(checkInvariants(game)).toEqual([]);
    });
  });
});
