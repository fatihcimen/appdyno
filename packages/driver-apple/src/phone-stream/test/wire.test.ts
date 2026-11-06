import { inflateSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { readBplist } from '../../webinspector.js';
import type { TcpConnection } from '../ipstack.js';
import { touchReport, PhoneHid } from '../phone-hid.js';
import { RemoteXpc } from '../remotexpc.js';
import { errorWords, invoke } from '../services.js';
import { DarkWatch, needOf } from '../stream-state.js';
import { audioOffer, thisMac, videoOffer } from '../stream-offer.js';
import { readTunnelAnswer, tunnelRequest } from '../tunnel.js';
import {
  decodeObject,
  encodeObject,
  encodeWrapper,
  XpcDouble,
  XpcInt64,
  XpcUuid,
} from '../xpc-codec.js';

const http2 = (type: number, flags: number, stream: number, p: Buffer = Buffer.alloc(0)) => {
  const h = Buffer.alloc(9);
  h.writeUIntBE(p.length, 0, 3);
  h[3] = type;
  h[4] = flags;
  h.writeUInt32BE(stream, 5);
  return Buffer.concat([h, p]);
};

function fakeConnection() {
  const written: Buffer[] = [];
  let data: (d: Buffer) => void = () => undefined;
  let closed: (why: string) => void = () => undefined;
  const connection = {
    write: (b: Buffer) => written.push(b),
    onData: (l: typeof data) => (data = l),
    onClose: (l: typeof closed) => (closed = l),
    close: vi.fn(),
  } as unknown as TcpConnection;
  return { connection, written, feed: (d: Buffer) => data(d), end: (w: string) => closed(w) };
}

/** The frames of everything written, past the preface. */
function framesOf(written: Buffer[]) {
  let b = Buffer.concat(written);
  if (b.toString('latin1', 0, 3) === 'PRI') b = b.subarray(24);
  const out: { type: number; flags: number; stream: number; payload: Buffer }[] = [];
  while (b.length >= 9) {
    const n = b.readUIntBE(0, 3);
    out.push({
      type: b[3]!,
      flags: b[4]!,
      stream: b.readUInt32BE(5),
      payload: b.subarray(9, 9 + n),
    });
    b = b.subarray(9 + n);
  }
  return out;
}

describe('XPC values', () => {
  it('come back as they went', () => {
    const v = {
      a: true,
      b: false,
      n: null,
      i: new XpcInt64(-5),
      plain: 7,
      u: 8n,
      d: new XpcDouble(0.5),
      s: 'héllo',
      e: '',
      data: Buffer.from([1, 2, 3, 4, 5]),
      list: ['x', 1n, { deep: 'y' }],
      nested: { k: { l: 'm' } },
      id: new XpcUuid('00112233-4455-6677-8899-aabbccddeeff'),
    };
    expect(decodeObject(encodeObject(v))).toEqual({
      a: true,
      b: false,
      n: null,
      i: -5,
      plain: 7,
      u: 8,
      d: 0.5,
      s: 'héllo',
      e: '',
      data: Buffer.from([1, 2, 3, 4, 5]),
      list: ['x', 1, { deep: 'y' }],
      nested: { k: { l: 'm' } },
      id: '00112233445566778899aabbccddeeff',
    });
  });

  it('a key or string of any length keeps to 32-bit steps', () => {
    for (const k of ['a', 'ab', 'abc', 'abcd', 'abcde']) {
      const b = encodeObject({ [k]: k, after: 1n });
      expect(decodeObject(b)).toEqual({ [k]: k, after: 1 });
      expect(b.length % 4).toBe(0);
    }
  });

  it('what is no object is undefined, and a broken one throws', () => {
    expect(decodeObject(Buffer.alloc(0))).toBeUndefined();
    expect(decodeObject(Buffer.alloc(12))).toBeUndefined();
    const b = encodeObject({ s: 'text' });
    expect(() => decodeObject(b.subarray(0, b.length - 6))).toThrow(RangeError);
    const unknown = Buffer.from(encodeObject(null));
    unknown.writeUInt32LE(0x6000, 8);
    expect(() => decodeObject(unknown)).toThrow('0x6000');
  });
});

describe('a service connection', () => {
  const reply = (v: Parameters<typeof encodeWrapper>[1], stream = 1) =>
    http2(0, 0, stream, encodeWrapper(0x101, v));

  it('opens both channels, and sends what asks for a reply as such', () => {
    const { connection, written } = fakeConnection();
    const x = RemoteXpc.start(connection);
    expect(Buffer.concat(written).toString('latin1', 0, 24)).toBe(
      'PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n',
    );
    const opened = framesOf(written);
    expect(opened.filter((f) => f.type === 1).map((f) => f.stream)).toEqual([1, 3]);
    written.length = 0;
    x.send({ a: 1n }, true);
    const f = framesOf(written)[0]!;
    expect(f.stream).toBe(1);
    expect(f.payload.readUInt32LE(4)).toBe(0x10101);
    written.length = 0;
    x.send({ a: 1n }, false);
    expect(framesOf(written)[0]!.payload.readUInt32LE(4)).toBe(0x101);
  });

  it('cuts a long message to the size of a frame', () => {
    const { connection, written } = fakeConnection();
    const x = RemoteXpc.start(connection);
    written.length = 0;
    x.send({ big: Buffer.alloc(40_000) }, false);
    const f = framesOf(written);
    expect(f.length).toBe(3);
    expect(f.every((p) => p.payload.length <= 16_384)).toBe(true);
  });

  it('reads messages across frames and chunks, skips empty ones, on either channel', async () => {
    const { connection, feed } = fakeConnection();
    const x = RemoteXpc.start(connection);
    const message = encodeWrapper(0x101, { hello: 'there' });
    const bytes = Buffer.concat([
      reply({}, 1),
      http2(0, 0, 3, message.subarray(0, 30)),
      http2(0, 0, 3, message.subarray(30)),
      reply({ second: 1n }, 1),
    ]);
    feed(bytes.subarray(0, 10));
    feed(bytes.subarray(10));
    await expect(x.next()).resolves.toEqual({ hello: 'there' });
    await expect(x.next()).resolves.toEqual({ second: 1 });
  });

  it('answers settings and pings, and leaves acknowledgements alone', () => {
    const { connection, written, feed } = fakeConnection();
    RemoteXpc.start(connection);
    written.length = 0;
    feed(http2(4, 0, 0));
    feed(http2(4, 1, 0));
    feed(http2(6, 0, 0, Buffer.alloc(8, 9)));
    feed(http2(6, 1, 0, Buffer.alloc(8, 9)));
    const f = framesOf(written);
    expect(f.map((p) => [p.type, p.flags])).toEqual([
      [4, 1],
      [6, 1],
    ]);
    expect(f[1]!.payload).toEqual(Buffer.alloc(8, 9));
  });

  it('gives back the flow window, so that a big answer does not stall', () => {
    const { connection, written, feed } = fakeConnection();
    RemoteXpc.start(connection);
    written.length = 0;
    const part = encodeWrapper(0x101, { a: Buffer.alloc(16_000) });
    for (let i = 0; i < 16; i++) feed(http2(0, 0, 1, part));
    feed(http2(0, 0, 1, part));
    const updates = framesOf(written).filter((p) => p.type === 8);
    expect(updates.map((p) => p.stream)).toEqual([0, 1]);
    expect(updates[0]!.payload.readUInt32BE()).toBeGreaterThanOrEqual(256 * 1024);
  });

  it('gives each channel back what it took, whichever of them last spoke', () => {
    const { connection, feed, written } = fakeConnection();
    RemoteXpc.start(connection);
    written.length = 0;
    const part = encodeWrapper(0x101, { a: Buffer.alloc(16_000) });
    // the window a phone is given opens at 1 MB: this much of it again, and its answers would stop coming
    const rounds = 12;
    for (let i = 0; i < rounds; i++) {
      for (let k = 0; k < 16; k++) feed(http2(0, 0, 3, part));
      feed(http2(0, 0, 1, part));
    }
    const given = (stream: number) =>
      framesOf(written)
        .filter((p) => p.type === 8 && p.stream === stream)
        .reduce((a, p) => a + p.payload.readUInt32BE(), 0);
    expect(given(3)).toBeGreaterThan(rounds * 16 * part.length - 256 * 1024);
    expect(given(1)).toBeLessThanOrEqual(rounds * part.length);
    expect(given(0)).toBeGreaterThan(rounds * 17 * part.length - 256 * 1024);
  });

  it('a connection that ends rejects who waits, and who asks later; so does silence', async () => {
    const { connection, end } = fakeConnection();
    const x = RemoteXpc.start(connection);
    await expect(x.next(5)).rejects.toThrow('no reply in 5 ms');
    const waiting = x.next();
    end('the tunnel ended');
    await expect(waiting).rejects.toThrow('the tunnel ended');
    await expect(x.next()).rejects.toThrow('the tunnel ended');
  });

  it('a feature answers with its output, or the words of its refusal', async () => {
    const { connection, feed, written } = fakeConnection();
    const x = RemoteXpc.start(connection);
    written.length = 0;
    const ok = invoke(x, 'f', {});
    feed(reply({ 'CoreDevice.output': { running: false } }));
    await expect(ok).resolves.toEqual({ running: false });
    expect(decodeObject(framesOf(written)[0]!.payload.subarray(24))).toMatchObject({
      'CoreDevice.featureIdentifier': 'f',
      'CoreDevice.coreDeviceVersion': { stringValue: '651.28' },
    });
    const refused = invoke(x, 'f', {});
    feed(
      reply({
        'CoreDevice.error': { NSLocalizedDescription: 'The device microphone or camera is in use' },
      }),
    );
    await expect(refused).rejects.toThrow('microphone or camera');
  });
});

describe('a dark phone, by its count of pictures', () => {
  const run = (perSecond: number[]) => {
    const watch = new DarkWatch();
    let total = 0;
    return perSecond.map((n) => watch.tick((total += n)));
  };

  it('is told after three seconds of a picture each, and once', () => {
    expect(run([21, 1, 1, 1, 1, 1])).toEqual([
      undefined,
      undefined,
      undefined,
      'asleep',
      undefined,
      undefined,
    ]);
  });

  it('comes back with the pictures, once', () => {
    expect(run([1, 1, 1, 3, 21, 21]).slice(2)).toEqual(['asleep', undefined, 'ok', undefined]);
  });

  it('a still lit screen, or a slow second among them, is not dark', () => {
    expect(run([21, 2, 21, 2, 2, 21, 20]).filter(Boolean)).toEqual([]);
  });
});

describe('what a phone says', () => {
  it('its reasons, as Apple words them, become what a person can act on', () => {
    expect(needOf('The device microphone or camera is currently in use.')).toBe('camera-or-mic');
    expect(needOf('A phone or VoIP call is currently in progress on the device.')).toBe('call');
    expect(needOf('The personal assistant is currently active on the device.')).toBe('siri');
    expect(needOf('Remote control requires iOS 27.0, watchOS 27.0')).toBe('os-too-old');
    expect(needOf('Something else')).toBeUndefined();
  });

  it('its error text is found wherever it is held', () => {
    expect(errorWords('plain')).toBe('plain');
    expect(errorWords({ a: { NSLocalizedFailureReason: 'deep' }, b: 1 })).toBe('deep');
    expect(errorWords(undefined)).toBe('');
  });
});

describe('the offer', () => {
  const endpoint = { model: 'Mac99,1', avc: '1.2.3', build: '99Z9' };

  const open = (b: Buffer) =>
    readBplist(b) as {
      avcMediaStreamNegotiatorMode: number;
      avcMediaStreamNegotiatorMediaBlob: Buffer;
      avcMediaStreamOptionRemoteEndpointInfo: Buffer;
      avcMediaStreamOptionCallID: string;
    };

  it('names its mode, and this Mac', () => {
    for (const mode of [5, 7] as const) {
      const o = open(videoOffer(mode, 1, endpoint));
      expect(o.avcMediaStreamNegotiatorMode).toBe(mode);
      const info = o.avcMediaStreamOptionRemoteEndpointInfo.toString('latin1');
      for (const s of ['Mac99,1', '1.2.3', '99Z9']) expect(info).toContain(s);
      expect(o.avcMediaStreamOptionCallID).toMatch(/^[0-9A-F-]{36}$/);
    }
    expect(open(audioOffer(5, 1, endpoint)).avcMediaStreamNegotiatorMode).toBe(6);
    expect(open(audioOffer(7, 1, endpoint)).avcMediaStreamNegotiatorMode).toBe(8);
  });

  it('holds its media in a deflated blob, with the features of its mode', () => {
    const blob = (mode: 5 | 7) =>
      inflateSync(open(videoOffer(mode, 1, endpoint)).avcMediaStreamNegotiatorMediaBlob).toString(
        'latin1',
      );
    expect(blob(7)).toContain('POS:5;EOD:1;HTS:2;RR:3;POSE:4;SW:0');
    expect(blob(5)).toContain('LTR;CABAC');
    expect(blob(7)).toContain('FLS;SW:1;');
  });

  it('reads this Mac by what it says of itself', () => {
    const asked: string[] = [];
    const run = ((file: string) => {
      asked.push(file);
      return ` ${file.split('/').at(-1)}\n`;
    }) as never;
    expect(thisMac(run)).toEqual({ model: 'sysctl', avc: 'plutil', build: 'sw_vers' });
    expect(asked).toHaveLength(3);
  });
});

describe('the tunnel handshake', () => {
  const answer = (j: unknown, more = '') => {
    const body = Buffer.from(JSON.stringify(j));
    const h = Buffer.alloc(10);
    h.write('CDTunnel', 'latin1');
    h.writeUInt16BE(body.length, 8);
    return Buffer.concat([h, body, Buffer.from(more)]);
  };
  const j = {
    clientParameters: { address: 'fd00::2', mtu: 16_000 },
    serverAddress: 'fd00::1',
    serverRSDPort: 49_571,
  };

  it('asks in the same frame it is answered in', () => {
    const b = tunnelRequest();
    expect(b.toString('latin1', 0, 8)).toBe('CDTunnel');
    expect(JSON.parse(b.toString('utf8', 10))).toEqual({
      type: 'clientHandshakeRequest',
      mtu: 16_000,
    });
  });

  it('waits for all of its answer, and keeps what came after it', () => {
    const whole = answer(j, 'packets');
    expect(readTunnelAnswer(whole.subarray(0, 5))).toBeUndefined();
    expect(readTunnelAnswer(whole.subarray(0, 20))).toBeUndefined();
    const read = readTunnelAnswer(whole)!;
    expect(read.info).toEqual({
      local: 'fd00::2',
      remote: 'fd00::1',
      rsdPort: 49_571,
      mtu: 16_000,
    });
    expect(read.rest.toString()).toBe('packets');
  });

  it('refuses what is no tunnel', () => {
    expect(() => readTunnelAnswer(Buffer.alloc(20))).toThrow('no tunnel');
  });
});

describe('a finger, as a report', () => {
  it('holds its place as sixteen bits of the screen, kept within it', () => {
    const r = touchReport(0xc2, 0.5, 1.5, 0x123456789abcn);
    expect(r).toHaveLength(58);
    expect(r[0]).toBe(0x09);
    expect(r[3]).toBe(0xc2);
    expect(r.readUInt16LE(4)).toBe(32_768);
    expect(r.readUInt16LE(6)).toBe(65_535);
    expect(r.readUIntLE(44, 6)).toBe(0x123456789abc);
    expect(touchReport(2, -1, 0, 0n).readUInt16LE(4)).toBe(0);
  });

  it('a touch on a stood-up picture is turned back to where the phone has that point', async () => {
    const universal = { send: vi.fn() };
    const hid = new PhoneHid({ send: vi.fn() } as never, universal as never, async () => undefined);
    hid.turns = 1;
    await hid.send({ kind: 'touch', p: 0, x: 0.25, y: 0.5 });
    const { _0: report } = (
      universal.send.mock.calls[0]![0] as { payload: { send: { _0: Buffer } } }
    ).payload.send;
    expect(report.readUInt16LE(4)).toBe(32_768);
    expect(report.readUInt16LE(6)).toBe(16_384);
  });

  it('a touch goes to one service, a button and a key to the other', async () => {
    const indigo = { send: vi.fn() };
    const universal = { send: vi.fn() };
    const hid = new PhoneHid(indigo as never, universal as never, async () => undefined);
    await hid.send({ kind: 'touch', p: 0, x: 0.1, y: 0.2 });
    await hid.send({ kind: 'touch', p: 2, x: 0.1, y: 0.2 });
    const state = (c: unknown[]) =>
      (c[0] as { payload: { send: { _0: Buffer } } }).payload.send._0[3];
    expect(universal.send.mock.calls.map(state)).toEqual([0xc2, 0x02]);
    expect(indigo.send).not.toHaveBeenCalled();
    await hid.send({ kind: 'key', page: 7, usage: 4, state: 1 });
    expect(indigo.send.mock.calls[0]![0]).toMatchObject({
      messageType: 'IndigoButtonEvent',
      payload: { state: 1n, usagePage: 7n, usageCode: 4n },
    });
    indigo.send.mockClear();
    await hid.send({ kind: 'text', s: 'aB' });
    expect(indigo.send).toHaveBeenCalledTimes(6);
    // what was typed may be a secret: the words never hold it
    await expect(hid.send({ kind: 'text', s: 'ç' })).rejects.toThrow(/^[^ç]*US keyboard[^ç]*$/);
  });
});
