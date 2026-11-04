import type { TcpConnection } from './ipstack.js';
import {
  decodeObject,
  encodeWrapper,
  WRAPPER_HEADER,
  wrapperBodyLength,
  type DecodedDict,
  type XpcValue,
} from './xpc-codec.js';

const PREFACE = 'PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n';
const DATA = 0;
const HEADERS = 1;
const SETTINGS = 4;
const PING = 6;
const GOAWAY = 7;
const WINDOW_UPDATE = 8;
const ACK = 1;
const END_HEADERS = 4;
const MAX_FRAME = 16_384;
const ROOT = 1;
const REPLY = 3;
/** What is given back of the flow window at a time: a screenshot of many megabytes must not stall. */
const WINDOW_STEP = 256 * 1024;
const WINDOW_START = 1_048_576;

const FLAG_ALWAYS = 0x1;
const FLAG_DATA = 0x100;
const FLAG_WANTS_REPLY = 0x10000;
const FLAG_INIT = 0x400000;
const FLAG_SETUP = 0x200;

function frame(type: number, flags: number, stream: number, payload: Buffer = Buffer.alloc(0)) {
  const h = Buffer.alloc(9);
  h.writeUIntBE(payload.length, 0, 3);
  h[3] = type;
  h[4] = flags;
  h.writeUInt32BE(stream, 5);
  return Buffer.concat([h, payload]);
}

const windowUpdate = (stream: number, n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return frame(WINDOW_UPDATE, 0, stream, b);
};

/** One service's connection: HTTP/2's frames with two channels of XPC in them. */
export class RemoteXpc {
  private inbound: Buffer = Buffer.alloc(0);
  private readonly channels = new Map<number, Buffer>([
    [ROOT, Buffer.alloc(0)],
    [REPLY, Buffer.alloc(0)],
  ]);
  private readonly queue: DecodedDict[] = [];
  private waiting: {
    resolve: (m: DecodedDict) => void;
    reject: (e: Error) => void;
    timer: NodeJS.Timeout;
  }[] = [];
  private unacked = 0;
  private ended: Error | undefined;

  private constructor(private readonly connection: TcpConnection) {
    connection.onData((d) => this.feed(d));
    connection.onClose((why) => this.end(new Error(why)));
  }

  /** Over a connection that is open, ready for messages at once. */
  static start(connection: TcpConnection): RemoteXpc {
    const x = new RemoteXpc(connection);
    const settings = Buffer.alloc(12);
    settings.writeUInt16BE(3, 0);
    settings.writeUInt32BE(100, 2);
    settings.writeUInt16BE(4, 6);
    settings.writeUInt32BE(WINDOW_START, 8);
    connection.write(
      Buffer.concat([
        Buffer.from(PREFACE, 'latin1'),
        frame(SETTINGS, 0, 0, settings),
        windowUpdate(0, 983_041),
        frame(HEADERS, END_HEADERS, ROOT),
        frame(DATA, 0, ROOT, encodeWrapper(FLAG_ALWAYS, {})),
        frame(HEADERS, END_HEADERS, REPLY),
        frame(DATA, 0, REPLY, encodeWrapper(FLAG_INIT | FLAG_ALWAYS)),
        frame(DATA, 0, ROOT, encodeWrapper(FLAG_SETUP | FLAG_ALWAYS)),
      ]),
    );
    return x;
  }

  private feed(d: Buffer) {
    this.inbound = this.inbound.length ? Buffer.concat([this.inbound, d]) : d;
    while (this.inbound.length >= 9) {
      const n = this.inbound.readUIntBE(0, 3);
      if (this.inbound.length < 9 + n) return;
      const type = this.inbound[3]!;
      const flags = this.inbound[4]!;
      const stream = this.inbound.readUInt32BE(5) & 0x7fffffff;
      const payload = this.inbound.subarray(9, 9 + n);
      this.inbound = this.inbound.subarray(9 + n);
      if (type === SETTINGS && !(flags & ACK)) this.connection.write(frame(SETTINGS, ACK, 0));
      else if (type === PING && !(flags & ACK)) this.connection.write(frame(PING, ACK, 0, payload));
      else if (type === GOAWAY) this.end(new Error('the service went away'));
      else if (type === DATA) this.onChannel(stream, payload);
    }
  }

  private onChannel(stream: number, payload: Buffer) {
    this.unacked += payload.length;
    if (this.unacked >= WINDOW_STEP) {
      this.connection.write(
        Buffer.concat([windowUpdate(0, this.unacked), windowUpdate(stream, this.unacked)]),
      );
      this.unacked = 0;
    }
    const held = this.channels.get(stream);
    if (!held) return;
    let b: Buffer = held.length ? Buffer.concat([held, payload]) : payload;
    while (b.length >= WRAPPER_HEADER) {
      const n = wrapperBodyLength(b);
      if (b.length < WRAPPER_HEADER + n) break;
      const message = decodeObject(b.subarray(WRAPPER_HEADER, WRAPPER_HEADER + n));
      b = b.subarray(WRAPPER_HEADER + n);
      if (message && typeof message === 'object' && !Buffer.isBuffer(message)) {
        if (Object.keys(message).length) this.deliver(message as DecodedDict);
      }
    }
    this.channels.set(stream, b);
  }

  private deliver(m: DecodedDict) {
    const w = this.waiting.shift();
    if (!w) {
      this.queue.push(m);
      return;
    }
    clearTimeout(w.timer);
    w.resolve(m);
  }

  private end(why: Error) {
    this.ended ??= why;
    for (const w of this.waiting.splice(0)) {
      clearTimeout(w.timer);
      w.reject(why);
    }
  }

  /** With a reply to read by `next`, or none. Long messages go in frames of the size HTTP/2 allows. */
  send(v: XpcValue, wantsReply: boolean) {
    const body = encodeWrapper(FLAG_DATA | FLAG_ALWAYS | (wantsReply ? FLAG_WANTS_REPLY : 0), v);
    for (let o = 0; o < body.length; o += MAX_FRAME) {
      this.connection.write(frame(DATA, 0, ROOT, body.subarray(o, o + MAX_FRAME)));
    }
  }

  next(timeoutMs = 8_000): Promise<DecodedDict> {
    const ready = this.queue.shift();
    if (ready) return Promise.resolve(ready);
    if (this.ended) return Promise.reject(this.ended);
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiting = this.waiting.filter((w) => w !== waiter);
          reject(new Error(`no reply in ${timeoutMs} ms`));
        }, timeoutMs),
      };
      this.waiting.push(waiter);
    });
  }

  close() {
    this.connection.close();
    this.end(new Error('closed'));
  }
}
