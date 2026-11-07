import {
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  ftruncateSync,
} from 'node:fs';
import http2, { type ClientHttp2Session } from 'node:http2';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import {
  deviceStateFile,
  type DeviceState,
  type InputEvent,
  type Mirror,
  type MirrorOptions,
  type MirrorSource,
  processAlive,
  type ViewerOrder,
} from '@appdyno/core';
import { GrpcMessages, grpcFrame, imageInfo, imageRequest } from './grpc-image.js';
import type { AndroidMirror } from './mirror.js';

const STREAM_PATH = '/android.emulation.control.EmulatorController/streamScreenshot';
/** The default of 64 KB cost a factor of 4 on a stream with the pixels in it; messages here are small. */
const WINDOW_BYTES = 1 << 30;
const CONNECT_MS = 8_000;
const TURNS_POLL_MS = 500;

export type GrpcEndpoint = { port: number; token?: string };

/** Where a running emulator describes itself on a Mac. */
const runningDir = () => join(homedir(), 'Library/Caches/TemporaryItems/avd/running');

/** The gRPC port of the emulator with this serial, as its own run file says; its token, if it wants one. */
export function findGrpc(serial: string, dir = runningDir()): GrpcEndpoint | undefined {
  const console = serial.replace(/^emulator-/, '');
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return undefined;
  }
  for (const name of names) {
    const pid = /^pid_(\d+)\.ini$/.exec(name)?.[1];
    if (!pid || !processAlive(Number(pid))) continue;
    const lines = readFileSync(join(dir, name), 'utf8').split('\n');
    const value = (key: string) =>
      lines
        .find((l) => l.startsWith(`${key}=`))
        ?.slice(key.length + 1)
        .trim();
    if (value('port.serial') !== console) continue;
    const port = Number(value('grpc.port'));
    if (!port) return undefined;
    const token = value('grpc.token');
    return { port, ...(token && { token }) };
  }
  return undefined;
}

/**
 * An emulator's mirror: the emulator writes its screen into a shared file and says so on its own gRPC
 * port, with nothing running in the guest, and each message becomes a `tick` to the viewer. Where it has
 * no such port, the guest encodes, which lags by seconds; the session says so. Input goes as on a phone.
 */
export class EmulatorMirror implements Mirror {
  private client: ClientHttp2Session | undefined;
  private file: string | undefined;
  private turnsTimer: NodeJS.Timeout | undefined;
  private push: ((s: DeviceState) => void) | undefined;

  constructor(
    private readonly serial: string,
    private readonly phone: AndroidMirror,
    private readonly endpoint: () => GrpcEndpoint | undefined = () => findGrpc(serial),
  ) {}

  check = () => this.phone.check();
  keyframe = () => this.phone.keyframe();
  wake = () => this.phone.wake();
  input = (e: InputEvent) => this.phone.input(e);
  keyOf = (usage: number) => this.phone.keyOf(usage);

  async open(
    opts: MirrorOptions,
    _signal: AbortSignal,
    tell: (message: ViewerOrder) => void,
  ): Promise<MirrorSource> {
    const grpc = this.endpoint();
    if (!grpc) return this.guest(opts, 'this emulator has no gRPC port');
    try {
      return await this.openPixels(grpc, tell);
    } catch (e) {
      await this.endPixels();
      return this.guest(opts, (e as Error).message);
    }
  }

  private async guest(opts: MirrorOptions, why: string): Promise<MirrorSource> {
    const { w, h } = await this.phone.status();
    const source = await this.phone.sourceWith(opts, { maxSize: Math.floor(Math.max(w, h) / 2) });
    return {
      ...source,
      note: `the guest encodes this picture, which lags by seconds (${why}): boot the emulator with the simulator tool for one with no lag`,
    };
  }

  /**
   * The screen's file: only this user reads it, it holds one frame, as the emulator wants it, and it goes with
   * its process. A frame a process that died left behind goes with the next start.
   */
  private makeFile(w: number, h: number): string {
    const stem = deviceStateFile('mirror', this.serial).replace(/\.json$/, '');
    const folder = dirname(stem);
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    for (const name of readdirSync(folder)) {
      const pid = name.startsWith(`${basename(stem)}-`)
        ? /-(\d+)\.rgba$/.exec(name)?.[1]
        : undefined;
      if (pid && !processAlive(Number(pid))) rmSync(join(folder, name), { force: true });
    }
    const file = `${stem}-${process.pid}.rgba`;
    const fd = openSync(file, 'w', 0o600);
    ftruncateSync(fd, w * h * 4);
    closeSync(fd);
    this.file = file;
    return file;
  }

  private async openPixels(
    grpc: GrpcEndpoint,
    tell: (message: ViewerOrder) => void,
  ): Promise<MirrorSource> {
    const screen = await this.phone.status();
    // the emulator's frame keeps the shape it was built with: a guest that rotates draws sideways in it
    const sideways = screen.rotation % 2 === 1;
    const w = sideways ? screen.h : screen.w;
    const h = sideways ? screen.w : screen.h;
    const file = this.makeFile(w, h);
    const client = http2.connect(`http://127.0.0.1:${grpc.port}`, {
      settings: { initialWindowSize: WINDOW_BYTES },
    });
    this.client = client;
    client.on('error', () => undefined);
    client.on('connect', () => client.setLocalWindowSize(WINDOW_BYTES));
    const stream = client.request({
      ':method': 'POST',
      ':path': STREAM_PATH,
      'content-type': 'application/grpc',
      te: 'trailers',
      ...(grpc.token && { authorization: `Bearer ${grpc.token}` }),
    });
    stream.end(grpcFrame(imageRequest(file, w, h)));
    const messages = new GrpcMessages();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the gRPC port did not answer')), CONNECT_MS);
      const fail = (why: string) => {
        clearTimeout(timer);
        reject(new Error(why));
      };
      stream.once('response', (headers) => {
        clearTimeout(timer);
        const status = headers['grpc-status'];
        if (status !== undefined && status !== '0')
          fail(`the gRPC port refused: ${String(headers['grpc-message'] ?? status)}`);
        else if (headers[':status'] !== 200) fail(`the gRPC port answered ${headers[':status']}`);
        else resolve();
      });
      stream.once('error', (e) => fail(e.message));
      client.once('error', (e) => fail(e.message));
    });
    let turns = screen.rotation;
    let seen = { w, h, seq: 0 };
    const tick = () => tell({ op: 'tick', ...seen, turns });
    stream.on('data', (chunk: Buffer) => {
      let got: Buffer[];
      try {
        got = messages.push(chunk);
      } catch {
        stream.destroy();
        return;
      }
      for (const m of got) {
        const { w: width, h: height, seq } = imageInfo(m);
        // an inactive display answers an empty image
        if (width === 0 || height === 0) continue;
        seen = { w: width, h: height, seq };
        // after the session's `attach`, which this promise's end comes before
        setImmediate(tick);
      }
    });
    // a turn of the guest brings no message of its own, and the picture must still turn
    this.turnsTimer = setInterval(() => {
      void this.phone.status().then(
        ({ rotation }) => {
          if (rotation === turns || this.client !== client) return;
          turns = rotation;
          tick();
        },
        () => undefined,
      );
    }, TURNS_POLL_MS);
    this.turnsTimer.unref();
    const ended = () => {
      if (this.client === client) this.push?.('not-connected');
    };
    stream.on('close', ended);
    stream.on('error', ended);
    client.on('close', ended);
    return { kind: 'pixels', file, w, h };
  }

  private async endPixels() {
    clearInterval(this.turnsTimer);
    const client = this.client;
    this.client = undefined;
    client?.destroy();
    if (this.file) rmSync(this.file, { force: true });
    this.file = undefined;
  }

  async close() {
    await this.endPixels();
    await this.phone.close();
  }

  watch(onChange: (s: DeviceState) => void) {
    this.push = onChange;
    const off = this.phone.watch(onChange);
    return () => {
      this.push = undefined;
      off();
    };
  }
}
