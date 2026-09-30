#version 300 es
// Separable gaussian at quarter resolution. Runs only when the scene is dirty.
precision highp float;
out vec4 O;
uniform sampler2D uSrc;
uniform vec2  uRes;
uniform vec2  uDir;
uniform float uSigma;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  int R = int(min(ceil(uSigma * 3.0), 24.0));
  float k = -0.5 / (uSigma * uSigma);
  mediump vec3 acc = vec3(0.0); float wsum = 0.0;
  for (int i = -24; i <= 24; i++) {
    if (i < -R || i > R) continue;
    float w = exp(float(i * i) * k);
    acc  += texture(uSrc, uv + uDir * float(i) / uRes).rgb * w;
    wsum += w;
  }
  O = vec4(acc / wsum, 1.0);
}
