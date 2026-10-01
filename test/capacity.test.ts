/**
 * How many bodies a cave can hold, worked out from the cave. A constant for the whole game was right while
 * every cave was about the same size; a cave twice the size of the biggest, or a small one, needs its own,
 * and the renderer is sized to the biggest in the run. What a cave's heaps need must never be dropped for want
 * of room: a coin that is not spawned is a coin the cave can never be cleared of, and its way out
 * is 90% of the cave's worth. What the world actually holds at capacity is played in `slow/capacity.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { buildCave } from '../src/cave';
import { BARREL_KIND, BRICK_KIND, GEODE_KIND, KINDS } from '../src/physics';
import { RUN, specOf } from './helpers';
import { VEIN_ROOM, capacityOf, runCapacity } from '../src/stock';
import { layBricks } from '../src/walls';

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
  // every geode cracked at once
  for (let g = 0; g < (spec.geodes?.count ?? 0); g++) add(0, spec.geodes!.holds);
  return kinds;
}

describe('a cave’s capacity', () => {
  it.each(RUN.map((c) => c.id))('%s holds every body its content can put in it, with room for the vein', (id) => {
    const cap = capacityOf(specOf(id));
    const kinds = held(id);
    for (let k = 1; k < 6; k++) expect(cap.kinds[k], `gem kind ${k}`).toBeGreaterThanOrEqual(kinds[k]);
    const total = kinds.reduce((a, b) => a + b, 0);
    expect(cap.bodies).toBeGreaterThanOrEqual(total + VEIN_ROOM);
    // room for every brick its walls can drop, and a barrel for each it stands
    const bricks = specOf(id).walls.reduce((n, _, w) => n + layBricks(buildCave(specOf(id)), w).length, 0);
    expect(cap.kinds[BRICK_KIND]).toBeGreaterThanOrEqual(bricks);
    expect(cap.kinds[BARREL_KIND]).toBeGreaterThanOrEqual(specOf(id).barrels);
    // and a geode for each it stands, and every gem they hold
    expect(cap.kinds[GEODE_KIND]).toBeGreaterThanOrEqual(specOf(id).geodes?.count ?? 0);
  });

  it('is each cave’s own, not one for the game: the hollow needs less than a cave with many heaps', () => {
    const hollow = capacityOf(specOf('hollow'));
    const biggest = RUN.map((c) => capacityOf(c).bodies).reduce((a, b) => Math.max(a, b));
    expect(hollow.bodies).toBeLessThan(biggest);
    expect(new Set(RUN.map((c) => capacityOf(c).bodies)).size, 'caves differ').toBeGreaterThan(1);
  });

  it('is sized for the renderer to the largest of the run, in every kind', () => {
    const all = RUN.map((c) => capacityOf(c));
    const run = runCapacity(RUN);
    expect(run.bodies).toBe(Math.max(...all.map((c) => c.bodies)));
    for (let k = 0; k < KINDS; k++) expect(run.kinds[k]).toBe(Math.max(...all.map((c) => c.kinds[k])));
  });
});
