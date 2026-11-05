import { describe, expect, it } from 'vitest';
import { encodePng } from '../src/png.js';
import { pictureApart, SAME_PICTURE } from './picture-apart.js';

const W = 360;
const H = 800;

/** A screen with something on it: light, a dark bar `at` px across, and a mid block lower down. */
function screen(at = 40, width = W, height = H) {
  const data = Buffer.alloc(width * height * 3, 240);
  const scale = width / W;
  const paint = (x0: number, y0: number, x1: number, y1: number, level: number) => {
    for (let y = Math.round(y0 * scale); y < y1 * scale; y++)
      for (let x = Math.max(0, Math.round(x0 * scale)); x < x1 * scale; x++)
        data.fill(level, (y * width + x) * 3, (y * width + x) * 3 + 3);
  };
  paint(at, 100, at + 200, 180, 20);
  paint(at + 60, 500, at + 240, 640, 120);
  return encodePng({ width, height, channels: 3, data });
}

describe('a picture beside a device’s own', () => {
  it('is the same at another size', () => {
    const { difference, shift } = pictureApart(screen(40, W / 2, H / 2), screen());
    expect(difference).toBeLessThan(SAME_PICTURE);
    expect(shift).toEqual({ x: 0, y: 0 });
  });

  it('shows how far it has moved, across or down', () => {
    const { difference, shift } = pictureApart(screen(10), screen(40));
    expect(difference).toBeGreaterThan(3);
    expect(shift.x).toBeCloseTo(-30 / W, 1);
    expect(shift.y).toBe(0);
  });

  it('calls a flat screen where it stands', () => {
    const flat = (level: number) =>
      encodePng({ width: W, height: H, channels: 3, data: Buffer.alloc(W * H * 3, level) });
    expect(pictureApart(flat(250), flat(250))).toEqual({ difference: 0, shift: { x: 0, y: 0 } });
  });
});
