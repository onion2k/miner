/**
 * The cave to look at: the rock and the floor as one broken surface, and the
 * stones lying about on it.
 *
 * The tiles are still what everything collides with and finds its way round;
 * this is only the picture of them. A height is taken at SUB points to a tile
 * side: nothing at all where a point touches open floor, bar a little
 * unevenness, and rising steeply into the rock with how far the point is from
 * the nearest open tile, to a ragged top. The foot of every cliff is on a
 * tile's edge, so the picture and what the dozer runs into agree. The points
 * are nudged off the grid and each square split along a diagonal chosen at
 * random, so no line of the grid shows, and every triangle is flat-shaded.
 *
 * There are no colours per vertex, only per placement, so the surface is cut
 * into groups each drawn in one colour: by room, since a room not open is
 * drawn dark; by floor or rock; and by a shade, the rock's by how steep the
 * face is, which is what reads as rock in a light from the side.
 *
 * All of it hangs on the tiles and which chambers have been broken into, so
 * it is built again only when one is.
 */
import { COLS, HOLE, ORIGIN_X, ORIGIN_Y, ROWS, TILE, areaAt, hash, rockish, tileCentre, type Cave } from './cave';
import type { Mesh } from 'artshape-render/mesh/types';
import { fbm, noise } from './noise';

/** Height samples to a tile side. */
const SUB = 4;
const STEP = TILE / SUB;
/** How far into the rock, in world units, the surface is drawn in detail; past that it is a plain plateau. */
const REACH = TILE * 3;
/** How far a jutting corner of rock is rounded back. */
const ROUND = 1.8;
/** The half-width of the square the hole's collar covers. */
const COLLAR = TILE * 1.5;
/** Shades of each: floor, and rock by steepness (steep and dark, steep, and the tops). */
export const TONES = 3;
/** More rooms than there will ever be, for packing a room and a palette into one key. */
const AREAS_MAX = 16;
/** How thick the beds of rock are, about. */
const STRATA = 1.7;

/** The height of the floor at a point: a shallow unevenness below zero, level round the hole. */
export function floorHeight(x: number, y: number): number {
  const rim = Math.max(Math.abs(x - HOLE.x), Math.abs(y - HOLE.y));
  const level = Math.min(1, Math.max(0, (rim - COLLAR) / 6));
  return -(noise(x * 0.3, y * 0.3, 41) * 0.12 + noise(x * 1.1, y * 1.1, 43) * 0.05) * level;
}

/**
 * How the rock is shaped at a point, as shares of the cave's own: how ragged
 * its faces, how deep its ledges, how much it lies in beds rather than
 * slopes, and how tall it stands.
 */
export interface RockShape {
  rough: number;
  ledge: number;
  /** 0 a smooth slope, 1 hard shelves; the cave's own is about half. */
  beds: number;
  top: number;
}

/** The cave's own rock. */
export const PLAIN_ROCK: RockShape = { rough: 1, ledge: 1, beds: 0.55, top: 1 };

/** The height of the rock at a point `d` in from the nearest open floor, shaped as `shape` says. */
export function rockHeight(x: number, y: number, d: number, shape: RockShape = PLAIN_ROCK): number {
  const top = (4 + fbm(x, y, 11) * 6.5) * shape.top;
  // up from the foot over about a tile, to a ragged top
  const rise = 1 - Math.exp(-d / 1.9);
  const ledge = (noise(x * 0.22, y * 0.22, 17) - 0.5) * 2 * Math.min(1, d / 2) * shape.ledge;
  const rough = (noise(x * 0.9, y * 0.9, 19) - 0.5) * 1.2 * Math.min(1, d / 1.5) * shape.rough;
  const raw = top * rise + ledge + rough;
  // in beds, as rock is: shelves a strata apart, blended back so they are not stairs, as much as the shape says
  const bed = STRATA + (noise(x * 0.07, y * 0.07, 21) - 0.5) * 0.6;
  const q = raw / bed,
    f = q - Math.floor(q);
  const stepped = (Math.floor(q) + f * f * f * (f * (f * 6 - 15) + 10)) * bed;
  return Math.max(0.4, raw * (1 - shape.beds) + stepped * shape.beds);
}

/**
 * What the cave looks like where, handed in by whoever knows: which palette
 * a patch of rock or floor is drawn from, what shade within it, and how the
 * rock is shaped. Left out, it is the cave's own everywhere.
 */
export interface TerrainStyle {
  /** The palette the ground at (x, y) is drawn from; 0 is the cave's own. */
  palette(x: number, y: number): number;
  /** Its shade within that palette, told the shade the cave would give it. */
  tone(palette: number, x: number, y: number, rock: boolean, tone: number): number;
  shape(x: number, y: number): RockShape;
}

export interface SurfaceGroup {
  area: number;
  rock: boolean;
  tone: number;
  palette: number;
  mesh: Mesh;
}

export interface Stone {
  x: number;
  y: number;
  z: number;
  yaw: number;
  tilt: number;
  size: [number, number, number];
  /** Which of the stone meshes. */
  shape: number;
  /** The floor's colour or the rock's, and how light, 0 to 1. */
  rock: boolean;
  shade: number;
  /** The room it is drawn with: the one whose floor it is on or beside. */
  area: number;
}

export interface Spire {
  x: number;
  y: number;
  z: number;
  radius: number;
  height: number;
  tilt: number;
  yaw: number;
  shade: number;
  area: number;
}

/**
 * The sample points the surface is made from, for placing things on it: `gx`
 * across, row by row. `depth` is how far each is into the rock, 0 on the
 * floor and Infinity past where the rock is drawn in detail; `area` is the
 * room of the floor it stands on or beside, 255 for none.
 */
export interface Samples {
  gx: number;
  gy: number;
  step: number;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  depth: Float32Array;
  area: Uint8Array;
}

export interface Terrain {
  groups: SurfaceGroup[];
  stones: Stone[];
  spires: Spire[];
  samples: Samples;
}

/**
 * How far each sample point is into the rock: 0 on or beside open floor,
 * Infinity past REACH; and the open tile nearest it, -1 with none.
 */
function depths(cave: Cave, revealed: boolean[]): [Float32Array, Int32Array] {
  const GX = COLS * SUB + 1,
    GY = ROWS * SUB + 1;
  const out = new Float32Array(GX * GY),
    nearest = new Int32Array(GX * GY);
  const mask = new Uint8Array(COLS * ROWS);
  for (let t = 0; t < mask.length; t++) mask[t] = rockish(cave.cells[t], revealed) ? 0 : 1;
  const open = (tx: number, ty: number) => tx >= 0 && ty >= 0 && tx < COLS && ty < ROWS && mask[ty * COLS + tx] === 1;
  const span = Math.ceil(REACH / TILE) + 1;
  // which tiles have an open tile within `span` of them, so the rest of the rock is passed over at once
  const near = new Uint8Array(COLS * ROWS);
  for (let ty = 0; ty < ROWS; ty++) {
    for (let tx = 0; tx < COLS; tx++) {
      if (!open(tx, ty)) continue;
      for (let oy = Math.max(0, ty - span); oy <= Math.min(ROWS - 1, ty + span); oy++) {
        near.fill(1, oy * COLS + Math.max(0, tx - span), oy * COLS + Math.min(COLS - 1, tx + span) + 1);
      }
    }
  }
  for (let j = 0; j < GY; j++) {
    for (let i = 0; i < GX; i++) {
      const px = i * STEP,
        py = j * STEP; // from the grid's corner
      const tx = Math.floor(i / SUB),
        ty = Math.floor(j / SUB);
      let best = Infinity,
        tile = -1;
      if (!near[Math.min(ROWS - 1, ty) * COLS + Math.min(COLS - 1, tx)]) {
        out[j * GX + i] = Infinity;
        nearest[j * GX + i] = -1;
        continue;
      }
      for (let ny = Math.max(0, ty - span); ny <= Math.min(ROWS - 1, ty + span); ny++) {
        const dy = Math.max(0, ny * TILE - py, py - (ny + 1) * TILE);
        for (let nx = Math.max(0, tx - span); nx <= Math.min(COLS - 1, tx + span); nx++) {
          if (!mask[ny * COLS + nx]) continue;
          const dx = Math.max(0, nx * TILE - px, px - (nx + 1) * TILE);
          const d = dx * dx + dy * dy;
          if (d < best) {
            best = d;
            tile = ny * COLS + nx;
          }
        }
      }
      best = Math.sqrt(best);
      out[j * GX + i] = best <= REACH ? best : Infinity;
      nearest[j * GX + i] = best <= REACH ? tile : -1;
    }
  }
  // The rock's corners rounded off: how far a point is into the rock with it worn back by ROUND and
  // built out again, which is the same along a straight face and less at a corner jutting out. Only
  // ever less, so there is never rock drawn where the dozer can drive, only a little floor drawn in
  // a corner it cannot reach anyway.
  const worn = new Float32Array(out);
  const cells = Math.ceil(ROUND / STEP) + 1;
  for (let j = 0; j < GY; j++) {
    for (let i = 0; i < GX; i++) {
      const e = out[j * GX + i];
      if (!(e > 0 && e < ROUND)) continue;
      let g = Infinity;
      for (let v = Math.max(0, j - cells); v <= Math.min(GY - 1, j + cells); v++) {
        for (let u = Math.max(0, i - cells); u <= Math.min(GX - 1, i + cells); u++) {
          if (out[v * GX + u] < ROUND) continue;
          const dd = (u - i) * (u - i) + (v - j) * (v - j);
          if (dd < g) g = dd;
        }
      }
      worn[j * GX + i] = Math.max(0, ROUND - Math.sqrt(g) * STEP);
    }
  }
  return [worn, nearest];
}

/** One group's triangles, as flat-shaded vertices, grown as they come. */
class Builder {
  pos = new Float32Array(9 * 1024);
  nrm = new Float32Array(9 * 1024);
  n = 0;
  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number) {
    if (this.n * 3 === this.pos.length) {
      const pos = new Float32Array(this.pos.length * 2),
        nrm = new Float32Array(this.pos.length * 2);
      pos.set(this.pos);
      nrm.set(this.nrm);
      this.pos = pos;
      this.nrm = nrm;
    }
    const o = this.n++ * 3;
    this.pos[o] = x;
    this.pos[o + 1] = y;
    this.pos[o + 2] = z;
    this.nrm[o] = nx;
    this.nrm[o + 1] = ny;
    this.nrm[o + 2] = nz;
  }
  build(): Mesh {
    const indices = new Uint32Array(this.n);
    for (let i = 0; i < this.n; i++) indices[i] = i;
    return {
      positions: this.pos.slice(0, this.n * 3),
      normals: this.nrm.slice(0, this.n * 3),
      uvs: new Float32Array(this.n * 2),
      indices,
    };
  }
}

export function buildTerrain(cave: Cave, revealed: boolean[], style?: TerrainStyle): Terrain {
  const shapeAt = (x: number, y: number) => (style ? style.shape(x, y) : PLAIN_ROCK);
  const GX = COLS * SUB + 1,
    GY = ROWS * SUB + 1;
  const [depth, nearest] = depths(cave, revealed);
  // Every sample point, where it is: nudged off the grid, and at its height. Past REACH the rock is a
  // plain plateau, a quad a tile, and a point there lies straight between its tile's corners, so the
  // plateau and the finer rock beside it meet without a crack.
  const px = new Float32Array(GX * GY),
    py = new Float32Array(GX * GY),
    pz = new Float32Array(GX * GY);
  const corners = new Float32Array((COLS + 1) * (ROWS + 1));
  for (let ty = 0; ty <= ROWS; ty++) {
    for (let tx = 0; tx <= COLS; tx++) {
      const x = ORIGIN_X + tx * TILE,
        y = ORIGIN_Y + ty * TILE;
      corners[ty * (COLS + 1) + tx] = rockHeight(x, y, REACH, shapeAt(x, y));
    }
  }
  const corner = (tx: number, ty: number) => corners[ty * (COLS + 1) + tx];
  for (let j = 0; j < GY; j++) {
    for (let i = 0; i < GX; i++) {
      const k = j * GX + i,
        d = depth[k];
      if (!Number.isFinite(d)) {
        const tx = Math.min(COLS - 1, Math.floor(i / SUB)),
          ty = Math.min(ROWS - 1, Math.floor(j / SUB));
        const fx = i / SUB - tx,
          fy = j / SUB - ty;
        const h0 = corner(tx, ty) + (corner(tx + 1, ty) - corner(tx, ty)) * fx;
        const h1 = corner(tx, ty + 1) + (corner(tx + 1, ty + 1) - corner(tx, ty + 1)) * fx;
        px[k] = ORIGIN_X + i * STEP;
        py[k] = ORIGIN_Y + j * STEP;
        pz[k] = h0 + (h1 - h0) * fy;
        continue;
      }
      const nudge = STEP * 0.32;
      const x = ORIGIN_X + i * STEP + (hash(i, j, 1) - 0.5) * nudge;
      const y = ORIGIN_Y + j * STEP + (hash(i, j, 2) - 0.5) * nudge;
      px[k] = x;
      py[k] = y;
      pz[k] = d === 0 ? floorHeight(x, y) : rockHeight(x, y, d, shapeAt(x, y));
    }
  }

  // the room each tile is drawn with
  const tileArea = new Uint8Array(COLS * ROWS);
  for (let t = 0; t < tileArea.length; t++) tileArea[t] = areaAt(...tileCentre(t % COLS, (t / COLS) | 0));
  const builders = new Map<number, Builder>();
  const PALETTES = 8;
  const key = (area: number, rock: boolean, tone: number, palette = 0) =>
    ((palette * AREAS_MAX + area) * 2 + (rock ? 1 : 0)) * TONES + tone;
  const emit = (a: number, b: number, c: number) => {
    const ux = px[b] - px[a],
      uy = py[b] - py[a],
      uz = pz[b] - pz[a];
    const vx = px[c] - px[a],
      vy = py[c] - py[a],
      vz = pz[c] - pz[a];
    let nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    // facing up, whichever way round the corners came
    if (nz < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const cx = (px[a] + px[b] + px[c]) / 3,
      cy = (py[a] + py[b] + py[c]) / 3,
      cz = (pz[a] + pz[b] + pz[c]) / 3;
    const rock = cz > 0.3;
    // the hole's collar is the floor there
    if (!rock && Math.abs(cx - HOLE.x) < COLLAR && Math.abs(cy - HOLE.y) < COLLAR) return;
    const salt = hash(Math.round(cx * 7), Math.round(cy * 7), 23);
    const plain = rock
      ? nz > 0.72
        ? 2
        : salt < 0.45
          ? 0
          : 1
      : Math.min(TONES - 1, Math.floor(noise(cx * 0.09, cy * 0.09, 29) * 2.6 + salt * 0.4));
    const palette = style ? Math.min(PALETTES - 1, style.palette(cx, cy)) : 0;
    const tone = style && palette ? style.tone(palette, cx, cy, rock, plain) : plain;
    // Rock is the room whose floor it stands over, so the wall of an open room is not drawn dark
    // for being nearer the next; floor is the room of the tile it is on.
    let t = -1;
    if (rock) t = nearest[a] >= 0 ? nearest[a] : nearest[b] >= 0 ? nearest[b] : nearest[c];
    if (t < 0) t = Math.floor((cy - ORIGIN_Y) / TILE) * COLS + Math.floor((cx - ORIGIN_X) / TILE);
    const area = t >= 0 && t < tileArea.length ? tileArea[t] : 0;
    const k = key(area, rock, tone, palette);
    let bld = builders.get(k);
    if (!bld) builders.set(k, (bld = new Builder()));
    bld.vertex(px[a], py[a], pz[a], nx, ny, nz);
    bld.vertex(px[b], py[b], pz[b], nx, ny, nz);
    bld.vertex(px[c], py[c], pz[c], nx, ny, nz);
  };
  for (let ty = 0; ty < ROWS; ty++) {
    for (let tx = 0; tx < COLS; tx++) {
      let fine = false;
      for (let j = ty * SUB; j <= (ty + 1) * SUB && !fine; j++) {
        for (let i = tx * SUB; i <= (tx + 1) * SUB; i++)
          if (Number.isFinite(depth[j * GX + i])) {
            fine = true;
            break;
          }
      }
      if (!fine) {
        const a = ty * SUB * GX + tx * SUB,
          b = a + SUB,
          c = a + SUB * GX + SUB,
          d = a + SUB * GX;
        emit(a, b, c);
        emit(a, c, d);
        continue;
      }
      for (let j = ty * SUB; j < (ty + 1) * SUB; j++) {
        for (let i = tx * SUB; i < (tx + 1) * SUB; i++) {
          const a = j * GX + i,
            b = a + 1,
            c = a + GX + 1,
            d = a + GX;
          if (hash(i, j, 5) < 0.5) {
            emit(a, b, c);
            emit(a, c, d);
          } else {
            emit(a, b, d);
            emit(b, c, d);
          }
        }
      }
    }
  }
  const groups: SurfaceGroup[] = [];
  for (const [k, bld] of builders) {
    const tone = k % TONES,
      rest = (k - tone) / TONES,
      areaPalette = rest >> 1;
    groups.push({
      area: areaPalette % AREAS_MAX,
      palette: Math.floor(areaPalette / AREAS_MAX),
      rock: (rest & 1) === 1,
      tone,
      mesh: bld.build(),
    });
  }
  groups.sort((p, q) => key(p.area, p.rock, p.tone, p.palette) - key(q.area, q.rock, q.tone, q.palette));

  // the stones: boulders fallen at the foot of the rock, a few on its tops, grit about the floor
  const areaOf = (p: number) => tileArea[nearest[p]];
  const stones: Stone[] = [];
  const spires: Spire[] = [];
  for (let j = 0; j < GY; j++) {
    for (let i = 0; i < GX; i++) {
      const k = j * GX + i,
        d = depth[k];
      if (!Number.isFinite(d)) continue;
      const x = px[k] + (hash(i, j, 61) - 0.5) * STEP,
        y = py[k] + (hash(i, j, 62) - 0.5) * STEP;
      const r = hash(i, j, 63),
        yaw = hash(i, j, 64) * Math.PI * 2,
        shape = Math.floor(hash(i, j, 65) * 3);
      if (d > 0 && d < 1.8 && (i + j) % 2 === 0 && r < 0.3) {
        // a boulder against the foot of the rock, bulging out over the floor no more than a little
        const size = Math.min(0.5 + hash(i, j, 66) * 1.5, d + 0.8);
        stones.push({
          x,
          y,
          z: -size * 0.25,
          yaw,
          tilt: (hash(i, j, 67) - 0.5) * 0.6,
          size: [size, size * (0.7 + hash(i, j, 68) * 0.5), size * (0.6 + hash(i, j, 69) * 0.4)],
          shape,
          rock: true,
          shade: hash(i, j, 70),
          area: areaOf(k),
        });
      } else if (d > 3 && r < 0.025) {
        const size = 0.8 + hash(i, j, 66) * 1.4;
        stones.push({
          x,
          y,
          z: rockHeight(x, y, d, shapeAt(x, y)) - size * 0.3,
          yaw,
          tilt: 0.3,
          size: [size, size * 0.8, size * 0.7],
          shape,
          rock: true,
          shade: hash(i, j, 70),
          area: areaOf(k),
        });
      } else if (d > 2 && d < 8 && r > 0.988) {
        const radius = 0.3 + hash(i, j, 71) * 0.45;
        spires.push({
          x,
          y,
          z: rockHeight(x, y, d, shapeAt(x, y)) - 0.4,
          radius,
          height: radius * (2.5 + hash(i, j, 72) * 3),
          tilt: (hash(i, j, 73) - 0.5) * 0.3,
          yaw,
          shade: hash(i, j, 74),
          area: areaOf(k),
        });
      } else if (d === 0) {
        // grit on the floor, thicker near the rock
        const edge = Math.min(depthToRock(cave, revealed, x, y), 8);
        if (r < 0.1 + (8 - edge) * 0.03 && Math.max(Math.abs(x - HOLE.x), Math.abs(y - HOLE.y)) > COLLAR + 1) {
          const size = 0.1 + hash(i, j, 66) ** 2 * (edge < 3 ? 0.6 : 0.3);
          stones.push({
            x,
            y,
            z: floorHeight(x, y) - size * 0.2,
            yaw,
            tilt: (hash(i, j, 67) - 0.5) * 0.8,
            size: [size, size * (0.6 + hash(i, j, 68) * 0.6), size * 0.6],
            shape,
            rock: hash(i, j, 75) < 0.4,
            shade: hash(i, j, 70),
            area: areaOf(k),
          });
        }
      }
    }
  }
  const sampleArea = new Uint8Array(GX * GY).fill(255);
  for (let k = 0; k < sampleArea.length; k++) if (nearest[k] >= 0) sampleArea[k] = tileArea[nearest[k]];
  return {
    groups,
    stones,
    spires,
    samples: { gx: GX, gy: GY, step: STEP, x: px, y: py, z: pz, depth, area: sampleArea },
  };
}

/** How far a floor point is from the nearest rock, up to two tiles; further counts as two tiles. */
function depthToRock(cave: Cave, revealed: boolean[], x: number, y: number): number {
  const tx = Math.floor((x - ORIGIN_X) / TILE),
    ty = Math.floor((y - ORIGIN_Y) / TILE);
  let best = TILE * 2;
  for (let oy = -2; oy <= 2; oy++) {
    for (let ox = -2; ox <= 2; ox++) {
      const nx = tx + ox,
        ny = ty + oy;
      const rock = nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS || rockish(cave.cells[ny * COLS + nx], revealed);
      if (!rock) continue;
      const x0 = ORIGIN_X + nx * TILE,
        y0 = ORIGIN_Y + ny * TILE;
      const d = Math.hypot(Math.max(0, x0 - x, x - x0 - TILE), Math.max(0, y0 - y, y - y0 - TILE));
      if (d < best) best = d;
    }
  }
  return best;
}
