// One WebGL2 canvas for every Tier A surface: context, resources, frame loop, sleep.
import quadVert from './shaders/quad.vert?raw';
import sceneFrag from './shaders/scene.frag?raw';
import downFrag from './shaders/down.frag?raw';
import gaussFrag from './shaders/gauss.frag?raw';
import blitFrag from './shaders/blit.frag?raw';
import shadowFrag from './shaders/shadow.frag?raw';
import glassFrag from './shaders/glass.frag?raw';
import { program, Program } from './gl';
import { Scene } from './scene';
import { ShadowCache, SHADOW_AMOUNT } from './material';
import { GestureTracker, hardness, WaveField } from './waves';
import { Spring } from './springs';
import {
  Shape, SHARP_CUT, EDGE_REACH, bevelThickness, cornerExponent, lensMagnification, shadowSpread, shapeFromRect,
} from './geometry';

export const MAX_DPR = 2;
export const BLUR_CSS_PX = 10;
/** Light softening for the clear (half-res) source. */
export const CLEAR_CSS_PX = 2.5;
/** Device-px scale on the shader's 40.0 wave-refraction constant. */
export const REFRACT = 0.3;
/** Wave gain per device px ratio. The brief's 22.0 was tuned at a larger refraction scale. */
export const WAVE_GAIN = 2.5;

export interface SurfaceOptions {
  /** Explicit radius (concentric nesting). Default: the size rule in §4. */
  radius?: number;
  /** Press response: goes nearly white and blooms. For controls, not containers. */
  pressable?: boolean;
  ripples?: boolean;
  shadow?: boolean;
  z?: number;
}

/** Per-frame shape override for morphing surfaces (melt, split). CSS px. */
export interface CustomShape {
  shapes: Shape[];
  melt?: number;
  k?: number;          // smooth-union radius, CSS px
  shadow?: number;     // 0..1 multiplier
}

let nextId = 1;

export class Surface {
  readonly id = nextId++;
  el: HTMLElement | null = null;
  custom: ((nowMs: number) => CustomShape | null) | null = null;
  enabled = true;
  readonly press = new Spring(0, 520, 2 * Math.sqrt(520) * 0.8);
  readonly field = new WaveField();
  readonly gestures: GestureTracker;
  // resolved each frame
  shapes: Shape[] = [];
  melt = 0;
  k = 0;
  shadowMul = 1;
  private lastKey = '';
  private pressVar = -1;

  constructor(public opts: SurfaceOptions, dpr: () => number) {
    this.gestures = new GestureTracker(this.field, dpr);
  }

  /** Returns true when geometry changed since the previous frame. */
  resolve(nowMs: number): boolean {
    this.melt = 0; this.k = 0; this.shadowMul = 1;
    const c = this.custom?.(nowMs);
    if (c) {
      this.shapes = c.shapes; this.melt = c.melt ?? 0; this.k = c.k ?? 0; this.shadowMul = c.shadow ?? 1;
    } else if (this.el) {
      const r = this.el.getBoundingClientRect();
      this.shapes = r.width > 0 && r.height > 0 ? [shapeFromRect(r, this.opts.radius)] : [];
    } else this.shapes = [];
    const key = this.shapes.map(s => `${s.cx.toFixed(2)},${s.cy.toFixed(2)},${s.hw.toFixed(2)},${s.hh.toFixed(2)},${s.r.toFixed(2)}`).join(';') + `|${this.melt.toFixed(3)}|${this.k.toFixed(2)}`;
    const changed = key !== this.lastKey;
    this.lastKey = key;
    return changed;
  }

  /** Icon crossfade dark→light at the press peak is driven from CSS via --glass-press. */
  syncPressVar() {
    if (!this.el) return;
    const v = Math.round(this.press.value * 100) / 100;
    if (v !== this.pressVar) { this.pressVar = v; this.el.style.setProperty('--glass-press', String(v)); }
  }
}

export interface RendererStats {
  awake: boolean;
  frames: number;
  sceneRenders: number;
  cpuMs: number;
  surfaces: number;
  tierAAreaPct: number;
  shadowBakes: number;
  dpr: number;
}

export interface RendererSettings {
  refraction: number;   // 1 = tuned default
  ripples: boolean;
  reducedMotion: boolean;
  shadowAmount: number;
}

interface GL {
  gl: WebGL2RenderingContext;
  vao: WebGLVertexArrayObject;
  scene: Scene;
  shadows: ShadowCache;
  blit: Program; shadow: Program; glass: Program;
}

export class GlassRenderer {
  readonly surfaces = new Set<Surface>();
  settings: RendererSettings = { refraction: 1, ripples: true, reducedMotion: false, shadowAmount: SHADOW_AMOUNT };
  onStats: ((s: RendererStats) => void) | null = null;
  onContextChange: ((ok: boolean) => void) | null = null;

  private g: GL | null = null;
  private raf = 0;
  private sleeping = true;
  private wakeUntil = 0;
  private lastT = 0;
  private sceneDirty = true;
  private pointersDown = 0;
  private running = new Set<EventTarget>();
  private animators = new Set<(nowMs: number) => boolean>();
  private art: { src: HTMLCanvasElement; scale: number } | null = null;
  private pan = 0;
  private dim = new Spring(0, 120, 2 * Math.sqrt(120));
  private readonly t0 = performance.now();
  private stats: RendererStats = { awake: false, frames: 0, sceneRenders: 0, cpuMs: 0, surfaces: 0, tierAAreaPct: 0, shadowBakes: 0, dpr: 1 };
  private lastStatsAt = 0;
  private cleanup: (() => void)[] = [];
  private lost = false;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.init();
    const onLost = (e: Event) => {
      e.preventDefault(); // allow restoration
      this.lost = true;
      cancelAnimationFrame(this.raf); this.raf = 0; this.sleeping = true;
      this.g = null;
      this.onContextChange?.(false);
    };
    const onRestored = () => {
      this.lost = false;
      this.init();
      this.onContextChange?.(true);
      this.wake();
    };
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    this.cleanup.push(() => {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
    });

    // Every event calls wake(). Scroll is captured so nested scrollers count.
    const wake = () => this.wake();
    const onRun = (e: Event) => { this.running.add(e.target!); this.wake(); };
    const onEnd = (e: Event) => { this.running.delete(e.target!); this.wake(); };
    const onResize = () => { this.sceneDirty = true; this.wake(); };
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', wake, { capture: true, passive: true });
    document.addEventListener('transitionrun', onRun);
    document.addEventListener('transitionend', onEnd);
    document.addEventListener('transitioncancel', onEnd);
    document.addEventListener('animationstart', onRun);
    document.addEventListener('animationend', onEnd);
    document.addEventListener('animationcancel', onEnd);
    // Layout can move a panel without resizing it (a sibling grows). Any DOM
    // mutation wakes us for a few frames of rect reads — except the per-frame
    // style writes we make ourselves, which would otherwise keep us awake.
    const mo = new MutationObserver(records => {
      for (const r of records) {
        if (r.type === 'attributes' && r.attributeName === 'style' && (r.target as Element).closest?.('[data-glass-driven]')) continue;
        if ((r.target as Element).closest?.('[data-glass-quiet]') || r.target.parentElement?.closest('[data-glass-quiet]')) continue;
        this.wake(); return;
      }
    });
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    this.cleanup.push(() => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', wake, { capture: true });
      document.removeEventListener('transitionrun', onRun);
      document.removeEventListener('transitionend', onEnd);
      document.removeEventListener('transitioncancel', onEnd);
      document.removeEventListener('animationstart', onRun);
      document.removeEventListener('animationend', onEnd);
      document.removeEventListener('animationcancel', onEnd);
      mo.disconnect();
    });
  }

  get contextLost() { return this.lost; }
  get maxTextureSize(): number { return (this.g?.gl.getParameter(this.g.gl.MAX_TEXTURE_SIZE) as number) ?? 4096; }
  get dpr() { return Math.min(window.devicePixelRatio || 1, MAX_DPR); }
  /** Renderer clock, seconds. */
  now() { return (performance.now() - this.t0) / 1000; }

  private init() {
    const gl = this.canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'default',
    });
    if (!gl) throw new Error('WebGL2 unavailable');
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    // Ship one shader variant, compiled once at startup.
    const P = (fs: string) => program(gl, quadVert, fs);
    const scenePrograms = { scene: P(sceneFrag), down: P(downFrag), gauss: P(gaussFrag) };
    this.g = {
      gl, vao,
      scene: new Scene(gl, scenePrograms, vao),
      shadows: new ShadowCache(gl),
      blit: P(blitFrag), shadow: P(shadowFrag), glass: P(glassFrag),
    };
    if (this.art) this.g.scene.setArt(this.art.src, this.art.scale);
    this.sceneDirty = true;
  }

  // ── public API ────────────────────────────────────────────────────────────

  createSurface(opts: SurfaceOptions): Surface {
    const s = new Surface(opts, () => this.dpr);
    this.surfaces.add(s);
    this.wake();
    return s;
  }
  removeSurface(s: Surface) { this.surfaces.delete(s); this.wake(); }

  setArt(src: HTMLCanvasElement, scale: number) {
    this.art = { src, scale };
    this.g?.scene.setArt(src, scale);
    this.markSceneDirty();
  }
  setPan(cssPx: number) { if (cssPx !== this.pan) { this.pan = cssPx; this.markSceneDirty(); } }
  setDim(v: number) { this.dim.set(v); this.wake(); }
  markSceneDirty() { this.sceneDirty = true; this.wake(); }
  updateSettings(s: Partial<RendererSettings>) { this.settings = { ...this.settings, ...s }; this.wake(); }

  /** Register a per-frame callback (tweens). It keeps the loop awake until it returns false. */
  animate(fn: (nowMs: number) => boolean): () => void { this.animators.add(fn); this.wake(); return () => { this.animators.delete(fn); }; }

  wake() {
    if (this.lost || !this.g) return;
    this.wakeUntil = performance.now() + 150;
    if (this.sleeping) {
      this.sleeping = false;
      this.lastT = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }
  }

  // Pointer → press + gesture classification.
  pointerDown(s: Surface, e: PointerEvent) {
    const dpr = this.dpr, t = this.now();
    if (s.opts.pressable) s.press.set(1);
    if (this.ripplesOn(s)) s.gestures.down(e.clientX * dpr, e.clientY * dpr, t, hardness(e.pressure, e.width, e.height, e.shiftKey));
    this.pointersDown++;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      if (this.ripplesOn(s)) s.gestures.move(ev.clientX * dpr, ev.clientY * dpr, this.now());
      this.wake();
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      this.pointersDown = Math.max(0, this.pointersDown - 1);
      s.press.set(0);
      if (ev.type === 'pointercancel') s.gestures.cancel();
      else if (this.ripplesOn(s)) s.gestures.up(ev.clientX * dpr, ev.clientY * dpr, this.now());
      this.wake();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    this.wake();
  }

  private ripplesOn(s: Surface) { return s.opts.ripples !== false && this.settings.ripples && !this.settings.reducedMotion; }

  /** Debug: force context loss through WEBGL_lose_context, restore after ms. */
  simulateContextLoss(restoreAfterMs = 1500) {
    const ext = this.g?.gl.getExtension('WEBGL_lose_context');
    if (!ext) return;
    ext.loseContext();
    setTimeout(() => ext.restoreContext(), restoreAfterMs);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.cleanup.forEach(f => f());
    // Free resources but keep the context: a canvas has exactly one, and the
    // next renderer (theme switch, StrictMode remount) reuses it.
    if (this.g) {
      const { gl } = this.g;
      this.g.scene.dispose(); this.g.shadows.dispose();
      for (const p of [this.g.blit, this.g.shadow, this.g.glass]) gl.deleteProgram(p.prog);
      gl.deleteVertexArray(this.g.vao);
    }
    this.g = null;
    this.sleeping = true;
  }

  // ── frame ─────────────────────────────────────────────────────────────────

  private frame = (tMs: number) => {
    this.raf = 0;
    const g = this.g;
    if (!g || this.lost) { this.sleeping = true; return; }
    const cpu0 = performance.now();
    const dt = Math.min(0.1, Math.max(0, (tMs - this.lastT) / 1000));
    this.lastT = tMs;
    const now = this.now();
    const { gl } = g;
    const dpr = this.dpr;

    // size
    const W = Math.max(1, Math.round(window.innerWidth * dpr)), H = Math.max(1, Math.round(window.innerHeight * dpr));
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W; this.canvas.height = H;
      this.sceneDirty = true;
    }
    g.scene.resize(W, H);

    // animations and springs
    let busy = this.pointersDown > 0 || this.running.size > 0;
    for (const a of this.animators) { if (!a(performance.now())) this.animators.delete(a); else busy = true; }
    if (this.dim.step(dt)) { this.sceneDirty = true; busy = true; }

    // Rect sync: read every panel rect once per frame while awake. A rect stale
    // for one frame makes glass visibly lag its content.
    const list = [...this.surfaces].filter(s => s.enabled).sort((a, b) => (a.opts.z ?? 0) - (b.opts.z ?? 0) || a.id - b.id);
    let area = 0;
    for (const s of list) {
      if (s.resolve(performance.now())) busy = true;
      s.gestures.tick(now);
      if (s.press.step(dt)) busy = true;
      if (s.field.holdDepth.step(dt)) busy = true;
      if (s.field.live(now)) busy = true;
      s.syncPressVar();
      for (const sh of s.shapes) area += 4 * sh.hw * sh.hh;
    }

    // scene composite + blur chain, only when the backdrop moved
    const didScene = this.sceneDirty;
    if (this.sceneDirty) {
      g.scene.render(this.pan * dpr, this.dim.value, BLUR_CSS_PX, CLEAR_CSS_PX, dpr);
      this.sceneDirty = false;
      this.stats.sceneRenders++;
    }

    // blit, then shadow + glass per surface in z order
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.bindVertexArray(g.vao);
    gl.disable(gl.BLEND);
    gl.useProgram(g.blit.prog);
    gl.uniform4f(g.blit.u.uQuad, 0, 0, W, H);
    gl.uniform2f(g.blit.u.uRes, W, H);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, g.scene.full.tex);
    gl.uniform1i(g.blit.u.uScene, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // output alpha and blend — never composite the backdrop yourself
    for (const s of list) {
      if (!s.shapes.length) continue;
      if (s.opts.shadow !== false) this.drawShadow(g, s, W, H, dpr);
      this.drawGlass(g, s, W, H, dpr, now);
    }

    this.stats.frames++;
    this.stats.cpuMs = performance.now() - cpu0;
    this.stats.surfaces = list.length;
    this.stats.tierAAreaPct = (100 * area) / (window.innerWidth * window.innerHeight);
    this.stats.shadowBakes = g.shadows.bakes;
    this.stats.dpr = dpr;

    // Sleep is exact: waves have a known death time and springs settle.
    busy = busy || didScene || this.sceneDirty;
    const t = performance.now();
    if (busy) this.wakeUntil = Math.max(this.wakeUntil, t + 150);
    if (!busy && t > this.wakeUntil) {
      this.sleeping = true;             // rAF NOT rescheduled
      this.emitStats(true);
      return;
    }
    this.emitStats(false);
    this.raf = requestAnimationFrame(this.frame);
  };

  private emitStats(final: boolean) {
    const t = performance.now();
    if (!this.onStats || (!final && t - this.lastStatsAt < 250)) return;
    this.lastStatsAt = t;
    this.onStats({ ...this.stats, awake: !final });
  }

  private drawShadow(g: GL, s: Surface, W: number, H: number, dpr: number) {
    const { gl, shadow } = g;
    const amt = this.settings.shadowAmount * s.shadowMul * (1 - s.melt);
    if (amt < 0.004) return;
    gl.useProgram(shadow.prog);
    gl.uniform2f(shadow.u.uRes, W, H);
    gl.uniform1i(shadow.u.uShadow, 2);
    gl.uniform1f(shadow.u.uAmt, amt);
    gl.activeTexture(gl.TEXTURE2);
    for (const sh of s.shapes) {
      const hw = sh.hw * dpr, hh = sh.hh * dpr, r = sh.r * dpr;
      const spread = shadowSpread(sh.hw, sh.hh) * dpr;
      const baked = g.shadows.get(hw, hh, r, spread);
      const cx = sh.cx * dpr + spread * 0.08, cy = sh.cy * dpr + spread * 0.28;
      const m = baked.margin;
      gl.bindTexture(gl.TEXTURE_2D, baked.tex);
      gl.uniform4f(shadow.u.uQuad, cx - hw - m, cy - hh - m, cx + hw + m, cy + hh + m);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.activeTexture(gl.TEXTURE0);
  }

  private readonly shBuf = new Float32Array(16);
  private readonly rBuf = new Float32Array(4);
  private readonly wBuf = new Float32Array(12);
  private readonly wdBuf = new Float32Array(9);

  private drawGlass(g: GL, s: Surface, W: number, H: number, dpr: number, now: number) {
    const { gl, glass: P } = g;
    const u = P.u;
    const shapes = s.shapes.slice(0, 4);
    const melt = s.melt;
    const press = s.press.value;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    this.shBuf.fill(0); this.rBuf.fill(0);
    shapes.forEach((sh, i) => {
      const full = Math.min(sh.hw, sh.hh);
      const r = sh.r + (full - sh.r) * melt; // melt runs the corner radius to fully round
      this.shBuf.set([sh.cx * dpr, sh.cy * dpr, sh.hw * dpr, sh.hh * dpr], i * 4);
      this.rBuf[i] = r * dpr;
      x0 = Math.min(x0, sh.cx - sh.hw); y0 = Math.min(y0, sh.cy - sh.hh);
      x1 = Math.max(x1, sh.cx + sh.hw); y1 = Math.max(y1, sh.cy + sh.hh);
    });
    const s0 = shapes[0];
    const r0 = this.rBuf[0] / dpr;

    // Tight quad: the shadow lives in its own pass, so the glass quad only needs
    // room for the AA edge — plus the bloom while pressed or melting.
    let margin = 2 * dpr;
    const bloom = melt * 1.15 + press * 0.4;
    if (bloom > 0.004) {
      const k = 10 + 46 * melt + 22 * press;
      margin = Math.max(margin, k * Math.log(bloom / 0.004));
    }
    const q = [x0 * dpr - margin, y0 * dpr - margin, x1 * dpr + margin, y1 * dpr + margin];
    if (q[2] < 0 || q[3] < 0 || q[0] > W || q[1] > H) return;

    gl.useProgram(P.prog);
    gl.uniform4f(u.uQuad, q[0], q[1], q[2], q[3]);
    gl.uniform2f(u.uRes, W, H);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, g.scene.blurB.tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, g.scene.clear.tex);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(u.uPre, 0);
    gl.uniform1i(u.uSharp, 1);
    gl.uniform4fv(u.uSh, this.shBuf);
    gl.uniform1fv(u.uR, this.rBuf);
    gl.uniform1i(u.uN, shapes.length);
    gl.uniform1f(u.uK, s.k * dpr);
    gl.uniform1f(u.uNexp, cornerExponent(r0, s0.hw, s0.hh));
    const thick = bevelThickness(s0.hw, s0.hh, r0);
    const k = this.settings.refraction;
    gl.uniform1f(u.uThick, thick * dpr);
    gl.uniform1f(u.uEdge, thick * EDGE_REACH * dpr * Math.min(k, 1)); // > 0.5·T would fold the image
    gl.uniform1f(u.uMag, lensMagnification(s0.hw, s0.hh) * k);
    gl.uniform1f(u.uPx, dpr);
    gl.uniform1f(u.uRefr, k * REFRACT * dpr);
    gl.uniform1f(u.uPress, press);
    gl.uniform1f(u.uMelt, melt);
    gl.uniform1f(u.uClear, 2 * Math.min(s0.hw, s0.hh) <= SHARP_CUT ? 1 : 0);
    gl.uniform1f(u.uTime, now);

    // waves
    const f = s.field;
    const sizeDev = 2 * Math.min(s0.hw, s0.hh) * dpr;
    if (Math.abs(f.size - sizeDev) > 1 && f.sources.length === 0) f.configure(sizeDev);
    f.prune(now);
    this.wBuf.fill(0); this.wdBuf.fill(0);
    f.sources.slice(0, 3).forEach((w, i) => {
      this.wBuf.set([w.x, w.y, w.t0, w.amp], i * 4);
      this.wdBuf.set([w.dx, w.dy, w.aniso], i * 3);
    });
    gl.uniform1f(u.uWGain, WAVE_GAIN * dpr);
    gl.uniform1f(u.uWK, f.wk);
    gl.uniform1f(u.uWW, f.ww);
    gl.uniform1f(u.uWS, f.ws);
    gl.uniform1f(u.uHoldR, f.holdR);
    gl.uniform3f(u.uHold, f.holdX, f.holdY, Math.max(0, f.holdDepth.value));
    gl.uniform4fv(u.uW, this.wBuf);
    gl.uniform3fv(u.uWd, this.wdBuf);
    gl.uniform1i(u.uWn, Math.min(3, f.sources.length));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

