/**
 * Every sound in the game, synthesised: nothing is loaded. Coins clink and
 * pitch up as a run goes on, gems thunk, the engine hums and strains under
 * a load, a fountain rumbles, a purchase chimes.
 *
 * The context is made on the first key or click, which is when the browser
 * allows it; until then every call is a no-op.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engine: { osc: OscillatorNode; osc2: OscillatorNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private rumble: { gain: GainNode } | null = null;
  private lastClink = 0;
  muted = false;

  constructor() {
    const wake = () => {
      this.ensure();
    };
    addEventListener('keydown', wake);
    addEventListener('pointerdown', wake);
    try {
      this.muted = localStorage.getItem('pushminer-muted') === '1';
    } catch {
      /* fine */
    }
  }

  private ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    // older Safari has it only under its prefix, and a browser with no audio has neither
    const w = window as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const Ctx = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    this.startEngine();
    this.startRumble();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.05);
    try {
      localStorage.setItem('pushminer-muted', this.muted ? '1' : '0');
    } catch {
      /* fine */
    }
    return this.muted;
  }

  /** A coin landing in the hole. `run` is how many have gone in on this run: the pitch climbs with it. */
  clink(run: number) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    // at most one every 40 ms: a cascade is a ripple, not a wall
    if (now - this.lastClink < 0.04) return;
    this.lastClink = now;
    const semis = Math.min(run, 36) * 0.4 + (Math.random() - 0.5) * 1.5;
    const f = 1500 * Math.pow(2, semis / 12);
    for (const [ratio, vol, decay] of [
      [1, 0.22, 0.14],
      [2.76, 0.07, 0.07],
      [5.4, 0.03, 0.05],
    ] as const) {
      const osc = ctx.createOscillator(),
        gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f * ratio;
      gain.gain.setValueAtTime(vol, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + decay + Math.random() * 0.03);
      osc.connect(gain).connect(this.master);
      osc.start(now);
      osc.stop(now + decay + 0.05);
    }
  }

  /** A gem: heavier, lower, and worth hearing on its own. */
  thunk(value: number) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const base = value >= 100 ? 220 : value >= 40 ? 260 : value >= 25 ? 300 : 340;
    const osc = ctx.createOscillator(),
      gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(base * 1.4, now);
    osc.frequency.exponentialRampToValueAtTime(base, now + 0.08);
    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.5);
    // a shimmer over the top, for the dear ones
    if (value >= 25) {
      for (let k = 0; k < 3; k++) {
        const o = ctx.createOscillator(),
          g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = base * (4 + k * 1.5);
        g.gain.setValueAtTime(0, now + 0.05 * k);
        g.gain.linearRampToValueAtTime(0.06, now + 0.05 * k + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.6 + k * 0.1);
        o.connect(g).connect(this.master);
        o.start(now);
        o.stop(now + 0.8);
      }
    }
  }

  /** The workshop's till. */
  chime() {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    [523, 659, 784, 1047].forEach((f, k) => {
      const osc = ctx.createOscillator(),
        gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const t = now + k * 0.08;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      osc.connect(gain).connect(this.master!);
      osc.start(t);
      osc.stop(t + 0.6);
    });
  }

  /** A knock on rock with nothing behind it: hollow, a low note with a ring to it, where solid rock only thuds. */
  knock() {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    for (const [f, vol, decay] of [
      [95, 0.5, 0.35],
      [190, 0.18, 0.22],
      [310, 0.08, 0.3],
    ] as const) {
      const osc = ctx.createOscillator(),
        gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f * 1.15, now);
      osc.frequency.exponentialRampToValueAtTime(f, now + 0.05);
      gain.gain.setValueAtTime(vol, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + decay);
      osc.connect(gain).connect(this.master);
      osc.start(now);
      osc.stop(now + decay + 0.05);
    }
  }

  /** Rock giving way: a crack, the stone coming down after it, and a boom under both. */
  smash() {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 1.2, ctx.sampleRate);
    const d = buffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      const t = i / d.length;
      // a sharp front, then a patter of pieces landing that thins out
      d[i] = (Math.random() * 2 - 1) * (Math.pow(1 - t, 4) + (Math.random() < 0.004 * (1 - t) ? 0.8 : 0));
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1600;
    const gain = ctx.createGain();
    gain.gain.value = 0.8;
    src.connect(filter).connect(gain).connect(this.master);
    src.start(now);
    const boom = ctx.createOscillator(),
      boomGain = ctx.createGain();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(90, now);
    boom.frequency.exponentialRampToValueAtTime(35, now + 0.6);
    boomGain.gain.setValueAtTime(0.7, now);
    boomGain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
    boom.connect(boomGain).connect(this.master);
    boom.start(now);
    boom.stop(now + 0.9);
  }

  /** A lamp knocked over: the glass going, a few bits of it tinkling after, and the bulb's last fizz. */
  shatter() {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = buffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 6);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 2500;
    const gain = ctx.createGain();
    gain.gain.value = 0.5;
    src.connect(filter).connect(gain).connect(this.master);
    src.start(now);
    for (let k = 0; k < 6; k++) {
      const t = now + 0.05 + Math.random() * 0.35;
      const osc = ctx.createOscillator(),
        g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 3000 + Math.random() * 3500;
      g.gain.setValueAtTime(0.06, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      osc.connect(g).connect(this.master);
      osc.start(t);
      osc.stop(t + 0.1);
    }
    const fizz = ctx.createOscillator(),
      fg = ctx.createGain();
    fizz.type = 'sawtooth';
    fizz.frequency.setValueAtTime(120, now);
    fizz.frequency.exponentialRampToValueAtTime(40, now + 0.25);
    fg.gain.setValueAtTime(0.05, now);
    fg.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    fizz.connect(fg).connect(this.master);
    fizz.start(now);
    fizz.stop(now + 0.3);
  }

  /** A blade into a wall that does not give: a dull thump, and nothing after it. */
  clunk() {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator(),
      gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(55, now + 0.12);
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  /** The rock cracking, before a fountain. */
  crack() {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate);
    const d = buffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    const gain = ctx.createGain();
    gain.gain.value = 0.6;
    src.connect(filter).connect(gain).connect(this.master);
    src.start(now);
  }

  /** The air horn: two notes a fourth apart, through a resonant filter, held for half a second. */
  horn() {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1400;
    filter.Q.value = 4;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.35, now + 0.04);
    gain.gain.setValueAtTime(0.35, now + 0.45);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
    filter.connect(gain).connect(this.master);
    for (const f of [311, 415]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      osc.frequency.setValueAtTime(f * 0.97, now);
      osc.frequency.linearRampToValueAtTime(f, now + 0.06);
      osc.connect(filter);
      osc.start(now);
      osc.stop(now + 0.75);
    }
  }

  private startEngine() {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator(),
      osc2 = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc2.type = 'square';
    osc.frequency.value = 45;
    osc2.frequency.value = 45.5;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 220;
    filter.Q.value = 2;
    const gain = ctx.createGain();
    gain.gain.value = 0.0;
    const mix = ctx.createGain();
    mix.gain.value = 0.5;
    osc.connect(mix);
    osc2.connect(mix);
    mix.connect(filter).connect(gain).connect(this.master!);
    osc.start();
    osc2.start();
    this.engine = { osc, osc2, filter, gain };
  }

  /** Every frame: how hard it is being driven, how fast it goes, and what it is pushing. */
  drive(throttle: number, speed: number, load: number) {
    const e = this.engine,
      ctx = this.ctx;
    if (!e || !ctx) return;
    const now = ctx.currentTime;
    const revs = 0.25 + Math.abs(throttle) * 0.45 + Math.min(1, Math.abs(speed) / 20) * 0.3;
    // a load pulls the revs down and thickens the note
    const strain = Math.min(1, load / 60);
    const f = 40 + revs * 70 - strain * 18;
    e.osc.frequency.setTargetAtTime(f, now, 0.08);
    e.osc2.frequency.setTargetAtTime(f * 1.005 + strain * 3, now, 0.08);
    e.filter.frequency.setTargetAtTime(180 + revs * 500 + strain * 250, now, 0.1);
    e.gain.gain.setTargetAtTime(0.05 + revs * 0.13 + strain * 0.06, now, 0.1);
  }

  private startRumble() {
    const ctx = this.ctx!;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 120;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.master!);
    src.start();
    this.rumble = { gain };
  }

  /** How much the ground is shaking right now, 0 to 1. */
  shake(amount: number) {
    if (!this.rumble || !this.ctx) return;
    this.rumble.gain.gain.setTargetAtTime(Math.min(1, amount) * 0.8, this.ctx.currentTime, 0.15);
  }
}
