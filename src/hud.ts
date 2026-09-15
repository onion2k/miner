/**
 * The page round the cave: the counters, the tally of a run, the word at the
 * top of the screen, the arrow to the next gate, the workshop, the boot
 * screen, and a phone's buttons.
 *
 * Everything here is the DOM, and nothing here is the game: it is told what
 * to show, and tells whoever set it up when a button is pressed. Where the
 * arrow goes is worked out apart from the DOM, in `placePointer`.
 */
import type { RunSummary } from './tally';
import { project } from './matrix';

/** Where the arrow to the next gate goes on the screen, in CSS pixels. */
export type PointerPlacement =
  /** Over the gate, which is in view: bobbing above it, pointing down. */
  | { over: true; x: number; y: number }
  /** At the edge of the screen, on the way to it, pointing along (ux, uy). */
  | { over: false; x: number; y: number; ux: number; uy: number };

/**
 * Where the arrow goes for a target at (tx, ty) on the floor, seen through
 * `vp` on a screen `width` by `height`, from a player at (px, py): over it if
 * it is well in view, else at the edge of the screen the way it lies, kept
 * clear of the counters along the top, the help or the buttons along the
 * bottom, and on a phone its sliders. Null if there is no saying which way.
 */
export function placePointer(
  vp: Float32Array,
  target: { x: number; y: number },
  player: { x: number; y: number },
  width: number,
  height: number,
  touch: boolean,
  t: number,
): PointerPlacement | null {
  const p = project(vp, target.x, target.y, 0.5);
  if (p && Math.abs(p[0]) < 0.9 && Math.abs(p[1]) < 0.9) {
    const bob = Math.sin(t * 5) * 5;
    return { over: true, x: ((p[0] + 1) * width) / 2, y: ((1 - p[1]) * height) / 2 - 60 + bob };
  }
  let dx: number, dy: number;
  if (p && p[2] > 0) {
    dx = (p[0] * width) / 2;
    dy = (-p[1] * height) / 2;
  } else {
    // behind the camera, where a projection says nothing: turn the way on the floor into the screen's
    const o = project(vp, player.x, player.y, 0),
      ex = project(vp, player.x + 1, player.y, 0),
      ey = project(vp, player.x, player.y + 1, 0);
    if (!o || !ex || !ey) return null;
    const wx = target.x - player.x,
      wy = target.y - player.y;
    dx = ((wx * (ex[0] - o[0]) + wy * (ey[0] - o[0])) * width) / 2;
    dy = (-(wx * (ex[1] - o[1]) + wy * (ey[1] - o[1])) * height) / 2;
  }
  const len = Math.hypot(dx, dy) || 1;
  const left = touch ? 72 : 56,
    right = width - left,
    top = 84,
    bottom = height - (touch ? 150 : 110);
  const cx = width / 2,
    cy = height / 2;
  const kx = dx > 0 ? (right - cx) / dx : dx < 0 ? (left - cx) / dx : Infinity;
  const ky = dy > 0 ? (bottom - cy) / dy : dy < 0 ? (top - cy) / dy : Infinity;
  const k = Math.max(0, Math.min(kx, ky));
  return { over: false, x: cx + dx * k, y: cy + dy * k, ux: dx / len, uy: dy / len };
}

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export class Hud {
  private readonly boot = byId('boot');
  private readonly bootMsg = byId('bootMsg');
  private readonly bankPanel = byId('bank');
  private readonly bankValue = this.bankPanel.querySelector('b')!;
  private readonly shopBalance = byId('shopBalance');
  private readonly progressText = byId('progress');
  private readonly shopProgress = byId('shopProgress');
  private readonly pointer = byId('pointer');
  private readonly pointerArrow = this.pointer.querySelector('.arrow') as HTMLElement;
  private readonly pointerLabel = this.pointer.querySelector('span')!;
  private readonly statsPanel = byId('stats');
  private readonly helpPanel = byId('help');
  private readonly toast = byId('toast');
  private readonly noteLine = byId('cameraNote');
  private readonly shopPanel = byId('shop');
  readonly shopRows = this.shopPanel.querySelector('.rows') as HTMLElement;
  readonly shopCosmetics = this.shopPanel.querySelector('.rows.cosmetics') as HTMLElement;
  private readonly shopButton = byId<HTMLButtonElement>('shopButton');
  private noteFor = 0;

  /** What the boot screen says it is doing, or why it stopped. */
  booting(text: string) {
    this.bootMsg.textContent = text;
  }

  /** The boot screen away, and the counters up. */
  booted() {
    this.boot.classList.add('gone');
    this.bankPanel.hidden = false;
    this.statsPanel.hidden = false;
    this.helpPanel.hidden = false;
  }

  /** A word at the top of the screen for a few seconds: what just happened, or what a button just changed. */
  note(text: string, seconds = 2) {
    this.noteLine.textContent = text;
    this.noteLine.hidden = false;
    this.noteFor = seconds;
  }

  /** Time passes: the word at the top goes when its time is up. */
  tick(dt: number) {
    if (this.noteFor > 0 && (this.noteFor -= dt) <= 0) this.noteLine.hidden = true;
  }

  bank(value: number) {
    this.bankValue.textContent = this.shopBalance.textContent = `${value}`;
  }

  progress(text: string) {
    this.progressText.textContent = this.shopProgress.textContent = text;
  }

  /** The tally of a run, growing with it up to a shout, and fading once it is over. */
  run(r: RunSummary) {
    this.toast.innerHTML = `+${r.value}<small>${r.parts.join(' · ')}</small>`;
    this.toast.hidden = !r.count;
    this.toast.style.fontSize = `${Math.min(64, 18 + Math.sqrt(r.value) * 2.4)}px`;
    this.toast.classList.toggle('gone', r.over);
  }

  stats(s: { ms: number; live: number; awake: number; load: number; coins: string }) {
    this.statsPanel.innerHTML =
      `<span>${s.ms.toFixed(1)}</span> ms · <span>${Math.round(1000 / s.ms)}</span> fps<br>` +
      `<span>${s.live}</span> bodies · <span>${s.awake}</span> awake · load <span>${s.load}</span><br>` +
      `coins <span>${s.coins}</span>`;
  }

  /** The workshop open or shut. */
  shop(open: boolean) {
    this.shopPanel.hidden = !open;
    this.shopButton.textContent = open ? 'close' : 'shop';
  }

  /** The arrow to the next gate, with the gate's name behind it; or none. */
  showPointer(place: PointerPlacement | null, label: string) {
    if (!place) {
      this.pointer.hidden = true;
      return;
    }
    this.pointer.hidden = false;
    this.pointer.style.transform = `translate(${place.x}px, ${place.y}px)`;
    const [ux, uy] = place.over ? [0, 1] : [place.ux, place.uy];
    this.pointerArrow.style.transform = `rotate(${Math.atan2(uy, ux)}rad)`;
    this.pointerLabel.textContent = label;
    // the words behind the arrow, far enough back that a long name clears it whichever way it points
    const w = this.pointerLabel.offsetWidth / 2 + 24,
      h = this.pointerLabel.offsetHeight / 2 + 22;
    this.pointerLabel.style.transform = `translate(calc(-50% + ${-ux * w}px), calc(-50% + ${-uy * h}px))`;
  }

  /**
   * The workshop's start-over button: two clicks, not a dialog. An embedded
   * page may have its dialogs suppressed, and a confirm that returns false
   * without ever being seen is a button that does nothing.
   */
  onReset(reset: () => void) {
    const button = byId<HTMLButtonElement>('reset');
    let armed: number | null = null;
    button.addEventListener('click', () => {
      if (armed !== null) {
        reset();
        return;
      }
      button.textContent = 'really? click again to lose everything';
      button.classList.add('armed');
      armed = window.setTimeout(() => {
        armed = null;
        button.textContent = 'start over';
        button.classList.remove('armed');
      }, 4000);
    });
  }
}

/** What a phone's buttons do. */
export interface PadActions {
  shop(): void;
  camera(): void;
  horn(): void;
  /** Toggle the sound; whether it is muted now. */
  mute(): boolean;
  /** On to the next way of driving by touch; which it is now. */
  controls(): 'tracks' | 'stick';
}

/**
 * A phone's buttons along the bottom, and the sliders either side: shown, and
 * wired to `actions`. Returns what the page needs to keep them saying the
 * right thing.
 */
export function setupPad(actions: PadActions, muted: boolean, scheme: 'tracks' | 'stick') {
  document.body.classList.add('touch');
  byId('tracks').hidden = false;
  byId('pad').hidden = false;
  const controlsButton = byId<HTMLButtonElement>('controlsButton');
  const hornButton = byId<HTMLButtonElement>('hornButton');
  const muteButton = byId<HTMLButtonElement>('muteButton');
  const showControls = (s: 'tracks' | 'stick') => {
    controlsButton.textContent = s === 'tracks' ? '⇅⇅' : '⇅⇆';
  };
  const showMute = (m: boolean) => {
    muteButton.textContent = m ? '🔇' : '🔊';
    muteButton.setAttribute('aria-label', m ? 'unmute' : 'mute');
  };
  controlsButton.addEventListener('click', () => showControls(actions.controls()));
  byId('cameraButton').addEventListener('click', () => actions.camera());
  byId('shopButton').addEventListener('click', () => actions.shop());
  // pointerdown, not click: a horn sounds when it is pressed, and a click waits for the lift
  hornButton.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    actions.horn();
  });
  // straight to the sound, not through the input's once-a-frame flag: two taps inside
  // one frame would be one toggle there, and the button would say the wrong thing
  muteButton.addEventListener('click', () => showMute(actions.mute()));
  showControls(scheme);
  showMute(muted);
  return {
    showMute,
    showHorn: (owned: boolean) => {
      hornButton.hidden = !owned;
    },
  };
}
