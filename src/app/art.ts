// Backdrop art: gradients, colour fields and a 24-month chart, drawn with
// Canvas2D once per layout/theme change. Tier A uploads it as a texture
// (backdrop source #1: pixels we own); Tier B blits it to a plain 2D canvas.
import { SERIES } from './data';
import { Tokens } from './tokens';

export const ART_WIDTH_FACTOR = 1.6; // art is wider than the window; the extra is pan range

export interface ArtLayout {
  width: number; height: number;   // viewport, CSS px
  chartLeft: number;               // CSS px (viewport)
  chartTop: number;
  chartBottom: number;
}

export function artScale(layout: ArtLayout, dpr: number, maxTex: number) {
  return Math.min(dpr, maxTex / (layout.width * ART_WIDTH_FACTOR), maxTex / layout.height);
}

/** `flat`: the flat theme drops the material, never the data — solid ground, no colour fields. */
export function drawArt(canvas: HTMLCanvasElement, L: ArtLayout, scale: number, t: Tokens, flat = false) {
  const W = L.width * ART_WIDTH_FACTOR, H = L.height;
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const c = canvas.getContext('2d')!;
  c.setTransform(scale, 0, 0, scale, 0, 0);
  const a = t.art;

  const bg = c.createLinearGradient(0, 0, W * 0.3, H);
  bg.addColorStop(0, a.bgTop); bg.addColorStop(1, a.bgBottom);
  c.fillStyle = flat ? t.bg : bg; c.fillRect(0, 0, W, H);

  // soft colour fields
  const blobs: [number, number, number, number][] = [
    [0.08, 0.18, 0.34, 0], [0.34, 0.08, 0.28, 1], [0.55, 0.42, 0.30, 2],
    [0.78, 0.16, 0.26, 3], [0.97, 0.52, 0.30, 4], [0.22, 0.78, 0.30, 3], [0.70, 0.86, 0.28, 0],
  ];
  c.globalAlpha = flat ? 0 : 0.55;
  for (const [x, y, r, i] of flat ? [] : blobs) {
    const R = r * Math.max(L.width, H);
    const g = c.createRadialGradient(x * W, y * H, 0, x * W, y * H, R);
    g.addColorStop(0, a.blobs[i]); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
  }
  c.globalAlpha = 1;

  // chart
  const x0 = L.chartLeft + 56, x1 = W - 40;
  const y0 = L.chartTop, y1 = L.chartBottom - 34;
  const n = SERIES.length;
  const max = Math.max(...SERIES.map(p => p.revenue)) * 1.12;
  const X = (i: number) => x0 + ((i + 0.5) / n) * (x1 - x0);
  const Y = (v: number) => y1 - (v / max) * (y1 - y0);

  c.font = '600 12px system-ui, -apple-system, "Segoe UI", sans-serif';
  c.textBaseline = 'middle';
  c.lineWidth = 1;
  for (let k = 0; k <= 5; k++) {
    const v = (max / 5) * k, y = Y(v);
    c.strokeStyle = a.grid;
    c.beginPath(); c.moveTo(x0, Math.round(y) + 0.5); c.lineTo(x1, Math.round(y) + 0.5); c.stroke();
    c.fillStyle = a.label; c.textAlign = 'right';
    c.fillText(`₹${Math.round(v / 100_000)}L`, x0 - 10, y);
  }

  // bars: cash in (blue) / cash out (red) — solid colour fields for the no-cast test
  const bw = ((x1 - x0) / n) * 0.26;
  SERIES.forEach((p, i) => {
    const x = X(i);
    c.fillStyle = a.revenue; roundRect(c, x - bw - 1.5, Y(p.revenue * 0.62), bw, y1 - Y(p.revenue * 0.62), 3);
    c.fillStyle = a.expense; roundRect(c, x + 1.5, Y(p.expense * 0.62), bw, y1 - Y(p.expense * 0.62), 3);
  });

  // revenue area + line
  const pts = SERIES.map((p, i) => [X(i), Y(p.revenue)] as const);
  const path = new Path2D();
  pts.forEach(([x, y], i) => {
    if (i === 0) { path.moveTo(x, y); return; }
    const [px, py] = pts[i - 1], mx = (px + x) / 2;
    path.bezierCurveTo(mx, py, mx, y, x, y);
  });
  const area = new Path2D(path);
  area.lineTo(pts[n - 1][0], y1); area.lineTo(pts[0][0], y1); area.closePath();
  const ag = c.createLinearGradient(0, y0, 0, y1);
  ag.addColorStop(0, withAlpha(a.revenue, 0.36)); ag.addColorStop(1, withAlpha(a.revenue, 0));
  c.fillStyle = ag; c.fill(area);
  c.strokeStyle = a.revenue; c.lineWidth = 3; c.stroke(path);
  c.fillStyle = a.revenue;
  pts.forEach(([x, y]) => { c.beginPath(); c.arc(x, y, 3.5, 0, Math.PI * 2); c.fill(); });

  c.fillStyle = a.label; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  const every = Math.ceil(52 / ((x1 - x0) / n)); // skip labels rather than let them collide on narrow screens
  SERIES.forEach((p, i) => { if (i % every === 0) c.fillText(p.label, X(i), y1 + 22); });

  // big type watermark — gives the lens something with structure to magnify
  c.font = '800 132px system-ui, -apple-system, "Segoe UI", sans-serif';
  c.fillStyle = a.grid; c.textAlign = 'left';
  c.fillText('FY 2025–26', x0 + 16, y0 + 120);
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath(); c.roundRect(x, y, w, Math.max(0, h), [r, r, 0, 0]); c.fill();
}
function withAlpha(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
