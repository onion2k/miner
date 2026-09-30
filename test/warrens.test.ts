/**
 * The Warrens, held to its sketch: five noise-shaped caverns in a chain, joined by winding tunnels,
 * arrived at on the west and left on the east, a hole in the second cavern and another in the fourth, a
 * side room behind a brick wall off one cavern, a hidden chamber, and no belt. The cave checker in
 * `caves.test.ts` holds it to everything every cave is held to; this holds what is its own, and that
 * putting it into the run did not move anything a save names.
 */
import { describe, expect, it } from 'vitest';
import { OPEN, TILE, carveShapes, gridOf, type Shape } from '../src/cave';
import { HAUL_LIMIT, haulField } from '../scripts/hauls';
import { IDS, caveOf, gameIn, newEconomy, saveIn, specOf, withSeed } from './helpers';

const warrens = caveOf('warrens');
const { spec } = warrens;
const { cols, rows } = warrens.grid;

type Cavern = Extract<Shape, { kind: 'cavern' }>;
/** The caverns, west to east. */
const caverns = spec.shapes
  .filter((s): s is Cavern => s.kind === 'cavern' && !s.rock)
  .sort((a, b) => a.box[0] - b.box[0]);
const tunnels = spec.shapes.filter((s) => s.kind === 'tunnel' && !s.rock);

/** The tile a world point is over, from the grid's corner. */
const tileOf = (x: number, y: number): [number, number] => [
  Math.floor((x - warrens.grid.originX) / TILE),
  Math.floor((y - warrens.grid.originY) / TILE),
];
const inBox = ([tx, ty]: [number, number], [x0, y0, x1, y1]: [number, number, number, number]) =>
  tx >= x0 && tx <= x1 && ty >= y0 && ty <= y1;

/** The pieces of floor a set of shapes leaves, four ways joined: each tile's piece number, 0 for rock. */
function labelled(shapes: Shape[]): { label: Int32Array; count: number } {
  const cells = carveShapes(gridOf({ cols, rows }), shapes);
  const label = new Int32Array(cells.length);
  let count = 0;
  for (let start = 0; start < cells.length; start++) {
    if (cells[start] !== OPEN || label[start]) continue;
    count++;
    const stack = [start];
    while (stack.length) {
      const t = stack.pop()!;
      if (cells[t] !== OPEN || label[t]) continue;
      label[t] = count;
      const tx = t % cols;
      if (tx > 0) stack.push(t - 1);
      if (tx < cols - 1) stack.push(t + 1);
      if (t >= cols) stack.push(t - cols);
      if (t + cols < cells.length) stack.push(t + cols);
    }
  }
  return { label, count };
}

describe('the Warrens', () => {
  it('stands in the run between the North Vault and the West Gallery, by the id it is saved under', () => {
    expect(IDS.indexOf('warrens')).toBe(IDS.indexOf('north-vault') + 1);
    expect(IDS.indexOf('west-gallery')).toBe(IDS.indexOf('warrens') + 1);
    expect(IDS.at(-1), 'the West Gallery is still the last cave').toBe('west-gallery');
    expect(spec.name).toBe('The Warrens');
  });

  it('is a jungle of about the East Gallery’s area, with a little more than its floor and none of its belts', () => {
    expect(spec.biome).toBe('jungle');
    expect((spec.cols * spec.rows) / (specOf('east-gallery').cols * specOf('east-gallery').rows)).toBeGreaterThan(0.85);
    expect((spec.cols * spec.rows) / (specOf('east-gallery').cols * specOf('east-gallery').rows)).toBeLessThan(1.25);
    const floor = (id: string) => caveOf(id).cells.filter((c) => c === OPEN).length;
    expect(floor('warrens') / floor('east-gallery')).toBeGreaterThan(0.75);
    expect(floor('warrens') / floor('east-gallery')).toBeLessThan(1.3);
    expect(spec.belts).toEqual([]);
  });

  it('is five caverns in a chain, each a noise-shaped piece of floor on its own until the tunnels join them', () => {
    expect(caverns).toHaveLength(5);
    expect(tunnels.length, 'a tunnel between each pair').toBeGreaterThanOrEqual(4);
    // the caverns alone are five pieces of floor apart from one another, and their boxes do not touch
    caverns.forEach((c, k) => {
      if (k) expect(c.box[0], `cavern ${k} starts east of cavern ${k - 1}`).toBeGreaterThan(caverns[k - 1].box[0]);
    });
    const alone = labelled(caverns);
    expect(alone.count, 'five caverns, five pieces').toBe(5);
    // with the tunnels, the five are one piece of floor
    const joined = labelled([...caverns, ...tunnels]);
    const pieces = new Set(
      caverns.map((c) => {
        const cx = (c.box[0] + c.box[2]) >> 1,
          cy = (c.box[1] + c.box[3]) >> 1;
        return joined.label[cy * cols + cx];
      }),
    );
    expect(pieces.has(0), 'each cavern has floor at its middle').toBe(false);
    expect(pieces.size, 'one piece').toBe(1);
    // the caverns are noise, not ovals and not boxes
    for (const c of caverns) expect(c.fill).toBeGreaterThan(0.3);
    expect(new Set(caverns.map((c) => c.seed)).size, 'each has its own seed').toBe(5);
  });

  it('winds: each tunnel turns at least once on its way', () => {
    for (const t of tunnels) {
      if (t.kind !== 'tunnel') continue;
      expect(t.points.length, 'more than a straight line between two points').toBeGreaterThanOrEqual(3);
    }
  });

  it('is arrived at on the west and left on the east', () => {
    expect(spec.entry.out).toEqual([-1, 0]);
    expect(spec.exit?.out).toEqual([1, 0]);
    const first = caverns[0],
      last = caverns[4];
    expect(spec.entry.tiles[0], 'the way in starts at the west edge').toBeLessThanOrEqual(4);
    expect(spec.exit!.tiles[2], 'the way out ends at the east edge').toBeGreaterThanOrEqual(cols - 5);
    expect(spec.entry.tiles[2], 'and meets the first cavern').toBeGreaterThanOrEqual(first.box[0]);
    expect(spec.exit!.tiles[0], 'the last cavern meets the way out').toBeLessThanOrEqual(last.box[2]);
  });

  it('has a hole in the second cavern and another in the fourth, and nowhere else', () => {
    expect(spec.holes).toHaveLength(2);
    const where = spec.holes.map((h) => {
      const at = tileOf(h.x, h.y);
      return caverns.map((c, k) => (inBox(at, c.box) ? k : -1)).filter((k) => k >= 0);
    });
    expect(where).toEqual([[1], [3]]);
    const [a, b] = spec.holes;
    expect(Math.hypot(a.x - b.x, a.y - b.y), 'a good way apart').toBeGreaterThan(80);
  });

  it('has a side room behind a brick wall off a cavern, and a hidden chamber', () => {
    expect(spec.stashes).toHaveLength(1);
    expect(spec.walls).toHaveLength(1);
    expect(spec.secrets).toHaveLength(1);
    // the corridor to the room starts in a cavern's floor, so the room is off that cavern
    const [, , cx1, cy1] = spec.stashes[0].corridor!;
    expect(
      caverns.some((c) => inBox([cx1, cy1], c.box)),
      'the side room’s corridor leaves a cavern',
    ).toBe(true);
    const [wx, wy] = spec.walls[0].tiles;
    expect(wy, 'and the wall is across it, a way along').toBeLessThan(cy1 - 4);
    expect(wx).toBeGreaterThanOrEqual(spec.stashes[0].corridor![0]);
  });

  it('holds emeralds and sapphires in its heaps, richer than the coins alone, and no rubies', () => {
    const kinds = new Set(spec.heaps.flatMap((h) => h.gems.filter(([, n]) => n > 0).map(([k]) => k)));
    expect([...kinds].sort()).toEqual([2, 3]);
    const gems = spec.heaps.reduce((n, h) => n + h.gems.reduce((m, [, k]) => m + k, 0), 0);
    const other = specOf('east-gallery').heaps.reduce((n, h) => n + h.gems.reduce((m, [, k]) => m + k, 0), 0);
    expect(gems, 'more gems in its heaps than the East Gallery’s').toBeGreaterThan(other);
    expect(spec.heaps.length).toBeGreaterThanOrEqual(3);
  });

  it('keeps its gems, 22 emeralds and 14 sapphires a heap, in heaps lighter in coins than the East Gallery’s, which is what holds it to that cave’s pace', () => {
    for (const h of spec.heaps)
      expect(h.gems.map(([k, n]) => [k, n]).sort(), 'the gems it had, no fewer').toEqual([
        [2, 22],
        [3, 14],
      ]);
    const east = specOf('east-gallery').heaps.map((h) => h.coins);
    // the pace on seeds 1 to 12 was held to the East Gallery's by these coins: more makes a thorough player slower
    for (const h of spec.heaps) expect(h.coins).toBeLessThan(Math.max(...east));
    expect(Math.max(...spec.heaps.map((h) => h.coins))).toBeLessThanOrEqual(480);
  });

  it('is held to a haul of 120 along the floor, and its worst heap is within it', () => {
    expect(HAUL_LIMIT.warrens).toBe(120);
    const field = haulField(warrens);
    const worst = Math.max(
      ...spec.heaps.map((h) => {
        const [tx, ty] = tileOf(h.x, h.y);
        return field[ty * cols + tx];
      }),
    );
    expect(worst).toBeLessThanOrEqual(120);
    expect(worst, 'and far enough that the tunnels matter').toBeGreaterThan(60);
  });

  it('is the same cave every build', () => {
    const again = carveShapes(warrens.grid, spec.shapes);
    // the carve of the shapes alone: the entry, walls and chambers are carved over it afterwards
    const cells = warrens.cells;
    let differ = 0;
    for (let t = 0; t < cells.length; t++) if (again[t] === OPEN && cells[t] !== OPEN) differ++;
    expect(differ, 'floor the shapes carved that the cave lost').toBe(0);
  });

  it('banks what goes down either hole, in the game', () => {
    withSeed(5, () => {
      const game = gameIn('warrens');
      const before = game.economy.bank;
      warrens.holes.forEach((h, k) => {
        expect(game.stock.spawn(1, h.x, h.y, 2), `a ruby over hole ${k}`).toBe(true);
        for (let f = 0; f < 120; f++) game.step(1 / 60, { throttle: 0, steer: 0 });
        expect(game.economy.bank, `after a ruby down hole ${k}`).toBe(before + 10 * (k + 1));
      });
    });
  });
});

describe('the run with the Warrens in it', () => {
  it('lands a save in the West Gallery in the West Gallery, and one in the Warrens in the Warrens', () => {
    expect(newEconomy(saveIn('west-gallery')).cave().id).toBe('west-gallery');
    expect(newEconomy(saveIn('warrens')).cave().id).toBe('warrens');
    expect(newEconomy(saveIn('north-vault')).cave().id).toBe('north-vault');
  });

  it('goes from the North Vault to the Warrens and on to the West Gallery', () => {
    const e = newEconomy(saveIn('north-vault', { open: true }));
    e.moveOn();
    expect(e.cave().id).toBe('warrens');
    e.open();
    e.moveOn();
    expect(e.cave().id).toBe('west-gallery');
    expect(e.isLast()).toBe(true);
  });
});
