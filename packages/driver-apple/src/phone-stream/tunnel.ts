import { type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import { connectPort, muxRequest, parsePlist, plistXml, USBMUXD } from '../usbmux.js';
import { readBplist } from '../webinspector.js';
import { IpStack, type PacketStream } from './ipstack.js';

/**
 * A tunnel of this process's own to a phone over USB: lockdown, CoreDeviceProxy, then raw packets, with nothing of
 * Apple's kernel tunnel, whose discovery port takes one client and would throw `remoted` off it. The pair record is
 * read and never written, and pairing is never asked for: a refusal stops here, naming what a person must do.
 */

export type RefusalNeed = 'not-trusted' | 'locked' | 'not-connected';

/** What the phone refused, with no retry: a retry cannot change it, and it may raise a prompt. */
export class PhoneRefusal extends Error {
  constructor(
    readonly need: RefusalNeed,
    message: string,
  ) {
    super(message);
  }
}

const LOCKDOWN_PORT = 62_078;
const PROXY_SERVICE = 'com.apple.internal.devicecompute.CoreDeviceProxy';
const SPRINGBOARD_SERVICE = 'com.apple.springboardservices';
const ORIENTATION_REQUEST = { command: 'getInterfaceOrientation' };
const LABEL = 'appdyno';
const ANSWER_MS = 8_000;
const TUNNEL_MAGIC = 'CDTunnel';
const TUNNEL_MTU = 16_000;

const NEEDS_OF: Record<string, RefusalNeed> = {
  PasswordProtected: 'locked',
  DeviceLocked: 'locked',
  PairingDialogResponsePending: 'not-trusted',
  UserDeniedPairing: 'not-trusted',
  InvalidHostID: 'not-trusted',
  InvalidPairRecord: 'not-trusted',
};

export type PairRecord = { hostId: string; buid: string; cert: Buffer; key: Buffer };

const bytes = (v: unknown) =>
  Buffer.isBuffer(v) ? v : Buffer.from(typeof v === 'string' ? v : '', 'base64');

/** The record of this Mac with the phone. It stays in memory, and is never printed or saved. */
export async function readPairRecord(udid: string, path = USBMUXD): Promise<PairRecord> {
  const { reply, socket } = await muxRequest(
    { MessageType: 'ReadPairRecord', PairRecordID: udid },
    path,
  );
  socket.destroy();
  if (typeof reply.PairRecordData !== 'string') {
    throw new PhoneRefusal('not-trusted', 'this Mac has no pair record with the phone');
  }
  const data = Buffer.from(reply.PairRecordData, 'base64');
  const record = (
    data.toString('latin1', 0, 6) === 'bplist' ? readBplist(data) : parsePlist(data.toString())
  ) as Record<string, unknown>;
  return {
    hostId: String(record.HostID),
    buid: String(record.SystemBUID),
    cert: bytes(record.HostCertificate),
    key: bytes(record.HostPrivateKey),
  };
}

const withTls = (socket: Socket, record: PairRecord) =>
  new Promise<TLSSocket>((resolve, reject) => {
    const t = tlsConnect({
      socket,
      cert: record.cert,
      key: record.key,
      // the phone is known by the cable and the pair record: its certificate names no host, and it needs these old ciphers
      rejectUnauthorized: false,
      ciphers: 'DEFAULT:@SECLEVEL=0',
      minVersion: 'TLSv1',
    });
    t.once('secureConnect', () => {
      t.off('error', reject);
      resolve(t);
    });
    t.once('error', reject);
  });

/** Lockdown's framing: 32 bits of length, an XML plist, one answer per question. */
class Lockdown {
  private buffer: Buffer = Buffer.alloc(0);
  private waiting: ((m: Record<string, unknown>) => void) | undefined;
  private failed: ((e: Error) => void) | undefined;

  constructor(private readonly socket: Socket) {
    socket.on('data', (d: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, d]);
      this.pump();
    });
    socket.on('error', (e) => this.failed?.(e));
    socket.on('close', () => this.failed?.(new Error('the phone closed lockdown')));
    socket.resume();
  }

  private pump() {
    if (!this.waiting || this.buffer.length < 4) return;
    const n = this.buffer.readUInt32BE(0);
    if (this.buffer.length < 4 + n) return;
    const body = this.buffer.subarray(4, 4 + n);
    const m = (
      body.toString('latin1', 0, 6) === 'bplist' ? readBplist(body) : parsePlist(body.toString())
    ) as Record<string, unknown>;
    this.buffer = this.buffer.subarray(4 + n);
    this.waiting(m);
  }

  ask(message: Record<string, string>): Promise<Record<string, unknown>> {
    const body = Buffer.from(plistXml({ Label: LABEL, ...message }));
    const head = Buffer.alloc(4);
    head.writeUInt32BE(body.length);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('lockdown did not answer')), ANSWER_MS);
      this.failed = (e) => {
        clearTimeout(timer);
        reject(e);
      };
      this.waiting = (m) => {
        clearTimeout(timer);
        this.waiting = undefined;
        const error = m.Error;
        if (typeof error === 'string') {
          reject(new PhoneRefusal(NEEDS_OF[error] ?? 'not-trusted', `the phone refused: ${error}`));
        } else resolve(m);
      };
      this.socket.write(Buffer.concat([head, body]));
      this.pump();
    });
  }

  /** Hands the socket on, with nothing of this reader left on it. */
  release() {
    this.socket.removeAllListeners('data');
    this.socket.removeAllListeners('error');
    this.socket.removeAllListeners('close');
    this.socket.pause();
  }
}

/** The service's port on the phone: one session, one question, and the connection closed. */
async function startService(udid: string, record: PairRecord, name: string) {
  const { socket } = await connectPort(udid, LOCKDOWN_PORT);
  const plain = new Lockdown(socket);
  try {
    await plain.ask({ Request: 'QueryType' });
    const session = await plain.ask({
      Request: 'StartSession',
      ProtocolVersion: '2',
      HostID: record.hostId,
      SystemBUID: record.buid,
    });
    plain.release();
    const secure = session.EnableSessionSSL ? await withTls(socket, record) : socket;
    const asking = new Lockdown(secure);
    const service = await asking.ask({ Request: 'StartService', Service: name });
    secure.destroy();
    return { port: Number(service.Port), secure: service.EnableServiceSSL === true };
  } finally {
    socket.destroy();
  }
}

type TunnelInfo = { local: string; remote: string; rsdPort: number; mtu: number };

/** The tunnel's handshake: a magic, 16 bits of length and JSON, each way. */
export function readTunnelAnswer(buffer: Buffer): { info: TunnelInfo; rest: Buffer } | undefined {
  if (buffer.length < TUNNEL_MAGIC.length + 2) return undefined;
  if (buffer.toString('latin1', 0, TUNNEL_MAGIC.length) !== TUNNEL_MAGIC) {
    throw new Error('the phone answered with no tunnel');
  }
  const n = buffer.readUInt16BE(TUNNEL_MAGIC.length);
  const end = TUNNEL_MAGIC.length + 2 + n;
  if (buffer.length < end) return undefined;
  const j = JSON.parse(buffer.toString('utf8', TUNNEL_MAGIC.length + 2, end)) as {
    clientParameters: { address: string; mtu: number };
    serverAddress: string;
    serverRSDPort: number;
  };
  return {
    info: {
      local: j.clientParameters.address,
      remote: j.serverAddress,
      rsdPort: j.serverRSDPort,
      mtu: j.clientParameters.mtu,
    },
    rest: buffer.subarray(end),
  };
}

export function tunnelRequest(): Buffer {
  const body = Buffer.from(JSON.stringify({ type: 'clientHandshakeRequest', mtu: TUNNEL_MTU }));
  const head = Buffer.alloc(TUNNEL_MAGIC.length + 2);
  head.write(TUNNEL_MAGIC, 'latin1');
  head.writeUInt16BE(body.length, TUNNEL_MAGIC.length);
  return Buffer.concat([head, body]);
}

/** Asks SpringBoard how the app in front is drawn; a closed connection is a refusal the caller takes as none. */
export async function orientationReader(udid: string) {
  const record = await readPairRecord(udid);
  const service = await startService(udid, record, SPRINGBOARD_SERVICE);
  const { socket } = await connectPort(udid, service.port);
  return closingOnFailure(socket, async () => {
    const stream = service.secure ? await withTls(socket, record) : socket;
    const lockdown = new Lockdown(stream);
    return {
      read: async () => Number((await lockdown.ask(ORIENTATION_REQUEST)).interfaceOrientation),
      close: () => stream.destroy(),
    };
  });
}

/** What is done on a new connection: if it fails the connection goes with it, as an open socket holds a process for ever. */
export async function closingOnFailure<T>(socket: { destroy(): void }, use: () => Promise<T>) {
  try {
    return await use();
  } catch (e) {
    socket.destroy();
    throw e;
  }
}

/** The answer to `tunnelRequest`, and what came after it. A phone that accepts and never answers gets `ms`. */
export function tunnelAnswer(stream: Duplex, ms = ANSWER_MS) {
  return new Promise<NonNullable<ReturnType<typeof readTunnelAnswer>>>((resolve, reject) => {
    let held: Buffer = Buffer.alloc(0);
    const stop = (done: () => void) => {
      clearTimeout(timer);
      stream.off('data', onData);
      stream.off('close', onClose);
      done();
    };
    const timer = setTimeout(() => stop(() => reject(new Error('the tunnel did not answer'))), ms);
    const onData = (d: Buffer) => {
      held = Buffer.concat([held, d]);
      try {
        const answer = readTunnelAnswer(held);
        if (answer) stop(() => resolve(answer));
      } catch (e) {
        stop(() => reject(e as Error));
      }
    };
    const onClose = () => stop(() => reject(new Error('the tunnel closed at its start')));
    stream.on('data', onData);
    stream.once('close', onClose);
    stream.resume();
  });
}

export type Tunnel = { stack: IpStack; rsdPort: number };

export async function openTunnel(udid: string): Promise<Tunnel> {
  const record = await readPairRecord(udid);
  const service = await startService(udid, record, PROXY_SERVICE);
  const { socket } = await connectPort(udid, service.port);
  return closingOnFailure(socket, async () => {
    const stream = service.secure ? await withTls(socket, record) : socket;
    stream.write(tunnelRequest());
    const { info, rest } = await tunnelAnswer(stream);
    const stack = new IpStack(stream as PacketStream, info);
    if (rest.length) stack.feed(rest);
    return { stack, rsdPort: info.rsdPort };
  });
}
