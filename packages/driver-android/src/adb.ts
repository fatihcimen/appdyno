import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { connect, type Socket } from 'node:net';
import { callSignal, cancelled } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { downloadedAdb } from './tools.js';

/**
 * A client of the local adb server's own protocol (TCP 127.0.0.1:5037): device lists, raw streams to a
 * device's abstract unix sockets and commands run without starting an adb process per call. Only file
 * pushes and installs use the adb binary (they need its sync protocol).
 */

export type AdbDevice = { serial: string; state: string; props: Record<string, string> };

export type AdbOptions = {
  host?: string;
  port?: number;
  /** The adb binary (start-server, push, install). */
  bin?: string;
  answerMs?: number;
};

/** How long a request may go unanswered: adb itself waits for ever on a device that stopped answering it. */
const ANSWER_MS = 15_000;

/** A cable's serial, or what wireless debugging gives: an address, an IPv6 one in brackets, or an mDNS name. */
const SERIAL = /^[\w.:%[\]() -]{1,96}$/;

export function assertSerial(serial: string): string {
  if (!SERIAL.test(serial))
    throw new DeviceError('INVALID_ARGUMENT', `not a device serial: ${serial}`);
  return serial;
}

/** A serial of a phone reached by the network: it is an address, or a name adb found on the network. */
export const overNetwork = (serial: string) => /:\d+$|\._adb-tls-connect\._tcp/.test(serial);

/** One argument for the device's `sh -c`: single-quoted, quotes inside escaped. */
const PACKAGE_NAME = /^[A-Za-z][\w]*(\.[A-Za-z][\w]*)+$/;

/** An Android package name, checked before it goes in a shell command. */
export const assertPkg = (p: string) => {
  if (!PACKAGE_NAME.test(p)) throw new DeviceError('INVALID_ARGUMENT', `not a package name: ${p}`);
  return p;
};

/** What a command said, for a refusal. */
export const shortFirstLine = (s: string) => s.trim().split('\n')[0]?.slice(0, 200) ?? '';

/**
 * What `am start -W` said went wrong. `Status: timeout` is no failure: the activity was started and had not
 * drawn when the wait ended (seen at load 500), and a read will tell what is on the screen.
 */
export const amStartError = (out: string) =>
  out
    .split('\n')
    .find((line) => /^Error|Exception/.test(line))
    ?.trim()
    .slice(0, 200);

export const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

const PAIR_MS = 30_000;

class Reader {
  private chunks: Buffer[] = [];
  private size = 0;
  private waiter: (() => void) | undefined;
  private ended = false;
  private failure: Error | undefined;

  constructor(private readonly socket: Socket) {
    socket.on('data', this.onData);
    socket.on('end', () => this.finish());
    socket.on('close', () => this.finish());
    socket.on('error', (e) => this.finish(e));
  }

  private onData = (b: Buffer) => {
    this.chunks.push(b);
    this.size += b.length;
    this.waiter?.();
  };

  private finish(e?: Error) {
    this.ended = true;
    this.failure ??= e;
    this.waiter?.();
  }

  async exactly(n: number): Promise<Buffer> {
    while (this.size < n) {
      if (this.ended) throw this.failure ?? new Error('adb closed the connection');
      await new Promise<void>((r) => (this.waiter = r));
      this.waiter = undefined;
    }
    const all = Buffer.concat(this.chunks);
    this.chunks = all.length > n ? [all.subarray(n)] : [];
    this.size -= n;
    return all.subarray(0, n);
  }

  /** Stops reading: the socket's later data goes to whoever takes it over. */
  detach(): Buffer {
    // paused until the new owner listens and resumes: data in between must not be lost
    this.socket.pause();
    this.socket.off('data', this.onData);
    const rest = Buffer.concat(this.chunks);
    this.chunks = [];
    this.size = 0;
    return rest;
  }
}

export class Adb {
  private readonly host: string;
  /** The adb server's port, for what connects to it by itself. */
  readonly port: number;
  private readonly given: string | undefined;
  private readonly answerMs: number;
  private started: Promise<void> | undefined;

  constructor(opts: AdbOptions = {}) {
    this.host = opts.host ?? '127.0.0.1';
    this.port = opts.port ?? 5037;
    this.given = opts.bin;
    this.answerMs = opts.answerMs ?? ANSWER_MS;
  }

  /** Looked up each time: a hub that stays open can be given one by a person's download. */
  get bin() {
    return this.given ?? process.env.ADB ?? defaultAdb();
  }

  /** Every device adb knows (`adb devices -l`), any state. */
  async devices(): Promise<AdbDevice[]> {
    const { socket, reader } = await this.request('host:devices-l');
    try {
      const len = parseInt((await reader.exactly(4)).toString('ascii'), 16);
      const text = len > 0 ? (await reader.exactly(len)).toString('utf8') : '';
      return parseDevices(text);
    } finally {
      socket.destroy();
    }
  }

  /**
   * A raw stream to `service` on the device (`localabstract:<name>`, `exec:<cmd>`). The socket comes
   * paused with the bytes already read in `rest`: listen, then `resume()`.
   */
  async open(serial: string, service: string): Promise<{ socket: Socket; rest: Buffer }> {
    const { socket, reader } = await this.request(`host:transport:${assertSerial(serial)}`, serial);
    await this.ask(socket, reader, service, serial);
    // from here on the stream is its user's, and may be quiet for as long as it likes
    socket.setTimeout(0);
    return { socket, rest: reader.detach() };
  }

  /**
   * Runs `command` through the device's shell and returns its output (stdout and whatever the command
   * redirects into it). A non-zero exit is not seen here: commands that matter print a marker.
   */
  async exec(serial: string, command: string, opts: { timeoutMs?: number } = {}): Promise<string> {
    return (await this.execBuffer(serial, command, opts)).toString('utf8');
  }

  /** As `exec`, the output as bytes (a file read with `cat`). */
  async execBuffer(
    serial: string,
    command: string,
    opts: { timeoutMs?: number } = {},
  ): Promise<Buffer> {
    const { socket, rest } = await this.open(serial, `exec:${command}`);
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = rest.length ? [rest] : [];
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new DeviceError('TIMEOUT', `adb command timed out: ${command.slice(0, 80)}`));
      }, opts.timeoutMs ?? 30_000);
      socket.on('data', (b: Buffer) => chunks.push(b));
      socket.resume();
      socket.on('close', () => {
        clearTimeout(timer);
        resolve(Buffer.concat(chunks));
      });
      socket.on('error', () => undefined);
      const signal = callSignal();
      const abort = () => {
        clearTimeout(timer);
        socket.destroy();
        reject(cancelled(`adb: ${command.slice(0, 40)}`));
      };
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
      socket.once('close', () => signal?.removeEventListener('abort', abort));
    });
  }

  /**
   * Starts `command` on the device in the background. The start session is kept open (the device kills
   * a just-started background process when its session ends at once) until the caller closes it, once
   * the process is up; it ends by itself after `holdMs`.
   */
  async startDetached(
    serial: string,
    command: string,
    holdMs = 15_000,
  ): Promise<{ close: () => void }> {
    const { socket } = await this.open(
      serial,
      `exec:(${command}) ; sleep ${Math.ceil(holdMs / 1000)}`,
    );
    socket.on('error', () => undefined);
    socket.resume();
    return { close: () => socket.destroy() };
  }

  /** Pairs with a phone by the code it shows under Wireless debugging. Connecting is adb's own, or a later `connect`. */
  async pair(address: string, code: string) {
    assertSerial(address);
    const said = await this.run(['pair', address, code], PAIR_MS);
    if (!/Successfully paired/.test(said))
      throw new DeviceError('CHECK_FAILED', `adb did not pair: ${shortFirstLine(said)}`);
  }

  /** Runs the adb binary (push, install); `stop` ends it early, as the call's own signal does. */
  run(args: string[], timeoutMs = 120_000, stop?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      const p = spawn(this.bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      p.stdout.on('data', (b) => (out += b));
      p.stderr.on('data', (b) => (out += b));
      const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
      const signal = callSignal();
      const abort = () => p.kill('SIGKILL');
      for (const s of [signal, stop]) s?.addEventListener('abort', abort, { once: true });
      p.once('close', () => {
        for (const s of [signal, stop]) s?.removeEventListener('abort', abort);
      });
      p.on('error', (e) => {
        clearTimeout(timer);
        reject(
          new DeviceError('UNSUPPORTED', `adb could not be started (${this.bin}): ${e.message}`),
        );
      });
      p.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(out);
        else reject(gone(out, args.join(' ')));
      });
    });
  }

  private async request(service: string, serial?: string) {
    const socket = await this.connectServer();
    const reader = new Reader(socket);
    await this.ask(socket, reader, service, serial);
    return { socket, reader };
  }

  private async ask(socket: Socket, reader: Reader, service: string, serial?: string) {
    try {
      await this.send(socket, service);
      await this.okay(reader, serial);
    } catch (e) {
      socket.destroy();
      throw e;
    }
  }

  private async connectServer(): Promise<Socket> {
    try {
      return await this.dial();
    } catch {
      // the server is down (never started, or stopped with kill-server): one start per outage, shared
      // by the callers that find it down at the same time
      this.started ??= this.run(['start-server'], 30_000)
        .then(() => undefined)
        .finally(() => (this.started = undefined));
      await this.started;
      return this.dial();
    }
  }

  private dial(): Promise<Socket> {
    return new Promise((resolve, reject) => {
      // a person's next touch must not wait for an answer to the one before it
      const s = connect({ host: this.host, port: this.port, noDelay: true });
      s.setTimeout(this.answerMs, () =>
        s.destroy(new DeviceError('TIMEOUT', `adb did not answer in ${this.answerMs} ms`)),
      );
      s.once('connect', () => resolve(s));
      s.once('error', reject);
    });
  }

  private send(socket: Socket, payload: string): Promise<void> {
    const body = Buffer.from(payload, 'utf8');
    const head = Buffer.from(body.length.toString(16).padStart(4, '0'), 'ascii');
    return new Promise((resolve, reject) =>
      socket.write(Buffer.concat([head, body]), (e) => (e ? reject(e) : resolve())),
    );
  }

  private async okay(reader: Reader, serial?: string): Promise<void> {
    const status = (await reader.exactly(4)).toString('ascii');
    if (status === 'OKAY') return;
    if (status !== 'FAIL')
      throw new DeviceError('INTERNAL', `adb answered ${JSON.stringify(status)}`);
    const len = parseInt((await reader.exactly(4)).toString('ascii'), 16);
    const message = (await reader.exactly(len)).toString('utf8');
    throw gone(message, serial ?? '');
  }
}

/** An adb failure as a typed error: a missing or offline device is DEVICE_GONE. */
function gone(message: string, what: string): DeviceError {
  const isGone = /device .*not found|offline|unauthorized|no devices|device still connecting/i.test(
    message,
  );
  return new DeviceError(
    isGone ? 'DEVICE_GONE' : 'INTERNAL',
    `adb: ${message.trim().slice(0, 300)}${what ? ` (${what})` : ''}`,
    isGone ? 'check that the device is connected and authorized (adb devices)' : undefined,
  );
}

export function parseDevices(text: string): AdbDevice[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      // a second phone of one name gets " (2)" in the middle of its serial
      const [, serial = '', words = ''] = /^(\S+(?: \(\d+\)\S*)?)\s*(.*)$/.exec(line) ?? [];
      const [state = '', ...rest] = words.split(/\s+/);
      const props: Record<string, string> = {};
      for (const kv of rest) {
        const i = kv.indexOf(':');
        if (i > 0) props[kv.slice(0, i)] = kv.slice(i + 1);
      }
      return { serial, state, props };
    });
}

function defaultAdb(): string {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (sdk) return `${sdk}/platform-tools/adb`;
  // where Android Studio puts the SDK on a Mac
  const studio = join(homedir(), 'Library/Android/sdk/platform-tools/adb');
  if (existsSync(studio)) return studio;
  return existsSync(downloadedAdb()) ? downloadedAdb() : 'adb';
}
