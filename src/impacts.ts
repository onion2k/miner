/**
 * What driving into the rock does, when the rock is not only rock.
 *
 * A brick wall driven square into takes a beating, by the engine and the
 * speed; one hit to each run at it, however long the blade is up against it
 * after. The rock in front of a hidden chamber, driven square into fast,
 * smashes; any other knock on it sounds hollow, which is all that gives it
 * away. Anything else is rock, the way out included, until the cave is cleared.
 *
 * This decides which, and remembers when each was last hit, so a blade held
 * against a wall is not a hit every frame. What follows — the damage, the
 * noise, the dust — is the caller's.
 */
import { BRICK, EXIT, SECRET, tileCentre, type CaveSpec, type Grid } from './cave';

/** Square enough on, as the cosine off straight at it, and fast enough, to smash the rock that breaks or hurt a wall. */
export const SMASH_SQUARE = 0.7,
  SMASH_SPEED = 6;
/** The least time between one hit on a wall and the next, and between one hollow knock and the next. */
const WALL_EVERY = 0.5,
  KNOCK_EVERY = 0.6;

export type Impact =
  /** A wall hit hard enough to count, for `damage`, at the tile (x, y). */
  | { type: 'wall'; wall: number; damage: number; x: number; y: number }
  /** The rock in front of a hidden chamber, smashed. */
  | { type: 'reveal'; chamber: number }
  /** The same rock knocked, not hard enough: it sounds hollow. */
  | { type: 'knock'; chamber: number };

export interface ImpactState {
  wallsDown: readonly boolean[];
  secretsOpen: readonly boolean[];
  /** How much a hit at a speed does to a wall with the engine fitted now; 0 for too slow to count. */
  ram(speed: number): number;
}

export class Impacts {
  private readonly knockedAt: number[];
  private readonly hitAt: number[];

  /** `cells` are the cave's, over `grid`; `spec` says how many chambers and walls there are to remember. */
  constructor(
    private readonly cells: Uint8Array,
    private readonly grid: Grid,
    spec: CaveSpec,
  ) {
    this.knockedAt = spec.secrets.map(() => -Infinity);
    this.hitAt = spec.walls.map(() => -Infinity);
  }

  /**
   * The machine is up against the tile (tx, ty), driving at it `square` on
   * (1 straight at it, 0 along it) at `speed`, at time `t`.
   */
  hit(tx: number, ty: number, square: number, speed: number, t: number, state: ImpactState): Impact | null {
    const cell = this.cells[ty * this.grid.cols + tx];
    speed = Math.abs(speed);
    // the way out is only rock, whatever is driven into it, and its value is past the walls', which would take it for one
    if (cell >= EXIT) return null;
    if (cell >= BRICK) {
      const wall = cell - BRICK;
      if (state.wallsDown[wall] || square < SMASH_SQUARE || t - this.hitAt[wall] < WALL_EVERY) return null;
      const damage = state.ram(speed);
      if (!damage) return null;
      this.hitAt[wall] = t;
      const [x, y] = tileCentre(this.grid, tx, ty);
      return { type: 'wall', wall, damage, x, y };
    }
    if (cell < SECRET || state.secretsOpen[cell - SECRET]) return null;
    const chamber = cell - SECRET;
    if (square >= SMASH_SQUARE && speed >= SMASH_SPEED) return { type: 'reveal', chamber };
    if (square > 0.2 && speed > 1.5 && t - this.knockedAt[chamber] > KNOCK_EVERY) {
      this.knockedAt[chamber] = t;
      return { type: 'knock', chamber };
    }
    return null;
  }
}
