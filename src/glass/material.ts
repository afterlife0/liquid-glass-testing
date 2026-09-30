// Baked shadow cache (§7 — "build this first"). A soft rounded-rect shadow
// field is static: bake it once into an R8 texture keyed by geometry and draw
// it as its own one-fetch pass. This is what lets the glass quad hug the panel.

export const SHADOW_AMOUNT = 0.30;
/** Quad margin around the panel, as a multiple of spread. */
export const SHADOW_MARGIN = 1.9;
const Q = 4;          // quantise keys to 4 device px — morphs stretch the nearest bake
const RES = 0.5;      // shadows are soft: bake at half resolution
const MAX_ENTRIES = 48;

export interface BakedShadow { tex: WebGLTexture; margin: number }

/** Pure: the shadow field value at a distance d from the shape (d < 0 is inside). */
export function shadowField(d: number, spread: number): number {
  const sigma = Math.max(1, spread * 0.55);
  return d <= 0 ? 1 : Math.exp(-0.5 * (d / sigma) ** 2);
}

function sdRoundRect(px: number, py: number, hw: number, hh: number, r: number) {
  const qx = Math.abs(px) - hw + r, qy = Math.abs(py) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

export class ShadowCache {
  private map = new Map<string, BakedShadow>();
  bakes = 0;
  constructor(private gl: WebGL2RenderingContext) {}

  get(hw: number, hh: number, r: number, spread: number): BakedShadow {
    const k = (v: number) => Math.max(Q, Math.round(v / Q) * Q);
    const key = `${k(hw)}|${k(hh)}|${k(r)}|${k(spread)}`;
    const hit = this.map.get(key);
    if (hit) { this.map.delete(key); this.map.set(key, hit); return hit; } // LRU touch
    const baked = this.bake(k(hw), k(hh), Math.min(k(r), k(hw), k(hh)), k(spread));
    this.map.set(key, baked);
    if (this.map.size > MAX_ENTRIES) {
      const [oldKey, old] = this.map.entries().next().value!;
      this.gl.deleteTexture(old.tex); this.map.delete(oldKey);
    }
    return baked;
  }

  private bake(hw: number, hh: number, r: number, spread: number): BakedShadow {
    const gl = this.gl;
    const margin = spread * SHADOW_MARGIN;
    const W = Math.max(2, Math.ceil((hw + margin) * 2 * RES));
    const H = Math.max(2, Math.ceil((hh + margin) * 2 * RES));
    const data = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const py = (y + 0.5) / RES - (hh + margin);
      for (let x = 0; x < W; x++) {
        const px = (x + 0.5) / RES - (hw + margin);
        data[y * W + x] = Math.round(255 * shadowField(sdRoundRect(px, py, hw, hh, r), spread));
      }
    }
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, W, H, 0, gl.RED, gl.UNSIGNED_BYTE, data);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.bakes++;
    return { tex, margin };
  }

  dispose() { for (const s of this.map.values()) this.gl.deleteTexture(s.tex); this.map.clear(); }
}
