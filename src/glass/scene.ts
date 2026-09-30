// Scene composite + blur chain. Runs ONLY when the backdrop moves (sceneDirty).
//
// Orientation contract (bug #3): every texture here is TOP-DOWN. The art is
// uploaded with UNPACK_FLIP_Y = false (row 0 = top) and every offscreen pass
// writes top-down row y at framebuffer row y. Exactly one flip exists: the
// final blit to the default framebuffer (blit.frag).
import { Program, Target, target, texture } from './gl';

export interface ScenePrograms { scene: Program; down: Program; gauss: Program }

export class Scene {
  full!: Target;     // full res composite (blitted to screen)
  half!: Target;     // box ½ — sampled sharp by small controls
  quarter!: Target;  // box ¼
  blurA!: Target;    // gauss H
  blurB!: Target;    // gauss V — sampled by large surfaces
  private art: WebGLTexture;
  private artW = 1; private artH = 1; private artScale = 1;
  private w = 0; private h = 0;

  constructor(private gl: WebGL2RenderingContext, private p: ScenePrograms, private vao: WebGLVertexArrayObject) {
    this.art = texture(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([20, 24, 32, 255]));
  }

  resize(w: number, h: number) {
    if (w === this.w && h === this.h) return;
    const gl = this.gl;
    this.w = w; this.h = h;
    this.full = target(gl, w, h, this.full);
    this.half = target(gl, Math.ceil(w / 2), Math.ceil(h / 2), this.half);
    this.quarter = target(gl, Math.ceil(w / 4), Math.ceil(h / 4), this.quarter);
    this.blurA = target(gl, this.quarter.w, this.quarter.h, this.blurA);
    this.blurB = target(gl, this.quarter.w, this.quarter.h, this.blurB);
  }

  /** Backdrop source #1/#2: pixels we own. Uploaded once per art change, never per frame. */
  setArt(src: HTMLCanvasElement, scale: number) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.art);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
    this.artW = src.width; this.artH = src.height; this.artScale = scale;
  }

  private pass(t: Target, prog: Program) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    gl.viewport(0, 0, t.w, t.h);
    gl.useProgram(prog.prog);
    gl.uniform4f(prog.u.uQuad, 0, 0, t.w, t.h);
    gl.uniform2f(prog.u.uRes, t.w, t.h);
  }

  private draw() { this.gl.bindVertexArray(this.vao); this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4); }

  render(panDev: number, dim: number, blurCssPx: number, dpr: number) {
    const gl = this.gl, { scene, down, gauss } = this.p;
    gl.disable(gl.BLEND);

    this.pass(this.full, scene);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.art);
    gl.uniform1i(scene.u.uArt, 0);
    gl.uniform2f(scene.u.uArtRes, this.artW, this.artH);
    gl.uniform1f(scene.u.uArtScale, this.artScale / dpr);
    gl.uniform1f(scene.u.uPan, panDev);
    gl.uniform1f(scene.u.uDim, dim);
    this.draw();

    // two box downsamples — no mipmaps on a texture that changes
    for (const [src, dst] of [[this.full, this.half], [this.half, this.quarter]] as const) {
      this.pass(dst, down);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform1i(down.u.uSrc, 0);
      gl.uniform2f(down.u.uSrcRes, src.w, src.h);
      this.draw();
    }

    // separable gaussian at quarter res; σ = 0.55 × radius
    const sigma = Math.max(0.8, 0.55 * blurCssPx * dpr / 4);
    for (const [src, dst, dx, dy] of [[this.quarter, this.blurA, 1, 0], [this.blurA, this.blurB, 0, 1]] as const) {
      this.pass(dst, gauss);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform1i(gauss.u.uSrc, 0);
      gl.uniform2f(gauss.u.uDir, dx, dy);
      gl.uniform1f(gauss.u.uSigma, sigma);
      this.draw();
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  dispose() {
    const gl = this.gl;
    for (const t of [this.full, this.half, this.quarter, this.blurA, this.blurB]) if (t) { gl.deleteFramebuffer(t.fb); gl.deleteTexture(t.tex); }
    gl.deleteTexture(this.art);
  }
}
