import { createReadStream, createWriteStream } from 'node:fs';
import { open, rename, rm, type FileHandle } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { DeviceError } from '@appdyno/protocol';

/**
 * MP4 and QuickTime files as boxes, with no dependency: enough to tell a playable video from a torn one
 * (a recorder killed before it ended leaves no `moov`) and to join segments of one recording.
 */

export type VideoInfo = {
  bytes: number;
  durationMs: number;
  frames: number;
  width: number;
  height: number;
  codec: string;
};

type Box = { type: string; start: number; end: number; body: number };

/** A file's top-level boxes, by their headers. */
async function fileBoxes(f: FileHandle, end: number): Promise<Box[]> {
  const boxes: Box[] = [];
  const head = Buffer.alloc(16);
  for (let p = 0; p + 8 <= end;) {
    await f.read(head, 0, 16, p);
    let size = head.readUInt32BE(0);
    let body = p + 8;
    if (size === 1) {
      size = Number(head.readBigUInt64BE(8));
      body = p + 16;
    } else if (size === 0) size = end - p;
    const type = head.toString('latin1', 4, 8);
    if (size < body - p || p + size > end)
      throw new Error(`the ${type} box runs past the end of the file`);
    boxes.push({ type, start: p, end: p + size, body });
    p += size;
  }
  return boxes;
}

function boxesIn(b: Buffer, parent: { body: number; end: number }): Box[] {
  const boxes: Box[] = [];
  for (let p = parent.body; p + 8 <= parent.end;) {
    const size = b.readUInt32BE(p);
    if (size < 8 || p + size > parent.end) throw new Error('a box inside moov is cut');
    boxes.push({ type: b.toString('latin1', p + 4, p + 8), start: p, end: p + size, body: p + 8 });
    p += size;
  }
  return boxes;
}

const child = (b: Buffer, parent: Box, type: string) =>
  boxesIn(b, parent).find((x) => x.type === type);

const need = (b: Buffer, parent: Box, ...path: string[]): Box =>
  path.reduce((at, type) => {
    const c = child(b, at, type);
    if (!c) throw new Error(`no ${type} box`);
    return c;
  }, parent);

const videoTrack = (m: Buffer, root: Box) => {
  const trak = boxesIn(m, root).find((x) => {
    if (x.type !== 'trak') return false;
    const hdlr = need(m, x, 'mdia', 'hdlr');
    return m.toString('latin1', hdlr.body + 8, hdlr.body + 12) === 'vide';
  });
  if (!trak) throw new Error('no video track');
  return trak;
};

/** Timescale and duration of a `mvhd` or `mdhd`. */
const timing = (m: Buffer, at: Box) => {
  const v1 = m[at.body] === 1;
  return {
    timescale: m.readUInt32BE(at.body + (v1 ? 20 : 12)),
    duration: v1 ? Number(m.readBigUInt64BE(at.body + 24)) : m.readUInt32BE(at.body + 16),
  };
};

async function moovOf(f: FileHandle) {
  const { size } = await f.stat();
  if (size === 0) throw new Error('the file is empty');
  const top = await fileBoxes(f, size);
  const at = top.find((x) => x.type === 'moov');
  if (!at) throw new Error('no moov box: the recording did not end properly');
  const moov = Buffer.alloc(at.end - at.start);
  await f.read(moov, 0, moov.length, at.start);
  const root: Box = { type: 'moov', start: 0, end: moov.length, body: 8 };
  return { size, top, moov, root };
}

/** What a video file holds, or a DeviceError saying why it is no playable video. */
export async function readVideo(file: string): Promise<VideoInfo> {
  let f: FileHandle | undefined;
  try {
    f = await open(file, 'r');
    const { size, moov, root } = await moovOf(f);
    const trak = videoTrack(moov, root);
    const { timescale, duration } = timing(moov, need(moov, trak, 'mdia', 'mdhd'));
    const stbl = need(moov, trak, 'mdia', 'minf', 'stbl');
    const frames = moov.readUInt32BE(need(moov, stbl, 'stsz').body + 8);
    if (frames === 0 || timescale === 0) throw new Error('its video track has no frames');
    const stsd = need(moov, stbl, 'stsd');
    const tkhd = need(moov, trak, 'tkhd');
    return {
      bytes: size,
      durationMs: Math.round((duration / timescale) * 1000),
      frames,
      // 16.16 fixed point, the last two words of the box
      width: moov.readUInt32BE(tkhd.end - 8) >>> 16,
      height: moov.readUInt32BE(tkhd.end - 4) >>> 16,
      codec: moov.toString('latin1', stsd.body + 12, stsd.body + 16),
    };
  } catch (e) {
    throw new DeviceError(
      'INTERNAL',
      `${file} is not a playable video: ${(e as Error).message}`,
      'the recording failed',
    );
  } finally {
    await f?.close();
  }
}

export const box = (type: string, ...parts: Buffer[]) => {
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length + 8);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
};

export const u32s = (values: number[]) => {
  const b = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => b.writeUInt32BE(v, i * 4));
  return b;
};

/** The words of a table box: version and flags, a count, then `width` words each. */
const words = (m: Buffer, at: Box, width: number) =>
  Array.from({ length: m.readUInt32BE(at.body + 4) * width }, (_, i) =>
    m.readUInt32BE(at.body + 8 + i * 4),
  );

/** `flags`: version and flags, kept where the version means something (a `ctts` with negative offsets). */
const tableBox = (type: string, flags: Buffer, width: number, values: number[]) =>
  box(type, flags, u32s([values.length / width]), u32s(values));

const NO_FLAGS = Buffer.alloc(4);

type Segment = {
  file: string;
  moov: Buffer;
  root: Box;
  trak: Box;
  stbl: Box;
  mdat: Box;
  ftyp: Buffer;
};

async function segmentOf(file: string): Promise<Segment> {
  const f = await open(file, 'r');
  try {
    const { top, moov, root } = await moovOf(f);
    const mdats = top.filter((x) => x.type === 'mdat');
    const ftypAt = top.find((x) => x.type === 'ftyp');
    if (mdats.length !== 1 || !ftypAt)
      throw new Error(`${file} has ${mdats.length} mdat boxes${ftypAt ? '' : ' and no ftyp'}`);
    const ftyp = Buffer.alloc(ftypAt.end - ftypAt.start);
    await f.read(ftyp, 0, ftyp.length, ftypAt.start);
    const trak = videoTrack(moov, root);
    const stbl = need(moov, trak, 'mdia', 'minf', 'stbl');
    return { file, moov, root, trak, stbl, mdat: mdats[0]!, ftyp };
  } finally {
    await f.close();
  }
}

/** A `mvhd`, `tkhd` or `mdhd` with another duration. */
function withDuration(m: Buffer, at: Box, duration: number) {
  const out = Buffer.from(m.subarray(at.start, at.end));
  const v1 = out[8] === 1;
  const offset = 8 + (at.type === 'tkhd' ? (v1 ? 28 : 20) : v1 ? 24 : 16);
  if (v1) out.writeBigUInt64BE(BigInt(duration), offset);
  else out.writeUInt32BE(duration, offset);
  return out;
}

/**
 * Segments of one recording as one video track in `out`: the frames copied as they are, the tables in
 * `moov` end to end. What else they hold (Android's metadata tracks) is left out. Throws when they cannot
 * go together (other encoder settings); the caller keeps the segments.
 */
export async function joinVideos(files: string[], out: string): Promise<void> {
  const parts = await Promise.all(files.map(segmentOf));
  const first = parts[0]!;
  const m = first.moov;
  const movieScale = (s: Segment) => timing(s.moov, need(s.moov, s.root, 'mvhd'));
  const mediaScale = (s: Segment) => timing(s.moov, need(s.moov, s.trak, 'mdia', 'mdhd'));
  const stsdOf = (s: Segment) => {
    const at = need(s.moov, s.stbl, 'stsd');
    return s.moov.subarray(at.start, at.end);
  };
  const same = (f: (s: Segment) => string) => new Set(parts.map(f)).size === 1;
  if (!same((s) => `${movieScale(s).timescale}/${mediaScale(s).timescale}`))
    throw new Error('the segments have different timescales');
  if (!same((s) => stsdOf(s).toString('latin1')))
    throw new Error('the segments have different encoder settings');
  const has = (s: Segment, type: string) => !!child(s.moov, s.stbl, type);
  for (const type of ['ctts', 'stss'])
    if (!same((s) => String(has(s, type)))) throw new Error(`only some segments have ${type}`);

  const stts: number[] = [];
  const ctts: number[] = [];
  const stss: number[] = [];
  const stsc: number[] = [];
  const sizes: number[] = [];
  const offsets: number[] = [];
  // the 64-bit mdat header whatever the size: the offsets do not depend on it then
  const mdatBody = first.ftyp.length + 16;
  let copied = 0;
  let frames = 0;
  let chunks = 0;
  for (const s of parts) {
    const x = s.moov;
    stts.push(...words(x, need(x, s.stbl, 'stts'), 2));
    if (has(s, 'ctts')) ctts.push(...words(x, need(x, s.stbl, 'ctts'), 2));
    if (has(s, 'stss')) stss.push(...words(x, need(x, s.stbl, 'stss'), 1).map((v) => v + frames));
    stsc.push(
      ...words(x, need(x, s.stbl, 'stsc'), 3).map((v, i) => (i % 3 === 0 ? v + chunks : v)),
    );
    const stsz = need(x, s.stbl, 'stsz');
    // a segment of one frame, as a near-still screen gives, holds its size here and no table
    const oneSize = x.readUInt32BE(stsz.body + 4);
    const n = x.readUInt32BE(stsz.body + 8);
    for (let i = 0; i < n; i++) sizes.push(oneSize || x.readUInt32BE(stsz.body + 12 + i * 4));
    const stco = child(x, s.stbl, 'stco');
    const co64 = child(x, s.stbl, 'co64');
    const at = stco ?? co64;
    if (!at) throw new Error(`${s.file} has no chunk offsets`);
    const count = x.readUInt32BE(at.body + 4);
    for (let i = 0; i < count; i++) {
      const o = stco
        ? x.readUInt32BE(at.body + 8 + i * 4)
        : Number(x.readBigUInt64BE(at.body + 8 + i * 8));
      offsets.push(o - s.mdat.body + mdatBody + copied);
    }
    copied += s.mdat.end - s.mdat.body;
    frames += n;
    chunks += count;
  }

  const movieDuration = parts.reduce((a, s) => a + movieScale(s).duration, 0);
  const mediaDuration = parts.reduce((a, s) => a + mediaScale(s).duration, 0);
  if (movieDuration >= 2 ** 32 || mediaDuration >= 2 ** 32)
    throw new Error('the joined video would be too long');

  const offsetWords = Buffer.alloc(offsets.length * 8);
  offsets.forEach((o, i) => offsetWords.writeBigUInt64BE(BigInt(o), i * 8));
  const cttsAt = child(m, first.stbl, 'ctts');
  const stbl = box(
    'stbl',
    stsdOf(first),
    tableBox('stts', NO_FLAGS, 2, stts),
    ...(cttsAt ? [tableBox('ctts', m.subarray(cttsAt.body, cttsAt.body + 4), 2, ctts)] : []),
    ...(has(first, 'stss') ? [tableBox('stss', NO_FLAGS, 1, stss)] : []),
    tableBox('stsc', NO_FLAGS, 3, stsc),
    box('stsz', NO_FLAGS, u32s([0, sizes.length]), u32s(sizes)),
    box('co64', NO_FLAGS, u32s([offsets.length]), offsetWords),
  );

  const raw = (at: Box) => m.subarray(at.start, at.end);
  const mdia = need(m, first.trak, 'mdia');
  const minf = need(m, mdia, 'minf');
  const minfOut = box('minf', ...boxesIn(m, minf).map((x) => (x.type === 'stbl' ? stbl : raw(x))));
  const mdiaOut = box(
    'mdia',
    ...boxesIn(m, mdia).map((x) =>
      x.type === 'minf' ? minfOut : x.type === 'mdhd' ? withDuration(m, x, mediaDuration) : raw(x),
    ),
  );
  // an edit list fits one segment's timeline, not the sum of them
  const trakOut = box(
    'trak',
    ...boxesIn(m, first.trak)
      .filter((x) => x.type !== 'edts')
      .map((x) =>
        x.type === 'mdia'
          ? mdiaOut
          : x.type === 'tkhd'
            ? withDuration(m, x, movieDuration)
            : raw(x),
      ),
  );
  const moovOut = box('moov', withDuration(m, need(m, first.root, 'mvhd'), movieDuration), trakOut);

  const mdatHead = Buffer.alloc(16);
  mdatHead.writeUInt32BE(1);
  mdatHead.write('mdat', 4, 'latin1');
  mdatHead.writeBigUInt64BE(BigInt(copied + 16), 8);

  const tmp = `${out}.joining`;
  try {
    const w = createWriteStream(tmp);
    w.write(first.ftyp);
    w.write(mdatHead);
    for (const s of parts)
      if (s.mdat.end > s.mdat.body)
        await pipeline(createReadStream(s.file, { start: s.mdat.body, end: s.mdat.end - 1 }), w, {
          end: false,
        });
    await new Promise<void>((resolve, reject) => {
      w.on('error', reject);
      w.end(moovOut, () => resolve());
    });
    await readVideo(tmp);
    await rename(tmp, out);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}
