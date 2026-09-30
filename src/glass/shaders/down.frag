#version 300 es
// 2x2 box downsample in one bilinear fetch: the centre of a destination
// pixel lands exactly on the shared corner of four source texels.
precision mediump float;
out vec4 O;
uniform sampler2D uSrc;
uniform highp vec2 uSrcRes;
void main() { O = texture(uSrc, gl_FragCoord.xy * 2.0 / uSrcRes); }
