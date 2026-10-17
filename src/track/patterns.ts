import type * as THREE from 'three';

/*
 * The original's see-through materials (wiki.stunts.hu "Shape materials"): some polygons are
 * drawn through a pattern mask, like OpenGL polygon stippling, so you see through them (the loop's
 * road is a grate, fences grilles, windows glass). Here the mask is applied per screen pixel of
 * the 320x200 picture, scaled with it. The wiki names the patterns; their exact pixel layouts are
 * approximations: grate a checkerboard, grille stripes, glass 3 pixels in 4, inverse ones the rest.
 */

export const enum Pattern {
  Opaque = 0,
  Grate = 1,
  Grille = 2,
  InverseGrille = 3,
  Glass = 4,
  InverseGlass = 5,
  Transparent = 6,
}

/** Pattern of each original material (by material number). */
export function materialPattern(material: number): Pattern {
  switch (material) {
    case 0x16:
    case 0x17:
    case 0x18:
    case 0x22:
    case 0x5e:
      return Pattern.Grate;
    case 0x76:
      return Pattern.Transparent;
    case 0x77:
      return Pattern.Grille;
    case 0x78:
      return Pattern.InverseGrille;
    case 0x79:
    case 0x7b:
    case 0x7d:
      return Pattern.Glass;
    case 0x7a:
    case 0x7c:
    case 0x7e:
      return Pattern.InverseGlass;
    default:
      return Pattern.Opaque;
  }
}

/** Device pixels per pixel of the 320x200 picture (set by the game when the window resizes). */
export const patternUniforms = { uPixel: { value: 1 } };

/** Make a vertex-coloured material honour the per-vertex "pattern" attribute. */
export function usePatterns(material: THREE.Material): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uPixel = patternUniforms.uPixel;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'attribute float pattern;\nvarying float vPattern;\nvoid main() {\n  vPattern = pattern;')
      ;
    shader.fragmentShader = shader.fragmentShader.replace(
      'void main() {',
      `uniform float uPixel;
varying float vPattern;
void main() {
  {
    vec2 p = floor(gl_FragCoord.xy / uPixel);
    float x = mod(p.x, 2.0);
    float y = mod(p.y, 2.0);
    int pt = int(vPattern + 0.5);
    if (pt == 1 && mod(p.x + p.y, 2.0) > 0.5) discard;
    if (pt == 2 && x > 0.5) discard;
    if (pt == 3 && x < 0.5) discard;
    if (pt == 4 && x < 0.5 && y < 0.5) discard;
    if (pt == 5 && !(x < 0.5 && y < 0.5)) discard;
    if (pt == 6) discard;
  }`,
    );
  };
}
