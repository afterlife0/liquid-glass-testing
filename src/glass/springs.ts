// Critically damped spring. Springs settle, so "moving" is exact and the
// renderer can sleep the moment every spring is at rest.
export class Spring {
  value: number;
  target: number;
  velocity = 0;
  constructor(v = 0, public stiffness = 260, public damping = 2 * Math.sqrt(260)) {
    this.value = v; this.target = v;
  }
  set(target: number) { this.target = target; }
  snap(v: number) { this.value = this.target = v; this.velocity = 0; }
  step(dt: number): boolean {
    if (!this.moving()) { this.value = this.target; this.velocity = 0; return false; }
    // semi-implicit Euler in fixed sub-steps for stability at low frame rates
    const n = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = Math.min(dt, 0.1) / n;
    for (let i = 0; i < n; i++) {
      const a = -this.stiffness * (this.value - this.target) - this.damping * this.velocity;
      this.velocity += a * h;
      this.value += this.velocity * h;
    }
    return true;
  }
  moving() { return Math.abs(this.value - this.target) > 1e-3 || Math.abs(this.velocity) > 1e-3; }
}

/** Fixed-duration tween used for melt/split transitions (their maths needs p ∈ [0,1]). */
export class Tween {
  p: number;
  private from = 0; private to = 0; private t0 = 0; private dur = 1;
  constructor(p = 0) { this.p = p; this.from = this.to = p; }
  go(to: number, now: number, durationMs: number) {
    this.from = this.p; this.to = to; this.t0 = now;
    this.dur = Math.max(1, durationMs * Math.abs(to - this.from));
  }
  step(now: number): boolean {
    if (this.p === this.to) return false;
    const k = Math.min(1, (now - this.t0) / this.dur);
    this.p = k >= 1 ? this.to : this.from + (this.to - this.from) * k;
    return true;
  }
  moving() { return this.p !== this.to; }
}
