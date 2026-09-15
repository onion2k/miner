import { describe, expect, it } from 'vitest';
import { AREAS, BODY_CAPACITY, buildCave } from '../src/cave';
import { BLAST_RADIUS, Barrels, FUSE } from '../src/barrels';
import { BARREL_KIND, KIND_RADIUS, World, type Pusher } from '../src/physics';

const cave = buildCave();
const DT = 1 / 60;
const world = () => new World(BODY_CAPACITY, cave.solid(AREAS.map(() => true)));
/** A box of a machine's, at (x, y) facing +x, `owner`'s. */
const box = (x: number, y: number, owner: number): Pusher => ({
  x,
  y,
  z: 1.2,
  yaw: 0,
  hx: 0.4,
  hy: 3,
  hz: 1.2,
  vx: 0,
  vy: 0,
  spin: 0,
  px: x,
  py: y,
  owner,
});
const barrelAt = (w: World, x: number, y: number) => w.spawn(BARREL_KIND, x, y, KIND_RADIUS[BARREL_KIND]);

describe('the barrels', () => {
  it('have their fuses lit by the player’s machine against them, and not by a drone’s, or from afar', () => {
    const w = world();
    const b = barrelAt(w, -30, 10);
    const barrels = new Barrels(w);
    expect(barrels.hitBy([box(-30 - KIND_RADIUS[BARREL_KIND] - 0.4, 10, 1)], 0)).toEqual([]);
    expect(barrels.hitBy([box(-40, 10, 0)], 0)).toEqual([]);
    expect(barrels.hitBy([box(-30 - KIND_RADIUS[BARREL_KIND] - 0.4, 10, 0)], 0)).toEqual([b]);
    expect(barrels.fuseLeft(b)).toBe(FUSE);
    // lit once: hitting it again is not lighting it again
    expect(barrels.hitBy([box(-30 - KIND_RADIUS[BARREL_KIND] - 0.4, 10, 0)], 0)).toEqual([]);
  });

  it('flash faster and faster as the fuse burns, and go off when it has burned', () => {
    const w = world();
    const b = barrelAt(w, -30, 10);
    const barrels = new Barrels(w);
    barrels.light(b);
    const flashesIn = (seconds: number) => {
      let flashes = 0,
        was = barrels.flashing(b);
      for (let t = 0; t < seconds; t += DT) {
        barrels.update(DT, (i) => w.remove(i));
        const now = barrels.flashing(b);
        if (now && !was) flashes++;
        was = now;
      }
      return flashes;
    };
    const early = flashesIn(1);
    const late = flashesIn(1.5);
    expect(late / 1.5).toBeGreaterThan(early * 1.5);
    let blasts = 0;
    for (let t = 0; t < 1; t += DT) blasts += barrels.update(DT, (i) => w.remove(i)).length;
    expect(blasts).toBe(1);
    expect(w.alive[b]).toBe(0);
    expect(barrels.lit).toEqual([]);
  });

  it('throw what is near outward and up, the nearer the harder, and leave what is out of reach', () => {
    const w = world();
    const near = w.spawn(0, -26, 10, 0.42),
      nearer = w.spawn(0, -28, 10, 0.42),
      far = w.spawn(0, -30 + BLAST_RADIUS + 2, 10, 0.42);
    const barrels = new Barrels(w);
    const thrown = barrels.blast(-30, 10, 1);
    expect(thrown).toBe(2);
    expect(w.vx[nearer]).toBeGreaterThan(w.vx[near]);
    expect(w.vx[near]).toBeGreaterThan(0);
    expect(w.vz[near]).toBeGreaterThan(0);
    expect(w.vx[far]).toBe(0);
    for (let f = 0; f < 30; f++) w.step(DT, () => {});
    expect(w.x[near]).toBeGreaterThan(-26 + 3);
  });

  it('set off the barrels caught in a blast soon after, nearest first', () => {
    const w = world();
    const first = barrelAt(w, -30, 10),
      close = barrelAt(w, -26, 10),
      edge = barrelAt(w, -30 + BLAST_RADIUS - 2, 10);
    const barrels = new Barrels(w);
    barrels.light(first, 0.01);
    barrels.update(DT, (i) => w.remove(i));
    expect(barrels.fuseLeft(close)).not.toBeNull();
    expect(barrels.fuseLeft(edge)).not.toBeNull();
    expect(barrels.fuseLeft(close)!).toBeLessThan(barrels.fuseLeft(edge)!);
    expect(barrels.fuseLeft(edge)!).toBeLessThan(FUSE);
    const went: number[] = [];
    for (let t = 0; t < 2; t += DT) for (const b of barrels.update(DT, (i) => w.remove(i))) went.push(Math.round(b.x));
    expect(went).toHaveLength(2);
  });

  it('forget a lit barrel that is gone, whatever takes its slot after', () => {
    const w = world();
    const b = barrelAt(w, -30, 10);
    const barrels = new Barrels(w);
    barrels.light(b);
    w.remove(b);
    const coin = w.spawn(0, -30, 10, 1);
    expect(coin).toBe(b);
    expect(barrels.update(FUSE + 1, () => {})).toEqual([]);
    expect(barrels.lit).toEqual([]);
    expect(w.alive[coin]).toBe(1);
  });
});
