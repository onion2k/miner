import { describe, expect, it } from 'vitest';
import { Autopilot, DWINDLE_OVER, gainsDwindled } from '../src/autopilot';
import { BOT_SCALE } from '../src/tools';
import { checkInvariants } from '../src/invariants';
import { gameIn, newGame, withSeed } from './helpers';

const DT = 1 / 60;
/** Play `seconds` of the game under the autopilot, or until `until` holds. */
function fly(pilot: Autopilot, seconds: number, until: () => boolean = () => false) {
  for (let f = 0; f < seconds * 60 && !until(); f++) pilot.step(DT);
}

describe('the autopilot', () => {
  it('drives the player’s own full-size dozer, with its upgrades, and banks what it pushes', () => {
    withSeed(1, () => {
      const game = newGame();
      const pilot = new Autopilot(game, 'rusher', { shop: false });
      expect(pilot.machine.dozer).toBe(game.dozer);
      expect(game.dozer.scale).toBe(1);
      const start = { x: game.dozer.x, y: game.dozer.y };
      fly(pilot, 40);
      expect(Math.hypot(game.dozer.x - start.x, game.dozer.y - start.y)).toBeGreaterThan(5);
      expect(game.economy.save.banked, 'banked in 40 s').toBeGreaterThan(10);
      expect(checkInvariants(game)).toEqual([]);
    });
  });

  it('buys the cheapest thing in the workshop it can afford, as soon as it can', () => {
    withSeed(2, () => {
      const game = gameIn('hollow');
      const pilot = new Autopilot(game, 'rusher');
      const [first, second] = game.economy
        .offers()
        .filter((o) => o.available && !o.owned)
        .sort((a, b) => a.cost - b.cost);
      // enough for either the cheapest or the next, not both: it takes the cheapest, and nothing cosmetic
      game.economy.deposit(second.cost);
      pilot.step(DT);
      expect(pilot.log.map((l) => l.what)).toEqual([`bought ${first.id}`]);
      expect(game.economy.bank).toBe(second.cost - first.cost);
      expect(game.economy.save.paints).toEqual(['yellow']);
    });
  });

  it('never buys the scoop, which it cannot work, however much it has to spend', () => {
    withSeed(11, () => {
      const game = newGame();
      const pilot = new Autopilot(game, 'rusher');
      game.economy.deposit(50_000);
      pilot.step(DT);
      const bought = pilot.log.map((l) => l.what);
      expect(bought.length, 'it bought what it could').toBeGreaterThan(3);
      expect(bought).not.toContain('bought scoop');
      expect(game.economy.save.scoop).toBe(0);
      expect(game.economy.offers().find((o) => o.id === 'scoop')).toMatchObject({ owned: false, available: true });
    });
  });

  it('as a rusher, drives out through the way out as soon as it is open', () => {
    withSeed(3, () => {
      const game = newGame();
      const pilot = new Autopilot(game, 'rusher', { shop: false });
      game.economy.open();
      fly(pilot, 120, () => game.left);
      expect(game.left).toBe(true);
      expect(game.economy.save.cave).toBe('south-gallery');
      expect(pilot.log.some((l) => l.what === 'out of hollow')).toBe(true);
    });
  });

  it('as a thorough player, breaks into its cave’s hidden chamber and knocks down its brick wall before going on', () => {
    withSeed(4, () => {
      // in the south gallery, with an engine good for its wall
      const game = gameIn('south-gallery', { engine: 4 });
      const pilot = new Autopilot(game, 'thorough', { shop: false });
      fly(pilot, 360, () => game.economy.save.secrets[0] && game.economy.save.walls[0]);
      expect(game.economy.save.secrets[0], 'chamber broken into').toBe(true);
      expect(game.economy.save.walls[0], 'wall down').toBe(true);
      expect(checkInvariants(game)).toEqual([]);
    });
  });

  it('judges the gains dwindled when the last stretch has banked next to nothing of the cave, and not before it has a stretch to judge by', () => {
    const worth = 3000;
    const at = (t: number, banked: number) => ({ t, banked });
    // too short a stretch to say, however little it banked
    expect(gainsDwindled([at(0, 500), at(DWINDLE_OVER - 10, 500)], worth)).toBe(false);
    // a whole stretch, and a coin or two in it: dwindled
    expect(gainsDwindled([at(0, 500), at(DWINDLE_OVER / 2, 502), at(DWINDLE_OVER, 504)], worth)).toBe(true);
    // a whole stretch, and a real share of the cave banked in it: still paying
    expect(gainsDwindled([at(0, 500), at(DWINDLE_OVER, 500 + worth * 0.05)], worth)).toBe(false);
  });

  it('as a thorough player, stays while the cave is still paying', () => {
    withSeed(7, () => {
      const game = gameIn('south-gallery', { open: true, engine: 3, blade: 2 });
      const pilot = new Autopilot(game, 'thorough', { shop: false });
      fly(pilot, 20);
      expect(game.left, 'not gone while heaps are there to push').toBe(false);
    });
  });

  it('leaves the drones as they were: the same machine, at its size', () => {
    const game = gameIn('hollow');
    game.economy.deposit(700);
    game.economy.buy('drone');
    expect(game.bots[0].dozer.scale).toBe(BOT_SCALE);
  });
});
