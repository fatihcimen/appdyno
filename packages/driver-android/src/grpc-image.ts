/**
 * The little of the emulator's screen stream that is used, by hand and with no dependency: the fields as
 * `emulator_controller.proto` numbers them. Input is the emulator's, and is read with every bound checked.
 */

const varint = (n: number) => {
  const out: number[] = [];
  let v = n;
  do {
    let b = v & 0x7f;
    v = Math.floor(v / 128);
    if (v > 0) b |= 0x80;
    out.push(b);
  } while (v > 0);
  return Buffer.from(out);
};

const field = (n: number, wire: 0 | 2) => varint(n * 8 + wire);
const numberField = (n: number, v: number) => Buffer.concat([field(n, 0), varint(v)]);
const bytesField = (n: number, b: Buffer) => Buffer.concat([field(n, 2), varint(b.length), b]);

const RGBA8888 = 1;
const MMAP = 1;

/**
 * The request: this format, written to this file. It must name the size, and the file must be exactly that
 * size: asked with no size or a larger file, the emulator answers every frame and writes nothing to it.
 */
export function imageRequest(file: string, w: number, h: number): Buffer {
  const handle = Buffer.from(`file://${file}`);
  const transport = Buffer.concat([numberField(1, MMAP), bytesField(2, handle)]);
  return Buffer.concat([
    numberField(1, RGBA8888),
    numberField(3, w),
    numberField(4, h),
    bytesField(6, transport),
  ]);
}

/** One gRPC message: a flag byte, four bytes of length, the message. */
export function grpcFrame(message: Buffer): Buffer {
  const head = Buffer.alloc(5);
  head.writeUInt32BE(message.length, 1);
  return Buffer.concat([head, message]);
}

type Field = { n: number; value: number | Buffer };

/** The fields of a message, or what could be read of it: a cut or strange message ends the list. */
function fieldsOf(buf: Buffer): Field[] {
  const out: Field[] = [];
  let at = 0;
  const read = () => {
    let v = 0;
    let scale = 1;
    for (;;) {
      if (at >= buf.length || scale > 2 ** 49) return undefined;
      const b = buf[at++]!;
      v += (b & 0x7f) * scale;
      if (b < 0x80) return v;
      scale *= 128;
    }
  };
  while (at < buf.length) {
    const tag = read();
    if (tag === undefined) return out;
    const wire = tag % 8;
    const n = Math.floor(tag / 8);
    if (wire === 0) {
      const v = read();
      if (v === undefined) return out;
      out.push({ n, value: v });
    } else if (wire === 2) {
      const length = read();
      if (length === undefined || at + length > buf.length) return out;
      out.push({ n, value: buf.subarray(at, at + length) });
      at += length;
    } else if (wire === 1 || wire === 5) {
      at += wire === 1 ? 8 : 4;
    } else {
      return out;
    }
  }
  return out;
}

export type ImageInfo = { w: number; h: number; seq: number; rotation: number };

const numberOf = (fields: Field[], n: number) => {
  const v = fields.find((f) => f.n === n)?.value;
  return typeof v === 'number' ? v : 0;
};

/** What an `Image` says of its frame; the pixels are in the file. */
export function imageInfo(message: Buffer): ImageInfo {
  const fields = fieldsOf(message);
  const format = fields.find((f) => f.n === 1)?.value;
  const inner = Buffer.isBuffer(format) ? fieldsOf(format) : [];
  const rotation = inner.find((f) => f.n === 2)?.value;
  return {
    w: numberOf(inner, 3),
    h: numberOf(inner, 4),
    seq: numberOf(fields, 5),
    rotation: Buffer.isBuffer(rotation) ? numberOf(fieldsOf(rotation), 1) : 0,
  };
}

/** Whole messages out of a stream of bytes; none larger than this is believed, with the pixels elsewhere. */
export class GrpcMessages {
  private buffer: Buffer = Buffer.alloc(0);

  constructor(private readonly maxBytes = 1 << 20) {}

  push(chunk: Buffer): Buffer[] {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    const out: Buffer[] = [];
    while (this.buffer.length >= 5) {
      const length = this.buffer.readUInt32BE(1);
      if (length > this.maxBytes) throw new Error(`a message of ${length} bytes on the stream`);
      if (this.buffer.length < 5 + length) break;
      out.push(this.buffer.subarray(5, 5 + length));
      this.buffer = this.buffer.subarray(5 + length);
    }
    return out;
  }
}
