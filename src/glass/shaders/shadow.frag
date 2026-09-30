#version 300 es
// Baked shadow: one fetch of a static R8 field. Premultiplied black.
precision mediump float;
in vec2 vUv;
out vec4 O;
uniform sampler2D uShadow;
uniform float uAmt;
void main() {
  float s = texture(uShadow, vUv).r * uAmt;
  if (s < 0.002) discard;
  O = vec4(0.0, 0.0, 0.0, s);
}
