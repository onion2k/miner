/**
 * The Deep's crystal geode: its props are crystals of its own and none of another biome's, its lights
 * are few, and it is no heavier than the future cave it replaced, which is what the frame gate holds it to.
 */
import { describe, expect, it } from 'vitest';
import { nearCutting, gridOf } from '../src/cave';
import { airParticle, biomeStyle, decorate, featureParticle, beat } from '../src/biomes';
import { GEODE_MESHES } from '../src/geode';
import { buildTerrain } from '../src/terrain';
import { caveOf } from './helpers';

const cave = caveOf('deep');
const terrain = buildTerrain(
  cave,
  cave.spec.secrets.map(() => false),
  biomeStyle(cave.spec),
);
const decor = decorate(cave.spec, terrain.samples);

/** What the Deep had as the future, measured at b19124b: 4154 props, 238 lamps and 196 feature lights. */
const WAS = { props: 4154, lamps: 238, lights: 196 };

describe('the geode', () => {
  it('stands crystals of its own, and no other biome’s props', () => {
    expect(decor.props.length).toBeGreaterThan(300);
    const kinds = new Set(decor.props.map((p) => p.kind));
    for (const k of kinds) expect(Object.keys(GEODE_MESHES), k).toContain(k);
    // clusters, spires and grit all stand somewhere
    expect(kinds.size).toBe(Object.keys(GEODE_MESHES).length);
  });

  it('lights a few of its crystals from inside, in magenta and violet, and shimmers or holds them', () => {
    expect(decor.lights.length).toBeGreaterThanOrEqual(10);
    expect(decor.lights.length).toBeLessThanOrEqual(80);
    for (const l of decor.lights) {
      expect(l.biome).toBe('geode');
      expect(['pulse', 'steady']).toContain(l.beat);
      expect(l.colour[0] + l.colour[2], 'not green').toBeGreaterThan(l.colour[1] * 1.5);
      expect(beat(l, 3)).toBeGreaterThan(0);
    }
  });

  it('has air and a glint off a lit crystal', () => {
    expect(airParticle(cave.spec, 0, 0, () => 0.5)).not.toBeNull();
    expect(featureParticle(decor.lights[0])).not.toBeNull();
  });

  it('is no heavier than the future cave it replaced', () => {
    expect(decor.props.length).toBeLessThanOrEqual(WAS.props);
    expect(cave.lamps.length).toBeLessThanOrEqual(WAS.lamps);
    expect(decor.lights.length).toBeLessThanOrEqual(WAS.lights);
  });

  it('leaves its cuttings bare', () => {
    const grid = gridOf(cave.spec);
    for (const p of decor.props)
      expect(nearCutting(grid, cave.spec, p.x, p.y, 2), `${p.kind} at ${p.x},${p.y}`).toBe(false);
    for (const l of decor.lights) expect(nearCutting(grid, cave.spec, l.x, l.y, 2)).toBe(false);
  });
});
