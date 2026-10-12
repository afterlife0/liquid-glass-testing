# Apple's Liquid Glass, reverse engineered (macOS 26.7)

This is a static teardown of how Apple renders Liquid Glass, done with
[REA](https://github.com/morluto/rea) (`rea-agents` 6.4.0, Ghidra 12.1.4 provider)
plus a few small helper scripts (`tools/reverse-engineering/`). Nothing was executed;
everything below comes from Apple's shipped binaries and GPU shader libraries.

Each claim is tagged with the kind of evidence behind it:

- **[observed]**: read directly from shipped code, metadata or shader IR.
- **[derived]**: follows mechanically from observed code (for example, a formula simplified).
- **[inferred]**: a reasonable reading that the evidence suggests but does not prove.

The REA Evidence IDs, addresses and binary digests are in the [evidence ledger](#9-evidence-ledger).

---

## TL;DR

1. **Every glass shape is a signed distance field (SDF).** Rects and continuous-corner
   "supercircles" are evaluated analytically. Arbitrary shapes get a jump-flooded SDF.
   All optics are functions of the distance `d` (in points, negative inside) and the
   SDF normal `n`. [observed]
2. **Refraction follows one profile: a quarter-circle bevel.** The sampling offset is
   `A · (1 − √(1 − (1 − t)²))` with `t = clamp(depth / h, 0, 1)`. It is maximal at the
   rim, falls smoothly to zero at depth `h`, and is exactly zero in the middle. The same
   `arc()` is used for inner refraction, outer refraction, edge bleed, shadow refraction,
   foreground refraction, chromatic aberration and the `CASDFGlassDisplacementEffect`
   (where `curvature` blends it toward a flat 0.2929 bevel). [observed]
3. **The rim bends both ways, using two samples.** `glassBackground` takes an *inner*
   sample (default amount −150 pt over a 60 pt arc) and an *outer* sample (+100 pt over
   50 pt). In the band 3–11 pt inside the edge it blends up to **75 %** toward the outer
   one. This project already approximates this with one signed offset. [observed]
4. **Blur varies with depth.** Blur is a piecewise-linear function of the *refracted*
   depth: full radius deep inside, **0.1×** near the rim, 0.4× exactly at the edge. It
   is applied by picking a mip level of a pre-blurred backdrop
   (`lod = log2(r)`, and `r = 1.6 × inputBlurRadius × scale`). [observed]
5. **The colour pipeline is a YCbCr colour matrix, not a white veil.** Face, edge-bleed
   and shadow each get a matrix built by `ColorMatrix::set_ycc_composite(white, black,
   saturation, fillColor)`. [observed]
6. **Highlights are an SDF rim band, not a hairline.** The default band is 20 pt wide
   with linear falloff (`curvature 1`). A directional mask is applied:
   `saturate((n·L − cos(spread)) / (1 − cos(spread)))`, and the result is shaped by
   **Schlick's bias function** with `a = amount`. A key light (+90°) and a fill light
   (−90°) sit on opposite edges. [observed]
7. **Shadows** use an erfc (Gaussian-blurred edge) falloff of a second SDF lookup offset
   by (0, 10). The shadow is "vibrant": it colour-matrixes a refracted, blurred copy of
   the backdrop instead of drawing black. [observed]
8. **The "liquid" merge** is a polynomial smooth-min whose radius is scaled by
   `saturate(0.5 − 0.5·dot(nA, nB))`. Shapes only fuse where their surfaces face each
   other. [observed]
9. **Dispersion** happens in two places. The `chromaticAberrationMap` filter samples
   R at `uv + δ`, G at `uv` and B at `uv − δ`. `glassForeground` uses a 7-tap spectral
   ramp, normalised by (½, ⅓, ½), and refracts and disperses content drawn *on* the
   glass. [observed]
10. **SwiftUI does not hard-code the look.** `SwiftUI.Glass` asks a
    `PlatformGlassDefinition`, and on macOS AppKit registers
    `DesignLibrary.AppKitPlatformGlassDefinition`. The private **DesignLibrary**
    framework turns 27 named presets (regular, clear, menu, dock, sidebar, control,
    slider, keyboard, loupe…) into Core Animation layers. [observed]

---

## 1. Provenance and method

**Target build:** macOS Tahoe **26.7 (25G229)**, from the Recovery OS (`BaseSystem.dmg`)
inside the *Install macOS Tahoe* installer. It contains the x86_64 dyld shared cache
(719 images, among them `QuartzCore`, `SwiftUICore`, `SwiftUI`, `AppKit`, `RenderBox`,
`SkyLight`, `CoreUI` and `DesignLibrary`) and the frameworks' resources, including
QuartzCore's `default.metallib`.

**Acquisition:** Apple's CDN is blocked by this sandbox's egress policy, so the
installer image was read from a third-party mirror. Only the needed byte ranges were
fetched, using HTTP range requests. Authenticity was checked independently of the
mirror:

- All 140 SHA-256 chunk hashes in `BaseSystem.chunklist` match the image. [observed]
- The chunklist's RSA-2048 signature verifies against Apple's chunklist public key
  (the copy in OpenCorePkg's `OcAppleKeysLib`, `mPkDb1`). [observed]

To reproduce, use an installer you obtain from Apple yourself
(`softwareupdate --fetch-full-installer`) or the frameworks on a Mac running 26.x.

**Tools:**

| Step | Tool |
| --- | --- |
| Native analysis (decompile, xrefs, strings, procedures) | **REA 6.4.0** MCP server, Ghidra 12.1.4 provider, kept alive as a persistent session (`tools/reverse-engineering/rea_mcp_bridge.py`) |
| Extract individual dylibs from the dyld cache | `ipsw dyld extract` 3.1.736 |
| Swift type layouts (field names) | `ipsw swift-dump` on the cache |
| Metal library → per-function AIR bitcode | `metallib.py` (MTLB function list parser) |
| AIR bitcode → LLVM IR → pseudo-C with named uniform fields | `llvm-dis-18`, `air2c.py` |
| Disk image / filesystem | `udif.py` (UDIF chunks, incl. LZFSE), `libfshfs` / `libfsapfs` |

**Limits:**

- This is the **x86_64** slice from the Recovery cache. Apple-silicon builds compile the
  same Metal sources, but CPU-side constants could differ.
- The recovery cache is a subset of the full OS. Everything glass-related that is
  listed here was present.
- No Apple binaries, decompiled output or shader IR are committed to this repository.
  This document contains only descriptions, formulas and parameter values.

---

## 2. Architecture: from `glassEffect()` to pixels

```
SwiftUI  View.glassEffect(Glass.regular, in: shape)   /  AppKit NSGlassEffectView (Swift, built on SwiftUI)
   │      Glass.regular / .clear / .identity, .tint(_:), .interactive(_:)
   ▼
SwiftUICore  PlatformGlassDefinition ──set(_:system:)──  registered by AppKit                      [observed]
   │          resolved(_:environment:) → _Glass.Resolved
   ▼
DesignLibrary.framework (private)  AppKitPlatformGlassDefinition / UIKitPlatformGlassDefinition      [observed]
   │   GlassMaterialProvider(configuration:, options:, size:, interactionState:)
   │   Configuration presets: regular clear menu dock appIcons widgets text avplayer facetime
   │     controlCenter notificationCenter monogram bubbles identity focusBorder focusPlatter
   │     keyboard sidebar abuttedSidebar inspector control loupe slider camera cartouchePopover
   │     siriSnippet carplayUltra
   │   Size: minimum | medium | maximum | dynamic(CGSize) | automatic
   │   resolve(state) → Resolved → resolveLayers(in:) → [SwiftUI.Material.Layer]
   ▼
SwiftUI.Material.Layer
   SDF layers:   glassDisplacement(inset:height:curvature:angle:maskInset:)
                 glassHighlight_v2(inset:color:height:angle:appliesDisplayAngle:curvature:spread:amount:)
                 glassKeyFillHighlight(_:)   shadow(inset:color:radius:offset:knockout:inverted:)
                 color(_:inset:)   gradient(colors:distances:interpolations:)   group(type:layers:filters:)
   Filters:      glassBackground(margin:maskIndex:)   displacementMap(amount:maskIndex:)
                 chromaticAberrationMap(amount:maskIndex:)   variableBlur(radius:…maskIndex:)
                 gaussianBlur  saturation  brightness  colorMatrix  edrGainMultiply  averageColor
   ▼
Core Animation (QuartzCore, client side)
   CASDFLayer {effect, smoothness, gaussianRadius, mergeElements}  CASDFElementLayer {mode, operation,
   gradientOvalization, contentsZero/OneValueDistance}
   CASDFGlassDisplacementEffect {height, curvature, angle, maskOffset}
   CASDFGlassHighlightEffect {height, curvature, angle, spread, amount, color, global}
   CASDFKeyFillHighlightEffect {key*, fill*, curvature, global}   CASDFShadowEffect {radius, offset,
   color, punchout, invert}   CABackdropLayer + CAFilter("glassBackground" | "glassForeground" |
   "displacementMap" | "chromaticAberrationMap" | "variableBlur" …)
   ▼
Render server (QuartzCore CA::OGL, in WindowServer / backboardd)
   SDFNode::apply  → uber-shader opcodes      GlassBackgroundFilter::render  GlassForegroundFilter::render
   DisplacementMapFilter / ChromaticAberrationMapFilter::texture_function
   ▼
Metal: QuartzCore.framework/Resources/default.metallib (180 functions)
   glass_background{,_sdf}{,_no_bleed}  glass_foreground{,_sdf}  sdf_filter_vert  sdf_gen_field
   sdf_gen_gradients  brim_init/brim_jump/brim_outline (jump flood)  displacement_map
   chromatic_aberration{,_map}  fixed_frag_* uber-shader: sdf_glass_displacement, sdf_glass_highlight,
   sdf_key_fill_highlight, sdf_shadow, sdf_union, sdf_subtraction, vibrant_light/dark …
```

The codename for the AppKit side is **Solarium** (`NSAppearance._wantsSolarium`,
`NSAlertGlassSolariumEnabled`). [observed]

Every shader exists in two variants: `_lpf` (full float) and `_lph` (half precision).
The `_sdf` variants evaluate an analytic shape. The plain variants read a pre-baked SDF
texture whose channels are (distance, ∂x, ∂y, coverage). [observed]

---

## 3. The shape: signed distance fields

### 3.1 Analytic shapes ([observed], `compute_sdf_with_mode`, `supercircle_sdf`)

- **Mode < 4** is a box (`|p| − b`). The normal is the dominant axis.
- **Mode 4** is one `supercircle_sdf` on `|p|`, using a single corner radius.
- **Mode > 4** handles four corners with independent radii. It evaluates
  `supercircle_sdf` per quadrant and keeps the maximum.
- **`supercircle_sdf`** is Apple's *continuous corner*. The corner curve starts
  `1.528665 · r` from the corner, rather than `r`. It is evaluated with a rational
  polynomial in the corner angle:
  `0.268531 + x(1.26803 + x(−3.64122 + x(3.15601 − 0.926054x)))` with
  `x = min/max` of the normalised corner coordinates. When corners have different
  radii, each corner's `1.528665` extent is scaled down by a factor of
  `saturate((−1.528665 − halfSize / mean(adjacent radii)) · −1.891557)`, so that
  neighbouring curves never overlap.
- **Normal "ovalization":** the normal is
  `normalize(mix(boxNormal, normalize(p.x, p.y · a/b), ovalization))`, which blends the
  shape normal toward the normal of the inscribed ellipse. This matches
  `CASDFElementLayer.gradientOvalization`. Capsules therefore refract radially, like a
  lens, instead of like a box bevel.
- The output is `(d, n.x, n.y, 1)`, with `n` transformed by a 2×2 `tr` matrix (the
  layer transform).

### 3.2 Arbitrary shapes ([observed], `brim_init` → `brim_jump` × N → `sdf_gen_field` → `sdf_gen_gradients`)

1. Seeds are pixels with `alpha > alpha_threshold`.
2. A **jump flood** pass stores the nearest seed per texel.
3. `d = ±|p − seed| + 0.5 − alpha(seed)`, with sign by inside/outside and sub-pixel
   correction from the seed's alpha.
4. Gradients are central differences, normalised, then scale/biased into the texture.

`CASDFGeneratorRequest` exposes `padding`, `maximumDistance`, `zero/oneValueDistance`,
`includeGradient`, `gradientSmoothing` and `outputBitDepth`.

### 3.3 Merging: the "liquid" ([observed], `sdf_union` / `sdf_subtraction`)

```glsl
// a, b = (d, nx, ny, w); k = CASDFLayer.smoothness
float kk = k * saturate(0.5 - 0.5 * dot(a.yz, b.yz));        // only where surfaces face each other
float h  = saturate((b.x - a.x) / (2.0 * kk) + 0.5);
float d  = mix(b.x, a.x, h) - kk * h * (1.0 - h);
vec2  n  = mix(b.yz, a.yz, h);
```

Subtraction mirrors this, with `kk = k · (0.5 + 0.5·dot(nA, nB))`.

The normal-dependent radius is the difference from a textbook smooth-min. Two capsules
side by side, with parallel facing walls, neck smoothly. Shapes stacked along the same
direction don't swell.

---

## 4. `glassBackground`: the main material

Two parts: QuartzCore's `GlassBackgroundFilter::render` turns `CAFilter` inputs into
uniforms, and `glass_background_base` in the metallib applies them. Below,
`depth = −d` (positive inside), `dir = displacement_mat · n`, and `displacement_mat`
maps points to texture UVs, including the layer's scale.

```glsl
float arc(float depth, float h) {                 // quarter-circle bevel
  float t = clamp(depth / h, 0.0, 1.0);
  return 1.0 - sqrt(t * (2.0 - t));               // 1 at the rim → 0 at depth h
}
float lod(float r) { return max(0.0, log2(r < 2.0 ? r * 0.5 + 1.0 : r)); }
```

### 4.1 Inside (coverage > 0)

**`complex_refraction` path.** This flag is set when either refraction amount is
non-zero or the blur opacities differ.

```glsl
// piecewise-linear blur factor over refracted depth x = d + offset
float blurF(float x) {   // dist = (−450, −3, −0, 0), opac = (1, .1, .1, .4)
  return opac0 - Σ(i=1..3) (opac[i-1]-opac[i]) * saturate((x - dist[i-1]) / (dist[i] - dist[i-1]));
}
float aIn  = innerAmount * arc(depth, innerHeight);          // −150, 60
vec4  cIn  = sampleLod(src, uv + aIn * dir,  lod(blurR * blurF(d + aIn)));
float aOut = outerAmount * arc(depth, outerHeight);          // +100, 50
vec4  cOut = sampleLod(src, uv + aOut * dir, lod(blurR * blurF(d + aOut)));
vec4  c    = mix(cIn, cOut, saturate((d - r0) / (r1 - r0)) * refractionOpacity);   // r0 = −11, r1 = −3, 0.75
```

**Otherwise** it takes a single sample at `uv` with `lod(blurR)`.

**Colour and edge bleed:**

```glsl
c.rgb /= max(c.a, 1e-6);                                             // unpremultiply
c.rgb  = mix(c.rgb, FaceCM * c.rgb + faceOff, faceOpacity);          // YCbCr composite matrix
float aB = bleedAmount * arc(depth, bleedHeight);                    // 400, 500
vec3  b  = BleedCM * unpremul(sampleLod(src, uv + aB * dir, lod(bleedBlur))) + bleedOff;
float w  = sq(bleedDarken.x * luma(c.rgb) + bleedDarken.y)           // (−1, 1) → (1 − luma)²
         * saturate((d - e0) / (e1 - e0));                           // e0 = −400, e1 = −42
c.rgb  = mix(c.rgb, b, w * w * bleedOpacity);                        // 0.2
```

### 4.2 Outside and edge (coverage < 1): the shadow

```glsl
vec2  s   = sdf(p + shadowOffset).xw;                       // (0, 10): distance + coverage
float x   = clamp(s.x * (1.0 / shadowRadius), -2.0, 2.0);   // 25
float a   = shadowOpacity * s.y * erfcHalf(x);              // ½·erfc(x), odd 7th-order polynomial
vec4  sh;
if (vibrancy > 0.0) {                                       // inputShadowVibrancyContribution, default 1
  float aS = shadowAmount * arc(-(d + distOffset), shadowHeight);       // 200, −50, 250
  vec3  t  = unpremul(sampleLod(src, uv + aS * dir, lod(shadowBlur)));
  sh = vec4((ShadowCM * t) * vibrancy + shadowOff, mix(shadowFaceOpacity, 1.0, vibrancy));
} else sh = vec4(shadowOff, shadowFaceOpacity);
sh *= a;
```

The polynomial is
`erfcHalf(x) ≈ 0.5 − 0.56055x + 0.16821x³ − 0.034454x⁵ + 0.0029545x⁷`
(the Gaussian CDF; `σ ≈ shadowRadius / √2`).

### 4.3 Composite

```glsl
out = mix(sh, vec4(c.rgb, 1.0), coverage);
// then: SDR holding tone (if enabled), clamp with optional hue preservation, × edr_scale
```

### 4.4 Built-in defaults ([observed], `get_float_key(atom, default)` in `GlassBackgroundFilter::render`)

| Input | Default | → uniform |
| --- | --- | --- |
| `inputInnerRefractionAmount` / `Height` | **−150** / **60** | `inner_refraction_amount`, `1/height` |
| `inputOuterRefractionAmount` / `Height` | **100** / **50** | `outer_refraction_amount`, `1/height` |
| `inputRefractionDistance0` / `1` | **−11** / **−3** | `refraction_threshold0/1` |
| `inputRefractionOpacity` | **0.75** | `refraction_opacity` |
| `inputBlurRadius` | **30** | `blur_radius = 1.6 × 30 × scale` |
| `inputBlurDistance0…3` | **−450, −3, −0, 0** | `blur_dist0…3` |
| `inputBlurOpacity0…3` | **1, 0.1, 0.1, 0.4** | `blur_alpha0 = o0`, `blur_alphaᵢ = oᵢ₋₁ − oᵢ` |
| `inputBleedAmount` / `Height` | **400** / **500** | `edge_bleed_amount`, `1/height` |
| `inputBleedBlurRadius` | **100** (× 0.5 when bleed opacity > 0) | `edge_bleed_blur_radius` |
| `inputBleedDistance0` / `1` | **−400** / **−42** | `edge_bleed_dist0/1` |
| `inputBleedOpacity` | **0.2** | `edge_bleed_opacity` |
| `inputBleedDarkenBlend` | **0** → `bleed_darken = (−1, 1)`; 1 → `(1, 0)` | |
| `inputShadowAmount` / `Height` | **200** / **250** | `shadow_amount`, `1/height` |
| `inputShadowRadius` | **25** | `shadow_inv_radius = 1/25` |
| `inputShadowBlurRadius` | **25** (× 0.5 when shadow opacity > 0) | `shadow_blur_radius` |
| `inputShadowOffset` | **(0, 10)** | `shadow_offset` (transformed) |
| `inputShadowDistanceOffset` | **−50** | `shadow_dist_offset` |
| `inputShadowOpacity` | **1** | `shadow_opacity` |
| `inputShadowVibrancyContribution` | **1** | `shadow_contribution` |
| `input{Face,Bleed,Shadow}ColorMatrix{White,Black,Saturation}` | **1, 0, 1** | `set_ycc_composite(…, FillColor)` |
| `inputFaceOpacity` | **1** | `face_opacity` |
| `inputMaxHeadroom` | **1.2** | EDR headroom |
| `inputSDRGradientDistance0/1`, `inputSDRHoldingToneWhite` | **−2.5, −1.5, 0.97** | holding tone |
| `inputClamp`, `inputClampPreserveHue`, `inputSDRShadowOpacity`, `inputSDRHoldingToneEnabled` | 0 | |

These are the filter's own fallbacks. SwiftUI/DesignLibrary set their own values per
preset (see §7).

---

## 5. `glassForeground`: content on the glass ([observed])

This filter refracts and disperses the layer's *own contents*, such as symbols and
text, near the rim. It fades them out within the last few points.

```glsl
float depth = -d;
float aR = refrAmount  * arc(depth - refrOffset,  refrHeight);   // −150, 100, −10
float aC = aberrAmount * arc(depth - aberrOffset, aberrHeight);  // −15, 20, 0
vec2 uv0 = uv + aR * (M * rotate(n, refrAngle));                  // angle 0
vec2 dc  =      aC * (M * rotate(n, aberrAngle));                 // angle 0
// 7-tap spectral dispersion
for k in {1, 2/3, 1/3}:    s = tex(uv0 + k*dc);  R += k*s.r;  G += (1-k)*s.g;  A += s.a;
for k in {0, 1/3, 2/3, 1}: s = tex(uv0 - k*dc);  G += (1-k)*s.g;  B += k*s.b;  A += s.a;
rgb = vec3(R, G, B) * vec3(0.5, 1.0/3.0, 0.5);   alpha = A / 7 * coverage;
alpha *= 1.0 - mix(edgeOpStart, edgeOpEnd, saturate((d - edgeStart) / (edgeEnd - edgeStart)));  // 0, 1, −4.5, −3
```

---

## 6. SDF effects: displacement, highlight, shadow ([observed])

These run in the uber-shader. `SDFNode::apply` packs the uniforms.

### 6.1 `CASDFGlassDisplacementEffect` → `sdf_glass_displacement`

**Defaults:** `height 20`, `curvature 1`, `angle 0`.

```glsl
float depth = -(d + offset), t = clamp(depth / height, 0., 1.), u = 1. - t;
float P = 1.0 - mix(1.0 - 0.2929 * float(t < 1.0), sqrt(1.0 - u*u), curvature);  // curvature 1 → arc()
out.rg = rotate(n, angle) * P * aa(depth − height);     // displacement vector
out.b  = aa(depth − maskInset) * coverage;              // mask
```

This texture feeds the backdrop's `displacementMap` filter, which samples
`src(uv + mat · (rg − offset)) · mask`. It also feeds `chromaticAberrationMap`, which
takes R at `uv + δ`, G at `uv` and B at `uv − δ`, with `alpha = mask · mean(a)`.

### 6.2 `CASDFGlassHighlightEffect` → `sdf_glass_highlight`

**Defaults:** `height 20`, `curvature 1`, `angle π/2`, `spread π`, `amount 0.5`,
`color` white.

`SDFNode::apply` (opcode `0x40`) packs:

- `params0 = (height, cos(spread), L)`
- `params1 = (1/amount − 2, curvature, offset)`
- `L` is the light direction from `__sincosf_stret`, packed as `(sin φ, −cos φ)`.
- When `amount == 1`, a cosine of exactly −1 is nudged to −1.01. That −1 is what the
  default `spread = π` produces, which is why this argument reads as `cos(spread)`.
  [derived from the special case; the `cosf` argument register was not traced]

```glsl
float depth = -(d + offset) / length(grad);
float t     = saturate(depth / height);
float band  = aa(depth) * mix(float(t < 1.0), 1.0 - t, curvature) * aa(height - depth);
float lit   = saturate((dot(n, L) - cos(spread)) / (1.0 - cos(spread)));   // L = unit light vector
float h     = depth < -5.0 ? 0.0 : band * lit;
out = color * h / ((1.0/amount - 2.0) * (1.0 - h) + 1.0);                  // Schlick bias(h, amount)
```

With the defaults, `amount 0.5` gives `bias = h` (linear), and `spread π` lights the
whole rim, ramping from 0 on the far side to 1 facing the light.

### 6.3 `CASDFKeyFillHighlightEffect` → `sdf_key_fill_highlight`

This is the same band × direction × bias term, evaluated twice: once for a **key**
light and once for a **fill** light. Each has its own height, spread, angle, amount
and colour, plus `*HeightScale/Offset` and `*SpreadScale/Offset`.

**Defaults:** key angle **+π/2**, fill angle **−π/2**; both height 20, spread π,
amount 0.5, white. The two lights sit on opposite edges.

### 6.4 `CASDFShadowEffect` → `sdf_shadow`

**Defaults:** radius **10**, offset **(0, −10)**, colour **black**, `punchout` and
`invert` false.

```glsl
x = clamp(scale * (d + offset) - bias, -2, 2);   out = color * coverage * erfcHalf(x);
```

### 6.5 `CASDFOutputEffect`

**Defaults:** `minimum −10000`, `maximum 100`. This is the distance range written when
an SDF is output for a backdrop (the `@0` texture that `glassBackground` reads).

---

## 7. What SwiftUI/DesignLibrary actually configure

On macOS, `SwiftUI.Glass` resolves through `DesignLibrary.AppKitPlatformGlassDefinition`.
AppKit registers it by calling `PlatformGlassDefinition.set(_:system:)` at
`0x7ff80489cc5d`, with the class from `DesignLibrary.AppKitPlatformGlassDefinitionCMa`
(GOT `0x7ff84004ea40`). [observed]

`ExperimentalGlassMaterialProvider.resolveLayers` in SwiftUICore is an unimplemented
stub (`fatalError`). The real recipe lives in DesignLibrary. [observed]

**Observed from DesignLibrary call sites**, x86_64 disassembly plus REA decompilation:

- `glassDisplacement(inset:height:curvature:angle:maskInset:)` is always called with
  **curvature 1.0**, **angle 0**, **maskInset 0**. One layer uses **inset −66.6**
  (`0xc050a66666666666`), i.e. the SDF expanded 66.6 pt outward. The main layer uses
  inset 0. `height` comes from a per-shape resolved value. [observed]
- `displacementMap(amount:)`, `chromaticAberrationMap(amount:)` and the blur radii are
  resolved values, not literals. `variableBlur` is given `radius × 0.5`. [observed]
- The **Clear** preset adds `glassBackground(margin: 400)`, which matches
  `inputBleedAmount = 400`. The margin is how far outside the shape the backdrop must
  be captured for edge bleed. [observed, inferred link]
- Highlight builders pass `spread = π`. A colour-scheme-dependent style function holds
  highlight-like angles of **95°** (1.658063 rad) and **70°** (1.22173 rad) in its
  light and dark branches, along with gains (1.06, 1.1, 1.15) and offsets 3.0 / −44.0.
  [observed literals, inferred meaning]
- `GlassMaterialProvider.resolve(state)` uses reference sizes **8, 12, 64, 164** for
  the size variants (minimum/medium/maximum…). [observed literals, inferred meaning]
- Swift type layouts (field names from reflection metadata):
  - `Resolved` = `{composite, focusOffset, configuration, resolved, dimensions:
    Dimensions?, tints, tintRecipe, colorScheme, customFill, customGlow, style,
    controlTint, styleFlags, fixedBackgroundColor}`
  - `Dimensions` = `{minimumDistance, minimumDistanceOfLargestArea}`. The bevel scales
    with the shape's inscribed distance [inferred].
  - `RegularGlassMaterialProvider` = `{configuration {appliesDisplayAngle,
    contentLensing}, sizeVariant}`
  - `GlassEdgeMaterialProvider` = `{width, angleOffset}`
  - `Defaults.Storage` = `{useEDRGainMultiply, specularHDR, defaultHDR,
    reducesShadowVibrancy, forcesDarkShadow, contourGradientRecipe, …}`
  - [observed]

**Open:** the exact per-preset numbers (displacement height and amount as a function
of `minimumDistance`; blur radius; highlight height and amount). They are produced by
symbol-redacted Swift functions in DesignLibrary (`FUN_7ff9048074b0`,
`FUN_7ff90480d280`, `FUN_7ff904843760`, `GlassMaterialProvider.resolve(_:)` at
`0x7ff90487e1b0`), and Ghidra loses their register-passed Swift arguments. The next step
is to follow those registers by hand from the `Resolved` struct field offsets.

---

## 8. How this project compares (`src/glass/shaders/glass.frag`)

| Aspect | This project | Apple (26.7) | Suggested change |
| --- | --- | --- | --- |
| Rim profile | one signed offset; cubic lobes `RIM_IN·w³ − RIM_OUT·wo³` over `min(22 %, 16 px)` | two samples, each with the quarter-circle `arc()`. Inner (−) over `h_in`; outer (+) blended in over the outer 3–11 pt at ≤ 75 % | replace `rimBend` with `arc()`; take inner and outer samples and blend by `saturate((d+11)/8)·0.75` (scaled to element size) |
| Middle | true size | true size (`arc()` = 0 past depth `h`) | already matches |
| Blur | fixed per element (3 px or 10 px gaussian) | blur ∝ refracted depth: full inside → 0.1 near rim → 0.4 at edge | sample a mip pyramid with `lod = log2(blurR · blurF(d + a))` |
| Colour | luma-dependent white lift (0.07) + 2 % veil + rim desaturation | YCbCr colour matrix (black/white/saturation + fill colour) per face/bleed/shadow; edge bleed `(1 − luma)²` | port `set_ycc_composite` and the bleed term; drop the veil |
| Specular | 1.4 px hairline, `pow(|n·L|, 1.6)` on both diagonals | 20 pt band, linear falloff, `saturate((n·L − cos spread)/(1 − cos spread))`, Schlick bias; key light + fill light on opposite edges | widen to a band and use the bias curve; keep two lights |
| Dispersion | 3-tap, only when offset > 9 px | `chromaticAberrationMap`: 3-tap R/G/B along the displacement; foreground: 7-tap | similar; scale δ with `arc()` instead of a threshold |
| Shadow | separate baked R8 pass | erfc falloff of an offset SDF; colour from a refracted, blurred backdrop | optional: vibrant shadow |
| Corners | superellipse, n = 3.4 | supercircle with 1.528665 · r extent | swap in `supercircle_sdf` |
| Merge | smooth-min, constant `k` | smooth-min with `k · saturate(0.5 − 0.5 n_A·n_B)` | one-line change in `sdAll` |
| Lens direction | SDF normal | normal blended toward the ellipse normal (`gradientOvalization`) | add an ovalization mix for capsules |

---

## 9. Evidence ledger

**Binaries analyzed** (macOS 26.7 25G229, x86_64):

| Artifact | SHA-256 |
| --- | --- |
| `BaseSystem.dmg` (Apple-signed chunklist verified) | `1b8756a6e655e13d1334d354969f42fb2e748e50dd0a19fba4c15ef8ae7810a5` |
| `dyld_shared_cache_x86_64` / `.01` | `e26a110b…dd03` / `4f13a4be…0017` |
| `QuartzCore` (extracted) | `9e91c42fec5363935a8f553a0e76ee181401600be8b64eed9db562235bf25f12` |
| `SwiftUICore` (extracted) | `29db9bd185d1846c9adcda8347bcaefcdf987527333a25702f9dec75aa8cf635` |
| `DesignLibrary` (extracted) | `c7954eff466786bcb5f4c76463e08a36ab46349b822b7cda86bf465a44ca8b08` |
| `QuartzCore.framework/Resources/default.metallib` | `7c6365339569521688f59b1925d04b001832f360e4d44f2a7367738eb4891428` |

**REA Evidence** (Ghidra 12.1.4 provider; analysis profile digest `c027fac3…2b7a`):

| Finding | Operation / address | Evidence ID |
| --- | --- | --- |
| glass filter strings, `CA::OGL::GlassBackgroundFilter` symbols | `search_strings "glass"` | `ev_fe78d5629e0077410489506d13206c29dcc6b240028fecb56ffe803c8a52d92b` |
| glass procedures | `search_procedures` | `ev_4fd86fabaf1ef886de1ddf8cd15ef6e558eea7939154416607a9d879be5a6d6d` |
| `glassBackground` defaults and uniform packing | `procedure_pseudo_code 0x7ff80a68a774` | `ev_6c948cbe13abe6b952cdc7bea7000dd60dedec9d0699906c0820855103f6ec79` |
| `glassForeground` defaults | `procedure_pseudo_code 0x7ff80a68d2d0` | `ev_58d14d67c53bb33733766049651222c0942450dcb8758bec26e34e1756492549` |
| bleed blur radius (×0.5) | `0x7ff80a60a93b` | `ev_5a0605c639a7d2fb58932fb7c9bcc1b51d13a536cf20abf820ebf013da75b863` |
| shadow blur radius (×0.5) | `0x7ff80a60ae54` | `ev_32eb5e7c9ba289d4f3e136d8aedaef82673a2794b622d6a8cb89e10bb1fc2d57` |
| atom table (`_wordlist` + `_stringpool_contents`) | `_CAAtomGetString 0x7ff80a4efd03` | `ev_ae212fd6e39a86a3b298a4a8d70dbf5ed82ad95edf00034820caafbb56c320e1` |
| `CASDFGlassDisplacementEffect` defaults (const dict `0x7ff840caf5a0`) | `0x7ff80a80793a` | `ev_504aeb21976e726177ff1e5a846484bd4b5b324f019c0942f920f34e163f18e9` |
| `CASDFGlassHighlightEffect` defaults | `0x7ff80a8080b8` | `ev_7e1985a9e679276df64c8fc19a158f919d1898564c1556a39166463b92b4277b` |
| `CASDFKeyFillHighlightEffect` defaults | `0x7ff80a8090e0` | `ev_36b6a04b55e2439a2c643ed759e6d3a5173bc5ab1f75116bee7d6457b6c41866` |
| `CASDFShadowEffect` defaults | `0x7ff80a809899` | `ev_6ecc93f76f52af9744d0a2e71104f1a47aed1445e97241ebce0b5100a941125c` |
| SDF effect → uniform packing (opcodes 0x3d/0x40/0x41) | `CA::OGL::SDFNode::apply 0x7ff80a765490` | `ev_664996f6d6afdc0b66e733c67ee0915b1ad47fe51b2ed1084a55c5936799ef1d` |
| SwiftUICore glass procedures | `search_procedures "glassDisplacement"` | `ev_aab2a606087a4c1f7a904115393c8ff2a0aa633ef5e2a9599d098b9cfe8aeb59` |
| `ExperimentalGlassMaterialProvider` is a stub | `0x7ff9028afc10` | `ev_0655acb0a4537210f886b721761d41621c0ccc19715b214c01c7da31bc2c21f6` |
| Regular preset → shared `resolveLayers` | `0x7ff904881940` | `ev_42fd5ac5d82d09296acd903bf7f3307ec9c782f63bb6564258765af9530d5d9f` |
| `Resolved.resolveLayers` dispatch | `0x7ff904871340` | `ev_a1fad6d73cbb1da490efac8c98f2a63a0615986d06f56a52b9ee87d9611057f6` |
| `glassDisplacement(inset: −66.6 …)` | `FUN_7ff9048074b0` | `ev_9d75a0e01c33e3ebccb7841fa310e0fc7e46149f1280975eeb1b1201fc6971a6` |
| highlight builder (`spread = π`) | `FUN_7ff90480d280` | `ev_5ccc5a066aa1d15365724c63a957415ccc6b3e9cc62aa3fe5f5df85b054ee7a9` |

**Shader-side evidence** (not REA; REA has no Metal/AIR reader). Function names, the
uniform struct field names and offsets (`air.struct_type_info`), and all formulas in
§3–§6 come from the AIR bitcode of `QuartzCore/default.metallib` (AIR v28, compiled by
`metalfe-32023.886`), disassembled with `llvm-dis-18` and translated with `air2c.py`.

---

## 10. Reproducing

See `tools/reverse-engineering/README.md`. In short:

1. Get an Apple-signed `BaseSystem.dmg`, or the frameworks from a Mac.
2. Verify its chunklist.
3. Extract the dyld cache and `default.metallib`.
4. Run `ipsw dyld extract` for `QuartzCore`, `SwiftUICore` and `DesignLibrary`.
5. Open them in REA (`open_binary` with `provider_id: "ghidra"`) through
   `rea_mcp_bridge.py`, so one Ghidra analysis serves many queries.
6. Split the metallib with `metallib.py`, then run `llvm-dis` and `air2c.py`.

Analysis is static and local. Respect Apple's software licence and your local law on
reverse engineering for interoperability.
