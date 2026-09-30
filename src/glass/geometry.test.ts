import { describe, expect, it } from 'vitest';
import { bevelThickness, concentricRadius, cornerExponent, incomingOpacity, meltOf, outgoingOpacity, rimBend, rimSample } from './geometry';
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
  it('reaches ~3/4 of the way to the centre of a control', () => {
    expect(bevelThickness(22, 22, 22)).toBeCloseTo(16.5);   // 44px button
    expect(bevelThickness(98, 30, 30)).toBeCloseTo(22.5);   // 60px capsule
  });
  it('never exceeds the corner radius (bug #1 seam) or the cap', () => {
    expect(bevelThickness(200, 100, 20)).toBe(20);
    expect(bevelThickness(400, 300, 300)).toBe(30);
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

describe('each edge pulls in what lies just beyond it', () => {
  const T = 22;
  it('passes the middle through at true size — no magnification', () => {
    for (const u of [T, T + 5, 60]) expect(rimSample(u, T)).toBe(u);
  });
  it('shows content from OUTSIDE across most of the band', () => {
    expect(rimSample(0, T)).toBeCloseTo(-0.75 * T);
    expect(rimSample(0.5 * T, T)).toBeLessThan(0);
  });
  it('keeps pulled-in content near its real size (1:1 across the plateau)', () => {
    const slope = (rimSample(0.2 * T + 0.01, T) - rimSample(0.2 * T, T)) / 0.01;
    expect(slope).toBeCloseTo(1, 5);
  });
  it('never mirrors: the mapping is monotone', () => {
    for (let u = 0; u < T; u += 0.05) expect(rimSample(u + 0.05, T)).toBeGreaterThan(rimSample(u, T));
  });
  it('returns to the middle with zero offset and zero slope (bug #1)', () => {
    expect(rimBend(1)).toBeCloseTo(0, 12);
    expect(Math.abs(rimBend(0.999))).toBeLessThan(1e-5);
    for (let i = 0; i < 1000; i++) expect(Math.abs(rimBend((i + 1) / 1000) - rimBend(i / 1000))).toBeLessThan(0.01);
  });
});
