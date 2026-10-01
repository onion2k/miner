/**
 * A cave's world at its capacity, played: every chamber broken into, every side room and every wall's treasure
 * in the world at once, and nothing dropped for want of room. Each builds a cave's whole game, so it is in the full check.
 */
import { describe, expect, it } from 'vitest';
import { buildCave } from '../../src/cave';
import { Economy, memoryStore, sourcesOf } from '../../src/economy';
import { Game } from '../../src/game';
import { BARREL_KIND, KINDS } from '../../src/physics';
import { VEIN_ROOM, capacityOf, treasureHeap } from '../../src/stock';
import { layBricks } from '../../src/walls';
import { RUN, specOf } from '../helpers';

/** Everything a cave can ever hold at once from its own content: heaps, every chamber and side room opened, every wall's treasure. */
function held(id: string) {
  const spec = specOf(id);
  const kinds = new Array<number>(KINDS).fill(0);
  const add = (coins: number, gems: [number, number][]) => {
    kinds[0] += coins;
    for (const [k, n] of gems) kinds[k] += n;
  };
  for (const h of spec.heaps) add(h.coins, h.gems);
  for (const s of spec.secrets) add(s.loot.coins, s.loot.gems);
  for (const s of spec.stashes) add(s.loot.coins, s.loot.gems);
  for (const w of spec.walls) add(0, w.treasure);
  return kinds;
}

describe('a cave at capacity', () => {
  it.each(RUN.map((c) => c.id))(
    '%s with every chamber broken into, side room and wall treasure in the world, has dropped nothing',
    (id) => {
      const spec = specOf(id);
      const economy = new Economy(memoryStore(), RUN);
      economy.travel(id);
      spec.secrets.forEach((_, k) => economy.reveal(k));
      const cave = buildCave(spec);
      const game = new Game(economy, cave);
      // the treasure of a wall comes out when the wall comes down in play
      const sources = sourcesOf(spec);
      spec.walls.forEach((w, k) => {
        if (w.treasure.length) game.stock.spawnHeap(sources.wall(k), treasureHeap(cave, k));
      });
      // and every wall's bricks, on the floor beside the treasure, and the barrels it stood at the start
      let refused = 0;
      spec.walls.forEach((_, k) => {
        for (const b of layBricks(cave, k)) if (game.stock.spawnBrick(0, b.x, b.y, b.z) < 0) refused++;
      });
      expect(refused, `${id} bricks with no room`).toBe(0);
      const kinds = held(id);
      for (let k = 0; k < 6; k++) expect(game.stock.kinds[k], `${id} kind ${k} in the world`).toBe(kinds[k]);
      expect(game.world.live).toBeLessThanOrEqual(capacityOf(spec).bodies);
      expect(game.world.capacity).toBe(capacityOf(spec).bodies);
      expect(game.stock.kinds[BARREL_KIND], `${id} barrels`).toBe(cave.barrels.length);
      // room is left for the vein after all of it, which is what the capacity is worked out to keep
      expect(game.world.capacity - game.world.live, `${id} room left for the vein`).toBeGreaterThanOrEqual(VEIN_ROOM);
    },
  );
});
