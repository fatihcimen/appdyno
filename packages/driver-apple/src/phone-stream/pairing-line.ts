import { type Socket } from 'node:net';
import { must } from '@appdyno/core';
import type { RemoteXpc } from './remotexpc.js';
import { XpcInt64, type XpcValue } from './xpc-codec.js';

/**
 * What carries a pairing's messages. By the network they are framed JSON; by the cable XPC, inside the tunnel, which is
 * the one way a phone agrees to make a new pairing. Messages are written as XPC has them: bytes and 64-bit numbers.
 */
export type Message = Record<string, unknown>;

export type PairingLine = {
  send(envelope: Message): void;
  next(ms: number): Promise<Message>;
  close(): void;
};

const MAGIC = 'RPPairing';
const HEAD = MAGIC.length + 2;
const ENVELOPE = 'RemotePairing.ControlChannelMessageEnvelope';

export const pairingFrame = (body: unknown) => {
  const json = Buffer.from(
    JSON.stringify(body, function plain(this: Message, key: string, value: unknown) {
      const raw = this[key];
      if (Buffer.isBuffer(raw)) return raw.toString('base64');
      if (raw instanceof XpcInt64) return raw.value;
      return typeof raw === 'bigint' ? Number(raw) : value;
    }),
  );
  const head = Buffer.alloc(HEAD);
  head.write(MAGIC, 'latin1');
  head.writeUInt16BE(json.length, MAGIC.length);
  return Buffer.concat([head, json]);
};

/** Framed messages on a phone's control connection on the network. */
export class FramedLine implements PairingLine {
  private held: Buffer = Buffer.alloc(0);
  private waiting: ((m: Message) => void) | undefined;
  private failed: ((e: Error) => void) | undefined;
  private readonly arrived: Message[] = [];

  constructor(private readonly socket: Socket) {
    socket.on('data', (d: Buffer) => this.onData(d));
    socket.on('error', (e) => this.failed?.(e));
    socket.on('close', () => this.failed?.(new Error('the phone closed the pairing connection')));
  }

  private onData(d: Buffer) {
    this.held = Buffer.concat([this.held, d]);
    try {
      while (this.held.length >= HEAD) {
        if (this.held.toString('latin1', 0, MAGIC.length) !== MAGIC) {
          throw new Error('the phone answered with something else');
        }
        const end = HEAD + this.held.readUInt16BE(MAGIC.length);
        if (this.held.length < end) break;
        this.arrived.push(JSON.parse(this.held.toString('utf8', HEAD, end)) as Message);
        this.held = this.held.subarray(end);
      }
    } catch (e) {
      // what is on the network is anyone's: bad words end this connection and nothing else
      this.failed?.(e as Error);
      this.socket.destroy();
      return;
    }
    if (this.waiting && this.arrived.length) this.waiting(must(this.arrived.shift(), 'a message'));
  }

  next(ms: number): Promise<Message> {
    const ready = this.arrived.shift();
    if (ready) return Promise.resolve(ready);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the phone did not answer')), ms);
      this.failed = (e) => {
        clearTimeout(timer);
        reject(e);
      };
      this.waiting = (m) => {
        clearTimeout(timer);
        this.waiting = undefined;
        resolve(m);
      };
    });
  }

  send(envelope: Message) {
    this.socket.write(pairingFrame(envelope));
  }

  close() {
    this.socket.destroy();
  }
}

/** The same messages through the service a phone offers inside a cable's tunnel. */
export class XpcLine implements PairingLine {
  constructor(private readonly xpc: RemoteXpc) {}

  send(envelope: Message) {
    this.xpc.send({ mangledTypeName: ENVELOPE, value: envelope as XpcValue }, true);
  }

  async next(ms: number): Promise<Message> {
    for (;;) {
      const { value } = await this.xpc.next(ms);
      if (value && typeof value === 'object') return value as Message;
    }
  }

  close() {
    this.xpc.close();
  }
}
