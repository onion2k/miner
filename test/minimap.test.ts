import { describe, expect, it } from 'vitest';
import { Camera } from 'artshape-render/gpu/camera';
import { project } from '../src/matrix';
import { BRICK_KIND, BARREL_KIND, KIND_NAME } from '../src/physics';
import { exitPoints, type Cave, type HoleSpec } from '../src/cave';
import {
  FLOOR_LEVEL,
  ROCK_LEVEL,
  cameraFacing,
  floorImage,
  minimapView,
  type MinimapInput,
  type MinimapBodies,
} from '../src/minimap';
import { RUN, caveOf } from './helpers';

const RANGE = 100;
const NO_BODIES: MinimapBodies = {
  count: 0,
  alive: new Uint8Array(0),
  kind: new Uint8Array(0),
  x: new Float32Array(0),
  y: new Float32Array(0),
};

/** A cave of the run with its holes put where the test wants them. */
function withHoles(id: string, at: [number, number][]): Cave {
  const cave = caveOf(id);
  const holes: HoleSpec[] = at.map(([x, y]) => ({ x, y, radius: 5.5, depth: 14 }));
  return { ...cave, holes };
}

/** What a page would hand the map, standing at the origin facing +x, with the map's up along +y unless said. */
function input(cave: Cave, over: Partial<MinimapInput> = {}): MinimapInput {
  return {
    cave,
    open: false,
    dozer: { x: 0, y: 0, yaw: 0 },
    facing: Math.PI / 2,
    bots: [],
    belts: [],
    bodies: NO_BODIES,
    range: RANGE,
    ...over,
  };
}

/** The camera as the game sets it: at `azimuth` round, over the point, looking down at it. */
function cameraAt(azimuth: number, x = 0, y = 0) {
  const polar = 0.62,
    radius = 78;
  const camera = new Camera();
  camera.aspect = 16 / 9;
  camera.fov = 42;
  camera.near = 2;
  camera.far = 700;
  camera.target = [x, y, 1.5];
  camera.position = [
    x + radius * Math.sin(polar) * Math.cos(azimuth),
    y + radius * Math.sin(polar) * Math.sin(azimuth),
    1.5 + radius * Math.cos(polar),
  ];
  camera.update();
  return camera;
}

/** The point `distance` away from (0, 0) whose bearing is `theta`. */
const ray = (theta: number, distance: number): [number, number] => [
  distance * Math.cos(theta),
  distance * Math.sin(theta),
];

/**
 * The bearing from the origin that the camera shows straight up the screen (`up`), or straight to the right of it:
 * found by looking at what the camera draws, not by working out which way it faces.
 */
function bearingOnScreen(camera: Camera, want: 'up' | 'right'): number {
  let best = 0,
    bestScore = Infinity;
  const origin = project(camera.viewProjection, 0, 0, 0)!;
  for (let i = 0; i < 7200; i++) {
    const theta = (i / 7200) * Math.PI * 2;
    const p = project(camera.viewProjection, ...ray(theta, 30), 0);
    if (!p) continue;
    // from where the origin is drawn, straight up the screen for up, and straight along it to the right for right
    const [dx, dy] = [p[0] - origin[0], p[1] - origin[1]];
    const [across, along] = want === 'up' ? [Math.abs(dx), -dy] : [Math.abs(dy), -dx];
    const score = across * 1000 + along;
    if (score < bestScore) {
      bestScore = score;
      best = theta;
    }
  }
  return best;
}

describe('the minimap turns with the camera', () => {
  it('shows a hole straight ahead on the screen straight up the map, after any orbit', () => {
    for (const azimuth of [-Math.PI / 2, 0, 0.7, 1.9, Math.PI, -2.4, 4.4, 9]) {
      const camera = cameraAt(azimuth);
      const ahead = ray(bearingOnScreen(camera, 'up'), 30);
      const view = minimapView(input(withHoles('hollow', [ahead]), { facing: cameraFacing(azimuth) }));
      const [hole] = view.holes;
      expect(hole.rim, `azimuth ${azimuth}`).toBe(false);
      expect(hole.x, `azimuth ${azimuth}: no sideways`).toBeCloseTo(0, 1);
      expect(hole.y, `azimuth ${azimuth}: up is negative`).toBeCloseTo(-30, 1);
    }
  });

  it('puts what is to the right on the screen to the right on the map, so it is a turn and not a mirror', () => {
    for (const azimuth of [-Math.PI / 2, 0.7, 1.9, Math.PI, -2.4]) {
      const camera = cameraAt(azimuth);
      const right = ray(bearingOnScreen(camera, 'right'), 30);
      const view = minimapView(input(withHoles('hollow', [right]), { facing: cameraFacing(azimuth) }));
      expect(view.holes[0].x, `azimuth ${azimuth}`).toBeCloseTo(30, 1);
      expect(view.holes[0].y, `azimuth ${azimuth}`).toBeCloseTo(0, 1);
    }
  });

  it('is measured from the dozer, so the map moves with it', () => {
    const view = minimapView(input(withHoles('hollow', [[40, 50]]), { dozer: { x: 30, y: 20, yaw: 0 } }));
    expect(view.holes[0].x).toBeCloseTo(10);
    expect(view.holes[0].y).toBeCloseTo(-30);
  });

  it('points the dozer along the way it faces, up when it faces where the camera does', () => {
    const faceUp = minimapView(input(withHoles('hollow', [[0, 50]]), { dozer: { x: 0, y: 0, yaw: Math.PI / 2 } }));
    expect(Math.cos(faceUp.dozer.heading)).toBeCloseTo(0);
    expect(Math.sin(faceUp.dozer.heading)).toBeCloseTo(-1);
    const faceRight = minimapView(input(withHoles('hollow', [[0, 50]]), { dozer: { x: 0, y: 0, yaw: 0 } }));
    expect(Math.cos(faceRight.dozer.heading)).toBeCloseTo(1);
    expect(Math.sin(faceRight.dozer.heading)).toBeCloseTo(0);
  });
});

describe('the holes on the map', () => {
  it('shows each hole in the window where it lies', () => {
    const view = minimapView(
      input(
        withHoles('hollow', [
          [20, 30],
          [-60, -10],
          [150, 0],
        ]),
      ),
    );
    // the nearest first, since it is always shown; the one beyond the window not at all
    const places = view.holes.map((h) => [Math.round(h.x), Math.round(h.y)]);
    expect(places).toContainEqual([20, -30]);
    expect(places).toContainEqual([-60, 10]);
    expect(view.holes.filter((h) => h.rim)).toEqual([]);
    expect(view.holes).toHaveLength(2);
  });

  it('puts the only hole on the rim the way it lies when it is outside the window, and never inside', () => {
    for (const [x, y] of [
      [300, 0],
      [0, 250],
      [-180, -90],
      [140, 140],
      [-130, 60],
    ]) {
      const view = minimapView(input(withHoles('hollow', [[x, y]])));
      expect(view.holes, `${x},${y}`).toHaveLength(1);
      const [h] = view.holes;
      expect(h.rim).toBe(true);
      // on the rim of the square: its larger coordinate is the range, and the way it lies is the way it points
      expect(Math.max(Math.abs(h.x), Math.abs(h.y))).toBeCloseTo(RANGE, 5);
      expect(h.x * -y - h.y * x, 'along the line to it').toBeCloseTo(0, 3);
      expect(h.x * x + h.y * -y, 'and not the opposite way').toBeGreaterThan(0);
    }
  });

  it('puts only the nearest hole on the rim in a cave of two, and drops the one that is further', () => {
    const view = minimapView(
      input(
        withHoles('hollow', [
          [400, 0],
          [0, -200],
        ]),
      ),
    );
    expect(view.holes).toHaveLength(1);
    expect(view.holes[0].rim).toBe(true);
    // the nearer is the one to the south, which is down the map
    expect(view.holes[0].x).toBeCloseTo(0, 3);
    expect(view.holes[0].y).toBeCloseTo(RANGE, 3);
    const swapped = minimapView(
      input(
        withHoles('hollow', [
          [0, -200],
          [400, 0],
        ]),
      ),
    );
    expect(swapped.holes[0].y).toBeCloseTo(RANGE, 3);
  });

  it('shows the hole in the window as itself, and one outside it too when it is the nearest of two in a window with both', () => {
    const view = minimapView(
      input(
        withHoles('hollow', [
          [50, 0],
          [0, 60],
        ]),
      ),
    );
    expect(view.holes.map((h) => h.rim)).toEqual([false, false]);
  });

  it('shows every hole of every cave, still, once the game is done', () => {
    for (const spec of RUN) {
      const cave = caveOf(spec.id);
      const h = cave.holes[0];
      const view = minimapView(input(cave, { dozer: { x: h.x + 10, y: h.y, yaw: 0 }, open: true }));
      expect(view.holes.length, spec.id).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('the way out on the map', () => {
  const caves = RUN.filter((c) => c.exit);

  it('is there once it is open, at its mouth, and not while it is shut', () => {
    expect(caves.length).toBeGreaterThan(0);
    for (const spec of caves) {
      const cave = caveOf(spec.id);
      const mouth = exitPoints(cave)!.mouth;
      const near = { x: mouth.x - 20, y: mouth.y, yaw: 0 };
      const shut = minimapView(input(cave, { dozer: near, open: false }));
      expect(shut.exit, `${spec.id} shut`).toBeUndefined();
      const open = minimapView(input(cave, { dozer: near, open: true }));
      expect(open.exit, `${spec.id} open`).toBeDefined();
      expect(open.exit!.rim).toBe(false);
      expect(open.exit!.x).toBeCloseTo(20, 3);
      expect(open.exit!.y).toBeCloseTo(-0, 3);
    }
  });

  it('is on the rim, the way it lies, when it is far off', () => {
    const cave = caveOf('hollow');
    const mouth = exitPoints(cave)!.mouth;
    const view = minimapView(input(cave, { dozer: { x: mouth.x - 300, y: mouth.y, yaw: 0 }, open: true }));
    expect(view.exit!.rim).toBe(true);
    expect(Math.max(Math.abs(view.exit!.x), Math.abs(view.exit!.y))).toBeCloseTo(RANGE, 5);
    expect(view.exit!.x, 'to the right of it, since the way out is east').toBeGreaterThan(0);
    expect(view.exit!.y).toBeCloseTo(0, 3);
  });

  it('is none in the last cave, which has no way out, open or not', () => {
    const last = caveOf(RUN[RUN.length - 1].id);
    expect(last.spec.exit).toBeNull();
    expect(minimapView(input(last, { open: true })).exit).toBeUndefined();
  });
});

describe('the floor image', () => {
  const grey = (cave: Cave, ...args: Parameters<Cave['solid']>) => floorImage(cave, cave.solid(...args));
  const differ = (a: Uint8Array, b: Uint8Array) => {
    const at: number[] = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) at.push(i);
    return at;
  };

  it('is a tile a pixel, floor pale and rock dark', () => {
    const cave = caveOf('hollow');
    const image = grey(cave, false);
    expect([image.width, image.height]).toEqual([cave.grid.cols, cave.grid.rows]);
    expect(image.data).toHaveLength(cave.grid.cols * cave.grid.rows);
    const solid = cave.solid(false);
    for (let i = 0; i < solid.length; i++) {
      if (cave.cells[i] === 1) expect(image.data[i]).toBe(FLOOR_LEVEL);
      if (cave.cells[i] === 0) expect(image.data[i]).toBe(ROCK_LEVEL);
    }
  });

  it('changes when a brick wall comes down, in the tiles of the wall and nowhere else', () => {
    const cave = caveOf('south-gallery');
    const before = grey(cave, false, [false], [false]);
    const after = grey(cave, false, [false], [true]);
    const changed = differ(before.data, after.data);
    expect(changed.length).toBeGreaterThan(0);
    const [x0, y0, x1, y1] = cave.spec.walls[0].tiles;
    for (const i of changed) {
      const tx = i % cave.grid.cols,
        ty = Math.floor(i / cave.grid.cols);
      expect(tx >= x0 && tx <= x1 && ty >= y0 && ty <= y1, `tile ${tx},${ty} is in the wall`).toBe(true);
      expect(after.data[i]).toBe(FLOOR_LEVEL);
    }
    // a wall that stands is not the rock around it
    expect(before.data[changed[0]]).not.toBe(ROCK_LEVEL);
    expect(before.data[changed[0]]).not.toBe(FLOOR_LEVEL);
  });

  it('changes when a hidden chamber is broken into, and not before', () => {
    const cave = caveOf('south-gallery');
    const hidden = grey(cave, false, [false], [false]);
    const found = grey(cave, false, [true], [false]);
    const changed = differ(hidden.data, found.data);
    expect(changed.length).toBeGreaterThan(0);
    for (const i of changed) {
      expect(hidden.data[i], 'rock while it is hidden').toBe(ROCK_LEVEL);
      expect(found.data[i], 'floor once it is found').toBe(FLOOR_LEVEL);
    }
  });

  it('changes when the way out opens, and leaves it as rock while it is shut', () => {
    for (const spec of RUN.filter((c) => c.exit)) {
      const cave = caveOf(spec.id);
      const shut = grey(cave, false);
      const open = grey(cave, true);
      const changed = differ(shut.data, open.data);
      expect(changed.length, spec.id).toBeGreaterThan(0);
      for (const i of changed) {
        expect(shut.data[i]).toBe(ROCK_LEVEL);
        expect(open.data[i]).toBe(FLOOR_LEVEL);
      }
    }
  });
});

describe('what is left to bank', () => {
  const kind = (name: string) => KIND_NAME.indexOf(name);
  const bodies = (list: [number, number, number][], alive = list.map(() => 1)): MinimapBodies => ({
    count: list.length,
    alive: Uint8Array.from(alive),
    kind: Uint8Array.from(list.map((b) => b[0])),
    x: Float32Array.from(list.map((b) => b[1])),
    y: Float32Array.from(list.map((b) => b[2])),
  });
  const cave = caveOf('hollow');

  it('falls as specks where coins and gems lie, turned with the map', () => {
    const list: [number, number, number][] = [
      [kind('coin'), 20, 20],
      [kind('ruby'), -40, 10],
      [kind('gold bar'), 0, -30],
    ];
    const view = minimapView(input(cave, { bodies: bodies(list) }));
    expect(view.specks).toHaveLength(3);
    // each speck within a bucket of where its body is, which is up the map where +y is
    const near = (x: number, y: number) => view.specks.some((s) => Math.hypot(s.x - x, s.y - y) < RANGE / 16);
    expect(near(20, -20)).toBe(true);
    expect(near(-40, -10)).toBe(true);
    expect(near(0, 30)).toBe(true);
  });

  it('is none for bricks and barrels, nor for what has gone, nor what lies beyond the window', () => {
    const list: [number, number, number][] = [
      [BRICK_KIND, 10, 10],
      [BARREL_KIND, -10, 10],
      [kind('coin'), 5, 5],
      [kind('coin'), 500, 5],
    ];
    const view = minimapView(input(cave, { bodies: bodies(list, [1, 1, 0, 1]) }));
    expect(view.specks).toEqual([]);
  });

  it('is none for what the scoop holds, which is with the machine and not lying in the cave', () => {
    const list: [number, number, number][] = [
      [kind('coin'), 20, 20],
      [kind('ruby'), -40, 10],
    ];
    const held = { ...bodies(list), carried: Uint8Array.from([0, 1]) };
    const view = minimapView(input(cave, { bodies: held }));
    expect(view.specks).toHaveLength(1);
    expect(view.specks[0].x).toBeGreaterThan(0);
  });

  it('is bucketed into the map pixels, so a heap of thousands is a few specks', () => {
    const list: [number, number, number][] = [];
    for (let i = 0; i < 4000; i++) list.push([0, 10 + (i % 20) * 0.1, 10 + Math.floor(i / 20) * 0.01]);
    const view = minimapView(input(cave, { bodies: bodies(list) }));
    expect(view.specks.length).toBeGreaterThan(0);
    expect(view.specks.length).toBeLessThan(8);
    // and the most there can ever be is what fits the window
    const wide: [number, number, number][] = [];
    for (let i = 0; i < 20000; i++) wide.push([0, ((i * 7919) % 400) - 200, ((i * 104729) % 400) - 200]);
    expect(minimapView(input(cave, { bodies: bodies(wide) })).specks.length).toBeLessThanOrEqual(64 * 64);
  });
});

describe('the drones and the belts', () => {
  const cave = caveOf('east-gallery');

  it('puts a drone in the window as a dot where it is, and none outside', () => {
    const view = minimapView(
      input(cave, {
        bots: [
          { x: 10, y: 20 },
          { x: 400, y: 0 },
        ],
      }),
    );
    expect(view.bots).toHaveLength(1);
    expect(view.bots[0].x).toBeCloseTo(10);
    expect(view.bots[0].y).toBeCloseTo(-20);
  });

  it('draws the belts that run as lines, turned, and none that are not given', () => {
    expect(minimapView(input(cave)).belts).toEqual([]);
    const view = minimapView(input(cave, { belts: [{ x0: 0, y0: 10, x1: 30, y1: 10, width: 4, speed: 3 }] }));
    expect(view.belts).toHaveLength(1);
    const [belt] = view.belts;
    expect([belt.x0, belt.y0, belt.x1, belt.y1].map((v) => Math.round(v * 1000) / 1000 + 0)).toEqual([0, -10, 30, -10]);
  });
});
