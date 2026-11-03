import { describe, expect, it } from 'vitest';
import { decodePng, diffImages, encodePng, paintRects, type Image } from '../src/png.js';

const image = (w: number, h: number, channels: 3 | 4 = 3, v = 200): Image => ({
  width: w,
  height: h,
  channels,
  data: new Uint8Array(w * h * channels).fill(v),
});

describe('PNG', () => {
  it('reads back what it writes, with or without alpha', () => {
    for (const channels of [3, 4] as const) {
      const img = image(5, 4, channels);
      img.data[7] = 12;
      const back = decodePng(encodePng(img))!;
      expect(back).toMatchObject({ width: 5, height: 4, channels });
      expect([...back.data]).toEqual([...img.data]);
    }
  });

  it('paints a rect, cut to the image', () => {
    const img = image(4, 4);
    paintRects(img, [{ x: 2, y: 2, w: 10, h: 10 }]);
    const at = (x: number, y: number) => img.data[(y * 4 + x) * 3];
    expect([at(1, 1), at(2, 2), at(3, 3)]).toEqual([200, 0, 0]);
  });
});

describe('diffImages', () => {
  it('counts what differs past the noise of an encoder, and draws it', () => {
    const a = image(10, 10);
    const b = image(10, 10, 4);
    b.data[0] = 100; // a real change
    b.data[4] = 205; // noise
    const d = diffImages(a, b);
    expect(d).toMatchObject({ compared: 100, differing: 1, percent: 1 });
    expect([...d.image.data.subarray(0, 3)]).toEqual([230, 30, 30]);
    expect(decodePng(encodePng(d.image))).not.toBeNull();
  });

  it('leaves masks out, and shows them', () => {
    const a = image(10, 10);
    const b = image(10, 10);
    b.data.fill(0, 0, 30); // the first row
    const d = diffImages(a, b, [{ x: 0, y: 0, w: 10, h: 1 }]);
    expect(d).toMatchObject({ compared: 90, differing: 0, percent: 0 });
    expect([...d.image.data.subarray(0, 3)]).toEqual([70, 90, 200]);
  });

  it('refuses two sizes', () => {
    expect(() => diffImages(image(2, 2), image(3, 2))).toThrow(/differ in size/);
  });
});
