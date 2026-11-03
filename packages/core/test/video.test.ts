import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { joinVideos, readVideo } from '../src/video.js';

const box = (type: string, ...parts: Buffer[]) => {
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length + 8);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
};
const u32 = (...v: number[]) => {
  const b = Buffer.alloc(v.length * 4);
  v.forEach((x, i) => b.writeUInt32BE(x, i * 4));
  return b;
};

/** A small file as a recorder writes it: ftyp, mdat, moov with a video track and a metadata track. */
function video(frames: Buffer[], opts: { stsd?: string; torn?: boolean; timescale?: number } = {}) {
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
    box('stsz', u32(0, 0, n), u32(...frames.map((f) => f.length))),
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

const dir = mkdtempSync(join(tmpdir(), 'appdyno-video-'));
const write = (name: string, b: Buffer) => {
  const f = join(dir, name);
  writeFileSync(f, b);
  return f;
};

/** The frames of a video, read through its tables as a player would. */
function framesOf(file: string) {
  const b = readFileSync(file);
  const find = (type: string, from = 0, to = b.length): [number, number] => {
    for (let p = from; p + 8 <= to;) {
      const size = b.readUInt32BE(p) || to - p;
      if (b.toString('latin1', p + 4, p + 8) === type) return [p + 8, p + size];
      const inner = ['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(
        b.toString('latin1', p + 4, p + 8),
      )
        ? find(type, p + 8, p + size)
        : ([-1, -1] as [number, number]);
      if (inner[0] >= 0) return inner;
      p += size === 1 ? Number(b.readBigUInt64BE(p + 8)) : size;
    }
    return [-1, -1];
  };
  const [stsz] = find('stsz');
  const [co64] = find('co64');
  const [stsc, stscEnd] = find('stsc');
  const n = b.readUInt32BE(stsz + 8);
  const sizes = Array.from({ length: n }, (_, i) => b.readUInt32BE(stsz + 12 + i * 4));
  const chunkOffsets = Array.from({ length: b.readUInt32BE(co64 + 4) }, (_, i) =>
    Number(b.readBigUInt64BE(co64 + 8 + i * 8)),
  );
  const runs: { first: number; each: number }[] = [];
  for (let p = stsc + 8; p < stscEnd; p += 12)
    runs.push({ first: b.readUInt32BE(p), each: b.readUInt32BE(p + 4) });
  const out: string[] = [];
  let s = 0;
  chunkOffsets.forEach((o, c) => {
    const each = runs.findLast((r) => r.first <= c + 1)!.each;
    for (let i = 0, at = o; i < each; i++) {
      out.push(b.toString('latin1', at, at + sizes[s]!));
      at += sizes[s++]!;
    }
  });
  return out;
}

describe('readVideo', () => {
  it('reads what a video holds', async () => {
    const f = write('good.mp4', video([Buffer.from('aaa'), Buffer.from('bb')]));
    expect(await readVideo(f)).toMatchObject({
      frames: 2,
      durationMs: 67,
      width: 1080,
      height: 2400,
      codec: 'avc1',
    });
  });

  it('calls a torn, an empty and a missing file what they are', async () => {
    await expect(
      readVideo(write('torn.mp4', video([Buffer.from('frame')], { torn: true }))),
    ).rejects.toThrow(/not a playable video: the mdat box runs past/);
    await expect(readVideo(write('empty.mp4', Buffer.alloc(0)))).rejects.toThrow(
      /the file is empty/,
    );
    await expect(readVideo(join(dir, 'none.mp4'))).rejects.toThrow(/not a playable video/);
    const noMoov = Buffer.concat([box('ftyp', Buffer.from('isom')), box('mdat', Buffer.from('x'))]);
    await expect(readVideo(write('nomoov.mp4', noMoov))).rejects.toThrow(/did not end properly/);
  });
});

describe('joinVideos', () => {
  it('puts the frames and tables of its segments end to end, on one track', async () => {
    const a = write('a.mp4', video([Buffer.from('a1'), Buffer.from('a22')]));
    const b = write('b.mp4', video([Buffer.from('b1'), Buffer.from('b22'), Buffer.from('b333')]));
    const out = join(dir, 'joined.mp4');
    await joinVideos([a, b], out);
    const v = await readVideo(out);
    expect(v.frames).toBe(5);
    expect(v.durationMs).toBe(167);
    expect(framesOf(out)).toEqual(['a1', 'a22', 'b1', 'b22', 'b333']);
    const bytes = readFileSync(out).toString('latin1');
    // the sync frame of the second segment counts from the first's end; the edit list and metadata go
    expect(bytes.match(/trak/g)).toHaveLength(1);
    expect(bytes).not.toContain('edts');
    const at = bytes.indexOf('stss') + 4;
    expect([
      readFileSync(out).readUInt32BE(at + 4),
      readFileSync(out).readUInt32BE(at + 8),
    ]).toEqual([2, 1]);
    expect(readFileSync(out).readUInt32BE(at + 12)).toBe(3);
  });

  it('refuses segments that do not go together, leaving no file', async () => {
    const a = write('c.mp4', video([Buffer.from('a')]));
    const b = write('d.mp4', video([Buffer.from('b')], { stsd: 'other-settings' }));
    const c = write('e.mp4', video([Buffer.from('c')], { timescale: 600 }));
    const out = join(dir, 'never.mp4');
    await expect(joinVideos([a, b], out)).rejects.toThrow(/different encoder settings/);
    await expect(joinVideos([a, c], out)).rejects.toThrow(/different timescales/);
    await expect(readVideo(out)).rejects.toThrow(/not a playable video/);
  });
});
