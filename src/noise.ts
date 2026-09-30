/**
 * The hash, and smooth noise made from it, for anything that wants a pattern
 * that wanders rather than jumps: the rock's height, the floor's shades, the
 * patches a biome creeps in by, and the shape of a cavern and the wander of a
 * tunnel. It stands on its own so that the carving can use it and the cave
 * need not be imported back by it.
 */

/** A small deterministic hash in 0..1, for the jitter on rocks. */
export function hash(a: number, b: number, c = 0): number {
  let h = (a * 374761393 + b * 668265263 + c * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A smooth noise in [0, 1], from the hash at the corners of a unit square. */
export function noise(x: number, y: number, salt: number): number {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy;
  const u = fx * fx * (3 - 2 * fx),
    v = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, salt),
    b = hash(ix + 1, iy, salt),
    c = hash(ix, iy + 1, salt),
    d = hash(ix + 1, iy + 1, salt);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Three octaves of it, coarse to fine, still in [0, 1]. */
export function fbm(x: number, y: number, salt: number): number {
  return (
    noise(x * 0.045, y * 0.045, salt) * 0.55 +
    noise(x * 0.12, y * 0.12, salt + 1) * 0.3 +
    noise(x * 0.33, y * 0.33, salt + 2) * 0.15
  );
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
