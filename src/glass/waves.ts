// §5 ripples: wave source pool + gesture classification.
// Units: positions in DEVICE px (top-down), times in renderer seconds.
import { clamp } from './geometry';
import { Spring } from './springs';

export const WAVE_LIFE = 1.5;
export const WAVE_DECAY = 2.9;
export const WAVE_FLOOR = 0.004;
export const MAX_SOURCES = 3;

export interface WaveSource {
  x: number; y: number;   // origin
  t0: number;             // start time (may be in the future: the tap echo)
  amp: number;
  dx: number; dy: number; // throw direction (flick / wake)
  aniso: number;          // 0 = isotropic, 1 = one-sided
}

/** Classify contact force before it becomes a wave. Mouse reports 0.5 while down. */
export function hardness(pressure: number, width: number, height: number, firmModifier = false): number {
  if (firmModifier) return 0.85; // desktop affordance: Shift+click is a firm tap
  const force = pressure > 0 ? pressure : 0.5;
  const size = Math.max(width || 0, height || 0);
  return clamp(((force - 0.3) / 0.45) * 0.7 + (Math.max(0, size - 18) / 45) * 0.6, 0, 1);
}

export class WaveField {
  sources: WaveSource[] = [];
  /** wavenumber — THE parameter that silently kills ripples (bug #5). ~0.06/px at 116px. */
  wk = 0.06;
  ww = 30;
  ws = 200;
  holdR = 20;
  holdX = 0; holdY = 0;
  readonly holdDepth = new Spring(0, 60, 2 * Math.sqrt(60) * 0.7); // slightly under-damped: the rebound
  size = 100;

  configure(sizeDev: number, hard = 0) {
    this.size = Math.max(8, sizeDev);
    this.wk = (7.6 - 2.4 * hard) / this.size;
    this.ww = this.size * 0.30;
    this.ws = this.size * 1.9 * (1 - 0.3 * hard); // firm tap: slower front — a thud, not a tick
    this.holdR = this.size * 0.2;
  }

  emit(s: WaveSource, now: number) {
    this.prune(now);
    if (this.sources.length >= MAX_SOURCES) {
      // evict the source with the least remaining energy
      let worst = 0, worstE = Infinity;
      this.sources.forEach((w, i) => { const e = energy(w, now); if (e < worstE) { worstE = e; worst = i; } });
      this.sources.splice(worst, 1);
    }
    this.sources.push(s);
  }

  prune(now: number) { this.sources = this.sources.filter(w => alive(w, now)); }

  /** Waves have a known death time — this is what makes exact sleep possible. */
  live(now: number): boolean {
    return this.sources.some(w => alive(w, now)) || this.holdDepth.moving() || this.holdDepth.value > 0.002;
  }
}

function energy(w: WaveSource, now: number) {
  const age = now - w.t0;
  return age < 0 ? w.amp : w.amp * Math.exp(-age * WAVE_DECAY);
}
function alive(w: WaveSource, now: number) {
  return now - w.t0 < WAVE_LIFE && energy(w, now) >= WAVE_FLOOR;
}

type Mode = 'idle' | 'down' | 'hold' | 'drag';

/** Turns pointer samples into wave sources: tap, firm tap, hold, release, drag wake, flick. */
export class GestureTracker {
  mode: Mode = 'idle';
  private sx = 0; private sy = 0; private st = 0; private hard = 0;
  private lx = 0; private ly = 0; private travelled = 0;
  private trail: { x: number; y: number; t: number }[] = [];

  constructor(private field: WaveField, private dpr: () => number) {}

  down(x: number, y: number, t: number, hard: number) {
    this.mode = 'down';
    this.sx = this.lx = x; this.sy = this.ly = y; this.st = t; this.hard = hard;
    this.travelled = 0; this.trail = [{ x, y, t }];
  }

  move(x: number, y: number, t: number) {
    if (this.mode === 'idle') return;
    const f = this.field, dpr = this.dpr();
    this.trail.push({ x, y, t });
    while (this.trail.length > 2 && t - this.trail[0].t > 0.1) this.trail.shift();
    if (this.mode === 'hold') { f.holdX = x; f.holdY = y; this.lx = x; this.ly = y; return; }
    const dx = x - this.lx, dy = y - this.ly, step = Math.hypot(dx, dy);
    if (this.mode === 'down' && Math.hypot(x - this.sx, y - this.sy) > 6 * dpr) {
      this.mode = 'drag'; f.configure(f.size, 0);
    }
    if (this.mode === 'drag') {
      this.travelled += step;
      if (this.travelled >= 24 * dpr && step > 0) {
        // a wake: small packets shed every 24px, biased backwards along the path
        this.travelled = 0;
        f.emit({ x, y, t0: t, amp: 0.16, dx: -dx / step, dy: -dy / step, aniso: 0.55 }, t);
      }
    }
    this.lx = x; this.ly = y;
  }

  /** Call every frame while the pointer is down: hold is time-based. */
  tick(t: number) {
    if (this.mode === 'down' && t - this.st > 0.28) {
      this.mode = 'hold';
      const f = this.field;
      f.holdX = this.lx; f.holdY = this.ly;
      f.holdDepth.set(1);
    }
  }

  up(x: number, y: number, t: number) {
    const f = this.field;
    const mode = this.mode;
    this.mode = 'idle';
    if (mode === 'down') {
      // tap / firm tap, plus a smaller ring 90ms behind — the droplet rebound
      f.configure(f.size, this.hard);
      const amp = 0.34 + 0.46 * this.hard;
      f.emit({ x: this.sx, y: this.sy, t0: t, amp, dx: 0, dy: 0, aniso: 0 }, t);
      f.emit({ x: this.sx, y: this.sy, t0: t + 0.09, amp: 0.14, dx: 0, dy: 0, aniso: 0 }, t);
    } else if (mode === 'hold') {
      // the dimple rebounds into a long low swell scaled by its depth
      const depth = f.holdDepth.value;
      f.wk = 3.4 / f.size; f.ww = f.size * 0.45; f.ws = f.size * 1.3;
      f.emit({ x, y, t0: t, amp: 0.55 * depth, dx: 0, dy: 0, aniso: 0 }, t);
      f.holdDepth.set(0);
    } else if (mode === 'drag') {
      const a = this.trail[0], b = this.trail[this.trail.length - 1];
      const dt = Math.max(1e-3, b.t - a.t);
      const vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt, speed = Math.hypot(vx, vy) / this.dpr();
      if (speed > 800) {
        // flick: anisotropic — runs hard one way and dies the other
        const n = Math.hypot(vx, vy);
        f.emit({ x, y, t0: t, amp: 0.6, dx: vx / n, dy: vy / n, aniso: 1 }, t);
      }
    }
  }

  cancel() {
    if (this.mode === 'hold') this.field.holdDepth.set(0);
    this.mode = 'idle';
  }
}
