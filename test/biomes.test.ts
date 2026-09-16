import { describe, expect, it } from 'vitest';
import { AREAS, COLS, HOLE, HOLLOW, ROWS, TILE, WINGS, buildCave, rockish, tileCentre } from '../src/cave';
import { BIOMES, BIOME_STYLE, biomeAt, decorate, groundTone, lampColour, LAMP_COLOUR, tint } from '../src/biomes';
import { FLOOR_TONES, ROCK_TONES } from '../src/palette';
import { FOOT_TONE, PLAIN_ROCK, buildTerrain } from '../src/terrain';

const cave = buildCave();
const hidden = [false, false, false, false];
const terrain = buildTerrain(cave, hidden, BIOME_STYLE);
const decor = decorate(terrain.samples);
/** The middle of a wing's room, in world units. */
const roomMiddle = (a: number): [number, number] => {
  const { dir, room } = WINGS[a];
  const along = room.along * TILE,
    across = room.across * TILE;
  return dir[0] ? [dir[0] * along, across] : [across, dir[1] * along];
};

describe('the biomes', () => {
  it('give every gallery its own, and leave the hollow as it was', () => {
    expect(BIOMES[0]).toBeNull();
    expect(new Set(BIOMES.slice(1).map((b) => b?.name))).toEqual(new Set(['jungle', 'ice', 'lava', 'future']));
    expect(BIOMES.slice(1).every((b) => b !== null)).toBe(true);
    expect(AREAS.map((a, k) => (k ? `${a.name}:${BIOMES[k]!.name}` : a.name))).toEqual([
      AREAS[0].name,
      `${AREAS[1].name}:jungle`,
      `${AREAS[2].name}:ice`,
      `${AREAS[3].name}:lava`,
      `${AREAS[4].name}:future`,
    ]);
  });

  it('are nothing anywhere in the hollow or its walls, and whole in the middle of each room', () => {
    // the hollow's ellipse and a tile of rock round it
    for (let ty = 0; ty < ROWS; ty++) {
      for (let tx = 0; tx < COLS; tx++) {
        const [x, y] = tileCentre(tx, ty);
        const inside = (x / ((HOLLOW.rx + 1) * TILE)) ** 2 + (y / ((HOLLOW.ry + 1) * TILE)) ** 2 < 1;
        if (inside) expect(biomeAt(x, y).weight, `${x},${y}`).toBe(0);
      }
    }
    for (let a = 1; a < AREAS.length; a++) expect(biomeAt(...roomMiddle(a))).toEqual({ area: a, weight: 1 });
  });

  it('come in gradually down each corridor, never all at once', () => {
    for (let a = 1; a < AREAS.length; a++) {
      const { dir, mouth, room } = WINGS[a];
      let last = 0,
        biggestStep = 0;
      for (let along = mouth * TILE; along <= room.along * TILE; along += 1) {
        const x = dir[0] ? dir[0] * along : 0,
          y = dir[0] ? room.across * TILE : dir[1] * along;
        const { weight } = biomeAt(x, y);
        biggestStep = Math.max(biggestStep, weight - last);
        expect(weight).toBeGreaterThanOrEqual(last - 1e-9);
        last = weight;
      }
      expect(last).toBe(1);
      expect(biggestStep, `${AREAS[a].name} ramps`).toBeLessThan(0.25);
    }
  });

  it('draw the hollow in the cave’s own palette and shape, and each room in its biome’s', () => {
    // the hollow's floor is its own; only the backs of its walls, out toward a room, take on the room's biome
    for (const g of terrain.groups) if (!g.rock && g.area === 0) expect(g.palette, 'biome floor in the hollow').toBe(0);
    for (let a = 1; a < AREAS.length; a++) expect(terrain.groups.some((g) => g.palette === a)).toBe(true);
    expect(BIOME_STYLE.shape(0, -14)).toBe(PLAIN_ROCK);
    expect(BIOME_STYLE.palette(0, -14)).toBe(0);
    expect(groundTone(0, true, 1)).toEqual(ROCK_TONES[1]);
    expect(groundTone(0, false, 2)).toEqual(FLOOR_TONES[2]);
    expect(groundTone(3, false, 0)).toEqual(BIOMES[3]!.floor[0]);
  });

  it('shape the hollow’s ground exactly as it was without them', () => {
    const plain = buildTerrain(cave, hidden);
    const { samples: a } = plain,
      { samples: b } = terrain;
    for (let k = 0; k < a.z.length; k++) {
      // past where the rock is drawn in detail it is a plateau between tile corners, which may be in a biome
      if (!Number.isFinite(a.depth[k]) || biomeAt(a.x[k], a.y[k]).weight > 0) continue;
      if (a.z[k] !== b.z[k]) expect.fail(`height at ${a.x[k]},${a.y[k]}: ${a.z[k]} became ${b.z[k]}`);
    }
  });

  it('colour lamps and stones by how strong the biome is, and not at all in the hollow', () => {
    expect(lampColour(0, -14)).toEqual(LAMP_COLOUR);
    const lava = BIOMES[3]!;
    const middle = lampColour(...roomMiddle(3));
    lava.lamp.forEach((c, i) => expect(middle[i]).toBeCloseTo(c * lava.lampBright, 9));
    const base: [number, number, number] = [1, 1, 1];
    expect(tint(base, 0, -14, (b) => b.stone.rock)).toBe(base);
  });

  it('put its decoration in the rooms, the same every time, and nothing tall where the dozer drives', () => {
    const again = decorate(terrain.samples);
    expect(again).toEqual(decor);
    const kinds = new Set(decor.props.map((p) => p.kind));
    for (const kind of ['crystal', 'fern', 'pool', 'neon', 'column', 'crate', 'trunk', 'cap'] as const)
      expect(kinds.has(kind), kind).toBe(true);
    const solid = cave.solid(
      AREAS.map(() => true),
      hidden,
    );
    const toRock = (x: number, y: number) => {
      const tx = Math.floor((x + (COLS / 2 + 0.5) * TILE) / TILE),
        ty = Math.floor((y + (ROWS / 2 + 0.5) * TILE) / TILE);
      let best = Infinity;
      for (let oy = -2; oy <= 2; oy++) {
        for (let ox = -2; ox <= 2; ox++) {
          const nx = tx + ox,
            ny = ty + oy;
          const rock = nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS || rockish(cave.cells[ny * COLS + nx], hidden);
          if (!rock) continue;
          const [cx, cy] = tileCentre(nx, ny);
          best = Math.min(
            best,
            Math.hypot(Math.max(0, Math.abs(x - cx) - TILE / 2), Math.max(0, Math.abs(y - cy) - TILE / 2)),
          );
        }
      }
      return best;
    };
    for (const p of decor.props) {
      expect(biomeAt(p.x, p.y).weight, `${p.kind} outside the biomes`).toBeGreaterThan(0);
      // what stands up off the floor stands on the rock, or at its very foot
      const tall = p.z + p.size[2] > 0.9 && !['snow', 'tuft', 'seep', 'pool'].includes(p.kind);
      if (tall && toRock(p.x, p.y) > 0.8)
        expect.fail(`${p.kind} at ${p.x.toFixed(1)},${p.y.toFixed(1)} stands on the floor`);
    }
    expect(solid.length).toBe(COLS * ROWS);
    expect(Math.hypot(HOLE.x, HOLE.y)).toBe(0);
  });

  it('shed a skirt each of their own, and the future room none, only a gutter along its panels', () => {
    // how much the rock sheds: whole in the galleries that are rock, nothing in the future's, none in the hollow's own
    expect(BIOME_STYLE.scree(...roomMiddle(1))).toBeGreaterThan(0.9);
    expect(BIOME_STYLE.scree(...roomMiddle(3))).toBeGreaterThan(0.9);
    expect(BIOME_STYLE.scree(...roomMiddle(4))).toBe(0);
    expect(BIOME_STYLE.scree(0, -14)).toBe(1);
    // and so no scree lies about in the future room, where the jungle is thick with it
    const grit = (area: number) => terrain.stones.filter((s) => s.area === area && s.size[0] < 0.7).length;
    expect(grit(4)).toBeLessThan(grit(1) / 4);
    // every biome has a foot tone of its own for its floor, darker than its open floor; the future's is its gutter
    for (const b of BIOMES) {
      if (!b) continue;
      expect(b.floor.length).toBe(FOOT_TONE + 1);
      const sum = (t: readonly number[]) => t[0] + t[1] + t[2];
      expect(sum(b.floor[FOOT_TONE])).toBeLessThan(sum(b.floor[1]));
    }
    expect(groundTone(0, false, FOOT_TONE)).toEqual(FLOOR_TONES[FOOT_TONE]);
    // the future's floor keeps its panels and seams, and its foot is the gutter
    expect(BIOME_STYLE.tone(4, ...roomMiddle(4), false, FOOT_TONE)).toBe(FOOT_TONE);
    expect(BIOME_STYLE.tone(4, ...roomMiddle(4), false, 0)).toBeLessThan(FOOT_TONE);
  });

  it('light their features only in their own rooms', () => {
    const byBiome = new Map<string, number>();
    for (const l of decor.lights) {
      const { area } = biomeAt(l.x, l.y);
      expect(BIOMES[area]!.name, `${l.biome} light at ${l.x.toFixed(0)},${l.y.toFixed(0)}`).toBe(l.biome);
      expect(l.area).not.toBe(0);
      byBiome.set(l.biome, (byBiome.get(l.biome) ?? 0) + 1);
    }
    for (const name of ['jungle', 'ice', 'lava', 'future']) expect(byBiome.get(name), name).toBeGreaterThan(3);
  });
});
