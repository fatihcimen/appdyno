export type Plist = string | number | boolean | Buffer | null | Plist[] | { [k: string]: Plist };

/** A plist's reference to another object, by the name its XML form gives it. */
const UID = 'CF$UID';
export const plistUid = (n: number): Plist => ({ [UID]: n });
export const uidOf = (v: Plist | undefined): number | undefined =>
  v && typeof v === 'object' && !Buffer.isBuffer(v) && !Array.isArray(v)
    ? (v[UID] as number | undefined)
    : undefined;

/** A device's string or number as text, and '' for what is neither, or missing. */
export const plistText = (v: unknown) =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';

/** Past any message here: an object may be named twice, so that a few bytes can unfold for as long as there is memory. */
export const MOST_VALUES = 1 << 20;

/** A binary property list: what the inspector's socket speaks (no dependency, no process per message). */
export function readBplist(b: Buffer): Plist {
  if (b.toString('latin1', 0, 8) !== 'bplist00') throw new Error('not a binary plist');
  const trailer = b.subarray(b.length - 32);
  const [offsetSize, refSize] = [trailer.readUInt8(6), trailer.readUInt8(7)];
  const count = Number(trailer.readBigUInt64BE(8));
  const top = Number(trailer.readBigUInt64BE(16));
  const table = Number(trailer.readBigUInt64BE(24));
  let left = MOST_VALUES;
  const read = (i: number): Plist => {
    if (--left < 0) throw new Error(`a plist of more than ${MOST_VALUES} values`);
    let p = b.readUIntBE(table + i * offsetSize, offsetSize);
    const marker = b.readUInt8(p++);
    const low = marker & 15;
    const size = () => {
      if (low !== 15) return low;
      const width = 1 << (b.readUInt8(p++) & 15);
      const n = b.readUIntBE(p, width);
      p += width;
      return n;
    };
    const refs = (n: number, from: number) => {
      // room is made before the first is read: a length from the wire, at every level of a list that holds itself
      if (p + (from + n) * refSize > b.length) throw new Error('a plist list past its end');
      return Array.from({ length: n }, (_, k) =>
        read(b.readUIntBE(p + (from + k) * refSize, refSize)),
      );
    };
    switch (marker >> 4) {
      case 0:
        return low === 8 ? false : low === 9 ? true : null;
      case 1:
        // the long form is 16 bytes, the value in the last 8
        return low <= 2
          ? b.readUIntBE(p, 1 << low)
          : Number(b.readBigInt64BE(low === 4 ? p + 8 : p));
      case 2:
        return low === 3 ? b.readDoubleBE(p) : b.readFloatBE(p);
      case 4: {
        const n = size();
        return b.subarray(p, p + n);
      }
      case 5: {
        const n = size();
        return b.toString('latin1', p, p + n);
      }
      case 6: {
        const n = size();
        return Buffer.from(b.subarray(p, p + n * 2))
          .swap16()
          .toString('utf16le');
      }
      case 8:
        return plistUid(b.readUIntBE(p, low + 1));
      case 10:
        return refs(size(), 0);
      case 13: {
        const n = size();
        const keys = refs(n, 0) as string[];
        const values = refs(n, n);
        return Object.fromEntries(keys.map((k, j) => [k, values[j] ?? null]));
      }
      default:
        throw new Error(`a plist object of kind ${marker >> 4}`);
    }
  };
  if (count <= top) throw new Error('a plist with no such object');
  return read(top);
}

export function writeBplist(root: Plist): Buffer {
  type Written = { own: Buffer; refs?: number[] };
  const objects: Written[] = [];
  const sized = (kind: number, n: number) => {
    if (n < 15) return Buffer.from([(kind << 4) | n]);
    const length = Buffer.alloc(6);
    length[0] = (kind << 4) | 15;
    length[1] = 0x12;
    length.writeUInt32BE(n, 2);
    return length;
  };
  const add = (v: Plist): number => {
    const i = objects.length;
    const uid = uidOf(v);
    if (typeof v === 'string') {
      const ascii = Buffer.byteLength(v) === v.length;
      const body = ascii ? Buffer.from(v, 'latin1') : Buffer.from(v, 'utf16le').swap16();
      objects.push({
        own: Buffer.concat([sized(ascii ? 5 : 6, ascii ? v.length : body.length / 2), body]),
      });
    } else if (typeof v === 'number') {
      const n = Buffer.alloc(9);
      n[0] = Number.isInteger(v) ? 0x13 : 0x23;
      if (Number.isInteger(v)) n.writeBigInt64BE(BigInt(v), 1);
      else n.writeDoubleBE(v, 1);
      objects.push({ own: n });
    } else if (typeof v === 'boolean') objects.push({ own: Buffer.from([v ? 9 : 8]) });
    else if (v === null) objects.push({ own: Buffer.from([0]) });
    else if (Buffer.isBuffer(v)) objects.push({ own: Buffer.concat([sized(4, v.length), v]) });
    else if (Array.isArray(v)) {
      const list: Written = { own: sized(10, v.length) };
      objects.push(list);
      list.refs = v.map(add);
    } else if (uid !== undefined) {
      const n = Buffer.alloc(5);
      n[0] = 0x83;
      n.writeUInt32BE(uid, 1);
      objects.push({ own: n });
    } else {
      const entries = Object.entries(v);
      const dict: Written = { own: sized(13, entries.length) };
      objects.push(dict);
      dict.refs = [...entries.map(([k]) => add(k)), ...entries.map(([, x]) => add(x))];
    }
    return i;
  };
  add(root);
  const REF = 4;
  const parts: Buffer[] = [Buffer.from('bplist00', 'latin1')];
  let at = 8;
  const offsets = objects.map(({ own, refs = [] }) => {
    const refBytes = Buffer.alloc(refs.length * REF);
    refs.forEach((r, k) => refBytes.writeUInt32BE(r, k * REF));
    parts.push(own, refBytes);
    const start = at;
    at += own.length + refBytes.length;
    return start;
  });
  const table = Buffer.alloc(offsets.length * REF);
  offsets.forEach((o, k) => table.writeUInt32BE(o, k * REF));
  const trailer = Buffer.alloc(32);
  trailer[6] = REF;
  trailer[7] = REF;
  trailer.writeBigUInt64BE(BigInt(objects.length), 8);
  trailer.writeBigUInt64BE(0n, 16);
  trailer.writeBigUInt64BE(BigInt(at), 24);
  return Buffer.concat([...parts, table, trailer]);
}
