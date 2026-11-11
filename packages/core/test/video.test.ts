import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { must } from '../src/must.js';
import { box, joinVideos, readVideo } from '../src/video.js';
import { fakeVideo as video } from '@appdyno/testing/fake-video.js';

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
    const { each } = must(
      runs.findLast((r) => r.first <= c + 1),
      `the run of chunk ${c + 1}`,
    );
    for (let i = 0, at = o; i < each; i++) {
      const size = must(sizes[s++], 'a size');
      out.push(b.toString('latin1', at, at + size));
      at += size;
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

  it('takes a segment of one frame, whose size stands alone with no table', async () => {
    const a = write('one-a.mp4', video([Buffer.from('a1'), Buffer.from('a22')]));
    const b = write('one-b.mp4', video([Buffer.from('b333')], { oneSize: true }));
    const out = join(dir, 'one-joined.mp4');
    await joinVideos([a, b], out);
    expect((await readVideo(out)).frames).toBe(3);
    expect(framesOf(out)).toEqual(['a1', 'a22', 'b333']);
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
