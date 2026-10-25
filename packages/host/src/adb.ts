import { spawn } from 'node:child_process';
import { connect, type Socket } from 'node:net';
import { DeviceError } from '@appdyno/protocol';

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
};

const SERIAL = /^[\w.:-]{1,64}$/;

export function assertSerial(serial: string): string {
  if (!SERIAL.test(serial))
    throw new DeviceError('INVALID_ARGUMENT', `not a device serial: ${serial}`);
  return serial;
}

/** One argument for the device's `sh -c`: single-quoted, quotes inside escaped. */
export const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

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
  private readonly port: number;
  readonly bin: string;
  private started: Promise<void> | undefined;

  constructor(opts: AdbOptions = {}) {
    this.host = opts.host ?? '127.0.0.1';
    this.port = opts.port ?? 5037;
    this.bin = opts.bin ?? process.env.ADB ?? defaultAdb();
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
    try {
      await this.send(socket, service);
      await this.okay(reader, serial);
    } catch (e) {
      socket.destroy();
      throw e;
    }
    return { socket, rest: reader.detach() };
  }

  /**
   * Runs `command` through the device's shell and returns its output (stdout and whatever the command
   * redirects into it). A non-zero exit is not seen here: commands that matter print a marker.
   */
  async exec(serial: string, command: string, opts: { timeoutMs?: number } = {}): Promise<string> {
    const { socket, rest } = await this.open(serial, `exec:${command}`);
    return new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = rest.length ? [rest] : [];
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new DeviceError('TIMEOUT', `adb command timed out: ${command.slice(0, 80)}`));
      }, opts.timeoutMs ?? 30_000);
      socket.on('data', (b: Buffer) => chunks.push(b));
      socket.resume();
      socket.on('close', () => {
        clearTimeout(timer);
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
      socket.on('error', () => undefined);
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

  /** Runs the adb binary (push, install). */
  run(args: string[], timeoutMs = 120_000): Promise<string> {
    return new Promise((resolve, reject) => {
      const p = spawn(this.bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      p.stdout.on('data', (b) => (out += b));
      p.stderr.on('data', (b) => (out += b));
      const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
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
    try {
      await this.send(socket, service);
      await this.okay(reader, serial);
    } catch (e) {
      socket.destroy();
      throw e;
    }
    return { socket, reader };
  }

  private async connectServer(): Promise<Socket> {
    try {
      return await this.dial();
    } catch {
      this.started ??= this.run(['start-server'], 30_000).then(() => undefined);
      await this.started;
      return this.dial();
    }
  }

  private dial(): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const s = connect({ host: this.host, port: this.port });
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
      const [serial = '', state = '', ...rest] = line.split(/\s+/);
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
  return 'adb';
}
