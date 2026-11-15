import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Points,
  ShaderMaterial,
} from 'three';
import { look, type Fire } from './fire.ts';

/** The most sparks drawn at once: a puff makes about thirty. */
const MOST = 96;

/**
 * The fire's sparks as soft round points that add their light, drawn over the scene. The scene's
 * units are page pixels, so a spark's radius is its size on the screen.
 */
export class Flames {
  readonly points: Points;
  readonly #place = new BufferAttribute(new Float32Array(MOST * 3), 3).setUsage(DynamicDrawUsage);
  readonly #tint = new BufferAttribute(new Float32Array(MOST * 4), 4).setUsage(DynamicDrawUsage);
  readonly #size = new BufferAttribute(new Float32Array(MOST), 1).setUsage(DynamicDrawUsage);
  readonly #material: ShaderMaterial;

  constructor(depth: number) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', this.#place);
    geometry.setAttribute('tint', this.#tint);
    geometry.setAttribute('size', this.#size);
    this.#place.array.fill(depth);
    this.#material = new ShaderMaterial({
      uniforms: { ratio: { value: 1 } },
      vertexShader: `
        attribute vec4 tint;
        attribute float size;
        uniform float ratio;
        varying vec4 shade;
        void main() {
          shade = tint;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * ratio;
        }`,
      fragmentShader: `
        varying vec4 shade;
        void main() {
          float edge = 1.0 - smoothstep(0.0, 1.0, length(gl_PointCoord - 0.5) * 2.0);
          gl_FragColor = vec4(shade.rgb, shade.a * edge);
        }`,
      blending: AdditiveBlending,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.points = new Points(geometry, this.#material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 1;
    geometry.setDrawRange(0, 0);
  }

  /** Draws the fire as it is now. A page's y runs down, the scene's up. */
  show(fire: Fire, ratio: number) {
    const sparks = fire.sparks.slice(-MOST);
    sparks.forEach((spark, i) => {
      const { radius, color, alpha } = look(spark);
      this.#place.setXY(i, spark.x, -spark.y);
      this.#tint.setXYZW(i, color[0] / 255, color[1] / 255, color[2] / 255, alpha);
      this.#size.setX(i, radius * 2);
    });
    for (const attribute of [this.#place, this.#tint, this.#size]) attribute.needsUpdate = true;
    this.#material.uniforms['ratio']!.value = ratio;
    this.points.geometry.setDrawRange(0, sparks.length);
  }
}
