/**
 * The wire between the host and an on-device agent: a stream of frames, each
 * `[u32 BE payload length][u8 type][payload]`. Type 0 is one JSON-RPC 2.0 message (UTF-8); type 1 is a
 * binary attachment `[u32 BE request id][bytes]` that belongs to the response with that id and is sent
 * before it.
 */

export const FRAME_JSON = 0;
export const FRAME_BINARY = 1;
/** A stream's frame, `[u64 BE capture us][u64 BE sent ns][u32 BE flags][bytes]`: it goes to the viewer, never through here. */
export const FRAME_VIDEO = 2;
export const VIDEO_HEADER_BYTES = 20;
/** A screenshot of a 4K screen as PNG stays well below this; anything larger is a broken stream. */
export const MAX_FRAME_BYTES = 64 * 1024 * 1024;
const HEADER = 5;

export type Frame =
  | { type: typeof FRAME_JSON; message: unknown }
  | { type: typeof FRAME_BINARY; id: number; data: Buffer };

export class FrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FrameError';
  }
}

function header(length: number, type: number): Buffer {
  if (length > MAX_FRAME_BYTES) throw new FrameError(`frame of ${length} bytes is over the limit`);
  const h = Buffer.allocUnsafe(HEADER);
  h.writeUInt32BE(length, 0);
  h.writeUInt8(type, 4);
  return h;
}

export function encodeJson(message: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(message), 'utf8');
  return Buffer.concat([header(payload.length, FRAME_JSON), payload]);
}

export function encodeBinary(id: number, data: Buffer): Buffer {
  const idBuf = Buffer.allocUnsafe(4);
  idBuf.writeUInt32BE(id >>> 0, 0);
  return Buffer.concat([header(data.length + 4, FRAME_BINARY), idBuf, data]);
}

/** Collects stream chunks and returns the frames they complete; throws FrameError on a broken stream. */
export class FrameDecoder {
  private chunks: Buffer[] = [];
  private size = 0;

  push(chunk: Buffer): Frame[] {
    this.chunks.push(chunk);
    this.size += chunk.length;
    const out: Frame[] = [];
    for (;;) {
      if (this.size < HEADER) return out;
      const head = this.peek(HEADER);
      const length = head.readUInt32BE(0);
      const type = head.readUInt8(4);
      if (length > MAX_FRAME_BYTES)
        throw new FrameError(`frame of ${length} bytes is over the limit`);
      if (type !== FRAME_JSON && type !== FRAME_BINARY)
        throw new FrameError(`unknown frame type ${type}`);
      if (this.size < HEADER + length) return out;
      const all = this.take(HEADER + length);
      const payload = all.subarray(HEADER);
      if (type === FRAME_JSON) {
        let message: unknown;
        try {
          message = JSON.parse(payload.toString('utf8'));
        } catch {
          throw new FrameError('a JSON frame is not valid JSON');
        }
        out.push({ type, message });
      } else {
        if (payload.length < 4) throw new FrameError('a binary frame has no request id');
        out.push({ type, id: payload.readUInt32BE(0), data: Buffer.from(payload.subarray(4)) });
      }
    }
  }

  private peek(n: number): Buffer {
    if (this.chunks[0]!.length < n) this.chunks = [Buffer.concat(this.chunks)];
    return this.chunks[0]!.subarray(0, n);
  }

  private take(n: number): Buffer {
    const all = this.chunks.length === 1 ? this.chunks[0]! : Buffer.concat(this.chunks);
    this.chunks = all.length > n ? [all.subarray(n)] : [];
    this.size -= n;
    return all.subarray(0, n);
  }
}
