/**
 * IPv6, TCP and UDP in this process, over a stream that carries raw packets: RFC 8200, RFC 9293 and RFC 768. No
 * socket of this Mac opens for any of it, so nothing listens on any network. TCP carries only requests to a
 * phone's services, so it keeps to what those need; video is UDP, and its path allocates as little as it can.
 */
import { NEXT_TCP, TCP_HEADER, TcpConnection } from './tcp.js';

export { PortRefused, TcpConnection } from './tcp.js';

const IPV6_HEADER = 40;
const UDP_HEADER = 8;
const NEXT_UDP = 17;
const FIRST_LOCAL_PORT = 50_000;

function checksum(parts: Buffer[]): number {
  let s = 0;
  for (const b of parts) {
    let i = 0;
    for (; i + 1 < b.length; i += 2) s += b.readUInt16BE(i);
    if (i < b.length) s += b.readUInt8(i) << 8;
  }
  while (s > 0xffff) s = (s & 0xffff) + (s >>> 16);
  return ~s & 0xffff;
}

/** An address's 16 bytes, from its text with or without `::`. */
export function ipv6Bytes(text: string): Buffer {
  const [left, right] = text.split('::') as [string, string | undefined];
  const words = (x: string | undefined) => (x ? x.split(':').map((p) => parseInt(p, 16)) : []);
  const head = words(left);
  const tail = words(right);
  const all =
    right === undefined
      ? head
      : [...head, ...Array<number>(8 - head.length - tail.length).fill(0), ...tail];
  const b = Buffer.alloc(16);
  all.forEach((v, i) => b.writeUInt16BE(v, i * 2));
  return b;
}

export type PacketStream = {
  write(b: Buffer): unknown;
  on(event: 'data', listener: (d: Buffer) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  on(event: 'error', listener: (e: Error) => void): unknown;
  destroy(): unknown;
};

export class UdpSocket {
  message: ((payload: Buffer, fromPort: number) => void) | undefined;

  constructor(
    private readonly stack: IpStack,
    readonly localPort: number,
  ) {}

  send(payload: Buffer, port: number) {
    const b = Buffer.alloc(UDP_HEADER + payload.length);
    b.writeUInt16BE(this.localPort, 0);
    b.writeUInt16BE(port, 2);
    b.writeUInt16BE(b.length, 4);
    payload.copy(b, UDP_HEADER);
    this.stack.send(NEXT_UDP, b);
  }

  close() {
    this.stack.forgetUdp(this.localPort);
  }
}

/** All of a tunnel's traffic, by port. Ends when its stream does. */
export class IpStack {
  readonly mss: number;
  readonly localAddress: string;
  readonly remoteAddress: string;
  private readonly local: Buffer;
  private readonly remote: Buffer;
  private readonly tcp = new Map<number, TcpConnection>();
  private readonly udp = new Map<number, UdpSocket>();
  private nextPort = FIRST_LOCAL_PORT;
  private rest: Buffer | undefined;
  private ended = false;
  private heard = Date.now();
  private readonly ends: ((why: string) => void)[] = [];

  constructor(
    private readonly stream: PacketStream,
    addresses: { local: string; remote: string; mtu: number },
  ) {
    this.localAddress = addresses.local;
    this.remoteAddress = addresses.remote;
    this.local = ipv6Bytes(addresses.local);
    this.remote = ipv6Bytes(addresses.remote);
    this.mss = addresses.mtu - IPV6_HEADER - TCP_HEADER;
    stream.on('data', (d) => this.feed(d));
    stream.on('close', () => this.onEnd('the tunnel ended'));
    stream.on('error', (e) => this.onEnd(`the tunnel failed: ${e.message}`));
  }

  private port() {
    do {
      this.nextPort = this.nextPort >= 65_000 ? FIRST_LOCAL_PORT : this.nextPort + 1;
    } while (this.tcp.has(this.nextPort) || this.udp.has(this.nextPort));
    return this.nextPort;
  }

  onEnded(listener: (why: string) => void) {
    this.ends.push(listener);
  }

  /** A network that went leaves no end to read, only silence: this ends the stack past `ms` of it. */
  endOnSilence(ms: number, every = ms / 4) {
    const timer = setInterval(() => {
      if (Date.now() - this.heard > ms) this.onEnd(`nothing came for ${ms / 1000} s`);
    }, every);
    timer.unref();
    this.onEnded(() => clearInterval(timer));
  }

  /** A connection to a port on the phone, open once this resolves. */
  async connect(port: number): Promise<TcpConnection> {
    const c = new TcpConnection(this, this.port(), port);
    this.tcp.set(c.localPort, c);
    await c.connect();
    return c;
  }

  createUdp(): UdpSocket {
    const u = new UdpSocket(this, this.port());
    this.udp.set(u.localPort, u);
    return u;
  }

  forget(c: TcpConnection, lingerMs: number) {
    // a port stays taken while the phone may yet answer on it
    if (lingerMs) setTimeout(() => this.tcp.delete(c.localPort), lingerMs).unref();
    else this.tcp.delete(c.localPort);
  }

  forgetUdp(port: number) {
    this.udp.delete(port);
  }

  send(next: number, payload: Buffer) {
    if (this.ended) return;
    const pseudo = Buffer.alloc(8);
    pseudo.writeUInt32BE(payload.length, 0);
    pseudo[7] = next;
    const at = next === NEXT_TCP ? 16 : 6;
    payload.writeUInt16BE(0, at);
    let sum = checksum([this.local, this.remote, pseudo, payload]);
    if (next === NEXT_UDP && sum === 0) sum = 0xffff;
    payload.writeUInt16BE(sum, at);
    const h = Buffer.alloc(IPV6_HEADER);
    h[0] = 0x60;
    h.writeUInt16BE(payload.length, 4);
    h[6] = next;
    h[7] = 64;
    this.local.copy(h, 8);
    this.remote.copy(h, 24);
    this.stream.write(Buffer.concat([h, payload]));
  }

  feed(chunk: Buffer) {
    this.heard = Date.now();
    const b = this.rest ? Buffer.concat([this.rest, chunk]) : chunk;
    let o = 0;
    while (b.length - o >= IPV6_HEADER) {
      const n = b.readUInt16BE(o + 4);
      if (b.length - o < IPV6_HEADER + n) break;
      const next = b[o + 6];
      const p = b.subarray(o + IPV6_HEADER, o + IPV6_HEADER + n);
      o += IPV6_HEADER + n;
      if (next === NEXT_UDP && p.length >= UDP_HEADER) {
        this.udp.get(p.readUInt16BE(2))?.message?.(p.subarray(UDP_HEADER), p.readUInt16BE(0));
      } else if (next === NEXT_TCP && p.length >= TCP_HEADER) {
        this.tcp.get(p.readUInt16BE(2))?.onPacket(p);
      }
    }
    this.rest = o < b.length ? b.subarray(o) : undefined;
  }

  private onEnd(why: string) {
    if (this.ended) return;
    this.ended = true;
    for (const c of [...this.tcp.values()]) c.end(why);
    for (const e of this.ends.splice(0)) e(why);
  }

  close() {
    this.onEnd('closed');
    this.stream.destroy();
  }
}
