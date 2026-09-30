#version 300 es
// Final blit to the default framebuffer — the ONE place that flips.
precision highp float;
out vec4 O;
uniform sampler2D uScene;
uniform vec2 uRes;
void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  O = vec4(texture(uScene, p / uRes).rgb, 1.0);
}
