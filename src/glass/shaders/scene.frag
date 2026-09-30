#version 300 es
// Scene composite, full resolution. STORAGE ORIENTATION: every offscreen
// texture is top-down — framebuffer row y holds top-down row y. The art
// texture was uploaded top-down (UNPACK_FLIP_Y = false), so no flip here.
precision highp float;
out vec4 O;
uniform sampler2D uArt;
uniform vec2  uArtRes;   // art texture size, texels
uniform float uArtScale; // art texels per device px
uniform float uPan;      // device px
uniform float uDim;      // 0..1 scrim for modals
void main() {
  vec2 p  = gl_FragCoord.xy;
  vec2 uv = (p + vec2(uPan, 0.0)) * uArtScale / uArtRes;
  vec3 c  = texture(uArt, uv).rgb;
  O = vec4(c * (1.0 - uDim), 1.0);
}
