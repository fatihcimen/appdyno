import { must } from '@appdyno/core';

/** Written here, apart from the reader under test: a box is its size, its type and its parts. */
function box(type: string, ...parts: Buffer[]) {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(Buffer.concat(parts).length + 8);
  return Buffer.concat([size, Buffer.from(type, 'latin1'), ...parts]);
}

const u32 = (...values: number[]) =>
  Buffer.concat(
    values.map((v) => Buffer.from([v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255])),
  );

/** A small file as a recorder writes it: ftyp, mdat, moov with a video track and a metadata track. */
export function fakeVideo(
  frames: Buffer[],
  opts: { stsd?: string; torn?: boolean; timescale?: number; oneSize?: boolean } = {},
) {
  const ftyp = box('ftyp', Buffer.from('isom'), u32(0), Buffer.from('isom'));
  const payload = Buffer.concat(frames);
  const mdat = box('mdat', payload);
  const first = ftyp.length + 8;
  if (opts.torn) return Buffer.concat([ftyp, mdat.subarray(0, mdat.length - 3)]);
  const scale = opts.timescale ?? 90_000;
  const n = frames.length;
  const hdlr = (kind: string) => box('hdlr', u32(0, 0), Buffer.from(kind), Buffer.alloc(12));
  const mdhd = box('mdhd', u32(0, 0, 0, scale, n * 3_000), Buffer.alloc(4));
  const tkhd = box(
    'tkhd',
    u32(0, 0, 0, 1, 0, n * 33),
    Buffer.alloc(52),
    u32(1080 << 16, 2400 << 16),
  );
  const stsd = box(
    'stsd',
    u32(0, 1),
    box('avc1', Buffer.alloc(6), Buffer.from(opts.stsd ?? 'same-settings')),
  );
  const stbl = box(
    'stbl',
    stsd,
    box('stts', u32(0, 1, n, 3_000)),
    box('stss', u32(0, 1, 1)),
    box('stsc', u32(0, 1, 1, n, 1)),
    opts.oneSize
      ? box('stsz', u32(0, must(frames[0], 'a frame').length, n))
      : box('stsz', u32(0, 0, n), u32(...frames.map((f) => f.length))),
    box('stco', u32(0, 1, first)),
  );
  const trak = box(
    'trak',
    tkhd,
    box('edts', box('elst', u32(0, 0))),
    box('mdia', mdhd, hdlr('vide'), box('minf', box('vmhd', u32(1, 0, 0)), stbl)),
  );
  const meta = box('trak', tkhd, box('mdia', mdhd, hdlr('meta'), box('minf', box('nmhd', u32(0)))));
  const mvhd = box('mvhd', u32(0, 0, 0, 1_000, n * 33), Buffer.alloc(80));
  return Buffer.concat([ftyp, mdat, box('moov', mvhd, trak, meta)]);
}
