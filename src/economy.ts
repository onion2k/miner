/**
 * The bank and what it buys: engine, blade, the four locked rooms, a belt
 * for each, and drones. Saved in the browser, so the cave is where you
 * left it.
 */
import { AREAS } from './cave';
import type { DozerSpec } from './dozer';

export interface Save {
  bank: number;
  banked: number;
  engine: number;
  blade: number;
  areas: boolean[];
  belts: boolean[];
  drones: number;
  magnet: number;
  /** Which paint the dozer wears, and which it owns. */
  paint: string;
  paints: string[];
  horn: boolean;
  flag: boolean;
}

export interface Paint { id: string; name: string; colour: [number, number, number]; roughness: number; cost: number }
export const PAINTS: Paint[] = [
  { id: 'yellow', name: 'Works Yellow', colour: [0.96, 0.7, 0.12], roughness: 0.45, cost: 0 },
  { id: 'red', name: 'Fire Engine', colour: [0.85, 0.12, 0.1], roughness: 0.4, cost: 150 },
  { id: 'blue', name: 'Deep Sea', colour: [0.12, 0.35, 0.85], roughness: 0.4, cost: 150 },
  { id: 'mint', name: 'Mint Choc', colour: [0.45, 0.85, 0.65], roughness: 0.5, cost: 200 },
  { id: 'pink', name: 'Bubblegum', colour: [0.95, 0.45, 0.7], roughness: 0.5, cost: 200 },
  { id: 'black', name: 'Midnight', colour: [0.08, 0.08, 0.1], roughness: 0.25, cost: 300 },
  { id: 'chrome', name: 'Chrome', colour: [0.9, 0.9, 0.95], roughness: 0.05, cost: 800 },
];
export const HORN_COST = 80;
export const FLAG_COST = 120;

const KEY = 'pushminer-save-v1';

const ENGINE: { maxSpeed: number; accel: number; turnRate: number; cost: number }[] = [
  { maxSpeed: 11, accel: 14, turnRate: 1.6, cost: 0 },
  { maxSpeed: 14, accel: 20, turnRate: 1.9, cost: 60 },
  { maxSpeed: 17, accel: 28, turnRate: 2.2, cost: 200 },
  { maxSpeed: 21, accel: 38, turnRate: 2.5, cost: 550 },
  { maxSpeed: 25, accel: 50, turnRate: 2.8, cost: 1400 },
  { maxSpeed: 30, accel: 64, turnRate: 3.1, cost: 3200 },
];
const BLADE: { width: number; cost: number }[] = [
  { width: 6.5, cost: 0 }, { width: 8, cost: 90 }, { width: 10, cost: 350 }, { width: 12.5, cost: 1100 },
];
const MAGNET: { radius: number; strength: number; cost: number }[] = [
  { radius: 4, strength: 5, cost: 0 },
  { radius: 6, strength: 9, cost: 120 },
  { radius: 8.5, strength: 14, cost: 380 },
  { radius: 11, strength: 20, cost: 950 },
  { radius: 14, strength: 28, cost: 2200 },
  { radius: 18, strength: 38, cost: 5000 },
];
export const MAX_DRONES = 3;
const DRONE_COST = [500, 1300, 3000];

export interface Offer {
  id: string;
  title: string;
  sub: string;
  cost: number;
  owned: boolean;
  /** Whether it can be bought at all yet, apart from the money. */
  available: boolean;
  /** For a thing that is worn: whether it is worn now. Owned and not active means clicking puts it on. */
  active?: boolean;
}

export class Economy {
  save: Save;
  private listeners: ((id: string) => void)[] = [];
  /** Set by `reset`: nothing is saved again, so a coin banked while the page reloads cannot resurrect the old save. */
  private wiped = false;

  constructor() {
    this.save = { bank: 0, banked: 0, engine: 0, blade: 0, areas: AREAS.map((_, a) => a === 0), belts: AREAS.map(() => false), drones: 0, magnet: 0, paint: 'yellow', paints: ['yellow'], horn: false, flag: false };
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw) as Partial<Save>;
        this.save = { ...this.save, ...s, areas: [true, ...(s.areas ?? []).slice(1)], belts: s.belts ?? this.save.belts };
        // a save from before an area existed has it shut
        while (this.save.areas.length < AREAS.length) this.save.areas.push(false);
        while (this.save.belts.length < AREAS.length) this.save.belts.push(false);
      }
    } catch { /* a browser with no storage plays from the start */ }
  }

  get bank() { return this.save.bank; }

  deposit(value: number) {
    this.save.bank += value;
    this.save.banked += value;
    this.persist();
  }

  spec(): DozerSpec {
    const e = ENGINE[this.save.engine];
    const m = MAGNET[this.save.magnet];
    return { maxSpeed: e.maxSpeed, accel: e.accel, turnRate: e.turnRate, bladeWidth: BLADE[this.save.blade].width, magnetRadius: m.radius, magnetStrength: m.strength };
  }

  /** Something to do when a purchase lands: the game rebuilds what changed. */
  onBuy(fn: (id: string) => void) { this.listeners.push(fn); }

  offers(): Offer[] {
    const s = this.save;
    const out: Offer[] = [];
    const e = s.engine + 1 < ENGINE.length ? ENGINE[s.engine + 1] : null;
    out.push({
      id: 'engine', title: `Engine ${e ? `Mk ${s.engine + 2}` : 'maxed'}`,
      sub: e ? `top speed ${e.maxSpeed}, turns faster` : `Mk ${s.engine + 1}: as fast as it goes`,
      cost: e?.cost ?? 0, owned: !e, available: !!e,
    });
    const b = s.blade + 1 < BLADE.length ? BLADE[s.blade + 1] : null;
    out.push({
      id: 'blade', title: `Wider blade${b ? '' : ' (maxed)'}`,
      sub: b ? `${b.width} across, up from ${BLADE[s.blade].width}` : `${BLADE[s.blade].width} across: the widest made`,
      cost: b?.cost ?? 0, owned: !b, available: !!b,
    });
    const m = s.magnet + 1 < MAGNET.length ? MAGNET[s.magnet + 1] : null;
    out.push({
      id: 'magnet', title: `Magnet ${m ? `Mk ${s.magnet + 2}` : 'maxed'}`,
      sub: m ? `pulls coins from ${m.radius} away, up from ${MAGNET[s.magnet].radius}` : `reaches ${MAGNET[s.magnet].radius}: nothing escapes it`,
      cost: m?.cost ?? 0, owned: !m, available: !!m,
    });
    for (let a = 1; a < AREAS.length; a++) {
      const area = AREAS[a];
      out.push({
        id: `area${a}`, title: `Open the ${area.name}`,
        sub: area.blurb,
        cost: area.cost, owned: s.areas[a], available: s.areas[area.after],
      });
    }
    for (let a = 1; a < AREAS.length; a++) {
      const belt = AREAS[a].belt!;
      out.push({
        id: `belt${a}`, title: `Conveyor to the ${AREAS[a].name}`,
        sub: 'push coins onto it and it carries them to the hole',
        cost: belt.cost, owned: s.belts[a], available: s.areas[a],
      });
    }
    const d = s.drones < MAX_DRONES ? DRONE_COST[s.drones] : null;
    out.push({
      id: 'drone', title: `Robo-dozer ${d ? s.drones + 1 : 'fleet complete'}`,
      sub: d ? 'a small bulldozer that drives itself: finds a heap, pushes it in, goes again' : `${MAX_DRONES} robo-dozers, working`,
      cost: d ?? 0, owned: !d, available: !!d,
    });
    return out;
  }

  paint(): Paint {
    return PAINTS.find((p) => p.id === this.save.paint) ?? PAINTS[0];
  }

  /** The things that change how the dozer looks and sounds, not what it does. */
  cosmetics(): Offer[] {
    const s = this.save;
    const out: Offer[] = PAINTS.map((p) => ({
      id: `paint:${p.id}`, title: p.name, sub: s.paint === p.id ? 'on the dozer now' : s.paints.includes(p.id) ? 'in the shed: click to wear it' : 'a coat of paint for the hull',
      cost: p.cost, owned: s.paints.includes(p.id), available: true, active: s.paint === p.id,
    }));
    out.push({ id: 'horn', title: 'Air horn', sub: s.horn ? 'press H. The coins jump.' : 'press H to honk. Startles the coins.', cost: HORN_COST, owned: s.horn, available: true });
    out.push({ id: 'flag', title: 'Pennant', sub: 'a little flag on a pole on the cab', cost: FLAG_COST, owned: s.flag, available: true });
    return out;
  }

  buy(id: string): boolean {
    const offer = [...this.offers(), ...this.cosmetics()].find((o) => o.id === id);
    if (!offer || !offer.available) return false;
    if (offer.owned) {
      // a paint already owned is put on, not bought again
      if (id.startsWith('paint:') && !offer.active) {
        this.save.paint = id.slice(6);
        this.persist();
        for (const fn of this.listeners) fn(id);
        return true;
      }
      return false;
    }
    if (this.save.bank < offer.cost) return false;
    this.save.bank -= offer.cost;
    const s = this.save;
    if (id === 'engine') s.engine++;
    else if (id === 'blade') s.blade++;
    else if (id === 'drone') s.drones++;
    else if (id === 'magnet') s.magnet++;
    else if (id === 'horn') s.horn = true;
    else if (id === 'flag') s.flag = true;
    else if (id.startsWith('paint:')) { s.paints.push(id.slice(6)); s.paint = id.slice(6); }
    else if (id.startsWith('area')) s.areas[+id.slice(4)] = true;
    else if (id.startsWith('belt')) s.belts[+id.slice(4)] = true;
    this.persist();
    for (const fn of this.listeners) fn(id);
    return true;
  }

  reset() {
    this.wiped = true;
    try { localStorage.removeItem(KEY); } catch { /* nothing to remove */ }
    location.reload();
  }

  private persist() {
    if (this.wiped) return;
    try { localStorage.setItem(KEY, JSON.stringify(this.save)); } catch { /* fine */ }
  }
}

/** The shop's rows, rebuilt into `rows` whenever the bank or the stock changes. */
export function renderShop(rows: HTMLElement, economy: Economy, offers = economy.offers()) {
  const bank = economy.bank;
  const existing = Array.from(rows.children) as HTMLButtonElement[];
  offers.forEach((o, i) => {
    let btn = existing[i];
    if (!btn) {
      btn = document.createElement('button');
      btn.addEventListener('click', () => { if (economy.buy(btn.dataset.id!)) renderShop(rows, economy, rows.classList.contains('cosmetics') ? economy.cosmetics() : undefined); });
      rows.appendChild(btn);
    }
    btn.dataset.id = o.id;
    const wearable = o.owned && o.active === false;
    btn.disabled = !wearable && (o.owned || !o.available || bank < o.cost);
    btn.className = o.active ? 'owned active' : o.owned ? 'owned' : '';
    const cost = o.active ? 'worn' : o.owned ? (wearable ? 'wear' : '✓') : !o.available ? 'locked' : `${o.cost}`;
    btn.innerHTML = `<span>${o.title}<small>${o.sub}</small></span><span class="cost">${cost}</span>`;
  });
  while (rows.children.length > offers.length) rows.lastChild!.remove();
}
