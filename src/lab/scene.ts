// Backdrop for the Glass Lab: recreations of the WWDC25 reference scenes,
// drawn once with Canvas2D and uploaded as the glass backdrop.

export interface Region { x: number; y: number; w: number; h: number }
export interface LabLayout { wheel: Region; text: Region; list: Region; video: Region; alert: Region; blob: Region }
export type SceneKey = keyof LabLayout;
export const SCENES: SceneKey[] = ['wheel', 'text', 'list', 'video', 'alert', 'blob'];

/** Phones show one scene at a time, full-stage, above a tab bar. */
export const isCompact = (W: number) => W < 760;
export const TAB_BAR_SPACE = 92;

export function layoutFor(W: number, H: number): LabLayout {
  if (isCompact(W)) {
    const stage = { x: 12, y: 52, w: W - 24, h: H - 52 - TAB_BAR_SPACE };
    return { wheel: stage, text: stage, list: stage, video: stage, alert: stage, blob: stage };
  }
  const g = 20, cw = (W - g * 4) / 3, rh = (H - g * 3 - 56) / 2, top = 56 + g;
  return {
    wheel: { x: g, y: top, w: cw, h: rh },
    text: { x: g * 2 + cw, y: top, w: cw, h: rh },
    list: { x: g * 3 + cw * 2, y: top, w: cw, h: rh },
    video: { x: g, y: top + rh + g, w: cw, h: rh },
    alert: { x: g * 2 + cw, y: top + rh + g, w: cw, h: rh },
    blob: { x: g * 3 + cw * 2, y: top + rh + g, w: cw, h: rh },
  };
}

/** `only`: draw a single scene (compact layout, where every scene shares the stage). */
export function drawLab(canvas: HTMLCanvasElement, W: number, H: number, dpr: number, L: LabLayout, only?: SceneKey) {
  const show = (k: SceneKey) => !only || only === k;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  const c = canvas.getContext('2d')!;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const bg = c.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#eceef2'); bg.addColorStop(1, '#c9ccd2');
  c.fillStyle = bg; c.fillRect(0, 0, W, H);

  const clip = (r: Region, rad: number, fn: () => void) => {
    c.save(); c.beginPath(); c.roundRect(r.x, r.y, r.w, r.h, rad); c.clip(); fn(); c.restore();
  };

  // 1 — colour wheel on studio grey
  if (show('wheel')) clip(L.wheel, 24, () => {
    c.fillStyle = '#e9eaed'; c.fillRect(L.wheel.x, L.wheel.y, L.wheel.w, L.wheel.h);
    const cx = L.wheel.x + L.wheel.w / 2, cy = L.wheel.y + L.wheel.h / 2, R = Math.min(L.wheel.w, L.wheel.h) * 0.3;
    const cg = c.createConicGradient(-Math.PI / 2, cx, cy);
    ['#ff0040', '#ff00ff', '#8000ff', '#0040ff', '#00c0ff', '#00ff80', '#80ff00', '#ffff00', '#ff8000', '#ff0040']
      .forEach((col, i, a) => cg.addColorStop(i / (a.length - 1), col));
    c.fillStyle = cg; c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fill();
    const rg = c.createRadialGradient(cx, cy, 0, cx, cy, R);
    rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.55, 'rgba(255,255,255,0.15)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = rg; c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fill();
  });

  // 2 — large body text (the archive / + capsule reference)
  if (show('text')) clip(L.text, 24, () => {
    c.fillStyle = '#f2f2f4'; c.fillRect(L.text.x, L.text.y, L.text.w, L.text.h);
    const fs = Math.min(30, L.text.w / 11.5);
    c.fillStyle = '#1c1c1e'; c.font = `500 ${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const lines = ['Artists have long been', 'using neon lights. Light', 'helps define color, tone,', 'and is inseperable from', 'the world around us.', 'Glass reflects it back.'];
    lines.forEach((l, i) => c.fillText(l, L.text.x + 20, L.text.y + fs * 1.9 + i * fs * 1.47));
  });

  // 3 — list over a photo (the toolbar reference)
  if (show('list')) clip(L.list, 24, () => {
    const r = L.list, split = r.y + r.h * 0.62;
    c.fillStyle = '#f4f4f6'; c.fillRect(r.x, r.y, r.w, r.h);
    const rows = [['Dog Rose', 'Rosa canina'], ['Sunflower', 'Helianthus annuus'], ['Lavender', 'Lavandula angustifolia'], ['Tulip', 'Tulipa gesneriana'], ['Daisy', 'Bellis perennis']];
    c.font = '400 17px system-ui, -apple-system, "Segoe UI", sans-serif';
    rows.forEach(([a, b], i) => {
      const y = r.y + 34 + i * 40;
      c.fillStyle = '#111'; c.fillText(a, r.x + 20, y); c.fillText(b, r.x + Math.min(150, r.w * 0.38), y);
      c.fillStyle = 'rgba(0,0,0,0.08)'; c.fillRect(r.x + 24, y + 14, r.w - 48, 1);
    });
    const sky = c.createLinearGradient(0, split, 0, r.y + r.h);
    sky.addColorStop(0, '#7fa7d9'); sky.addColorStop(1, '#a9c6ea');
    c.fillStyle = sky; c.fillRect(r.x, split, r.w, r.y + r.h - split);
    // petals: saturated red and blue shapes (dispersion shows against these)
    const leaf = (x: number, y: number, len: number, ang: number, col: string) => {
      c.save(); c.translate(x, y); c.rotate(ang); c.fillStyle = col;
      c.beginPath(); c.ellipse(len / 2, 0, len / 2, len / 7, 0, 0, Math.PI * 2); c.fill(); c.restore();
    };
    const lx = r.x + r.w * 0.55, ly = split + 70;
    leaf(lx, ly, 110, -2.2, '#2b56d6'); leaf(lx, ly, 90, -1.2, '#d62b3a'); leaf(lx, ly, 100, -0.4, '#2848c0');
    leaf(lx, ly, 80, 2.6, '#c91f45'); leaf(lx - 110, ly + 30, 70, -1.9, '#b8243c');
  });

  // 4 — dark "video" frame with vertical strands (the playback controls reference)
  if (show('video')) clip(L.video, 24, () => {
    const r = L.video;
    const vg = c.createLinearGradient(0, r.y, 0, r.y + r.h);
    vg.addColorStop(0, '#10262c'); vg.addColorStop(1, '#0b1a20');
    c.fillStyle = vg; c.fillRect(r.x, r.y, r.w, r.h);
    for (let i = 0; i < 26; i++) {
      const x = r.x + (i / 26) * r.w + Math.sin(i * 2.1) * 20;
      const g = c.createLinearGradient(x - 14, 0, x + 14, 0);
      g.addColorStop(0, 'rgba(40,70,80,0)'); g.addColorStop(0.5, i % 3 ? '#35606b' : '#6fa2ad'); g.addColorStop(1, 'rgba(40,70,80,0)');
      c.fillStyle = g; c.beginPath();
      c.moveTo(x - 10, r.y); c.quadraticCurveTo(x + 40 * Math.sin(i), r.y + r.h / 2, x + 8, r.y + r.h);
      c.lineTo(x + 20, r.y + r.h); c.quadraticCurveTo(x + 50 * Math.sin(i), r.y + r.h / 2, x + 2, r.y); c.fill();
    }
  });

  // 6 — soft yellow form against blue (twin of the capsule-over-blob reference)
  if (show('blob')) clip(L.blob, 24, () => {
    const r = L.blob;
    const sky = c.createLinearGradient(r.x, r.y + r.h, r.x + r.w, r.y);
    sky.addColorStop(0, '#6aa2ea'); sky.addColorStop(1, '#2b62b8');
    c.fillStyle = sky; c.fillRect(r.x, r.y, r.w, r.h);
    c.save();
    c.filter = `blur(${Math.round(Math.min(r.w, r.h) * 0.03)}px)`;
    const y = c.createLinearGradient(0, r.y + r.h * 0.35, 0, r.y + r.h);
    y.addColorStop(0, '#ffd23a'); y.addColorStop(1, '#f2a100');
    c.fillStyle = y;
    c.beginPath();                                  // body, lower left
    c.ellipse(r.x + r.w * 0.28, r.y + r.h * 0.95, r.w * 0.42, r.h * 0.55, -0.15, 0, Math.PI * 2);
    c.fill();
    c.beginPath();                                  // shoulder rising toward the centre
    c.ellipse(r.x + r.w * 0.5, r.y + r.h * 0.72, r.w * 0.13, r.h * 0.34, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();
  });

  // 5 — flowers against sky (the alert reference)
  if (show('alert')) clip(L.alert, 24, () => {
    const r = L.alert;
    const sky = c.createLinearGradient(0, r.y, 0, r.y + r.h);
    sky.addColorStop(0, '#2f7fe0'); sky.addColorStop(1, '#8cc2f5');
    c.fillStyle = sky; c.fillRect(r.x, r.y, r.w, r.h);
    const flower = (x: number, y: number, R: number, col: string) => {
      for (let k = 0; k < 8; k++) {
        c.save(); c.translate(x, y); c.rotate((k / 8) * Math.PI * 2); c.fillStyle = col;
        c.beginPath(); c.ellipse(R * 0.55, 0, R * 0.5, R * 0.2, 0, 0, Math.PI * 2); c.fill(); c.restore();
      }
      c.fillStyle = '#f4c20d'; c.beginPath(); c.arc(x, y, R * 0.18, 0, Math.PI * 2); c.fill();
    };
    const pts: [number, number, number, string][] = [
      [0.12, 0.72, 46, '#ffffff'], [0.3, 0.9, 52, '#c2185b'], [0.48, 0.66, 40, '#f8bbd0'], [0.66, 0.86, 56, '#ffffff'],
      [0.84, 0.7, 44, '#ad1457'], [0.95, 0.95, 50, '#ffffff'], [0.22, 0.48, 30, '#f48fb1'], [0.74, 0.44, 28, '#ffffff'],
    ];
    for (const [fx, fy, R, col] of pts) {
      c.strokeStyle = '#3f7f3a'; c.lineWidth = 3; c.beginPath(); c.moveTo(r.x + fx * r.w, r.y + fy * r.h); c.lineTo(r.x + fx * r.w + 6, r.y + r.h); c.stroke();
      flower(r.x + fx * r.w, r.y + fy * r.h, R, col);
    }
  });
}
