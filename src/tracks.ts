/**
 * The marks tracks leave in the floor: a bar pressed across each track every
 * time it runs a grouser's length, where that track is on the ground.
 *
 * Nothing here knows about the cave, the dozer or the renderer. A machine is
 * told to it by where it is, which way it faces and how far each of its
 * tracks has run; where the ground is, and whether there is any, is asked of
 * a function it is handed. What it gives back is placements, a page at a
 * time, and which pages have changed.
 *
 * Marks are kept in pages, so laying one costs a write to one page and not
 * to all of them. There is only so much floor the game will remember: once
 * every page is full the oldest is emptied and used again, and while the
 * newest fills, the one next to go shrinks away, so old tracks fade rather
 * than vanish a stretch at a time.
 */
import { place } from './matrix';

export interface TrackOptions {
  /** Marks a page, and how many pages. */
  pageSize: number;
  pages: number;
  /** From a machine's middle to the middle of each track, across, at scale 1. */
  gauge: number;
  /** How far a track runs between one mark and the next, at scale 1. */
  spacing: number;
  /** A mark's size: along the way the track runs, and across it, at scale 1. */
  length: number;
  width: number;
  /**
   * The height of the ground at a point, for a mark to lie on; null where
   * there is none to mark — over a hole, say.
   */
  ground: (x: number, y: number) => number | null;
}

/** A machine as the marks need it. `scale` is its size against a machine of scale 1. */
export interface Tracked {
  x: number;
  y: number;
  yaw: number;
  trackLeft: number;
  trackRight: number;
  scale: number;
}

/** How far over the ground a mark lies, so the floor does not show through it. */
const LIFT = 0.04;
/** Floats kept a mark: where it is, which way it faces, and its size. */
const STRIDE = 5;

export class TrackMarks {
  /** Placements a page, sixteen floats a mark, for as many marks as the page's count. */
  readonly matrices: Float32Array[];
  readonly counts: number[];
  /** The pages changed since `clean`. */
  readonly dirty = new Set<number>();
  private readonly marks: Float32Array[];
  /** The page being filled, and how many pages have ever been started. */
  private page = 0;
  private started = 1;
  /** Where each machine's tracks had run to at its last mark, by the key it is laid under. */
  private readonly last = new Map<unknown, [number, number]>();

  constructor(private readonly options: TrackOptions) {
    this.matrices = Array.from({ length: options.pages }, () => new Float32Array(options.pageSize * 16));
    this.marks = Array.from({ length: options.pages }, () => new Float32Array(options.pageSize * STRIDE));
    this.counts = new Array<number>(options.pages).fill(0);
  }

  /**
   * Lay whatever marks a machine has made since it was last looked at. `key`
   * tells machines apart; the first look at one only notes where it is.
   */
  update(key: unknown, m: Tracked) {
    const was = this.last.get(key);
    if (!was) {
      this.last.set(key, [m.trackLeft, m.trackRight]);
      return;
    }
    const spacing = this.options.spacing * m.scale;
    const c = Math.cos(m.yaw),
      s = Math.sin(m.yaw);
    for (const [side, run, k] of [
      [1, m.trackLeft, 0],
      [-1, m.trackRight, 1],
    ] as const) {
      const across = side * this.options.gauge * m.scale;
      // a mark for each grouser the track has run on (or back) past since the last, a whole
      // spacing apart however far it went this frame, each back along the way by how far the
      // track has run on past it
      while (Math.abs(run - was[k]) >= spacing) {
        was[k] += Math.sign(run - was[k]) * spacing;
        const behind = run - was[k];
        this.lay(m.x - c * behind - s * across, m.y - s * behind + c * across, m.yaw, m.scale);
      }
    }
  }

  /** Forget a machine, so it starts afresh if it comes back: one taken out of the game, say. */
  forget(key: unknown) {
    this.last.delete(key);
  }

  /** Every page as nothing, and every machine forgotten. */
  clear() {
    this.counts.fill(0);
    this.page = 0;
    this.started = 1;
    this.last.clear();
    for (let p = 0; p < this.options.pages; p++) this.dirty.add(p);
  }

  /** The pages have been drawn from: nothing has changed since. */
  clean() {
    this.dirty.clear();
  }

  /** How many marks there are. */
  get size(): number {
    return this.counts.reduce((a, b) => a + b, 0);
  }

  private lay(x: number, y: number, yaw: number, scale: number) {
    const { pageSize, pages, length, width, ground } = this.options;
    const half = (Math.max(length, width) * scale) / 2;
    // on the highest of the ground under its ends, so no bump of the floor comes up through it
    let z = -Infinity;
    for (const [ox, oy] of [
      [0, 0],
      [half, 0],
      [-half, 0],
      [0, half],
      [0, -half],
    ]) {
      const g = ground(x + ox, y + oy);
      if (g === null) return;
      z = Math.max(z, g);
    }
    if (this.counts[this.page] === pageSize) {
      // the page is full: on to the next, emptying it if it was used before
      this.page = (this.page + 1) % pages;
      this.counts[this.page] = 0;
      this.started = Math.min(pages, this.started + 1);
      this.dirty.add(this.page);
    }
    const p = this.page,
      i = this.counts[p]++;
    this.marks[p].set([x, y, z + LIFT, yaw, scale], i * STRIDE);
    this.write(p, i, 1);
    this.dirty.add(p);
    this.fade();
  }

  /**
   * With every page in use, the next one to be emptied shrinks as the
   * current one fills, and is gone as it is reused.
   */
  private fade() {
    const { pageSize, pages } = this.options;
    if (this.started < pages) return;
    const next = (this.page + 1) % pages;
    const left = 1 - this.counts[this.page] / pageSize;
    // a step at a time, not every mark
    if (Math.round(left * 32) === Math.round((left + 1 / pageSize) * 32)) return;
    for (let i = 0; i < this.counts[next]; i++) this.write(next, i, left);
    this.dirty.add(next);
  }

  private write(p: number, i: number, shrink: number) {
    const m = this.marks[p],
      o = i * STRIDE;
    const scale = m[o + 4];
    place(this.matrices[p], i, m[o], m[o + 1], m[o + 2], m[o + 3]);
    // the unit square stretched to the mark's size, and shrunk as it fades
    const out = this.matrices[p],
      q = i * 16;
    const along = this.options.length * scale * shrink,
      across = this.options.width * scale * shrink;
    out[q] *= along;
    out[q + 1] *= along;
    out[q + 4] *= across;
    out[q + 5] *= across;
  }
}
