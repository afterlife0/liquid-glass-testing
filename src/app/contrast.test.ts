// Contrast audit (§1): every theme, against the brightest AND darkest backdrop
// it can present. 4.5:1 body, 7:1 financial figures.
import { describe, expect, it } from 'vitest';
import { contrast, over, parseColor, Scheme, THEMES } from './tokens';

const BODY = 4.5, FIN = 7;

for (const scheme of Object.keys(THEMES) as Scheme[]) {
  const t = THEMES[scheme];
  const P = parseColor;
  // Glass lenses sample beyond their footprint, so plates are checked against
  // pure black and white as well as the art's extremes.
  const backdrops = [...t.art.extremes, '#000000', '#ffffff'].map(P);
  const worst = (fg: string, surface: string, bgs = backdrops) =>
    Math.min(...bgs.map(b => contrast(P(fg), over(P(surface), b))));

  describe(`${scheme} theme`, () => {
    it('figures on a backing plate ≥ 7:1 over any backdrop', () => {
      expect(worst(t.figure, t.plate)).toBeGreaterThanOrEqual(FIN);
    });
    it('labels and deltas on a plate ≥ 4.5:1', () => {
      for (const fg of [t.text, t.textMuted, t.positive, t.negative, t.accentLabel])
        expect(worst(fg, t.plate), fg).toBeGreaterThanOrEqual(BODY);
    });
    it('Tier B frost text ≥ 4.5:1 over the art extremes', () => {
      const art = t.art.extremes.map(P);
      for (const fg of [t.text, t.textMuted]) expect(worst(fg, t.frost, art), fg).toBeGreaterThanOrEqual(BODY);
    });
    it('tables and totals on the flat surface: figures ≥ 7:1, secondary ≥ 4.5:1', () => {
      for (const s of [t.flat, t.flatAlt]) {
        expect(contrast(P(t.figure), P(s))).toBeGreaterThanOrEqual(FIN);
        expect(contrast(P(t.text), P(s))).toBeGreaterThanOrEqual(FIN);
        expect(contrast(P(t.textMuted), P(s))).toBeGreaterThanOrEqual(BODY);
        expect(contrast(P(t.positive), P(s))).toBeGreaterThanOrEqual(BODY);
        expect(contrast(P(t.negative), P(s))).toBeGreaterThanOrEqual(BODY);
      }
    });
    it('primary action label ≥ 4.5:1', () => {
      expect(contrast(P(t.accentText), P(t.accent))).toBeGreaterThanOrEqual(BODY);
    });
  });
}
