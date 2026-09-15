/**
 * The brick walls as bricks: how each is laid, which bricks hold its
 * treasure, how it looks for the beating it has taken, and how it comes
 * apart when it falls.
 *
 * All of it follows from a wall's tiles, grade and treasure in `cave.ts`,
 * and from nothing else: the same wall is always the same bricks.
 */
import { BAR } from './physics';
import { ORIGIN_X, ORIGIN_Y, STASHES, TILE, WALLS, hash, tileCentre, wallAlongX, type Stash } from './cave';

/** A brick in a wall: how long along the wall, how deep, how tall; and how many courses a wall stands. */
export const BRICK_SIZE = [1.9, 1.75, 1.05] as const;
export const COURSES = 4;

export interface Brick {
  x: number;
  y: number;
  /** The middle of the brick, up. */
  z: number;
  yaw: number;
  length: number;
}

/**
 * The bricks of a wall as it stands: courses of them, two deep across the
 * corridor, each course set half a brick along from the one below, with a
 * part brick at each end where the bond leaves one. Along the wall's own
 * length, which is X or Y as the wall runs.
 */
export function layBricks(w: number): Brick[] {
  const [x0, y0, x1, y1] = WALLS[w].tiles;
  const alongX = wallAlongX(w);
  const start = alongX ? ORIGIN_X + x0 * TILE : ORIGIN_Y + y0 * TILE;
  const span = ((alongX ? x1 - x0 : y1 - y0) + 1) * TILE;
  const across = alongX ? ORIGIN_Y + (y0 + 0.5) * TILE : ORIGIN_X + (x0 + 0.5) * TILE;
  const out: Brick[] = [];
  const [L, D, H] = BRICK_SIZE;
  for (let c = 0; c < COURSES; c++) {
    for (const side of [-1, 1]) {
      const offset = ((c + (side > 0 ? 1 : 0)) % 2) * (L / 2);
      for (let edge = -offset; edge < span; edge += L) {
        const a = Math.max(0, edge),
          b = Math.min(span, edge + L);
        if (b - a < 0.5) continue;
        const along = start + (a + b) / 2,
          off = across + side * (D / 2 + 0.05);
        out.push({
          x: alongX ? along : off,
          y: alongX ? off : along,
          z: H * (c + 0.5),
          yaw: alongX ? 0 : Math.PI / 2,
          length: b - a - 0.08,
        });
      }
    }
  }
  return out;
}

/**
 * Which of a wall's bricks hold its treasure, and what: a gold bar is a gold
 * brick, a gem is set in the top of one. Always the same bricks for the same
 * wall, and from the top course, where they show from above.
 */
export function treasureBricks(w: number): { brick: number; kind: number }[] {
  const bricks = layBricks(w),
    items = WALLS[w].treasure.flatMap(([kind, n]) => new Array<number>(n).fill(kind));
  const high = bricks
    .map((b, i) => [b, i] as const)
    .filter(([b]) => b.z > BRICK_SIZE[2] * (COURSES - 1))
    .map(([, i]) => i);
  const taken = new Set<number>(),
    out: { brick: number; kind: number }[] = [];
  items.forEach((kind, n) => {
    let pick = high[Math.floor(hash(w, n, 11) * high.length)];
    for (let tries = 0; taken.has(pick) && tries < high.length; tries++)
      pick = high[(high.indexOf(pick) + 1) % high.length];
    taken.add(pick);
    out.push({ brick: pick, kind });
  });
  return out;
}

/** A brick wall's tiles, as world centres. */
export function wallTiles(w: number): [number, number][] {
  const [x0, y0, x1, y1] = WALLS[w].tiles,
    out: [number, number][] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push(tileCentre(x, y));
  return out;
}

/** The side room a wall stands in front of, if it stands in front of one. */
export function stashBehind(w: number): Stash | undefined {
  const [x0, y0, x1, y1] = WALLS[w].tiles;
  return STASHES.find(
    (st) => st.area === WALLS[w].area && Math.hypot((x0 + x1) / 2 - st.at[0], (y0 + y1) / 2 - st.at[1]) < 12,
  );
}

/** A brick of a wall still standing, as it is to be drawn. */
export interface StandingBrick extends Brick {
  tilt: number;
  /** How light it is against its grade's colour: each brick a shade off the next, and darker for a beating. */
  shade: number;
  /** A gold brick, or a gem set in its top; undefined for a plain one. */
  treasure?: number;
}

/**
 * A wall that has taken a beating shows it: its bricks knocked askew and
 * darker, the more the worse. `hurt` is how much of what it stands it has
 * taken, 0 to 1.
 */
export function standingBricks(w: number, hurt: number): StandingBrick[] {
  const gold = new Map(treasureBricks(w).map((t) => [t.brick, t.kind]));
  return layBricks(w).map((b, i) => {
    const j = (salt: number) => hash(w * 131 + i, salt, 5) - 0.5;
    return {
      x: b.x + j(1) * hurt * 0.9,
      y: b.y + j(2) * hurt * 0.9,
      z: b.z,
      yaw: b.yaw + j(3) * hurt * 0.5,
      length: b.length,
      tilt: j(4) * hurt * 0.3,
      // the shade is taken from where the brick was laid, so it does not change as the brick is knocked about
      shade: (0.82 + hash(b.x * 3, b.y * 3, b.z * 7) * 0.3) * (1 - hurt * 0.35),
      treasure: gold.get(i),
    };
  });
}

/** A piece of a wall coming down: a brick, or treasure that was set in one, and how it flies. */
export interface Loose {
  /** Treasure's kind, or undefined for a brick. */
  treasure?: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** A brick's tumble. */
  spin: [number, number, number];
}

/**
 * A wall knocked down from where the dozer stands and the way it faces:
 * every brick comes loose, those in the middle of the hit hardest and the
 * top courses furthest, on the way the dozer was driving. What was set in a
 * brick comes loose with it: a gold brick is a gold bar in its place, a gem
 * sits a little above its brick. Each course starts a ball's height above
 * the one below, or the balls would start inside each other and burst apart.
 */
export function looseBricks(
  w: number,
  from: { x: number; y: number; yaw: number },
  ballRadius: number,
  random: () => number = Math.random,
): Loose[] {
  const c = Math.cos(from.yaw),
    s = Math.sin(from.yaw);
  const gold = new Map(treasureBricks(w).map((t) => [t.brick, t.kind]));
  const out: Loose[] = [];
  layBricks(w).forEach((b, n) => {
    const near = Math.max(0, 1 - Math.hypot(b.x - from.x, b.y - from.y) / 16);
    const push = 3 + near * 9 + (b.z / (COURSES * BRICK_SIZE[2])) * 4;
    const course = Math.round(b.z / BRICK_SIZE[2] - 0.5);
    const z = ballRadius + 0.05 + course * (ballRadius * 2 + 0.05);
    const vx = c * push + (random() - 0.5) * 3,
      vy = s * push + (random() - 0.5) * 3,
      vz = 2 + random() * 5;
    const kind = gold.get(n);
    if (kind !== undefined)
      out.push({
        treasure: kind,
        x: b.x,
        y: b.y,
        z: z + (kind === BAR ? 0 : 1.2),
        vx,
        vy,
        vz: vz + 1,
        spin: [0, 0, 0],
      });
    if (kind === BAR) return;
    out.push({
      x: b.x,
      y: b.y,
      z,
      vx,
      vy,
      vz,
      spin: [(random() - 0.5) * 10, (random() - 0.5) * 10, (random() - 0.5) * 6],
    });
  });
  return out;
}
