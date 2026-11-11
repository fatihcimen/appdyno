import { decodePng, must } from '@appdyno/core';

const COLUMNS = 54;
const ROWS = 120;
/** How many cells a picture is looked for away from where it should be: a tenth of the width. */
const REACH = 6;
/** How much better elsewhere has to fit, in levels of 255: a flat screen fits everywhere. */
const BETTER = 2;
/** Scaling, a stream's compression, a frame's cutout and its corners, at this size. */
export const SAME_PICTURE = 12;

/** A picture as a small grid of brightness: its size and compression fall away, and what stands where stays. */
function cellsOf(png: Buffer) {
  const image = decodePng(png);
  if (!image) throw new Error('not a picture this can read');
  const { width, height, channels, data } = image;
  const sums = new Float64Array(COLUMNS * ROWS);
  const counts = new Float64Array(COLUMNS * ROWS);
  for (let y = 0; y < height; y += 2) {
    const row = Math.floor((y * ROWS) / height);
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * channels;
      const cell = row * COLUMNS + Math.floor((x * COLUMNS) / width);
      const at = (k: number) => must(data[k], 'a byte');
      sums[cell] = must(sums[cell], 'a cell') + (at(i) + at(i + 1) + at(i + 2)) / 3;
      counts[cell] = must(counts[cell], 'a cell') + 1;
    }
  }
  return sums.map((sum, i) => sum / must(counts[i], 'a cell'));
}

const apartAt = (a: Float64Array, b: Float64Array, dx: number, dy: number) => {
  let sum = 0;
  let seen = 0;
  for (let y = Math.max(0, -dy); y < Math.min(ROWS, ROWS - dy); y++)
    for (let x = Math.max(0, -dx); x < Math.min(COLUMNS, COLUMNS - dx); x++, seen++)
      sum += Math.abs(
        must(a[(y + dy) * COLUMNS + x + dx], 'a cell') - must(b[y * COLUMNS + x], 'a cell'),
      );
  return sum / seen;
};

/**
 * How far what a window shows is from the device's own screenshot: `difference` in levels of 255 where it stands, and
 * `shift`, as shares of the picture, to where it would fit better. A faithful window has a small one and none.
 */
export function pictureApart(shown: Buffer, device: Buffer) {
  const [a, b] = [cellsOf(shown), cellsOf(device)];
  const difference = apartAt(a, b, 0, 0);
  let best = { dx: 0, dy: 0, apart: difference - BETTER };
  for (let dy = -REACH; dy <= REACH; dy++)
    for (let dx = -REACH; dx <= REACH; dx++) {
      const apart = apartAt(a, b, dx, dy);
      if (apart < best.apart) best = { dx, dy, apart };
    }
  return { difference, shift: { x: best.dx / COLUMNS, y: best.dy / ROWS } };
}
