/**
 * The Warrens' fungal dressing: that it is mushrooms and nothing borrowed, that its lights are few so the
 * cave stays dark between them, and that it asks for no more of the frame than the jungle it replaced.
 */
import { describe, expect, it } from 'vitest';
import { buildCave, nearCutting } from '../src/cave';
import { airParticle, beat, decorate, biomeStyle, featureParticle } from '../src/biomes';
import { FUNGAL_MESHES } from '../src/fungal';
import { buildTerrain } from '../src/terrain';
import { specOf } from './helpers';

const spec = specOf('warrens');
const cave = buildCave(spec);
const hidden = spec.secrets.map(() => false);
const decor = decorate(spec, buildTerrain(cave, hidden, biomeStyle(spec)).samples);

describe('the fungal biome', () => {
  it('stands only fungal kinds in the Warrens, and several of them', () => {
    const kinds = new Set(decor.props.map((p) => p.kind));
    for (const k of kinds) expect(Object.keys(FUNGAL_MESHES), String(k)).toContain(k);
    expect(kinds.size).toBeGreaterThanOrEqual(4);
  });

  it('lights it with a few fungal pulses, in more than one colour', () => {
    expect(decor.lights.length).toBeGreaterThan(5);
    expect(decor.lights.length).toBeLessThanOrEqual(50);
    for (const l of decor.lights) {
      expect(l.biome).toBe('fungal');
      expect(l.beat).toBe('pulse');
    }
    expect(new Set(decor.lights.map((l) => l.colour.join())).size).toBeGreaterThanOrEqual(3);
  });

  it('drifts spores in its air and puffs them off a glowing cap', () => {
    const air = airParticle(spec, 0, 0, () => 0.5);
    expect(air).not.toBeNull();
    expect(air!.velocity[2]).toBeGreaterThan(0);
    expect(featureParticle(decor.lights[0])).not.toBeNull();
    for (const t of [0, 1, 2, 3]) expect(beat(decor.lights[0], t)).toBeGreaterThan(0);
  });

  it('keeps to the jungle’s weight: no more props, lamps or lights than the cave had', () => {
    expect(decor.props.length).toBeGreaterThan(500);
    expect(decor.props.length).toBeLessThanOrEqual(2463);
    expect(cave.lamps.length).toBeLessThanOrEqual(84);
  });

  it('leaves nothing on its cuttings', () => {
    for (const p of [...decor.props, ...decor.lights]) {
      const near = nearCutting(cave.grid, spec, p.x, p.y, 1.5);
      expect(near).toBe(false);
    }
  });
});
