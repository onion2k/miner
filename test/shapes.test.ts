/**
 * The shapes a cave is carved from: the tunnel and the cavern, which make the
 * Warrens, and the rule that every shape carves only inside its own box, which
 * leaves every cave that was carved before exactly as it was. Without the
 * hashes below, a loop bounded a tile too tight would shave the edge off a
 * cave nobody is looking at and nothing else would notice.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { OPEN, ROCK, buildCave, carveShapes, gridOf, shapeBox, type Shape } from '../src/cave';
import { RUN } from '../src/caves';

/** A grid of `cols` by `rows` tiles carved from `shapes`. */
function carve(cols: number, rows: number, shapes: Shape[]): Uint8Array {
  return carveShapes(gridOf({ cols, rows }), shapes);
}

/** The open tiles, as indices. */
const openTiles = (cells: Uint8Array) => [...cells.keys()].filter((t) => cells[t] === OPEN);

/** The sizes of the pieces of floor, four ways joined, biggest first. */
function pieces(cells: Uint8Array, cols: number): number[] {
  const seen = new Uint8Array(cells.length);
  const sizes: number[] = [];
  for (const start of openTiles(cells)) {
    if (seen[start]) continue;
    let size = 0;
    const stack = [start];
    while (stack.length) {
      const t = stack.pop()!;
      if (seen[t] || cells[t] !== OPEN) continue;
      seen[t] = 1;
      size++;
      const tx = t % cols;
      if (tx > 0) stack.push(t - 1);
      if (tx < cols - 1) stack.push(t + 1);
      if (t >= cols) stack.push(t - cols);
      if (t + cols < cells.length) stack.push(t + cols);
    }
    sizes.push(size);
  }
  return sizes.sort((a, b) => b - a);
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Whether every open tile is inside the box, inclusive. */
function insideBox(cells: Uint8Array, cols: number, [x0, y0, x1, y1]: [number, number, number, number]): boolean {
  return openTiles(cells).every((t) => {
    const tx = t % cols,
      ty = (t / cols) | 0;
    return tx >= x0 && tx <= x1 && ty >= y0 && ty <= y1;
  });
}

// ---- criterion 1: the tunnel ----

describe('a tunnel', () => {
  const COLS = 80,
    ROWS = 44;
  const points: [number, number][] = [
    [8, 30],
    [26, 12],
    [48, 26],
    [70, 10],
  ];
  const tunnel = (seed: number, width = 4, extra: Partial<Shape> = {}): Shape =>
    ({ kind: 'tunnel', points, width, seed, ...extra }) as Shape;
  /** The length of the path through the points, in tiles. */
  const length = points.slice(1).reduce((n, [x, y], k) => n + Math.hypot(x - points[k][0], y - points[k][1]), 0);

  it('carves one connected path, through every point it was given', () => {
    const cells = carve(COLS, ROWS, [tunnel(3)]);
    const sizes = pieces(cells, COLS);
    expect(sizes, 'one piece of floor').toHaveLength(1);
    for (const [x, y] of points) expect(cells[y * COLS + x], `floor at ${x},${y}`).toBe(OPEN);
  });

  it('is about as wide as it was asked to be, whatever the width', () => {
    for (const width of [3, 4, 6, 9]) {
      const cells = carve(COLS, ROWS, [tunnel(5, width)]);
      const across = openTiles(cells).length / length;
      expect(across, `width ${width} carved ${across.toFixed(1)} across`).toBeGreaterThan(width * 0.75);
      expect(across, `width ${width} carved ${across.toFixed(1)} across`).toBeLessThan(width * 1.45);
      expect(pieces(cells, COLS), `width ${width} in one piece`).toHaveLength(1);
    }
  });

  it('wobbles in width along its length, from the seed, without ever closing up', () => {
    // a straight run, so that any change in how many tiles are open across it is the width's and not a bend's
    for (let seed = 1; seed <= 8; seed++) {
      const cells = carve(COLS, ROWS, [
        {
          kind: 'tunnel',
          points: [
            [10, 22],
            [30, 22],
            [50, 22],
          ],
          width: 10,
          seed,
        },
      ]);
      const across: number[] = [];
      for (let tx = 14; tx < 46; tx++) {
        let n = 0;
        for (let ty = 0; ty < ROWS; ty++) if (cells[ty * COLS + tx] === OPEN) n++;
        across.push(n);
      }
      expect(
        Math.max(...across) - Math.min(...across),
        `seed ${seed}: not one width all the way`,
      ).toBeGreaterThanOrEqual(2);
      expect(Math.min(...across), `seed ${seed}: never pinched`).toBeGreaterThanOrEqual(7);
    }
  });

  it('goes through each point it was given, centred on it, however much it wanders between them', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const cells = carve(COLS, ROWS, [
        {
          kind: 'tunnel',
          points: [
            [10, 22],
            [30, 22],
            [50, 22],
          ],
          width: 10,
          seed,
        },
      ]);
      let above = 0,
        below = 0;
      for (let ty = 0; ty < ROWS; ty++) {
        if (cells[ty * COLS + 30] !== OPEN) continue;
        if (ty > 22) above++;
        else if (ty < 22) below++;
      }
      expect(
        Math.abs(above - below),
        `seed ${seed}: ${above} tiles above the point and ${below} below`,
      ).toBeLessThanOrEqual(1);
    }
  });

  it('is the same every build from the same seed, and another from another seed', () => {
    const a = carve(COLS, ROWS, [tunnel(3)]);
    expect(same(a, carve(COLS, ROWS, [tunnel(3)]))).toBe(true);
    const b = carve(COLS, ROWS, [tunnel(4)]);
    expect(same(a, b), 'a different seed is a different tunnel').toBe(false);
    // and both are still the same width of tunnel: only the wobble moved
    expect(Math.abs(openTiles(a).length - openTiles(b).length) / openTiles(a).length).toBeLessThan(0.25);
  });

  it('carves only inside its box, which is the box round its points and its width, and never the edge', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const shape = tunnel(seed, 6);
      const cells = carve(COLS, ROWS, [shape]);
      const box = shapeBox(shape, gridOf({ cols: COLS, rows: ROWS }));
      expect(insideBox(cells, COLS, box), `seed ${seed} outside ${box.join(',')}`).toBe(true);
      // the box is the points and the width, not the grid
      expect(box[0]).toBeLessThanOrEqual(points[0][0] - 3);
      expect(box[2]).toBeGreaterThanOrEqual(points[3][0] + 3);
      expect(box[2] - box[0], 'about as long as the points are').toBeLessThan(points[3][0] - points[0][0] + 16);
      for (let tx = 0; tx < COLS; tx++) {
        expect(cells[tx]).toBe(ROCK);
        expect(cells[(ROWS - 1) * COLS + tx]).toBe(ROCK);
      }
    }
  });

  it('puts rock back when it is rock, and takes nothing from floor it does not cross', () => {
    const floor: Shape = { kind: 'rect', tiles: [2, 2, COLS - 3, ROWS - 3] };
    const cells = carve(COLS, ROWS, [floor, tunnel(3, 4, { rock: true })]);
    const rock = cells.filter((c) => c === ROCK).length;
    expect(rock, 'a tunnel of rock across the floor').toBeGreaterThan(length * 3);
    expect(cells[(ROWS - 3) * COLS + 3], 'floor away from it').toBe(OPEN);
  });
});

// ---- criterion 2: the cavern ----

describe('a cavern', () => {
  const COLS = 70,
    ROWS = 50;
  const box: [number, number, number, number] = [12, 8, 50, 40];
  const area = (box[2] - box[0] + 1) * (box[3] - box[1] + 1);
  const cavern = (seed: number, fill: number, extra: Partial<Shape> = {}): Shape =>
    ({ kind: 'cavern', box, seed, fill, ...extra }) as Shape;

  it('carves one connected piece of about `fill` of its box', () => {
    for (const fill of [0.35, 0.5, 0.65, 0.8]) {
      for (const seed of [1, 2, 3, 4]) {
        const cells = carve(COLS, ROWS, [cavern(seed, fill)]);
        const sizes = pieces(cells, COLS);
        expect(sizes, `fill ${fill}, seed ${seed}: pockets left open`).toHaveLength(1);
        expect(sizes[0] / area, `fill ${fill}, seed ${seed}`).toBeGreaterThan(fill - 0.08);
        expect(sizes[0] / area, `fill ${fill}, seed ${seed}`).toBeLessThan(fill + 0.08);
      }
    }
  });

  it('is shaped by the seed: the same every build, another from another seed', () => {
    const a = carve(COLS, ROWS, [cavern(3, 0.6)]);
    expect(same(a, carve(COLS, ROWS, [cavern(3, 0.6)]))).toBe(true);
    const b = carve(COLS, ROWS, [cavern(4, 0.6)]);
    expect(same(a, b)).toBe(false);
    // not a box and not an oval: the edge of the floor is ragged
    const rows = new Set<number>();
    for (let ty = box[1]; ty <= box[3]; ty++) {
      let n = 0;
      for (let tx = box[0]; tx <= box[2]; tx++) if (a[ty * COLS + tx] === OPEN) n++;
      rows.add(n);
    }
    expect(rows.size, 'rows of different lengths').toBeGreaterThan(8);
  });

  it('carves nothing outside its box, and never the rim of the grid, even when full', () => {
    for (const fill of [0.3, 0.7, 1]) {
      const shape = cavern(9, fill);
      const cells = carve(COLS, ROWS, [shape]);
      expect(insideBox(cells, COLS, box), `fill ${fill}`).toBe(true);
      expect(shapeBox(shape, gridOf({ cols: COLS, rows: ROWS }))).toEqual(box);
    }
    const edge = carve(COLS, ROWS, [{ kind: 'cavern', box: [0, 0, COLS - 1, ROWS - 1], seed: 2, fill: 1 }]);
    for (let tx = 0; tx < COLS; tx++) {
      expect(edge[tx]).toBe(ROCK);
      expect(edge[(ROWS - 1) * COLS + tx]).toBe(ROCK);
    }
    for (let ty = 0; ty < ROWS; ty++) {
      expect(edge[ty * COLS]).toBe(ROCK);
      expect(edge[ty * COLS + COLS - 1]).toBe(ROCK);
    }
  });

  it('leaves as rock any pocket that is not joined to the biggest, so a thin fill is still one piece', () => {
    for (let seed = 1; seed <= 20; seed++)
      expect(pieces(carve(COLS, ROWS, [cavern(seed, 0.45)]), COLS), `seed ${seed}`).toHaveLength(1);
  });

  it('puts rock back when it is rock', () => {
    const floor: Shape = { kind: 'rect', tiles: [2, 2, COLS - 3, ROWS - 3] };
    const cells = carve(COLS, ROWS, [floor, cavern(3, 0.5, { rock: true })]);
    const rock = cells.filter((c) => c === ROCK).length;
    const outside = COLS * ROWS - (COLS - 4) * (ROWS - 4);
    expect((rock - outside) / area).toBeGreaterThan(0.4);
    expect((rock - outside) / area).toBeLessThan(0.6);
  });
});

// ---- criterion 3: no cave carved before is changed ----

/**
 * The cells of each cave of the run as they were carved before the shapes were bounded to their boxes,
 * hashed. A cave added since is not here: only what was carved before is held.
 */
const CELLS_BEFORE: Record<string, string> = {
  hollow: '7c142686b16de9fc',
  'south-gallery': '2b12d4b4f9738c63',
  'east-gallery': 'c240265e0c7d89f4',
  'north-vault': '8f6ce00cc32d4d23',
  'west-gallery': '3ca1ae87a98ce30e',
};

describe('every cave carved before the shapes were bounded', () => {
  for (const [id, hash] of Object.entries(CELLS_BEFORE)) {
    it(`${id} has the very same cells`, () => {
      const spec = RUN.find((c) => c.id === id)!;
      const cells = buildCave(spec).cells;
      expect(createHash('sha256').update(cells).digest('hex').slice(0, 16)).toBe(hash);
    });
  }
});

describe('an ellipse carved in its box', () => {
  it('is the same as carved over the whole grid, at any size, place and seed', () => {
    // the reference: the test of the carving as it was, over every tile of the grid
    const reference = (cols: number, rows: number, cx: number, cy: number, rx: number, ry: number, seed: number) => {
      const cells = new Uint8Array(cols * rows);
      for (let ty = 1; ty < rows - 1; ty++)
        for (let tx = 1; tx < cols - 1; tx++) {
          const dx = (tx - cx) / rx,
            dy = (ty - cy) / ry;
          const th = Math.atan2(dy, dx);
          const w = 1 + 0.09 * Math.sin(3 * th + seed) + 0.06 * Math.sin(7 * th + seed * 2.3);
          if (dx * dx + dy * dy < w * w) cells[ty * cols + tx] = OPEN;
        }
      return cells;
    };
    for (let k = 0; k < 60; k++) {
      const h = (n: number) => Math.abs(Math.sin(k * 12.9898 + n * 78.233) * 43758.5453) % 1;
      const cols = 40 + Math.floor(h(1) * 60),
        rows = 30 + Math.floor(h(2) * 40);
      const cx = -10 + h(3) * (cols + 20),
        cy = -10 + h(4) * (rows + 20),
        rx = 0.5 + h(5) * 30,
        ry = 0.5 + h(6) * 20,
        seed = h(7) * 6.3;
      const shape: Shape = { kind: 'ellipse', cx, cy, rx, ry, seed };
      expect(
        same(carveShapes(gridOf({ cols, rows }), [shape]), reference(cols, rows, cx, cy, rx, ry, seed)),
        `case ${k}`,
      ).toBe(true);
    }
  });
});

// ---- criterion 6: the bounding is what makes a big cave quick to build ----

describe('the work a shape costs', () => {
  it('is its box and not the grid: a small shape in the 4x cave visits a sliver of it', () => {
    const grid = gridOf({ cols: 224, rows: 120 });
    const small: Shape[] = [
      { kind: 'ellipse', cx: 30, cy: 20, rx: 8, ry: 5, seed: 1 },
      {
        kind: 'tunnel',
        points: [
          [100, 60],
          [130, 70],
        ],
        width: 4,
        seed: 2,
      },
      { kind: 'cavern', box: [150, 40, 175, 70], seed: 3, fill: 0.6 },
      { kind: 'rect', tiles: [10, 10, 20, 14] },
    ];
    for (const s of small) {
      const [x0, y0, x1, y1] = shapeBox(s, grid);
      expect(((x1 - x0 + 1) * (y1 - y0 + 1)) / (224 * 120), `${s.kind}'s box`).toBeLessThan(0.06);
    }
    // and the wobbly ellipse's box holds the wobble: 15% past its radius, at the most
    const [x0, , x1] = shapeBox(small[0], grid);
    expect(x0).toBeLessThanOrEqual(30 - 8 * 1.15);
    expect(x1).toBeGreaterThanOrEqual(30 + 8 * 1.15);
  });
});
