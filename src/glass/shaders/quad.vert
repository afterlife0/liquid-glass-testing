#version 300 es
// Draws an axis-aligned rect given in TOP-DOWN pixels of the current target.
precision highp float;
in vec2 aPos;            // unit quad 0..1
uniform vec4 uQuad;      // x0, y0, x1, y1 (top-down px)
uniform vec2 uRes;       // target size in px
out vec2 vUv;            // 0..1, v = 0 at the top edge
void main() {
  vec2 px = mix(uQuad.xy, uQuad.zw, aPos);
  vUv = aPos;
  gl_Position = vec4(px.x / uRes.x * 2.0 - 1.0, 1.0 - px.y / uRes.y * 2.0, 0.0, 1.0);
}
