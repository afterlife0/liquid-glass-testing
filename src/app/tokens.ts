// Theme tokens — the single source for the CSS variables AND the contrast
// audit (src/app/contrast.test.ts). Change a colour here and the audit re-runs.

export type Scheme = 'dark' | 'light';

export interface Tokens {
  bg: string;              // page background (flat tier, and behind everything)
  text: string;            // body text
  textMuted: string;       // secondary text
  figure: string;          // financial figures
  plate: string;           // dense backing plate behind labels/figures on glass
  frost: string;           // Tier B background (opacity ≥ 0.62: it carries figures)
  frostBorder: string;
  flat: string;            // opaque surface: tables, totals, flat theme
  flatAlt: string;         // zebra row
  flatBorder: string;
  field: string;           // inputs (plain fill)
  accent: string;          // primary action fill
  accentText: string;
  accentLabel: string;     // secondary action: tinted label on glass
  positive: string;
  negative: string;
  /** Backdrop art palette. `extremes` are the brightest and darkest colours the art can present. */
  art: {
    bgTop: string; bgBottom: string;
    blobs: string[];
    grid: string; label: string;
    revenue: string; expense: string;
    extremes: string[];
  };
}

export const THEMES: Record<Scheme, Tokens> = {
  dark: {
    bg: '#0b1020',
    text: '#eef2f8',
    textMuted: '#b4bfcf',
    figure: '#f8fafc',
    plate: 'rgba(8, 11, 20, 0.74)',
    frost: 'rgba(22, 27, 36, 0.80)',
    frostBorder: 'rgba(255, 255, 255, 0.10)',
    flat: '#121826',
    flatAlt: '#161e2e',
    flatBorder: '#263041',
    field: 'rgba(255, 255, 255, 0.08)',
    accent: '#2563eb',
    accentText: '#ffffff',
    accentLabel: '#93c5fd',
    positive: '#4ade80',
    negative: '#fca5a5',
    art: {
      bgTop: '#0c1426', bgBottom: '#170f2a',
      blobs: ['#ff6b5a', '#3b82f6', '#14b8a6', '#f59e0b', '#a855f7'],
      grid: 'rgba(148, 163, 184, 0.16)', label: 'rgba(226, 232, 240, 0.62)',
      revenue: '#60a5fa', expense: '#f87171',
      extremes: ['#0c1426', '#170f2a', '#ff6b5a', '#f59e0b', '#60a5fa', '#e2e8f0'],
    },
  },
  light: {
    bg: '#eef1f6',
    text: '#0f172a',
    textMuted: '#3f4a5c',
    figure: '#020617',
    plate: 'rgba(255, 255, 255, 0.90)',
    frost: 'rgba(250, 251, 253, 0.72)',
    frostBorder: 'rgba(15, 23, 42, 0.10)',
    flat: '#ffffff',
    flatAlt: '#f5f7fb',
    flatBorder: '#dfe4ec',
    field: 'rgba(15, 23, 42, 0.06)',
    accent: '#1d4ed8',
    accentText: '#ffffff',
    accentLabel: '#1e40af',
    positive: '#166534',
    negative: '#b91c1c',
    art: {
      bgTop: '#dfe8f7', bgBottom: '#f4e9f1',
      blobs: ['#fb7185', '#60a5fa', '#2dd4bf', '#fbbf24', '#c084fc'],
      grid: 'rgba(30, 41, 59, 0.12)', label: 'rgba(30, 41, 59, 0.66)',
      revenue: '#2563eb', expense: '#e11d48',
      extremes: ['#ffffff', '#dfe8f7', '#fb7185', '#2563eb', '#1e293b'],
    },
  },
};

export function applyTheme(scheme: Scheme, root: HTMLElement = document.documentElement) {
  const t = THEMES[scheme];
  const vars: Record<string, string> = {
    '--bg': t.bg, '--text': t.text, '--text-muted': t.textMuted, '--figure': t.figure,
    '--plate': t.plate, '--frost': t.frost, '--frost-border': t.frostBorder,
    '--flat': t.flat, '--flat-alt': t.flatAlt, '--flat-border': t.flatBorder, '--field': t.field,
    '--accent': t.accent, '--accent-text': t.accentText, '--accent-label': t.accentLabel,
    '--positive': t.positive, '--negative': t.negative,
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.dataset.scheme = scheme;
  root.style.colorScheme = scheme;
}

// ── contrast maths (WCAG 2.x) ────────────────────────────────────────────────

export type RGBA = [number, number, number, number];

export function parseColor(c: string): RGBA {
  const hex = c.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`bad colour ${c}`);
  const [r, g, b, a = '1'] = m[1].split(',').map(s => s.trim());
  return [+r, +g, +b, +a];
}

export function over(top: RGBA, bottom: RGBA): RGBA {
  const a = top[3];
  return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1];
}

export function luminance([r, g, b]: RGBA): number {
  const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrast(a: RGBA, b: RGBA): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
