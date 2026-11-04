import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http2 from 'node:http2';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { GrpcMessages, grpcFrame, imageInfo, imageRequest } from '../src/grpc-image.js';
import { grpcArgs } from '../src/emulators.js';
import { EmulatorMirror, findGrpc } from '../src/mirror-emulator.js';
import type { AndroidMirror } from '../src/mirror.js';

const dir = mkdtempSync(join(tmpdir(), 'appdyno-grpc-'));
const stateBefore = process.env.APPDYNO_STATE_DIR;

beforeAll(() => {
  process.env.APPDYNO_STATE_DIR = dir;
});

afterAll(() => {
  if (stateBefore === undefined) delete process.env.APPDYNO_STATE_DIR;
  else process.env.APPDYNO_STATE_DIR = stateBefore;
  rmSync(dir, { recursive: true, force: true });
});

const varint = (n: number) => {
  const out: number[] = [];
  let v = n;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
  return Buffer.from(out);
};
const num = (f: number, v: number) => Buffer.concat([varint(f * 8), varint(v)]);
const msg = (f: number, b: Buffer) => Buffer.concat([varint(f * 8 + 2), varint(b.length), b]);

/** An `Image` as the emulator sends it, with the pixels elsewhere. */
const image = (w: number, h: number, seq: number, rotation = 0) =>
  Buffer.concat([
    msg(
      1,
      Buffer.concat([
        num(1, 1),
        msg(2, num(1, rotation)),
        num(3, w),
        num(4, h),
        msg(6, Buffer.concat([num(1, 1), msg(2, Buffer.from('file:///x'))])),
      ]),
    ),
    num(5, seq),
    num(6, 1_700_000_000_000_000),
  ]);

describe('the emulator screen stream, by hand', () => {
  it('asks for RGBA written to the file', () => {
    const request = imageRequest('/tmp/screen.rgba', 1080, 2400);
    expect(request[0]).toBe(0x08);
    expect(request[1]).toBe(1);
    expect(request.includes(Buffer.from('file:///tmp/screen.rgba'))).toBe(true);
    expect(request.subarray(2, 8)).toEqual(Buffer.concat([num(3, 1080), num(4, 2400)]));
  });

  it('reads what an image says of its frame', () => {
    expect(imageInfo(image(1080, 2400, 7, 1))).toEqual({ w: 1080, h: 2400, seq: 7, rotation: 1 });
    expect(imageInfo(image(0, 0, 0))).toMatchObject({ w: 0, h: 0 });
  });

  it('reads a cut or strange message as what it could read, with no exception', () => {
    const whole = image(1080, 2400, 7);
    for (let cut = 0; cut < whole.length; cut++) imageInfo(whole.subarray(0, cut));
    imageInfo(Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]));
    imageInfo(Buffer.from([0x0a, 0xff, 0xff, 0xff, 0x7f]));
    imageInfo(Buffer.from([0x0b]));
    const noise = Buffer.alloc(4096);
    for (let round = 0; round < 200; round++) {
      for (let i = 0; i < noise.length; i++) noise[i] = (i * 31 + round * 7) & 0xff;
      expect(imageInfo(noise).w).toBeGreaterThanOrEqual(0);
    }
  });

  it('finds whole messages across chunks, and believes no huge one', () => {
    const messages = new GrpcMessages();
    const a = grpcFrame(image(1, 2, 3));
    const b = grpcFrame(image(4, 5, 6));
    const all = Buffer.concat([a, b]);
    expect(messages.push(all.subarray(0, 3))).toEqual([]);
    expect(messages.push(all.subarray(3, a.length + 2)).map(imageInfo)).toMatchObject([{ w: 1 }]);
    expect(messages.push(all.subarray(a.length + 2)).map(imageInfo)).toMatchObject([{ w: 4 }]);
    const huge = Buffer.alloc(5);
    huge.writeUInt32BE(1 << 30, 1);
    expect(() => new GrpcMessages().push(huge)).toThrow(/bytes on the stream/);
  });
});

describe('booting an emulator', () => {
  it('opens its gRPC port behind a token, unless the flags name their own', () => {
    expect(grpcArgs(['-no-window'], 8721)).toEqual(['-grpc', '8721', '-grpc-use-token']);
    expect(grpcArgs(['-grpc', '9000'], 8721)).toEqual([]);
  });
});

describe('finding an emulator gRPC port', () => {
  const running = mkdtempSync(join(tmpdir(), 'appdyno-running-'));
  afterAll(() => rmSync(running, { recursive: true, force: true }));

  const ini = (pid: number, lines: string[]) =>
    writeFileSync(join(running, `pid_${pid}.ini`), lines.join('\n'));

  it('reads the port and token of the live emulator with that serial', () => {
    ini(process.pid, ['port.serial=5720', 'grpc.port=8721', 'grpc.token=secret']);
    expect(findGrpc('emulator-5720', running)).toEqual({ port: 8721, token: 'secret' });
    expect(findGrpc('emulator-5722', running)).toBeUndefined();
  });

  it('passes over a dead one, and answers nothing for one with no port', () => {
    ini(999_999, ['port.serial=5724', 'grpc.port=1']);
    expect(findGrpc('emulator-5724', running)).toBeUndefined();
    ini(process.pid, ['port.serial=5726']);
    expect(findGrpc('emulator-5726', running)).toBeUndefined();
    expect(findGrpc('emulator-5726', join(running, 'no-such'))).toBeUndefined();
  });
});

/** A stand-in for the emulator's gRPC port: answers as told, and keeps what it was asked. */
function fakeEmulator(answer: (s: http2.ServerHttp2Stream) => void) {
  const asked: http2.IncomingHttpHeaders[] = [];
  const bodies: Buffer[] = [];
  const server = http2.createServer();
  server.on('stream', (stream, headers) => {
    asked.push(headers);
    stream.on('data', (b: Buffer) => bodies.push(b));
    stream.on('error', () => undefined);
    answer(stream);
  });
  return new Promise<{ port: number; close: () => void; asked: typeof asked; bodies: Buffer[] }>(
    (resolve) =>
      server.listen(0, '127.0.0.1', () =>
        resolve({
          port: (server.address() as AddressInfo).port,
          asked,
          bodies,
          close: () => server.close(),
        }),
      ),
  );
}

const phone = (
  screen: { w: number; h: number; rotation: number } = { w: 1080, h: 2400, rotation: 0 },
) =>
  ({
    status: vi.fn(async () => screen),
    check: vi.fn(async () => ({ ok: true, routes: ['agent'] })),
    keyframe: vi.fn(async () => undefined),
    input: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    watch: vi.fn(() => () => undefined),
    sourceWith: vi.fn(async (_o: unknown, start: object) => ({
      kind: 'adb',
      serial: 'emulator-5720',
      socket: 's',
      token: 't',
      codec: 'h264',
      start,
    })),
  }) as unknown as AndroidMirror & {
    sourceWith: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    input: ReturnType<typeof vi.fn>;
  };

const signal = new AbortController().signal;
const until = async (test: () => boolean) => {
  const end = Date.now() + 5_000;
  while (!test() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
  expect(test()).toBe(true);
};

describe('an emulator mirror', () => {
  let close = () => undefined as void;
  afterEach(() => close());

  it('asks with its token, and each frame becomes a tick after the attach', async () => {
    const emulator = await fakeEmulator((s) => {
      s.respond({ ':status': 200, 'content-type': 'application/grpc' });
      s.write(grpcFrame(image(0, 0, 0)));
      s.write(grpcFrame(image(1080, 2400, 1)));
      s.write(grpcFrame(image(1080, 2400, 2)));
    });
    close = emulator.close;
    const ticks: Record<string, unknown>[] = [];
    const mirror = new EmulatorMirror('emulator-5720', phone(), () => ({
      port: emulator.port,
      token: 'the-token',
    }));
    const source = await mirror.open({ quality: 'auto' }, signal, (m) => ticks.push(m));
    expect(source).toMatchObject({ kind: 'pixels', w: 1080, h: 2400 });
    const file = (source as { file: string }).file;
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(file).size).toBe(1080 * 2400 * 4);
    expect(emulator.asked[0]).toMatchObject({
      ':path': '/android.emulation.control.EmulatorController/streamScreenshot',
      authorization: 'Bearer the-token',
    });
    expect(ticks).toEqual([]);
    await until(() => ticks.length === 2);
    expect(ticks[0]).toMatchObject({ op: 'tick', w: 1080, h: 2400, turns: 0 });
    const stream = Buffer.concat(emulator.bodies);
    expect(stream.includes(Buffer.from(`file://${file}`))).toBe(true);
    await mirror.close();
    expect(existsSync(file)).toBe(false);
  });

  it('a guest that turns draws sideways in the same frame: the file keeps its shape, and a tick says so', async () => {
    const emulator = await fakeEmulator((s) => {
      s.respond({ ':status': 200 });
      s.write(grpcFrame(image(1080, 2400, 1)));
    });
    close = emulator.close;
    const screen = { w: 2400, h: 1080, rotation: 1 };
    const ticks: Record<string, unknown>[] = [];
    const mirror = new EmulatorMirror('emulator-5720', phone(screen), () => ({
      port: emulator.port,
    }));
    const source = await mirror.open({ quality: 'auto' }, signal, (m) => ticks.push(m));
    expect(source).toMatchObject({ w: 1080, h: 2400 });
    await until(() => ticks.length === 1);
    expect(ticks[0]).toMatchObject({ turns: 1 });
    screen.rotation = 0;
    await until(() => ticks.length === 2);
    expect(ticks[1]).toMatchObject({ w: 1080, h: 2400, turns: 0 });
    await mirror.close();
  });

  it('a stream that ends says the device went, and only the live one', async () => {
    const emulator = await fakeEmulator((s) => {
      s.respond({ ':status': 200 });
      s.write(grpcFrame(image(10, 20, 1)));
      setTimeout(() => s.close(), 50);
    });
    close = emulator.close;
    const seen: string[] = [];
    const mirror = new EmulatorMirror('emulator-5720', phone(), () => ({ port: emulator.port }));
    mirror.watch((s) => seen.push(s));
    await mirror.open({ quality: 'auto' }, signal, () => undefined);
    await until(() => seen.length > 0);
    expect(seen[0]).toBe('not-connected');
    seen.length = 0;
    await mirror.open({ quality: 'auto' }, signal, () => undefined);
    await mirror.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(seen).toEqual([]);
  });

  it('no port: the guest encodes at half size, and it says so', async () => {
    const p = phone();
    const mirror = new EmulatorMirror('emulator-5720', p, () => undefined);
    const source = await mirror.open({ quality: 'auto' }, signal, () => undefined);
    expect(p.sourceWith).toHaveBeenCalledWith({ quality: 'auto' }, { maxSize: 1200 });
    expect(source).toMatchObject({ kind: 'adb', start: { maxSize: 1200 } });
    expect((source as { note: string }).note).toMatch(/lags by seconds.*simulator tool/);
  });

  it('a port that refuses: the same, with its reason', async () => {
    const emulator = await fakeEmulator((s) => {
      s.respond(
        { ':status': 200, 'grpc-status': '16', 'grpc-message': 'no token' },
        { endStream: true },
      );
    });
    close = emulator.close;
    const mirror = new EmulatorMirror('emulator-5720', phone(), () => ({ port: emulator.port }));
    const source = await mirror.open({ quality: 'auto' }, signal, () => undefined);
    expect(source).toMatchObject({ kind: 'adb' });
    expect((source as { note: string }).note).toContain('no token');
  });

  it('a port nothing listens on: the same', async () => {
    const mirror = new EmulatorMirror('emulator-5720', phone(), () => ({ port: 1 }));
    await expect(mirror.open({ quality: 'auto' }, signal, () => undefined)).resolves.toMatchObject({
      kind: 'adb',
    });
  });

  it('input goes as on a phone, and close ends both; twice is once', async () => {
    const p = phone();
    const mirror = new EmulatorMirror('emulator-5720', p, () => undefined);
    await mirror.input({ kind: 'touch', p: 0, x: 0, y: 0 });
    expect(p.input).toHaveBeenCalledOnce();
    await mirror.close();
    await mirror.close();
    expect(p.close).toHaveBeenCalledTimes(2);
  });
});
