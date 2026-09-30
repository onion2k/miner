import { describe, expect, it } from 'vitest';
import { BRICK, EXIT, SECRET } from '../src/cave';
import { Impacts, SMASH_SPEED, type ImpactState } from '../src/impacts';
import { caveOf } from './helpers';

/** The South Gallery has one chamber and one wall, which is all the tiles below stand for. */
const { spec: SPEC, grid: GRID } = caveOf('south-gallery');
const { secrets: SECRETS, walls: WALLS } = SPEC;
const { cols: COLS, rows: ROWS } = GRID;

/** A grid with a wall tile at (10, 10), a chamber's rock at (20, 20) and a way out's at (40, 40). */
const cells = new Uint8Array(COLS * ROWS);
cells[10 * COLS + 10] = BRICK;
cells[20 * COLS + 20] = SECRET;
cells[40 * COLS + 40] = EXIT;
const state = (over: Partial<ImpactState> = {}): ImpactState => ({
  wallsDown: WALLS.map(() => false),
  secretsOpen: SECRETS.map(() => false),
  ram: (speed) => (speed > 4 ? speed * 5 : 0),
  ...over,
});

describe('driving into the rock', () => {
  it('hurts a brick wall driven square into fast enough, once a run at it', () => {
    const impacts = new Impacts(cells, GRID, SPEC);
    expect(impacts.hit(10, 10, 1, 8, 0, state())).toMatchObject({ type: 'wall', wall: 0, damage: 40 });
    // the blade held against it is not another hit
    expect(impacts.hit(10, 10, 1, 8, 0.2, state())).toBeNull();
    expect(impacts.hit(10, 10, 1, 8, 0.6, state())).toMatchObject({ type: 'wall' });
    // at a slant, too slow, or already down, nothing
    expect(impacts.hit(10, 10, 0.3, 8, 5, state())).toBeNull();
    expect(impacts.hit(10, 10, 1, 3, 6, state())).toBeNull();
    expect(impacts.hit(10, 10, 1, 8, 7, state({ wallsDown: WALLS.map(() => true) }))).toBeNull();
  });

  it('smashes a chamber open square on and fast, and otherwise sounds hollow, now and then', () => {
    const impacts = new Impacts(cells, GRID, SPEC);
    expect(impacts.hit(20, 20, 1, SMASH_SPEED, 0, state())).toEqual({ type: 'reveal', chamber: 0 });
    expect(impacts.hit(20, 20, 0.5, 3, 0, state())).toEqual({ type: 'knock', chamber: 0 });
    expect(impacts.hit(20, 20, 0.5, 3, 0.3, state())).toBeNull();
    expect(impacts.hit(20, 20, 0.5, 3, 1, state())).toEqual({ type: 'knock', chamber: 0 });
    expect(impacts.hit(20, 20, 1, SMASH_SPEED, 2, state({ secretsOpen: SECRETS.map(() => true) }))).toBeNull();
  });

  it('is only rock anywhere else, backing into it or not', () => {
    const impacts = new Impacts(cells, GRID, SPEC);
    expect(impacts.hit(30, 30, 1, 20, 0, state())).toBeNull();
    expect(impacts.hit(20, 20, 1, -SMASH_SPEED, 0, state())).toEqual({ type: 'reveal', chamber: 0 });
  });

  it('takes the way out for rock: driven into square and flat out, it does nothing, open or not', () => {
    const impacts = new Impacts(cells, GRID, SPEC);
    for (let t = 0; t < 4; t++) expect(impacts.hit(40, 40, 1, 14, t, state())).toBeNull();
  });
});
