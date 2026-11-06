/** XPC values as they travel to a phone's services, and the wrapper each message goes in. */

/** Numbers in a message are 64 bits on the wire; a plain `bigint` is the unsigned kind. */
export class XpcInt64 {
  constructor(readonly value: number) {}
}
export class XpcDouble {
  constructor(readonly value: number) {}
}
/** Written from its text form; a decoded one comes back as hex. */
export class XpcUuid {
  constructor(readonly value: string) {}
}

export type XpcValue =
  | null
  | boolean
  | number
  | bigint
  | string
  | Buffer
  | XpcInt64
  | XpcDouble
  | XpcUuid
  | XpcValue[]
  | { [key: string]: XpcValue };

const NULL = 0x1000;
const BOOL = 0x2000;
const INT64 = 0x3000;
const UINT64 = 0x4000;
const DOUBLE = 0x5000;
const DATE = 0x7000;
const DATA = 0x8000;
const STRING = 0x9000;
const UUID = 0xa000;
const ARRAY = 0xe000;
const DICT = 0xf000;

const OBJECT_MAGIC = 0x42133742;
const OBJECT_VERSION = 5;
const WRAPPER_MAGIC = 0x29b00b92;
export const WRAPPER_HEADER = 24;
/** Well past a screenshot, the longest message there is. */
const MOST_BODY = 1n << 28n;

const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};
const padding = (n: number) => Buffer.alloc((4 - (n % 4)) % 4);
const cString = (s: string) => {
  const b = Buffer.from(`${s}\0`);
  return [b, padding(b.length)];
};

function encodeValue(v: XpcValue, out: Buffer[]): void {
  if (v === null) out.push(u32(NULL));
  else if (typeof v === 'boolean') out.push(u32(BOOL), u32(v ? 1 : 0));
  else if (typeof v === 'bigint') {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(v);
    out.push(u32(UINT64), b);
  } else if (typeof v === 'number' || v instanceof XpcInt64) {
    const b = Buffer.alloc(8);
    b.writeBigInt64LE(BigInt(typeof v === 'number' ? v : v.value));
    out.push(u32(INT64), b);
  } else if (v instanceof XpcDouble) {
    const b = Buffer.alloc(8);
    b.writeDoubleLE(v.value);
    out.push(u32(DOUBLE), b);
  } else if (v instanceof XpcUuid) {
    out.push(u32(UUID), Buffer.from(v.value.replaceAll('-', ''), 'hex'));
  } else if (Buffer.isBuffer(v)) {
    out.push(u32(DATA), u32(v.length), v, padding(v.length));
  } else if (typeof v === 'string') {
    const b = Buffer.from(`${v}\0`);
    out.push(u32(STRING), u32(b.length), b, padding(b.length));
  } else if (Array.isArray(v)) {
    const inner: Buffer[] = [u32(v.length)];
    for (const x of v) encodeValue(x, inner);
    const body = Buffer.concat(inner);
    out.push(u32(ARRAY), u32(body.length), body);
  } else {
    const entries = Object.entries(v);
    const inner: Buffer[] = [u32(entries.length)];
    for (const [k, x] of entries) {
      inner.push(...cString(k));
      encodeValue(x, inner);
    }
    const body = Buffer.concat(inner);
    out.push(u32(DICT), u32(body.length), body);
  }
}

export type Decoded = null | boolean | number | string | Buffer | Decoded[] | DecodedDict;
export type DecodedDict = { [key: string]: Decoded };

/** A value of a type not listed here, or a length past the end, throws: the message is not one of these. */
function decodeValue(b: Buffer, at: { o: number }): Decoded {
  const type = b.readUInt32LE(at.o);
  at.o += 4;
  const fixed = (read: (o: number) => number | bigint) => {
    const v = read(at.o);
    at.o += 8;
    return Number(v);
  };
  switch (type) {
    case NULL:
      return null;
    case BOOL: {
      const v = b.readUInt32LE(at.o) === 1;
      at.o += 4;
      return v;
    }
    case INT64:
      return fixed((o) => b.readBigInt64LE(o));
    case UINT64:
    case DATE:
      return fixed((o) => b.readBigUInt64LE(o));
    case DOUBLE:
      return fixed((o) => b.readDoubleLE(o));
    case UUID: {
      const v = b.toString('hex', at.o, at.o + 16);
      at.o += 16;
      return v;
    }
    case DATA:
    case STRING: {
      const n = b.readUInt32LE(at.o);
      at.o += 4;
      if (at.o + n > b.length) throw new RangeError('an XPC value runs past its message');
      const v = b.subarray(at.o, at.o + n);
      at.o += n + padding(n).length;
      return type === DATA ? Buffer.from(v) : v.toString('utf8', 0, Math.max(0, n - 1));
    }
    case ARRAY: {
      at.o += 4;
      const n = b.readUInt32LE(at.o);
      at.o += 4;
      const list: Decoded[] = [];
      for (let i = 0; i < n; i++) list.push(decodeValue(b, at));
      return list;
    }
    case DICT: {
      at.o += 4;
      const n = b.readUInt32LE(at.o);
      at.o += 4;
      const dict: DecodedDict = {};
      for (let i = 0; i < n; i++) {
        const end = b.indexOf(0, at.o);
        if (end < 0) throw new RangeError('an XPC key has no end');
        const key = b.toString('utf8', at.o, end);
        at.o = end + 1 + padding(end + 1 - at.o).length;
        dict[key] = decodeValue(b, at);
      }
      return dict;
    }
    default:
      throw new RangeError(`an XPC value of type 0x${type.toString(16)}`);
  }
}

export function encodeObject(v: XpcValue): Buffer {
  const out = [u32(OBJECT_MAGIC), u32(OBJECT_VERSION)];
  encodeValue(v, out);
  return Buffer.concat(out);
}

/** What a wrapper's body holds; undefined for a body that is no object, such as an empty one. */
export function decodeObject(body: Buffer): Decoded | undefined {
  if (body.length <= 8 || body.readUInt32LE(0) !== OBJECT_MAGIC) return undefined;
  return decodeValue(body, { o: 8 });
}

export function encodeWrapper(flags: number, v?: XpcValue): Buffer {
  const body = v === undefined ? Buffer.alloc(0) : encodeObject(v);
  const h = Buffer.alloc(WRAPPER_HEADER);
  h.writeUInt32LE(WRAPPER_MAGIC, 0);
  h.writeUInt32LE(flags, 4);
  h.writeBigUInt64LE(BigInt(body.length), 8);
  h.writeBigUInt64LE(1n, 16);
  return Buffer.concat([h, body]);
}

/**
 * Length of a wrapper's body, from a buffer that holds its header. What is no wrapper, or longer than any message here,
 * throws: it would be waited for with all that comes after it, and that wait has no end.
 */
export function wrapperBodyLength(b: Buffer) {
  const n = b.readBigUInt64LE(8);
  if (b.readUInt32LE(0) !== WRAPPER_MAGIC || n > MOST_BODY)
    throw new RangeError('not the head of an XPC message');
  return Number(n);
}
