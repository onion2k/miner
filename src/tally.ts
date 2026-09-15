/**
 * A run: everything that has gone down the hole without a pause longer than
 * a moment, tallied as it goes, and how hot it is — how fast value is
 * arriving — which is what the sparkle, the light and the pitch grow with.
 * And the hole's own glow, which flares with each thing banked and fades.
 */
import { KINDS, KIND_NAME, KIND_VALUE } from './physics';

/** How long after the last thing banked a run is over, in seconds. */
const RUN_PAUSE = 1.3;
/** How many coins a second make a run as hot as it gets. */
const HOT_FLOW = 25;

export interface RunSummary {
  value: number;
  count: number;
  /** "12 coins · 1 ruby", in kind order. */
  parts: string[];
  over: boolean;
}

export class Tally {
  value = 0;
  count = 0;
  /** How long until the run is over. */
  timer = 0;
  /** How many of each kind this run. */
  readonly gained = new Array<number>(KINDS).fill(0);
  /** How fast value is arriving, in coins a second, smoothed. */
  flow = 0;
  /** How bright the hole glows, 0 to 3. */
  holePulse = 0;

  /** Something banked. How hot the run is now, 0 to 1. */
  add(kind: number): number {
    this.gained[kind]++;
    this.value += KIND_VALUE[kind];
    this.count++;
    this.timer = RUN_PAUSE;
    this.flow += 1;
    const heat = this.heat;
    this.holePulse = Math.min(3, this.holePulse + 0.2 + heat * 0.5 + (kind > 0 ? 0.7 : 0));
    return heat;
  }

  get heat(): number {
    return Math.min(1, this.flow / HOT_FLOW);
  }

  /** The glow and the heat die away. */
  fade(dt: number) {
    this.holePulse = Math.max(0, this.holePulse - dt * 1.8);
    this.flow = Math.max(0, this.flow - this.flow * Math.min(1, 2.5 * dt));
  }

  /** Time passes on the run. Whether it has just ended, which is when to show it one last time and then `reset`. */
  tick(dt: number): boolean {
    if (this.timer <= 0) return false;
    this.timer -= dt;
    return this.timer <= 0;
  }

  reset() {
    this.value = 0;
    this.count = 0;
    this.gained.fill(0);
  }

  summary(): RunSummary {
    const parts: string[] = [];
    for (let k = 0; k < KINDS; k++) {
      if (this.gained[k]) parts.push(`${this.gained[k]} ${KIND_NAME[k]}${this.gained[k] > 1 ? 's' : ''}`);
    }
    return { value: this.value, count: this.count, parts, over: this.timer <= 0 };
  }
}
