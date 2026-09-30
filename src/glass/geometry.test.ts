import { describe, expect, it } from 'vitest';
import { bevelThickness, concentricRadius, cornerExponent, incomingOpacity, lensMagnification, meltOf, outgoingOpacity } from './geometry';
import { shadowField, SHADOW_MARGIN } from './material';

describe('concentricity (§4)', () => {
  it('makes small elements round', () => {
    expect(concentricRadius(22, 22)).toBe(22);          // 44px icon button → circle
    expect(cornerExponent(22, 22, 22)).toBe(2);         // a circle, not a squircle
  });
  it('makes short wide elements capsules', () => {
    expect(concentricRadius(70, 20)).toBe(20);
    expect(cornerExponent(20, 70, 20)).toBe(2);
  });
  it('gives larger surfaces the house radius with the superellipse', () => {
    expect(concentricRadius(120, 55)).toBe(20);
    expect(cornerExponent(20, 120, 55)).toBe(3.4);
  });
});

describe('bevel is a fraction, never a constant', () => {
  it('keeps a flat middle on a 44px button', () => {
    const t = bevelThickness(22, 22, 22);
    expect(t).toBeCloseTo(8.8);
    expect(t).toBeLessThan(22 * 0.5);
  });
  it('caps at 11px and never exceeds the corner radius (bug #1 seam)', () => {
    expect(bevelThickness(200, 100, 20)).toBe(11);
    expect(bevelThickness(200, 100, 9)).toBe(9);
  });
});

describe('transitions (§6)', () => {
  it('melt peaks mid-transition and is zero at both ends', () => {
    expect(meltOf(0)).toBe(0);
    expect(meltOf(1)).toBeCloseTo(0, 6);
    expect(meltOf(0.5)).toBeCloseTo(1);
  });
  it('stages content: old dies by ~30%, new starts after ~64%, staggered 4%', () => {
    expect(outgoingOpacity(0.32)).toBe(0);
    expect(incomingOpacity(0.64)).toBe(0);
    expect(incomingOpacity(1)).toBe(1);
    expect(incomingOpacity(0.8, 1)).toBeLessThan(incomingOpacity(0.8, 0));
  });
});

describe('baked shadow field', () => {
  it('is solid inside and has decayed at the quad margin', () => {
    expect(shadowField(-5, 20)).toBe(1);
    expect(shadowField(20 * SHADOW_MARGIN, 20)).toBeLessThan(0.01);
  });
});

describe('lens magnification is size-relative', () => {
  it('magnifies small controls more than large panels, and never zero', () => {
    const small = lensMagnification(22, 22), card = lensMagnification(120, 59), sheet = lensMagnification(300, 250);
    expect(small).toBeGreaterThan(card);
    expect(card).toBeGreaterThan(sheet);
    expect(sheet).toBeGreaterThan(0);
    // centre magnification m = 1 / (1 − 0.7·uMag): a visible 5–10% on a control
    expect(1 / (1 - 0.7 * small)).toBeGreaterThan(1.05);
  });
});
