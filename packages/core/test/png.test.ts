import { deflateSync } from 'node:zlib';
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

  it("reads an iPhone's own screenshot, which is 16 bits a sample, as 8", () => {
    const chunk = (type: string, data: Buffer) => {
      const head = Buffer.alloc(8);
      head.writeUInt32BE(data.length, 0);
      head.write(type, 4, 'latin1');
      return Buffer.concat([head, data, Buffer.alloc(4)]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(2, 0);
    ihdr.writeUInt32BE(1, 4);
    ihdr[8] = 16;
    ihdr[9] = 6;
    // the Sub filter takes each byte from the same byte of the pixel before: 8 bytes back here, not 4
    const row = [1, 0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xff, 0xff, 1, 0, 1, 0, 1, 0, 0, 0];
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(Buffer.from(row))),
      chunk('IEND', Buffer.alloc(0)),
    ]);
    const back = decodePng(png)!;
    expect([back.width, back.height, back.channels]).toEqual([2, 1, 4]);
    expect([...back.data]).toEqual([0x12, 0x56, 0x9a, 0xff, 0x13, 0x57, 0x9b, 0xff]);
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
