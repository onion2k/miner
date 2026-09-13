/**
 * The controls on a phone: a slider down each side of the screen, one for
 * each track, the way a real dozer is driven with a lever for each. Push
 * both up to drive, both down to back up, one up and one down to turn on
 * the spot. Each slider follows its own finger, so both can be held at once,
 * and springs back to the middle when it is let go.
 */

/** Whether this is a device driven by touch: its main pointer is a finger. `?touch` forces it. */
export function isTouchDevice(): boolean {
  return new URLSearchParams(location.search).has('touch') || matchMedia('(pointer: coarse)').matches;
}

/** How far from the middle a slider has to go before the track moves, as a fraction of its travel. */
const DEAD_ZONE = 0.1;
/** Where a slider is all the way, short of its end, so a thumb need not find the very edge. */
const FULL_AT = 0.8;

export class TrackSliders {
  /** Each track's lever, -1 full back to 1 full forward. */
  left = 0;
  right = 0;

  constructor(left: HTMLElement, right: HTMLElement) {
    this.bind(left, (v) => { this.left = v; });
    this.bind(right, (v) => { this.right = v; });
  }

  private bind(slider: HTMLElement, set: (value: number) => void) {
    const thumb = slider.querySelector('.thumb') as HTMLElement;
    let finger: number | null = null;

    const follow = (e: PointerEvent) => {
      const r = slider.getBoundingClientRect();
      const travel = (r.height - thumb.offsetHeight) / 2;
      const raw = Math.max(-1, Math.min(1, (r.top + r.height / 2 - e.clientY) / Math.max(travel, 1)));
      thumb.style.transform = `translateY(${-raw * travel}px)`;
      // past the dead zone, rescaled so the lever reaches a full 1 at FULL_AT of the way
      const past = Math.min(1, Math.max(0, Math.abs(raw) - DEAD_ZONE) / (FULL_AT - DEAD_ZONE));
      set(Math.sign(raw) * past);
    };
    const release = (e: PointerEvent) => {
      if (e.pointerId !== finger) return;
      finger = null;
      slider.classList.remove('held');
      thumb.style.transform = '';
      set(0);
    };

    slider.addEventListener('pointerdown', (e) => {
      if (finger !== null) return;
      finger = e.pointerId;
      // held by this slider even when the finger slides off it; a pointer the browser
      // no longer knows (a synthetic one) cannot be captured, and needs no capturing
      try { slider.setPointerCapture(e.pointerId); } catch { /* moves still arrive while over it */ }
      slider.classList.add('held');
      follow(e);
      e.preventDefault();
    });
    slider.addEventListener('pointermove', (e) => { if (e.pointerId === finger) follow(e); });
    slider.addEventListener('pointerup', release);
    slider.addEventListener('pointercancel', release);
    slider.addEventListener('lostpointercapture', release);
  }
}
