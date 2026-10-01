/**
 * How far every heap is to push: along the floor, to the nearest hole, in
 * world units. A cave is laid out so no heap is further than its haul limit,
 * whatever belt might carry it; the caves' checker in
 * `test/caves.test.ts` and the maps `cave-map.ts` draws both read it from here,
 * so what the map shows is what the checker holds the cave to.
 */
import { TILE, type Cave } from '../src/cave';

/**
 * How far a heap may be from the nearest hole, along the floor, in each cave of the run: about one and a
 * half times what it was in the old cave, which is what the user agreed the caves would be scaled to.
 */
export const HAUL_LIMIT: Record<string, number> = {
  hollow: 45,
  'south-gallery': 80,
  'east-gallery': 160,
  'north-vault': 80,
  warrens: 120,
  'west-gallery': 160,
  deep: 160,
};

/**
 * How far along the floor each tile is from the nearest hole, in world units, with every wall down and
 * the way out open; Infinity where the dozer cannot get. A plain Dijkstra over the tiles, eight ways,
 * never cutting a corner through rock: the drones' own field (`Nav.toHole`) prices a tile beside the
 * rock higher than one in the open, which says which way to go but not how far it is.
 */
export function haulField(cave: Cave): Float64Array {
  const { cols, rows, originX, originY } = cave.grid;
  const solid = cave.solid(
    true,
    cave.spec.secrets.map(() => false),
    cave.spec.walls.map(() => true),
  );
  const dist = new Float64Array(cols * rows).fill(Infinity);
  const queue: [number, number][] = [];
  for (const h of cave.holes) {
    const t = Math.floor((h.y - originY) / TILE) * cols + Math.floor((h.x - originX) / TILE);
    dist[t] = 0;
    queue.push([0, t]);
  }
  while (queue.length) {
    // the nearest first; a few thousand tiles, so a sorted list is plenty
    queue.sort((a, b) => b[0] - a[0]);
    const [d, t] = queue.pop()!;
    if (d > dist[t]) continue;
    const tx = t % cols,
      ty = (t / cols) | 0;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        const nx = tx + ox,
          ny = ty + oy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || solid[ny * cols + nx]) continue;
        if (ox && oy && (solid[ty * cols + nx] || solid[ny * cols + tx])) continue;
        const nd = d + (ox && oy ? Math.SQRT2 : 1) * TILE;
        if (nd < dist[ny * cols + nx]) {
          dist[ny * cols + nx] = nd;
          queue.push([nd, ny * cols + nx]);
        }
      }
    }
  }
  return dist;
}

/** The haul to a heap: how far along the floor it is from the nearest hole. */
export function haulOf(cave: Cave, field: Float64Array, k: number): number {
  const { cols, originX, originY } = cave.grid;
  const h = cave.spec.heaps[k];
  return field[Math.floor((h.y - originY) / TILE) * cols + Math.floor((h.x - originX) / TILE)];
}
