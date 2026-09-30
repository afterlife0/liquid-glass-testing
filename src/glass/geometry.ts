// §4 geometry rules. All inputs in CSS px unless noted. Pure — unit tested.

export interface Shape {
  cx: number; cy: number;   // centre
  hw: number; hh: number;   // half-size
  r: number;                // corner radius
}

export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Concentricity: radius is a function of size. ≤60px is round; short+wide is a capsule. */
export function concentricRadius(halfW: number, halfH: number): number {
  const size = 2 * Math.min(halfW, halfH);
  return Math.min(size <= 60 ? size / 2 : 20, Math.min(halfW, halfH));
}

/** n = 2 for anything fully round or a capsule cap, else Apple's continuous corner. */
export function cornerExponent(radius: number, halfW: number, halfH: number): number {
  return radius >= Math.min(halfW, halfH) - 0.5 ? 2.0 : 3.4;
}

/** Bevel is a fraction, never a constant — and never deeper than the corner (bug #1). */
export function bevelThickness(halfW: number, halfH: number, radius: number): number {
  const size = 2 * Math.min(halfW, halfH);
  return Math.max(1, Math.min(size * 0.2, 11, radius));
}

export function shadowSpread(halfW: number, halfH: number): number {
  return Math.min(2 * Math.min(halfW, halfH) * 0.45, 22);
}

/** Below 90 CSS px, sample the half-res source (sharper detail inside small lenses). */
export const SHARP_CUT = 90;

export function shapeFromRect(r: { left: number; top: number; width: number; height: number }, radius?: number): Shape {
  const hw = r.width / 2, hh = r.height / 2;
  return {
    cx: r.left + hw, cy: r.top + hh, hw, hh,
    r: Math.min(radius ?? concentricRadius(hw, hh), Math.min(hw, hh)),
  };
}

export function lerpShape(a: Shape, b: Shape, t: number): Shape {
  return { cx: lerp(a.cx, b.cx, t), cy: lerp(a.cy, b.cy, t), hw: lerp(a.hw, b.hw, t), hh: lerp(a.hh, b.hh, t), r: lerp(a.r, b.r, t) };
}

/** Melt parameter: peaks mid-transition. */
export const meltOf = (p: number) => Math.pow(Math.max(0, Math.sin(Math.PI * clamp(p, 0, 1))), 0.75);

/** Staged content timing: old label dies by ~30%, new arrives after ~64%, staggered 4%. */
export const outgoingOpacity = (p: number) => clamp(1 - p * 3.2, 0, 1);
export const incomingOpacity = (p: number, index = 0) => clamp((p - 0.64 - index * 0.04) / 0.36, 0, 1);

export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
