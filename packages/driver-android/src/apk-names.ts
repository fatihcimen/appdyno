import { run } from '@appdyno/core';

/** What a phone may call an .apk: its package, and its label in each language the file has. */
export type ApkNames = { id: string; names: string[] };

type Chunk = { at: number; type: number; head: number; size: number };

const STRING_POOL = 0x0001;
const XML_START = 0x0102;
const XML_RESOURCE_MAP = 0x0180;
const TABLE_PACKAGE = 0x0200;
const TABLE_TYPE = 0x0201;
const LABEL_ATTRIBUTE = 0x01010001;
const VALUE_REFERENCE = 0x01;
const VALUE_STRING = 0x03;
const NO_ENTRY = 0xffffffff;
const NO_ENTRY_16 = 0xffff;
const POOL_UTF8 = 0x100;
const TYPE_SPARSE = 0x01;
const TYPE_OFFSET16 = 0x02;
const ENTRY_COMPLEX = 0x0001;
const ENTRY_COMPACT = 0x0008;

function* chunks(b: Buffer, from: number, end: number): Generator<Chunk> {
  for (let at = from; at + 8 <= end;) {
    const size = b.readUInt32LE(at + 4);
    if (size < 8) return;
    yield { at, type: b.readUInt16LE(at), head: b.readUInt16LE(at + 2), size };
    at += size;
  }
}

function poolOf(b: Buffer, c: Chunk): (i: number) => string {
  const utf8 = (b.readUInt32LE(c.at + 16) & POOL_UTF8) !== 0;
  const strings = c.at + b.readUInt32LE(c.at + 20);
  return (i) => {
    let p = strings + b.readUInt32LE(c.at + c.head + 4 * i);
    if (!utf8) {
      let n = b.readUInt16LE(p);
      p += 2;
      if (n & 0x8000) {
        n = ((n & 0x7fff) << 16) | b.readUInt16LE(p);
        p += 2;
      }
      return b.toString('utf16le', p, p + 2 * n);
    }
    p += b.readUInt8(p) & 0x80 ? 2 : 1; // its length in characters, of no use here
    let n = b.readUInt8(p);
    if (n & 0x80) n = ((n & 0x7f) << 8) | b.readUInt8(++p);
    return b.toString('utf8', p + 1, p + 1 + n);
  };
}

/** The offset of an entry in a type chunk, in each of the three ways the format keeps it. */
function entryOffset(b: Buffer, t: Chunk, flags: number, entry: number): number | undefined {
  const table = t.at + t.head;
  if (flags & TYPE_SPARSE) {
    const count = b.readUInt32LE(t.at + 12);
    for (let i = 0; i < count; i++)
      if (b.readUInt16LE(table + 4 * i) === entry) return b.readUInt16LE(table + 4 * i + 2) * 4;
    return undefined;
  }
  if (entry >= b.readUInt32LE(t.at + 12)) return undefined;
  if (flags & TYPE_OFFSET16) {
    const o = b.readUInt16LE(table + 2 * entry);
    return o === NO_ENTRY_16 ? undefined : o * 4;
  }
  const o = b.readUInt32LE(table + 4 * entry);
  return o === NO_ENTRY ? undefined : o;
}

/** Every language's value of a resource, following references. */
function valuesOf(b: Buffer, ref: number, seen = new Set<number>()): string[] {
  if (seen.has(ref)) return [];
  seen.add(ref);
  const [pkg, type, entry] = [ref >>> 24, (ref >>> 16) & 0xff, ref & 0xffff];
  const out: string[] = [];
  let pool: ((i: number) => string) | undefined;
  for (const c of chunks(b, 12, b.length)) {
    if (c.type === STRING_POOL) pool = poolOf(b, c);
    if (c.type !== TABLE_PACKAGE || b.readUInt32LE(c.at + 8) !== pkg) continue;
    for (const t of chunks(b, c.at + c.head, c.at + c.size)) {
      if (t.type !== TABLE_TYPE || b[t.at + 8] !== type) continue;
      const offset = entryOffset(b, t, b.readUInt8(t.at + 9), entry);
      if (offset === undefined) continue;
      const p = t.at + b.readUInt32LE(t.at + 16) + offset;
      const flags = b.readUInt16LE(p + 2);
      if (flags & ENTRY_COMPLEX && !(flags & ENTRY_COMPACT)) continue;
      const compact = (flags & ENTRY_COMPACT) !== 0;
      const size = b.readUInt16LE(p);
      const kind = compact ? flags >>> 8 : b.readUInt8(p + size + 3);
      const data = b.readUInt32LE(compact ? p + 4 : p + size + 4);
      if (kind === VALUE_STRING && pool) out.push(pool(data));
      if (kind === VALUE_REFERENCE) out.push(...valuesOf(b, data, seen));
    }
  }
  return out;
}

/** The package and the label attribute of a binary AndroidManifest.xml. */
function manifestOf(xml: Buffer) {
  let pool: ((i: number) => string) | undefined;
  let resources: Buffer | undefined;
  let id: string | undefined;
  let label: { kind: number; data: number; raw: number } | undefined;
  for (const c of chunks(xml, 8, xml.length)) {
    if (c.type === STRING_POOL) pool ??= poolOf(xml, c);
    if (c.type === XML_RESOURCE_MAP) resources = xml.subarray(c.at + c.head, c.at + c.size);
    if (c.type !== XML_START || !pool) continue;
    const tag = pool(xml.readUInt32LE(c.at + 20));
    if (tag !== 'manifest' && tag !== 'application') continue;
    const first = xml.readUInt16LE(c.at + 24);
    const size = xml.readUInt16LE(c.at + 26);
    const count = xml.readUInt16LE(c.at + 28);
    for (let i = 0; i < count; i++) {
      const a = c.at + 16 + first + i * size;
      const name = xml.readUInt32LE(a + 4);
      if (tag === 'manifest' && pool(name) === 'package') id = pool(xml.readUInt32LE(a + 8));
      const isLabel = resources && name * 4 < resources.length && resources.readUInt32LE(name * 4);
      if (tag === 'application' && isLabel === LABEL_ATTRIBUTE)
        label = {
          kind: xml.readUInt8(a + 15),
          data: xml.readUInt32LE(a + 16),
          raw: xml.readUInt32LE(a + 8),
        };
    }
    if (tag === 'application') break;
  }
  if (!id || !pool) throw new Error('no package in its manifest');
  return { id, label, pool };
}

const member = async (path: string, name: string) =>
  (
    await run('unzip', ['-p', path, name], {
      encoding: 'buffer',
      maxBuffer: 256 * 1024 * 1024,
    })
  ).stdout;

/** What this file's app is called on a phone, read from the file (no SDK tool is needed for it). */
export async function apkNames(path: string): Promise<ApkNames> {
  const { id, label, pool } = manifestOf(await member(path, 'AndroidManifest.xml'));
  const labels =
    label?.kind === VALUE_STRING
      ? [pool(label.raw)]
      : label?.kind === VALUE_REFERENCE
        ? valuesOf(await member(path, 'resources.arsc'), label.data)
        : [];
  return { id, names: [...new Set([...labels, id])] };
}
