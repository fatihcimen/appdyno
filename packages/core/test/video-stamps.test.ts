import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert, describe, expect, it } from 'vitest';
import { must } from '../src/must.js';
import { box, parseStamps, u32s, videoStamps } from '../src/video.js';

const dir = mkdtempSync(join(tmpdir(), 'appdyno-stamps-'));

// the two tracks of one `screenrecord --time-limit 3` on an Android 14 emulator, byte for byte
const LEGACY = Buffer.from(
  '2356563 14e5343305045543 14d452123 02000000 dfca5b0f00000000 f72d760f00000000'.replace(/ /g, ''),
  'hex',
);
const CURRENT = Buffer.from(
  '23565631 4e534330 50455431 4d453223 02000000 144a719ea000e518 02000000 ef7690fe3b000000 af8ca3653c000000'.replace(
    / /g,
    '',
  ),
  'hex',
);
/** That recording's frames: 1793840716430002708 + 257673950959 and + 259403254959 ns, cut to a µs. */
const FIRST_MS = 1793840974103.953;
const SECOND_MS = 1793840975833.257;

const u32 = (...v: number[]) => u32s(v);
const hdlr = (kind: string) => box('hdlr', u32(0, 0), Buffer.from(kind), Buffer.alloc(12));
const trak = (kind: string, stbl: Buffer) =>
  box('trak', box('mdia', hdlr(kind), box('minf', stbl)));
/** A track of one sample at `at`, by the box a file of this size uses. */
const oneSample = (kind: string, at: number, size: number, wide = false) => {
  const co64 = Buffer.alloc(16);
  co64.writeUInt32BE(1, 4);
  co64.writeBigUInt64BE(BigInt(at), 8);
  return trak(
    kind,
    box(
      'stbl',
      box('stsz', u32(0, size, 1)),
      wide ? box('co64', co64) : box('stco', u32(0, 1, at)),
    ),
  );
};

/** A file as `screenrecord` lays it out: the samples in `mdat`, the tracks in `moov`. */
function recording(samples: Buffer[], wide = false) {
  const ftyp = box('ftyp', Buffer.from('isom'), u32(0), Buffer.from('isom'));
  const mdat = box('mdat', ...samples);
  let at = ftyp.length + 8;
  const tracks = samples.map((s) => {
    const t = oneSample('meta', at, s.length, wide);
    at += s.length;
    return t;
  });
  return Buffer.concat([ftyp, mdat, box('moov', box('mvhd', u32(0)), ...tracks)]);
}

const write = (name: string, b: Buffer) => {
  const f = join(dir, name);
  writeFileSync(f, b);
  return f;
};

describe('a recording that keeps its own clock', () => {
  it('reads a track as the device wrote it', () => {
    expect(parseStamps(CURRENT)).toEqual([FIRST_MS, SECOND_MS]);
  });

  it('adds without losing what a double would: an epoch in ns is past 2^53', () => {
    const [first, second] = must(parseStamps(CURRENT), 'its stamps');
    assert(first !== undefined && second !== undefined);
    // the video's own frame gap, read by a player
    expect(second - first).toBeCloseTo(1729.304, 2);
  });

  it('takes the track with a wall clock, past the older one before it', async () => {
    expect(await videoStamps(write('real.mp4', recording([LEGACY, CURRENT])))).toEqual([
      FIRST_MS,
      SECOND_MS,
    ]);
  });

  it('reads a track a large file reaches by 64 bits', async () => {
    expect(await videoStamps(write('wide.mp4', recording([CURRENT], true)))).toHaveLength(2);
  });

  it('has none in a file with only the older track, which has no wall clock', async () => {
    expect(parseStamps(LEGACY)).toBeUndefined();
    expect(await videoStamps(write('legacy.mp4', recording([LEGACY])))).toBeUndefined();
  });

  it('has none in a file with no such track: a simulator keeps none', async () => {
    expect(await videoStamps(write('plain.mov', recording([])))).toBeUndefined();
  });

  it('says nothing of a track that is cut short, rather than reading past it', () => {
    expect(parseStamps(CURRENT.subarray(0, 40))).toBeUndefined();
    const overcounted = Buffer.from(CURRENT);
    overcounted.writeUInt32LE(9, 28);
    expect(parseStamps(overcounted)).toBeUndefined();
  });

  it('never refuses a video for what it cannot read of this', async () => {
    expect(await videoStamps(write('nothing.mp4', Buffer.from('not a video')))).toBeUndefined();
    expect(await videoStamps(join(dir, 'gone.mp4'))).toBeUndefined();
  });
});
