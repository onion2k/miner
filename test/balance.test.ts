import { describe, expect, it } from 'vitest';
import { ORDER } from '../src/cave';
import { Economy, memoryStore, workshopTotal } from '../src/economy';
import { playThrough } from '../scripts/balancer';

describe('the balance run', () => {
  it('plays the hollow through and reports its pacing', () => {
    const run = playThrough({ seed: 1, profile: 'rusher', rooms: 1, capMinutes: 20 });
    expect(run.finished).toBe(true);
    expect(run.rooms).toHaveLength(1);
    expect(run.rooms[0]).toMatchObject({ area: ORDER[0] });
    expect(run.rooms[0].minutes).toBeGreaterThan(0.5);
    expect(run.rooms[0].minutes).toBeLessThan(20);
    expect(run.bank.length).toBeGreaterThan(1);
    expect(run.problems).toEqual([]);
    for (const p of run.purchases) expect(p.minute).toBeLessThanOrEqual(run.minutes);
  }, 30_000);

  it('loads an old save, bought under the old prices, with what it bought kept', () => {
    const old = JSON.stringify({ bank: 12, room: 0, areas: [true], engine: 3, blade: 2, magnet: 1, drones: 2 });
    const e = new Economy(memoryStore(old));
    expect([e.save.engine, e.save.blade, e.save.magnet, e.save.drones]).toEqual([3, 2, 1, 2]);
    expect(e.bank).toBe(12);
    expect(workshopTotal()).toBeGreaterThan(0);
  });
});
