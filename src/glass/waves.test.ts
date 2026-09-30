import { describe, expect, it } from 'vitest';
import { GestureTracker, hardness, MAX_SOURCES, WAVE_LIFE, WaveField } from './waves';

const setup = (size = 116) => {
  const f = new WaveField(); f.configure(size);
  return { f, g: new GestureTracker(f, () => 1) };
};

describe('wavenumber — the parameter that silently kills ripples (bug #5)', () => {
  it('puts roughly one wavelength across the element', () => {
    const { f } = setup(116);
    expect(f.wk).toBeCloseTo(0.0655, 3);            // ~0.06 per px for a 116px button
    const wavelength = (2 * Math.PI) / f.wk;
    expect(wavelength / 116).toBeGreaterThan(0.5);
    expect(wavelength / 116).toBeLessThan(1.5);
  });
  it('firm contact lowers the wavenumber and slows the front', () => {
    const soft = new WaveField(); soft.configure(100, 0);
    const firm = new WaveField(); firm.configure(100, 1);
    expect(firm.wk).toBeLessThan(soft.wk);
    expect(firm.ws).toBeLessThan(soft.ws);
  });
});

describe('gesture classification', () => {
  it('mouse at default pressure is a soft tap; Shift is firm', () => {
    expect(hardness(0.5, 1, 1)).toBeLessThan(0.55);
    expect(hardness(0.5, 1, 1, true)).toBeGreaterThan(0.55);
    expect(hardness(1, 40, 40)).toBe(1);
  });
  it('tap: a packet plus a smaller echo 90ms behind', () => {
    const { f, g } = setup();
    g.down(10, 10, 1, 0); g.up(10, 10, 1.1);
    expect(f.sources).toHaveLength(2);
    expect(f.sources[1].t0 - f.sources[0].t0).toBeCloseTo(0.09);
    expect(f.sources[1].amp).toBeCloseTo(0.14);
    expect(f.sources[0].amp).toBeCloseTo(0.34);
  });
  it('hold: no wave, a dimple; release rebounds into a swell', () => {
    const { f, g } = setup();
    g.down(10, 10, 1, 0); g.tick(1.3);
    expect(g.mode).toBe('hold');
    expect(f.sources).toHaveLength(0);
    expect(f.holdDepth.target).toBe(1);
    for (let i = 0; i < 60; i++) f.holdDepth.step(1 / 60);
    g.up(10, 10, 2.3);
    expect(f.sources).toHaveLength(1);
    expect(f.holdDepth.target).toBe(0);
  });
  it('drag sheds a wake biased backwards; a fast release flicks one-sided', () => {
    const { f, g } = setup();
    g.down(0, 0, 1, 0);
    for (let i = 1; i <= 10; i++) g.move(i * 10, 0, 1 + i * 0.005);
    expect(f.sources.length).toBeGreaterThan(0);
    expect(f.sources[0].dx).toBeLessThan(0);          // wake points back along the path
    g.up(100, 0, 1.055);
    const flick = f.sources[f.sources.length - 1];
    expect(flick.aniso).toBe(1);
    expect(flick.dx).toBeGreaterThan(0);
  });
  it('caps the pool at 3 sources per element', () => {
    const { f, g } = setup();
    for (let i = 0; i < 4; i++) { g.down(0, 0, i, 0); g.up(0, 0, i + 0.01); }
    expect(f.sources.length).toBeLessThanOrEqual(MAX_SOURCES);
  });
});

describe('exact sleep', () => {
  it('waves have a known death time', () => {
    const { f, g } = setup();
    g.down(0, 0, 1, 1); g.up(0, 0, 1);
    expect(f.live(1.2)).toBe(true);
    expect(f.live(1 + 0.09 + WAVE_LIFE + 0.001)).toBe(false);
  });
});
