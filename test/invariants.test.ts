/**
 * The rules that must always hold of a game in a run of caves, each shown to
 * be noticed when it is broken: a rule nothing has been seen to break is a
 * rule nothing may be checking.
 */
import { describe, expect, it } from 'vitest';
import { EXIT } from '../src/cave';
import { checkInvariants } from '../src/invariants';
import { gameIn, newGame, withSeed } from './helpers';

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
      const said = checkInvariants(game).join('\n');
      for (const what of ['secrets', 'walls', 'wallDamage', 'left', 'rubble', 'barrels'])
        expect(said, `a wrong ${what} noticed`).toContain(what);
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
    const last = gameIn('west-gallery');
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

  it('ask nothing of a game that has been left: its save is of the next cave', () => {
    withSeed(5, () => {
      const game = gameIn('hollow', { open: true });
      game.left = true;
      game.economy.save.cave = 'south-gallery';
      expect(checkInvariants(game)).toEqual([]);
    });
  });
});
