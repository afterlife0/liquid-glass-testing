// Feature detection → the single null that disables Tier A.

export interface GlassCapability {
  ok: boolean;
  reason: string;
  renderer: string;
}

export function detectGlass(): GlassCapability {
  if (typeof window === 'undefined') return { ok: false, reason: 'no window', renderer: '' };
  const forced = new URLSearchParams(location.search).get('tier');
  if (forced === 'b') return { ok: false, reason: 'forced Tier B (?tier=b)', renderer: '' };
  if (matchMedia('(prefers-reduced-transparency: reduce)').matches)
    return { ok: false, reason: 'prefers-reduced-transparency', renderer: '' };
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl) return { ok: false, reason: 'no WebGL2', renderer: '' };
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const r = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  // Release the probe context — Chromium caps contexts per page. Read every
  // parameter first: a lost context answers null to everything.
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  // ?tier=a is a diagnostics override (visual regression in headless CI) —
  // it skips only the software-rasteriser check.
  if (forced !== 'a' && /SwiftShader|Software|llvmpipe|Basic Render/i.test(r))
    return { ok: false, reason: `software rasteriser (${r})`, renderer: r };
  if (!(maxTex >= 4096)) return { ok: false, reason: `MAX_TEXTURE_SIZE ${maxTex}`, renderer: r };
  return { ok: true, reason: 'ok', renderer: r };
}

/** The brief's exact predicate, kept as the public contract. */
export function canRunGlass(): boolean { return detectGlass().ok; }

interface BatteryLike extends EventTarget { level: number; charging: boolean }

/** Low battery (<25%, not charging) feeds the same null. Calls back on change. */
export function watchBattery(onLow: (low: boolean) => void): () => void {
  const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
  if (!nav.getBattery) return () => {};
  let b: BatteryLike | null = null;
  const check = () => b && onLow(b.level < 0.25 && !b.charging);
  nav.getBattery().then(bat => {
    b = bat; check();
    bat.addEventListener('levelchange', check);
    bat.addEventListener('chargingchange', check);
  }).catch(() => {});
  return () => {
    b?.removeEventListener('levelchange', check);
    b?.removeEventListener('chargingchange', check);
  };
}
