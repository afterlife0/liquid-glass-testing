#version 300 es
// Liquid Glass material — the §3 shader. Coordinates highp, colour mediump.
// Two additions over the brief, both uniform-driven (no per-pixel branches):
//   • sdAll also blends the dominant shape's centre/half-size, so the lens and
//     the wave mirrors follow whichever shape a pixel belongs to after a split
//     (with only uSh[0] the separated shapes clamp to a constant, shifted lens).
//   • uWd carries a per-source direction + anisotropy for the flick gesture (§5).
precision highp float;
out vec4 O;

uniform vec2  uRes;
uniform sampler2D uPre;     // quarter-res gaussian backdrop
uniform sampler2D uSharp;   // half-res backdrop, for small controls
uniform vec4  uSh[4];       // xy centre, zw half-size — device px, top-down
uniform float uR[4];        // corner radius per shape
uniform int   uN;           // shape count (1..4)
uniform float uK;           // smooth-union radius — the "liquid"
uniform float uNexp;        // 2.0 = circular corner, 3.4 = superellipse
uniform float uThick, uRefr, uPress, uMelt, uClear, uTime;
uniform float uEdge;        // rim compression: device px sampled beyond the rim
uniform float uMag;         // lens magnification, fraction of the half-size
uniform float uPx;          // device px per CSS px — keeps the rim hairline thin at any DPR
uniform float uWK, uWW, uWS, uHoldR;
uniform float uWGain;       // wave gain: offsets the 1/dpr of a device-px gradient; applied after the life floor
uniform vec3  uHold;        // xy finger, z depth
uniform vec4  uW[3];        // xy origin, z start time, w amplitude
uniform vec3  uWd[3];       // xy throw direction, z anisotropy (0 = isotropic)
uniform int   uWn;

const vec2 LIGHT = vec2(-0.5523, -0.8337);   // normalize(vec2(-0.55, -0.83))

/* Superellipse rounded box with an ANALYTIC normal. */
float sdSq(vec2 p, vec2 b, float r, float n, out vec2 nrm) {
  vec2 s = sign(p);
  s = mix(vec2(1.0), s, abs(s));                       // sign(0) would zero the normal
  vec2 q = abs(p) - b + r;
  if (q.x > 0.0 && q.y > 0.0) {                        // corner region only
    float a = pow(q.x, n), c = pow(q.y, n);
    nrm = s * vec2(pow(q.x, n-1.0), pow(q.y, n-1.0))
            / max(pow(a + c, (n-1.0)/n), 1e-5);
    return pow(a + c, 1.0/n) - r;
  }
  if (q.x > q.y) { nrm = vec2(s.x, 0.0); return q.x - r; }
  nrm = vec2(0.0, s.y); return q.y - r;
}

/* Polynomial smooth union. The same maths merges AND splits. */
float sdAll(vec2 p, out vec2 nrm, out vec2 cen, out vec2 hb) {
  vec2 n; float d = sdSq(p - uSh[0].xy, uSh[0].zw, uR[0], uNexp, n);
  cen = uSh[0].xy; hb = uSh[0].zw;
  for (int i = 1; i < 4; i++) {
    if (i >= uN) break;
    vec2 ni; float di = sdSq(p - uSh[i].xy, uSh[i].zw, uR[i], uNexp, ni);
    float h = clamp(0.5 + 0.5*(d - di)/max(uK, 1e-4), 0.0, 1.0);
    d   = mix(d, di, h) - uK*h*(1.0 - h);
    n   = normalize(mix(n, ni, h) + 1e-6);
    cen = mix(cen, uSh[i].xy, h);
    hb  = mix(hb,  uSh[i].zw, h);
  }
  nrm = n; return d;
}

/* Travelling wave packets with four mirror images off the rim (§5). */
vec2 waveGrad(vec2 p, vec2 c, vec2 hb) {
  vec2 acc = vec2(0.0);
  for (int i = 0; i < 3; i++) {
    if (i >= uWn) break;
    vec4 A = uW[i];
    float age = uTime - A.z;
    if (A.w <= 0.002 || age < 0.0 || age > 1.5) continue;
    float life = A.w * exp(-age * 2.9);
    if (life < 0.004) continue;
    float front = age*uWS, lo = max(0.0, front - 2.2*uWW), hi = front + 2.2*uWW;
    vec3 D = uWd[i];
    for (int m = 0; m < 5; m++) {
      vec2 q = A.xy; vec2 dir = D.xy; float gain = 1.0;
      if      (m == 1) { q.x = 2.0*(c.x - hb.x) - q.x; dir.x = -dir.x; gain = 0.5; }
      else if (m == 2) { q.x = 2.0*(c.x + hb.x) - q.x; dir.x = -dir.x; gain = 0.5; }
      else if (m == 3) { q.y = 2.0*(c.y - hb.y) - q.y; dir.y = -dir.y; gain = 0.5; }
      else if (m == 4) { q.y = 2.0*(c.y + hb.y) - q.y; dir.y = -dir.y; gain = 0.5; }
      vec2 dv = p - q; float d2 = dot(dv, dv);
      if (d2 > hi*hi || d2 < lo*lo) continue;          // reject before the sqrt
      float r = max(sqrt(d2), 1e-3), u = (r - front)/uWW;
      if (abs(u) > 2.2) continue;
      float an  = mix(1.0, max(dot(dv / r, dir), 0.0), D.z);
      float amp = life*gain*an*exp(-u*u), ph = (r - front)*uWK;
      acc += amp * (cos(ph)*uWK - sin(ph)*2.0*u/uWW) * dv / r;
    }
  }
  return acc * 22.0 * uWGain;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 nrm, cen, hb; float d = sdAll(p, nrm, cen, hb);

  // ── outside: bloom only (press / melt). The shadow is its own earlier pass.
  //    The bloom is evaluated from max(d, 0) and also composited under the AA
  //    band below — otherwise the band between the glass and the bloom reads as
  //    a dark outline at the peak of a melt (bug #1: a fixed d became a line).
  float bk = 10.0 + 46.0*uMelt + 22.0*uPress;
  float bloom = (uMelt*1.15 + uPress*0.40) * exp(-max(d, 0.0)/bk);
  if (d > 1.2) {
    if (bloom < 0.004) discard;                        // cheapest possible reject
    O = vec4(vec3(bloom), bloom); return;              // premultiplied white == screen blend
  }
  float inside = smoothstep(1.2, -1.2, d);

  // ── surface: RIM COMPRESSION + SIZE-RELATIVE LENS. Both terms are required.
  //    Rim: a thick lens bends hardest at its edge, so the band just inside the
  //    rim shows content from up to uEdge px BEYOND the footprint, squeezed into
  //    the bevel (the list row pulled into a toolbar's top edge in the reference).
  //    w³ has zero first AND second derivative where the bevel ends: no seam (bug #1).
  float t = clamp(-d/uThick, 0.0, 1.0);
  float w = 1.0 - t;
  vec2 offEdge = nrm * (uEdge * w*w*w);
  //    Lens: magnify about the centre in proportion to the shape's size, growing
  //    toward the rim — content under a control reads larger, not just softer.
  vec2 rel  = p - cen;
  vec2 relv = clamp(rel/max(hb, vec2(1.0)), -1.2, 1.2);
  vec2 offLens = -rel * uMag * (0.70 + 0.62*min(dot(relv, relv), 1.0));

  vec2 wg = waveGrad(p, cen, hb);
  if (uHold.z > 0.002) {                               // press-and-hold dimple
    vec2 dv = p - uHold.xy; float s2 = uHoldR*uHoldR;
    wg += uHold.z * 0.6 * exp(-dot(dv,dv)/(2.0*s2)) * dv/s2 * 22.0;
  }
  vec2 off  = ((offEdge + offLens) - wg * 40.0 * uRefr) * (1.0 - uMelt*0.7);
  vec2 uv   = p / uRes;

  // ── sample, with dispersion only where the bend is wide enough to separate
  mediump vec3 g;
  float ol = length(off);
  if (ol > 9.0) {
    vec2 fr = off * min(0.075, 5.5/max(ol, 0.001));
    if (uClear > 0.5) {
      g.r = texture(uSharp, uv + (off+fr)/uRes).r;
      g.g = texture(uSharp, uv +  off    /uRes).g;
      g.b = texture(uSharp, uv + (off-fr)/uRes).b;
    } else {
      g.r = texture(uPre,   uv + (off+fr)/uRes).r;
      g.g = texture(uPre,   uv +  off    /uRes).g;
      g.b = texture(uPre,   uv + (off-fr)/uRes).b;
    }
  } else g = (uClear > 0.5) ? texture(uSharp, uv + off/uRes).rgb
                            : texture(uPre,   uv + off/uRes).rgb;

  // ── vibrancy: a NEUTRAL lift that grows as the backdrop darkens. Never a hue.
  mediump float bl = dot(g, vec3(0.2126, 0.7152, 0.0722));
  //    0.07, not the brief's 0.13: against the reference, 0.13 turned controls over
  //    dark video into grey discs where Apple's are a faint lightening.
  g += vec3((1.0 - smoothstep(0.0, 0.5, bl)) * 0.07);
  g  = mix(g, vec3(1.0), uMelt*0.90 + uPress*0.45);

  // ── veil: a small neutral lift so glass reads as a material over any content.
  g = mix(g, vec3(1.0), 0.05);

  // ── rim: a hairline, never scaled by body opacity. Lit on BOTH diagonals —
  //    bright top-left, softer bottom-right, dim on the cross diagonal.
  mediump float edge = smoothstep(1.4*uPx, 0.0, abs(d + 0.8*uPx));
  mediump float band = smoothstep(1.0, 0.0, t) * 0.05;
  mediump float lit  = dot(nrm, LIGHT);
  mediump float spec = pow(abs(lit), 1.6) * (lit > 0.0 ? 0.46 : 0.30);
  g += (edge*(spec + 0.10) + band)*(1.0 - uMelt*0.8) + edge*uPress*0.22;

  // ── wave shading is DIRECTIONAL and signed — a flat surface gets exactly zero.
  mediump float sheen = dot(wg, LIGHT);
  g += clamp(sheen, -0.28, 0.28) * 0.34;

  // ── shoulder: bright content approaches 1.0 asymptotically.
  mediump float mx = max(g.r, max(g.g, g.b));
  if (mx > 0.84) g *= (0.84 + 0.16*(1.0 - exp(-(mx - 0.84)/0.16))) / mx;

  O = vec4(g * inside, inside * (0.88 + 0.12*max(uPress, uMelt)));  // premultiplied
  O += vec4(vec3(bloom), bloom) * (1.0 - inside);      // bloom under the AA edge
}
