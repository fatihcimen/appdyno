import { deflateSync, inflateSync } from 'node:zlib';

/** A decoded screenshot: 8-bit RGB or RGBA rows, top to bottom. */
export type Image = { width: number; height: number; channels: 3 | 4; data: Uint8Array };

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * PNG screenshots as pixels (zlib and the five row filters, no dependency).
 * shortcut: 8-bit RGB/RGBA, non-interlaced only (what the agents' encoders write); anything else is null
 */
export function decodePng(buf: Buffer): Image | null {
  try {
    if (buf.length < 33 || !buf.subarray(0, 8).equals(PNG)) return null;
    let p = 8;
    let width = 0;
    let height = 0;
    let c: 3 | 4 | undefined;
    const idat: Buffer[] = [];
    while (p + 8 <= buf.length) {
      const len = buf.readUInt32BE(p);
      const type = buf.toString('latin1', p + 4, p + 8);
      const data = buf.subarray(p + 8, p + 8 + len);
      if (type === 'IHDR') {
        width = data.readUInt32BE(0);
        height = data.readUInt32BE(4);
        const [depth, color, , , interlace] = data.subarray(8, 13);
        if (depth !== 8 || interlace !== 0 || (color !== 2 && color !== 6)) return null;
        c = color === 6 ? 4 : 3;
      } else if (type === 'IDAT') idat.push(data);
      else if (type === 'IEND') break;
      p += 12 + len;
    }
    if (!c || width === 0 || height === 0 || width * height > 16e6) return null;
    const stride = width * c;
    const raw = inflateSync(Buffer.concat(idat), { maxOutputLength: height * (stride + 1) });
    if (raw.length < height * (stride + 1)) return null;
    const out = new Uint8Array(height * stride);
    const left = (dst: number, x: number) => (x >= c ? out[dst + x - c]! : 0);
    for (let y = 0; y < height; y++) {
      const f = raw[y * (stride + 1)];
      const src = y * (stride + 1) + 1;
      const dst = y * stride;
      const up = (x: number) => (y > 0 ? out[dst - stride + x]! : 0);
      // one loop per filter type: a branch per byte would double the decode time
      if (f === 0) out.set(raw.subarray(src, src + stride), dst);
      else if (f === 1)
        for (let x = 0; x < stride; x++) out[dst + x] = raw[src + x]! + left(dst, x);
      else if (f === 2) for (let x = 0; x < stride; x++) out[dst + x] = raw[src + x]! + up(x);
      else if (f === 3)
        for (let x = 0; x < stride; x++)
          out[dst + x] = raw[src + x]! + ((left(dst, x) + up(x)) >> 1);
      else if (f === 4)
        for (let x = 0; x < stride; x++) {
          const a = left(dst, x);
          const b = up(x);
          const d = x >= c && y > 0 ? out[dst - stride + x - c]! : 0;
          const q = a + b - d;
          const [pa, pb, pc] = [Math.abs(q - a), Math.abs(q - b), Math.abs(q - d)];
          out[dst + x] = raw[src + x]! + (pa <= pb && pa <= pc ? a : pb <= pc ? b : d);
        }
      else return null;
    }
    return { width, height, channels: c, data: out };
  } catch {
    return null;
  }
}

const CRC = Int32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (b: Buffer) => {
  let c = -1;
  for (const v of b) c = CRC[(c ^ v) & 0xff]! ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

function chunk(type: string, data: Buffer) {
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const out = Buffer.alloc(typed.length + 8);
  out.writeUInt32BE(data.length, 0);
  typed.copy(out, 4);
  out.writeUInt32BE(crc32(typed), typed.length + 4);
  return out;
}

/** Pixels as a PNG: a filter byte of 0 per row, Node's zlib. */
export function encodePng(img: Image): Buffer {
  const stride = img.width * img.channels;
  const raw = Buffer.alloc((stride + 1) * img.height);
  for (let y = 0; y < img.height; y++)
    raw.set(img.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8;
  ihdr[9] = img.channels === 4 ? 6 : 2;
  return Buffer.concat([
    PNG,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export type PixelRect = { x: number; y: number; w: number; h: number };

/** The rect cut to the image, as bounds. */
const clip = (img: Image, r: PixelRect) => ({
  x0: Math.max(0, Math.floor(r.x)),
  y0: Math.max(0, Math.floor(r.y)),
  x1: Math.min(img.width, Math.ceil(r.x + r.w)),
  y1: Math.min(img.height, Math.ceil(r.y + r.h)),
});

/** Paints rects over the image, in place. */
export function paintRects(img: Image, rects: PixelRect[], rgb: [number, number, number] = [0, 0, 0]) {
  for (const r of rects) {
    const { x0, y0, x1, y1 } = clip(img, r);
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const at = (y * img.width + x) * img.channels;
        img.data.set(rgb, at);
        if (img.channels === 4) img.data[at + 3] = 255;
      }
  }
}

export type ImageDiff = {
  /** Pixels compared: masks left out. */
  compared: number;
  differing: number;
  percent: number;
  /** The second image grey, its differing pixels red, masks blue. */
  image: Image;
};

/** How far a channel may differ before a pixel counts as differing: below an encoder's or a blur's noise. */
const CHANNEL_TOLERANCE = 16;

/** Two images of one size compared pixel by pixel, what `masks` covers left out. */
export function diffImages(a: Image, b: Image, masks: PixelRect[] = []): ImageDiff {
  if (a.width !== b.width || a.height !== b.height)
    throw new Error(`the images differ in size: ${a.width}x${a.height}, ${b.width}x${b.height}`);
  const out = new Uint8Array(b.width * b.height * 3);
  const masked = new Uint8Array(b.width * b.height);
  for (const r of masks) {
    const { x0, y0, x1, y1 } = clip(b, r);
    for (let y = y0; y < y1; y++) masked.fill(1, y * b.width + x0, y * b.width + Math.max(x0, x1));
  }
  let differing = 0;
  let compared = 0;
  for (let i = 0; i < masked.length; i++) {
    const [pa, pb] = [i * a.channels, i * b.channels];
    const at = i * 3;
    if (masked[i]) {
      out.set([70, 90, 200], at);
      continue;
    }
    compared++;
    const near =
      Math.abs(a.data[pa]! - b.data[pb]!) <= CHANNEL_TOLERANCE &&
      Math.abs(a.data[pa + 1]! - b.data[pb + 1]!) <= CHANNEL_TOLERANCE &&
      Math.abs(a.data[pa + 2]! - b.data[pb + 2]!) <= CHANNEL_TOLERANCE;
    if (!near) {
      differing++;
      out.set([230, 30, 30], at);
    } else {
      const grey = (b.data[pb]! * 77 + b.data[pb + 1]! * 151 + b.data[pb + 2]! * 28) >> 8;
      out.fill(255 - ((255 - grey) >> 2), at, at + 3);
    }
  }
  return {
    compared,
    differing,
    percent: compared > 0 ? (differing / compared) * 100 : 0,
    image: { width: b.width, height: b.height, channels: 3, data: out },
  };
}
