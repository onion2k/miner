/**
 * The page round the cave: the counters, the tally of a run, the word at the
 * top of the screen, the map, the black layer of the fade, the workshop, the boot
 * screen, and a phone's buttons.
 *
 * Everything here is the DOM, and nothing here is the game: it is told what
 * to show, and tells whoever set it up when a button is pressed. What the
 * map shows, and where, is worked out apart from the DOM, in `minimapView`.
 */
import { FLOW_MAP } from './currents';
import type { RunSummary } from './tally';
import { FLOOR_LEVEL, ROCK_LEVEL, WALL_LEVEL, type FloorImage, type MinimapView } from './minimap';

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** What the map is drawn in, as CSS colours: the cave's own, so floor reads against rock and the marks against both. */
const GROUND = new Map<number, [number, number, number, number]>([
  [FLOOR_LEVEL, [222, 205, 168, 235]],
  [WALL_LEVEL, [160, 104, 74, 242]],
  [ROCK_LEVEL, [36, 34, 48, 235]],
]);
const MAP = {
  gold: '#f2c14e',
  speck: 'rgba(242, 193, 78, 0.55)',
  belt: 'rgba(120, 124, 140, 0.9)',
  bot: '#5aa9ff',
  hole: '#050507',
  ring: '#4fd16f',
  outline: 'rgba(0, 0, 0, 0.75)',
};

/**
 * The map in the corner: a canvas that draws whatever view it is handed, at the screen's pixel density and
 * the size the page gives it. It holds the floor as an image of its own, one pixel a tile, made when the floor
 * changes and drawn turned and placed each time, so a redraw costs a blit and a few dozen marks.
 */
export class Minimap {
  private readonly canvas = byId<HTMLCanvasElement>('minimap');
  private readonly ctx = this.canvas.getContext('2d')!;
  private floor: HTMLCanvasElement | null = null;

  show() {
    this.canvas.hidden = false;
  }

  /** Put away while the workshop is open, which fills the corner it is in. */
  cover(covered: boolean) {
    this.canvas.classList.toggle('covered', covered);
  }

  /** As dark as the page: it fades with the screen and not before or after it. */
  fade(darkness: number) {
    this.canvas.style.opacity = darkness === 0 ? '1' : (1 - darkness).toFixed(3);
  }

  /** The floor as the cave stands now, in colour, ready to be drawn. */
  setFloor(image: FloorImage) {
    const floor = (this.floor ??= document.createElement('canvas'));
    floor.width = image.width;
    floor.height = image.height;
    const ctx = floor.getContext('2d')!;
    const pixels = ctx.createImageData(image.width, image.height);
    for (let i = 0; i < image.data.length; i++) pixels.data.set(GROUND.get(image.data[i])!, i * 4);
    ctx.putImageData(pixels, 0, 0);
  }

  /** Waits for what has been drawn to be rasterised, which a canvas otherwise puts off: for timing the work and not only the asking. */
  finish() {
    this.ctx.getImageData(0, 0, 1, 1);
  }

  /** The view drawn: the floor, then what lies on it, then the machine on top. */
  draw(view: MinimapView) {
    const { canvas, ctx } = this;
    const size = canvas.clientWidth;
    if (!size) return;
    const dpr = window.devicePixelRatio || 1;
    const backing = Math.round(size * dpr);
    if (canvas.width !== backing) canvas.width = canvas.height = backing;
    // map units from here: the dozer at the middle, the window `range` either way
    const k = size / (2 * view.range),
      px = 1 / k;
    ctx.setTransform((backing / size) * k, 0, 0, (backing / size) * k, backing / 2, backing / 2);
    ctx.clearRect(-view.range, -view.range, 2 * view.range, 2 * view.range);
    const [r, g, b, a] = GROUND.get(ROCK_LEVEL)!;
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a / 255})`;
    ctx.fillRect(-view.range, -view.range, 2 * view.range, 2 * view.range);
    if (this.floor) {
      ctx.save();
      ctx.transform(...view.floor);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.floor, 0, 0);
      ctx.restore();
    }
    // a mark on the rim is drawn just inside it, so the whole of it shows
    const keep = view.range - 5 * px;
    const clamp = (v: number) => Math.max(-keep, Math.min(keep, v));

    ctx.strokeStyle = MAP.belt;
    ctx.lineWidth = 1.4 * px;
    ctx.beginPath();
    for (const b of view.belts) {
      ctx.moveTo(b.x0, b.y0);
      ctx.lineTo(b.x1, b.y1);
    }
    ctx.stroke();

    // the currents, in what they are made of, and each drain a dark pit ringed in the same: nothing like a hole's green
    ctx.lineWidth = 2.6 * px;
    ctx.lineCap = 'butt';
    for (const c of view.currents) {
      ctx.strokeStyle = FLOW_MAP[c.flow];
      ctx.beginPath();
      ctx.moveTo(c.x0, c.y0);
      ctx.lineTo(c.x1, c.y1);
      ctx.stroke();
    }
    for (const d of view.drains) {
      ctx.beginPath();
      ctx.arc(d.x, d.y, Math.max(2.6 * px, d.radius * 0.7), 0, Math.PI * 2);
      ctx.fillStyle = MAP.hole;
      ctx.fill();
      ctx.strokeStyle = FLOW_MAP[d.flow];
      ctx.lineWidth = 1.7 * px;
      ctx.stroke();
    }

    ctx.fillStyle = MAP.speck;
    for (const s of view.specks) ctx.fillRect(s.x - px, s.y - px, 2 * px, 2 * px);

    for (const h of view.holes) {
      const x = clamp(h.x),
        y = clamp(h.y),
        r = h.rim ? 3.4 * px : Math.max(3.4 * px, h.radius * 0.7);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = MAP.hole;
      ctx.fill();
      ctx.strokeStyle = MAP.ring;
      ctx.lineWidth = 1.7 * px;
      ctx.stroke();
    }

    if (view.exit) {
      const x = clamp(view.exit.x),
        y = clamp(view.exit.y),
        r = 4.6 * px;
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      ctx.fillStyle = MAP.gold;
      ctx.fill();
      ctx.strokeStyle = MAP.outline;
      ctx.lineWidth = 1.2 * px;
      ctx.stroke();
    }

    ctx.fillStyle = MAP.bot;
    for (const b of view.bots) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, 2.6 * px, 0, Math.PI * 2);
      ctx.fill();
    }

    // the machine, a gold arrow pointing the way it faces
    ctx.save();
    ctx.rotate(view.dozer.heading);
    ctx.beginPath();
    ctx.moveTo(8 * px, 0);
    ctx.lineTo(-5.5 * px, 5.2 * px);
    ctx.lineTo(-2.5 * px, 0);
    ctx.lineTo(-5.5 * px, -5.2 * px);
    ctx.closePath();
    ctx.fillStyle = MAP.gold;
    ctx.fill();
    ctx.strokeStyle = MAP.outline;
    ctx.lineWidth = 1.2 * px;
    ctx.stroke();
    ctx.restore();
  }
}

export class Hud {
  private readonly boot = byId('boot');
  private readonly bootMsg = byId('bootMsg');
  private readonly bankPanel = byId('bank');
  private readonly bankValue = this.bankPanel.querySelector('b')!;
  private readonly shopBalance = byId('shopBalance');
  private readonly progressText = byId('progress');
  private readonly shopProgress = byId('shopProgress');
  private readonly statsPanel = byId('stats');
  private readonly helpPanel = byId('help');
  private readonly helpScoop = byId('helpScoop');
  private readonly toast = byId('toast');
  private readonly noteLine = byId('cameraNote');
  private readonly fadeLayer = byId('fade');
  private readonly keepGoingLine = byId('keepGoing');
  private readonly shopPanel = byId('shop');
  readonly shopRows = this.shopPanel.querySelector('.rows') as HTMLElement;
  readonly shopCosmetics = this.shopPanel.querySelector('.rows.cosmetics') as HTMLElement;
  private readonly shopButton = byId<HTMLButtonElement>('shopButton');
  readonly map = new Minimap();
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
    this.map.show();
  }

  /** The scoop's key in the line of keys, once there is a scoop for it to work: a key that does nothing is not listed. */
  scoopKey(owned: boolean) {
    this.helpScoop.hidden = !owned;
  }

  /** A word at the top of the screen for a few seconds: what just happened, or what a button just changed. */
  note(text: string, seconds = 2) {
    this.noteLine.textContent = text;
    this.noteLine.hidden = false;
    this.noteFor = seconds;
  }

  /** The black layer over the page, as dark as the game says: 0 none, 1 black. */
  fade(darkness: number) {
    const v = Math.max(0, Math.min(1, darkness));
    this.fadeLayer.style.opacity = v === 0 ? '0' : v.toFixed(3);
    this.map.fade(v);
  }

  /** "Keep going", over the black: 0 not there, 1 in full, as the game says. */
  keepGoing(strength: number) {
    const v = Math.max(0, Math.min(1, strength));
    this.keepGoingLine.style.opacity = v === 0 ? '0' : v.toFixed(3);
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
    this.map.cover(open);
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
  scoop(): void;
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
  const scoopButton = byId<HTMLButtonElement>('scoopButton');
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
  // the scoop likewise: it lifts as it is pressed, not as the finger comes up
  scoopButton.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    actions.scoop();
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
    showScoop: (owned: boolean) => {
      scoopButton.hidden = !owned;
    },
  };
}
