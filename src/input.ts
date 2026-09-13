/** The keyboard: WASD or arrows to drive, and a few one-shot keys. On a phone, the sliders. */
export interface Drive { throttle: number; steer: number }

export class Input {
  private down = new Set<string>();
  private shop = false;
  private recentre = false;
  private mute = false;
  private horn = false;
  private camera = false;
  /** The phone's sliders, when there are any: read when no drive key is down. */
  touch: { drive(): Drive } | null = null;

  constructor() {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      this.down.add(k);
      if (k === 'b') this.shop = true;
      if (k === 'c') this.recentre = true;
      if (k === 'm') this.mute = true;
      if (k === 'h') this.horn = true;
      if (k === 'v') this.camera = true;
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.down.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.down.clear());
  }

  private is(...keys: string[]) { return keys.some((k) => this.down.has(k)); }

  read(): Drive {
    const throttle = (this.is('w', 'arrowup') ? 1 : 0) - (this.is('s', 'arrowdown') ? 1 : 0);
    const steer = (this.is('a', 'arrowleft') ? 1 : 0) - (this.is('d', 'arrowright') ? 1 : 0);
    if (throttle || steer || !this.touch) return { throttle, steer };
    return this.touch.drive();
  }

  /** The shop, asked for by something other than the B key: the phone's button. */
  toggleShop() { this.shop = true; }
  /** The camera, from the phone's button. */
  pressCamera() { this.camera = true; }
  /** The horn, from the phone's button. */
  pressHorn() { this.horn = true; }

  takeShop() { const v = this.shop; this.shop = false; return v; }
  takeRecentre() { const v = this.recentre; this.recentre = false; return v; }
  takeMute() { const v = this.mute; this.mute = false; return v; }
  takeHorn() { const v = this.horn; this.horn = false; return v; }
  takeCamera() { const v = this.camera; this.camera = false; return v; }
}
