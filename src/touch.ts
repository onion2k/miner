/**
 * The controls on a phone, two ways to hold them.
 *
 * - `tracks`: a slider down each side of the screen, one for each track, the
 *   way a real dozer is driven with a lever for each. Push both up to drive,
 *   both down to back up, one up and one down to turn on the spot.
 * - `stick`: the left slider is the throttle, forward and back, and a slider
 *   lying across on the right steers, the way a car's pedal and wheel split
 *   between two hands.
 *
 * Each slider follows its own finger, so both can be held at once, and
 * springs back to the middle when it is let go.
 */
import type { Drive } from './input';

/** Whether this is a device driven by touch: its main pointer is a finger. `?touch` forces it. */
export function isTouchDevice(): boolean {
  return new URLSearchParams(location.search).has('touch') || matchMedia('(pointer: coarse)').matches;
}

/** How far from the middle a slider has to go before the track moves, as a fraction of its travel. */
const DEAD_ZONE = 0.1;
/** Where a slider is all the way, short of its end, so a thumb need not find the very edge. */
const FULL_AT = 0.8;
/**
 * The steering's response: the lever's reach past the dead zone, to this power. A
 * turn rate straight from a short slider lying across a phone was all or nothing
 * under a thumb's wobble; squared, the first half of the travel is a gentle arc and
 * the full turn is still at the end.
 */
const STEER_CURVE = 2;

export type Scheme = 'tracks' | 'stick';
const SCHEMES: Scheme[] = ['tracks', 'stick'];
const KEY = 'pushminer-controls';

export class TouchControls {
  scheme: Scheme = 'tracks';
  /** Each lever, -1 to 1: up is forward on the upright ones, right is right on the one lying across. */
  private left = 0;
  private right = 0;
  private across = 0;
  private readonly releases: (() => void)[] = [];

  constructor(
    leftEl: HTMLElement,
    private readonly rightEl: HTMLElement,
    private readonly acrossEl: HTMLElement,
  ) {
    this.bind(leftEl, 'up', (v) => {
      this.left = v;
    });
    this.bind(rightEl, 'up', (v) => {
      this.right = v;
    });
    this.bind(
      acrossEl,
      'across',
      (v) => {
        this.across = v;
      },
      STEER_CURVE,
    );
    try {
      const s = localStorage.getItem(KEY);
      if (SCHEMES.includes(s as Scheme)) this.scheme = s as Scheme;
    } catch {
      /* fine */
    }
    this.show();
  }

  /** Over to the other scheme, every lever let go. */
  cycle(): Scheme {
    this.scheme = SCHEMES[(SCHEMES.indexOf(this.scheme) + 1) % SCHEMES.length];
    try {
      localStorage.setItem(KEY, this.scheme);
    } catch {
      /* fine */
    }
    for (const release of this.releases) release();
    this.show();
    return this.scheme;
  }

  private show() {
    this.rightEl.hidden = this.scheme !== 'tracks';
    this.acrossEl.hidden = this.scheme !== 'stick';
    document.body.classList.toggle('stick', this.scheme === 'stick');
  }

  drive(): Drive {
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    // steer is to the left when positive, as A is
    if (this.scheme === 'stick') return { throttle: this.left, steer: -this.across };
    // Two tracks to one drive: what they share is the throttle, and the difference turns
    // it, to the left when the right track runs ahead. Summed, not averaged, so the levers
    // reach what the keys do: both pushed is W at full speed, one pushed is W with A or D,
    // opposite ways is a spin. Averaged, an arc was three quarters of the speed and a
    // lever short of its end was slower still.
    return { throttle: clamp(this.left + this.right), steer: clamp(this.right - this.left) };
  }

  private bind(slider: HTMLElement, axis: 'up' | 'across', set: (value: number) => void, curve = 1) {
    const thumb = slider.querySelector('.thumb') as HTMLElement;
    let finger: number | null = null;

    const follow = (e: PointerEvent) => {
      const r = slider.getBoundingClientRect();
      let raw: number;
      if (axis === 'up') {
        const travel = (r.height - thumb.offsetHeight) / 2;
        raw = Math.max(-1, Math.min(1, (r.top + r.height / 2 - e.clientY) / Math.max(travel, 1)));
        thumb.style.transform = `translateY(${-raw * travel}px)`;
      } else {
        const travel = (r.width - thumb.offsetWidth) / 2;
        raw = Math.max(-1, Math.min(1, (e.clientX - r.left - r.width / 2) / Math.max(travel, 1)));
        thumb.style.transform = `translateX(${raw * travel}px)`;
      }
      // past the dead zone, rescaled so the lever reaches a full 1 at FULL_AT of the way
      const past = Math.min(1, Math.max(0, Math.abs(raw) - DEAD_ZONE) / (FULL_AT - DEAD_ZONE));
      set(Math.sign(raw) * past ** curve);
    };
    const letGo = () => {
      finger = null;
      slider.classList.remove('held');
      thumb.style.transform = '';
      set(0);
    };
    const release = (e: PointerEvent) => {
      if (e.pointerId === finger) letGo();
    };
    this.releases.push(letGo);

    slider.addEventListener('pointerdown', (e) => {
      if (finger !== null) return;
      finger = e.pointerId;
      // held by this slider even when the finger slides off it; a pointer the browser
      // no longer knows (a synthetic one) cannot be captured, and needs no capturing
      try {
        slider.setPointerCapture(e.pointerId);
      } catch {
        /* moves still arrive while over it */
      }
      slider.classList.add('held');
      follow(e);
      e.preventDefault();
    });
    slider.addEventListener('pointermove', (e) => {
      if (e.pointerId === finger) follow(e);
    });
    slider.addEventListener('pointerup', release);
    slider.addEventListener('pointercancel', release);
    slider.addEventListener('lostpointercapture', release);
  }
}
