import { describe, expect, it } from 'vitest';
import { TILE, nearCutting, rockish, tileCentre } from '../src/cave';
import {
  LAMP_COLOUR,
  airParticle,
  biomeAt,
  biomeOf,
  biomeStyle,
  decorate,
  groundTone,
  lampColour,
  tint,
  type BiomeName,
} from '../src/biomes';
import { FLOOR_TONES, ROCK_TONES } from '../src/palette';
import { FOOT_TONE, PLAIN_ROCK, buildTerrain } from '../src/terrain';
import { IDS, caveOf } from './helpers';

/** Which biome each cave of the run has: the Hollow none. */
const BIOME: Record<string, BiomeName | null> = {
  hollow: null,
  'south-gallery': 'jungle',
  'east-gallery': 'lava',
  'north-vault': 'ice',
  warrens: 'jungle',
  'west-gallery': 'future',
};

/** Every cave built once, with the terrain it is drawn from and what stands in it. */
const BUILT = new Map(
  IDS.map((id) => {
    const cave = caveOf(id);
    const hidden = cave.spec.secrets.map(() => false);
    const terrain = buildTerrain(cave, hidden, biomeStyle(cave.spec));
    return [id, { cave, hidden, terrain, decor: decorate(cave.spec, terrain.samples) }] as const;
  }),
);

describe('the biomes', () => {
  it('give each cave its own, and leave the Hollow as it was', () => {
    for (const id of IDS) expect(biomeOf(caveOf(id).spec)?.name ?? null, id).toBe(BIOME[id]);
    expect(new Set(IDS.slice(1).map((id) => biomeOf(caveOf(id).spec)?.name))).toEqual(
      new Set(['jungle', 'ice', 'lava', 'future']),
    );
  });

  it.each(IDS)('fill the whole of %s at full strength, or nothing of the plain one', (id) => {
    const { cave } = BUILT.get(id)!;
    const { cols, rows } = cave.grid;
    const want = BIOME[id] ? 1 : 0;
    // every tile, the cuttings and the rock round the edge too
    for (let ty = 0; ty < rows; ty += 3)
      for (let tx = 0; tx < cols; tx += 3) {
        const [x, y] = tileCentre(cave.grid, tx, ty);
        expect(biomeAt(cave.spec, x, y).weight, `${id} at ${x},${y}`).toBe(want);
      }
  });

  it.each(IDS)('draw %s in its own palette and shape, and the Hollow in the cave’s', (id) => {
    const { cave, terrain } = BUILT.get(id)!;
    const style = biomeStyle(cave.spec);
    const biome = biomeOf(cave.spec);
    const want = biome ? 1 : 0;
    for (const g of terrain.groups) expect(g.palette, `${id} group`).toBe(want);
    expect(style.palette(0, -14)).toBe(want);
    expect(style.shape(0, -14)).toBe(biome ? biome.shape : PLAIN_ROCK);
    expect(groundTone(cave.spec, 0, true, 1)).toEqual(ROCK_TONES[1]);
    expect(groundTone(cave.spec, 0, false, 2)).toEqual(FLOOR_TONES[2]);
    if (biome) expect(groundTone(cave.spec, 1, false, 0)).toEqual(biome.floor[0]);
  });

  it('shape the Hollow’s ground exactly as it was without them', () => {
    const { cave, hidden, terrain } = BUILT.get('hollow')!;
    const plain = buildTerrain(cave, hidden);
    for (let k = 0; k < plain.samples.z.length; k++)
      if (plain.samples.z[k] !== terrain.samples.z[k])
        expect.fail(`height at ${plain.samples.x[k]},${plain.samples.y[k]} changed`);
  });

  it('colour lamps and stones by the biome, and not at all in the Hollow', () => {
    const hollow = caveOf('hollow').spec;
    expect(lampColour(hollow, 0, -14)).toEqual(LAMP_COLOUR);
    const base: [number, number, number] = [1, 1, 1];
    expect(tint(hollow, base, 0, -14, (b) => b.stone.rock)).toBe(base);
    const lava = caveOf('east-gallery').spec;
    const b = biomeOf(lava)!;
    const lit = lampColour(lava, 0, 0);
    b.lamp.forEach((c, i) => expect(lit[i]).toBeCloseTo(c * b.lampBright, 9));
  });

  it.each(IDS.slice(1))(
    'put its decoration in %s, the same every time, nothing on its cuttings, and nothing tall where the dozer drives',
    (id) => {
      const { cave, hidden, terrain, decor } = BUILT.get(id)!;
      expect(decorate(cave.spec, terrain.samples)).toEqual(decor);
      expect(decor.props.length).toBeGreaterThan(20);
      const toRock = (x: number, y: number) => {
        const { cols, rows, originX, originY } = cave.grid;
        const tx = Math.floor((x - originX) / TILE),
          ty = Math.floor((y - originY) / TILE);
        let best = Infinity;
        for (let oy = -2; oy <= 2; oy++) {
          for (let ox = -2; ox <= 2; ox++) {
            const nx = tx + ox,
              ny = ty + oy;
            const rock = nx < 0 || ny < 0 || nx >= cols || ny >= rows || rockish(cave.cells[ny * cols + nx], hidden);
            if (!rock) continue;
            const [cx, cy] = tileCentre(cave.grid, nx, ny);
            best = Math.min(
              best,
              Math.hypot(Math.max(0, Math.abs(x - cx) - TILE / 2), Math.max(0, Math.abs(y - cy) - TILE / 2)),
            );
          }
        }
        return best;
      };
      for (const p of decor.props) {
        expect(
          nearCutting(cave.grid, cave.spec, p.x, p.y, 1.5),
          `${p.kind} at ${p.x},${p.y} on or beside a cutting`,
        ).toBe(false);
        // what stands up off the floor stands on the rock, or at its very foot
        const tall = p.z + p.size[2] > 0.9 && !['snow', 'tuft', 'seep', 'pool'].includes(p.kind);
        if (tall && toRock(p.x, p.y) > 0.8)
          expect.fail(`${p.kind} at ${p.x.toFixed(1)},${p.y.toFixed(1)} stands on the floor`);
      }
      for (const l of decor.lights)
        expect(nearCutting(cave.grid, cave.spec, l.x, l.y, 1.5), `${l.biome} light on a cutting`).toBe(false);
    },
  );

  it('have the kinds of thing each is known for, and the Hollow none', () => {
    const kinds = (id: string) => new Set(BUILT.get(id)!.decor.props.map((p) => p.kind));
    expect(BUILT.get('hollow')!.decor.props).toEqual([]);
    expect(BUILT.get('hollow')!.decor.lights).toEqual([]);
    for (const kind of ['fern', 'trunk', 'cap']) expect(kinds('south-gallery').has(kind as never), kind).toBe(true);
    for (const kind of ['crystal']) expect(kinds('north-vault').has(kind as never), kind).toBe(true);
    for (const kind of ['pool', 'column']) expect(kinds('east-gallery').has(kind as never), kind).toBe(true);
    for (const kind of ['neon', 'crate']) expect(kinds('west-gallery').has(kind as never), kind).toBe(true);
  });

  it('shed a skirt each of their own, and the future cave none, only a gutter along its panels', () => {
    const scree = (id: string) => biomeStyle(caveOf(id).spec).scree(0, 0);
    expect(scree('south-gallery')).toBe(1);
    expect(scree('north-vault')).toBe(1);
    expect(scree('east-gallery')).toBe(1);
    expect(scree('hollow')).toBe(1);
    expect(scree('west-gallery')).toBe(0);
    // and so no scree lies about in the future cave, where the jungle is thick with it
    const grit = (id: string) => BUILT.get(id)!.terrain.stones.filter((s) => s.size[0] < 0.7).length;
    expect(grit('west-gallery')).toBeLessThan(grit('south-gallery') / 4);
    // every biome has a foot tone of its own for its floor, darker than its open floor; the future's is its gutter
    for (const id of IDS.slice(1)) {
      const b = biomeOf(caveOf(id).spec)!;
      expect(b.floor.length).toBe(FOOT_TONE + 1);
      const sum = (t: readonly number[]) => t[0] + t[1] + t[2];
      expect(sum(b.floor[FOOT_TONE])).toBeLessThan(sum(b.floor[1]));
    }
    expect(groundTone(caveOf('hollow').spec, 0, false, FOOT_TONE)).toEqual(FLOOR_TONES[FOOT_TONE]);
    // the future's floor keeps its panels and seams, and its foot is the gutter
    const future = biomeStyle(caveOf('west-gallery').spec);
    expect(future.tone(1, 10, 10, false, FOOT_TONE)).toBe(FOOT_TONE);
    expect(future.tone(1, 10, 10, false, 0)).toBeLessThan(FOOT_TONE);
  });

  it('light their features only in their own cave, and drift their own air', () => {
    for (const id of IDS.slice(1)) {
      const { decor } = BUILT.get(id)!;
      expect(decor.lights.length, id).toBeGreaterThan(3);
      for (const l of decor.lights) expect(l.biome, `${id} light`).toBe(BIOME[id]);
    }
    expect(airParticle(caveOf('hollow').spec, 0, 0, Math.random)).toBeNull();
    for (const id of IDS.slice(1))
      expect(
        airParticle(caveOf(id).spec, 0, 0, () => 0.5),
        id,
      ).not.toBeNull();
  });
});
