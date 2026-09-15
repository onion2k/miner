import { describe, expect, it } from 'vitest';
import { ORDER, SECRETS, WALLS } from '../src/cave';
import { Autopilot } from '../src/autopilot';
import { BOT_SCALE } from '../src/tools';
import { Economy, memoryStore } from '../src/economy';
import { Game } from '../src/game';
import { checkInvariants } from '../src/invariants';
import { withSeed } from './helpers';

const DT = 1 / 60;
const newGame = (json: string | null = null) => new Game(new Economy(memoryStore(json)));
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
      fly(pilot, 90);
      expect(Math.hypot(game.dozer.x - start.x, game.dozer.y - start.y)).toBeGreaterThan(5);
      expect(game.economy.save.banked, 'banked in 90 s').toBeGreaterThan(40);
      expect(checkInvariants(game)).toEqual([]);
    });
  });

  it('buys the cheapest thing in the workshop it can afford, as soon as it can', () => {
    withSeed(2, () => {
      const game = newGame();
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

  it('as a rusher, goes on into the next room as soon as it is open', () => {
    withSeed(3, () => {
      const game = newGame();
      const pilot = new Autopilot(game, 'rusher', { shop: false });
      game.economy.open();
      fly(pilot, 120, () => game.economy.current() === ORDER[1]);
      expect(game.economy.current()).toBe(ORDER[1]);
      expect(pilot.log.some((l) => l.what === `into ${ORDER[1]}`)).toBe(true);
    });
  });

  it('as a thorough player, breaks into its room’s hidden chamber and knocks down its brick wall before going on', () => {
    withSeed(4, () => {
      const game = newGame();
      const pilot = new Autopilot(game, 'thorough', { shop: false });
      // straight on into the south gallery, with an engine good for its wall
      game.economy.open();
      fly(pilot, 5);
      game.economy.save.engine = 4;
      const room = ORDER[1];
      Object.assign(game.dozer, pilot.pastSeal(room));
      game.step(DT, { throttle: 0, steer: 0 });
      expect(game.economy.current()).toBe(room);
      const chamber = SECRETS.findIndex((s) => s.area === room);
      const wall = WALLS.findIndex((w) => w.area === room);
      fly(pilot, 240, () => game.economy.save.secrets[chamber] && game.economy.save.walls[wall]);
      expect(game.economy.save.secrets[chamber], 'chamber broken into').toBe(true);
      expect(game.economy.save.walls[wall], 'wall down').toBe(true);
      expect(checkInvariants(game)).toEqual([]);
    });
  });

  it('leaves the drones as they were: the same machine, at its size', () => {
    const game = newGame();
    game.economy.deposit(700);
    game.economy.buy('drone');
    expect(game.bots[0].dozer.scale).toBe(BOT_SCALE);
  });
});
