import { describe, expect, it } from 'vitest';
import {
  FRAME_BINARY,
  FRAME_JSON,
  FrameDecoder,
  FrameError,
  MAX_FRAME_BYTES,
  encodeBinary,
  encodeJson,
} from '../src/frame.js';

describe('frames', () => {
  it('round-trips JSON and binary frames split at every byte', () => {
    const wire = Buffer.concat([
      encodeJson({ jsonrpc: '2.0', id: 1, method: 'ping', params: { t: 'İşğü' } }),
      encodeBinary(7, Buffer.from([0, 1, 2, 255])),
      encodeJson({ jsonrpc: '2.0', id: 7, result: {} }),
    ]);
    const d = new FrameDecoder();
    const frames = [];
    for (let i = 0; i < wire.length; i++) frames.push(...d.push(wire.subarray(i, i + 1)));
    expect(frames).toEqual([
      {
        type: FRAME_JSON,
        message: { jsonrpc: '2.0', id: 1, method: 'ping', params: { t: 'İşğü' } },
      },
      { type: FRAME_BINARY, id: 7, data: Buffer.from([0, 1, 2, 255]) },
      { type: FRAME_JSON, message: { jsonrpc: '2.0', id: 7, result: {} } },
    ]);
  });

  it('returns several frames from one chunk', () => {
    const d = new FrameDecoder();
    const frames = d.push(Buffer.concat([encodeJson(1), encodeJson(2), encodeJson(3)]));
    expect(frames.map((f) => (f.type === FRAME_JSON ? f.message : undefined))).toEqual([1, 2, 3]);
  });

  it('refuses an oversized length, an unknown type and broken JSON', () => {
    const big = Buffer.alloc(5);
    big.writeUInt32BE(MAX_FRAME_BYTES + 1, 0);
    expect(() => new FrameDecoder().push(big)).toThrow(FrameError);
    const unknown = Buffer.from([0, 0, 0, 0, 9]);
    expect(() => new FrameDecoder().push(unknown)).toThrow(/unknown frame type/);
    const bad = Buffer.concat([Buffer.from([0, 0, 0, 1, 0]), Buffer.from('{')]);
    expect(() => new FrameDecoder().push(bad)).toThrow(/not valid JSON/);
  });

  it('refuses a binary frame without its id', () => {
    const short = Buffer.from([0, 0, 0, 2, 1, 0, 0]);
    expect(() => new FrameDecoder().push(short)).toThrow(/no request id/);
  });

  it('survives random chunking of a long stream', () => {
    const msgs = Array.from({ length: 200 }, (_, i) => ({ id: i, s: 'x'.repeat(i * 37) }));
    const wire = Buffer.concat(msgs.map((m) => encodeJson(m)));
    const d = new FrameDecoder();
    const got: unknown[] = [];
    let seed = 42;
    for (let at = 0; at < wire.length;) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const n = 1 + (seed % 900);
      for (const f of d.push(wire.subarray(at, at + n)))
        if (f.type === FRAME_JSON) got.push(f.message);
      at += n;
    }
    expect(got).toEqual(msgs);
  });
});
