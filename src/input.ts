/** The keyboard: WASD or arrows to drive, and a few one-shot keys. */
export interface Drive { throttle: number; steer: number }

export class Input {
  private down = new Set<string>();
  private shop = false;
  private recentre = false;

  constructor() {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      this.down.add(k);
      if (k === 'b') this.shop = true;
      if (k === 'c') this.recentre = true;
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.down.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.down.clear());
  }

  private is(...keys: string[]) { return keys.some((k) => this.down.has(k)); }

  read(): Drive {
    const throttle = (this.is('w', 'arrowup') ? 1 : 0) - (this.is('s', 'arrowdown') ? 1 : 0);
    const steer = (this.is('a', 'arrowleft') ? 1 : 0) - (this.is('d', 'arrowright') ? 1 : 0);
    return { throttle, steer };
  }

  takeShop() { const v = this.shop; this.shop = false; return v; }
  takeRecentre() { const v = this.recentre; this.recentre = false; return v; }
}
