/**
 * Each cave of the run drawn as a top-down map, a PNG a cave, for looking at
 * a cave against its sketch before anything is built on it.
 *
 *   npm run caves:map -- <folder>              every cave, to <folder>/<id>.png
 *   npm run caves:map -- <folder> hollow east-gallery     just those
 *
 * North is up. Rock is dark, floor pale; the way in is tinted blue and the
 * way out red, with a line across it where going past leaves the cave; holes
 * are black rings, heaps gold discs as big as they spread, belts green,
 * brick walls orange, hidden chambers purple, lamps white dots, barrels
 * brown, the vein magenta and the cracks cyan. No image library: the PNG is
 * written here, from the tiles, with zlib from Node.
 *
 * It also says, for each cave, how far each heap is to push against the
 * cave's haul limit, which is what the checker holds it to.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { BRICK, EXIT, LEAVING_SHORT, OPEN, SECRET, TILE, buildCave, arrival, type Cave } from '../src/cave';
import { RUN } from '../src/caves';
import { HAUL_LIMIT, haulField, haulOf } from './hauls';

// ---- a PNG, from pixels ----

const CRC = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** An 8-bit RGB PNG of `width` by `height` pixels, three bytes each, top row first. */
export function png(width: number, height: number, rgb: Uint8Array): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits a channel
  header[9] = 2; // truecolour
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    rows[y * (width * 3 + 1)] = 0; // no filter
    rows.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

// ---- a cave, from tiles ----

type Rgb = [number, number, number];
const ROCK_COLOUR: Rgb = [38, 38, 46],
  FLOOR: Rgb = [206, 196, 166],
  WAY_IN: Rgb = [150, 185, 230],
  WAY_OUT: Rgb = [196, 84, 84],
  BRICK_COLOURS: Rgb[] = [
    [0, 0, 0],
    [214, 122, 52],
    [140, 150, 170],
    [70, 76, 92],
  ],
  CHAMBER: Rgb = [116, 66, 158],
  CHAMBER_FACE: Rgb = [170, 120, 210];

/** The cave as a picture, `scale` pixels a tile, and the lines to say of it. */
export function drawCave(cave: Cave, scale = 7): { width: number; height: number; rgb: Uint8Array; notes: string[] } {
  const { cols, rows, originX, originY } = cave.grid;
  const { spec } = cave;
  const width = cols * scale,
    height = rows * scale;
  const rgb = new Uint8Array(width * height * 3);
  // world to pixel, north up
  const px = (x: number) => ((x - originX) / TILE) * scale;
  const py = (y: number) => height - ((y - originY) / TILE) * scale;
  const set = (x: number, y: number, c: Rgb, alpha = 1) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 3;
    for (let k = 0; k < 3; k++) rgb[i + k] = Math.round(rgb[i + k] * (1 - alpha) + c[k] * alpha);
  };
  const disc = (x: number, y: number, r: number, c: Rgb, alpha = 1) => {
    for (let dy = -Math.ceil(r); dy <= r; dy++)
      for (let dx = -Math.ceil(r); dx <= r; dx++) if (dx * dx + dy * dy <= r * r) set(px(x) + dx, py(y) + dy, c, alpha);
  };
  const ring = (x: number, y: number, r: number, c: Rgb) => {
    for (let a = 0; a < 6.3; a += 0.03) set(px(x) + Math.cos(a) * r, py(y) + Math.sin(a) * r, c);
  };
  const line = (x0: number, y0: number, x1: number, y1: number, c: Rgb, thick = 1, alpha = 1) => {
    const n = Math.ceil(Math.hypot(px(x1) - px(x0), py(y1) - py(y0)));
    for (let s = 0; s <= n; s++) {
      const x = px(x0) + ((px(x1) - px(x0)) * s) / n,
        y = py(y0) + ((py(y1) - py(y0)) * s) / n;
      for (let dy = -thick; dy <= thick; dy++) for (let dx = -thick; dx <= thick; dx++) set(x + dx, y + dy, c, alpha);
    }
  };

  // the tiles
  const inBox = (t: number, tiles: [number, number, number, number]) => {
    const tx = t % cols,
      ty = (t / cols) | 0;
    return tx >= tiles[0] && tx <= tiles[2] && ty >= tiles[1] && ty <= tiles[3];
  };
  for (let t = 0; t < cols * rows; t++) {
    const tx = t % cols,
      ty = (t / cols) | 0;
    const c = cave.cells[t];
    let colour: Rgb = ROCK_COLOUR;
    if (c === OPEN) colour = inBox(t, spec.entry.tiles) ? WAY_IN : FLOOR;
    else if (c === EXIT) colour = WAY_OUT;
    else if (c >= BRICK) colour = BRICK_COLOURS[spec.walls[c - BRICK].grade];
    else if (c >= SECRET) {
      const [w0x, w0y, w1x, w1y] = spec.secrets[c - SECRET].wall;
      colour = tx >= w0x && tx <= w1x && ty >= w0y && ty <= w1y ? CHAMBER_FACE : CHAMBER;
    }
    const y0 = height - (ty + 1) * scale;
    for (let dy = 0; dy < scale; dy++)
      // a faint line along each tile's top and left edge, so distances can be counted in tiles
      for (let dx = 0; dx < scale; dx++)
        set(tx * scale + dx, y0 + dy, colour.map((k) => (dx && dy ? k : k * 0.9)) as Rgb);
  }

  // the belts, holes, heaps, vein and cracks, and the lamps and barrels
  for (const { spec: b } of spec.belts)
    line(b.x0, b.y0, b.x1, b.y1, [40, 150, 70], Math.max(1, Math.round((b.width / TILE) * scale * 0.5)), 0.85);
  for (const l of cave.lamps) disc(l.x, l.y, 1.5, [255, 255, 255]);
  for (const b of cave.barrels) disc(b.x, b.y, 3, [120, 70, 30]);
  spec.heaps.forEach((h) => disc(h.x, h.y, (Math.sqrt(h.coins) * 0.36 + 1.5) * (scale / TILE), [230, 180, 30], 0.85));
  for (const h of spec.holes) {
    disc(h.x, h.y, h.radius * (scale / TILE), [0, 0, 0]);
    ring(h.x, h.y, h.radius * (scale / TILE) + 1, [255, 255, 255]);
  }
  disc(spec.vein.x, spec.vein.y, 3, [220, 40, 200]);
  for (const [x, y] of spec.cracks) {
    line(x - 3, y - 3, x + 3, y + 3, [40, 210, 220]);
    line(x - 3, y + 3, x + 3, y - 3, [40, 210, 220]);
  }
  // where the machine arrives, and the line across the way out that leaves the cave
  const at = arrival(cave);
  disc(at.x, at.y, 3.5, [30, 90, 230]);
  if (spec.exit) {
    const [x0, y0, x1, y1] = spec.exit.tiles;
    const [ox, oy] = spec.exit.out;
    const bx0 = originX + x0 * TILE,
      by0 = originY + y0 * TILE,
      bx1 = originX + (x1 + 1) * TILE,
      by1 = originY + (y1 + 1) * TILE;
    if (ox) {
      const x = (ox > 0 ? bx1 : bx0) - ox * LEAVING_SHORT;
      line(x, by0, x, by1, [255, 255, 255], 0);
    } else {
      const y = (oy > 0 ? by1 : by0) - oy * LEAVING_SHORT;
      line(bx0, y, bx1, y, [255, 255, 255], 0);
    }
  }

  // what to say of it
  const field = haulField(cave);
  const limit = HAUL_LIMIT[spec.id];
  const notes = [`${spec.id}: ${cols} x ${rows} tiles, ${spec.biome ?? 'plain'}, haul limit ${limit}`];
  spec.heaps.forEach((h, k) => {
    const haul = haulOf(cave, field, k);
    const straight = Math.hypot(h.x - spec.holes[0].x, h.y - spec.holes[0].y);
    notes.push(
      `  heap ${k} at ${h.x},${h.y}: ${haul.toFixed(0)} along the floor, ${straight.toFixed(0)} straight${haul > limit ? '  OVER' : ''}`,
    );
  });
  return { width, height, rgb, notes };
}

function main() {
  const [folder, ...ids] = process.argv.slice(2);
  if (!folder) {
    console.error('usage: npm run caves:map -- <folder> [cave ids]');
    process.exit(1);
  }
  mkdirSync(folder, { recursive: true });
  for (const spec of RUN) {
    if (ids.length && !ids.includes(spec.id)) continue;
    const { width, height, rgb, notes } = drawCave(buildCave(spec));
    writeFileSync(`${folder}/${spec.id}.png`, png(width, height, rgb));
    for (const line of notes) console.log(line);
    console.log(`  written ${folder}/${spec.id}.png (${width} x ${height})`);
  }
}

// run only when called from the command line, so the tests can use the writer
if (process.argv[1]?.includes('cave-map')) main();
