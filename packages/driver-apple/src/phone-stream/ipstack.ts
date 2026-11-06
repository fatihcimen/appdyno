/**
 * IPv6, TCP and UDP in this process, over a stream that carries raw packets: RFC 8200, RFC 9293 and RFC 768. No
 * socket of this Mac opens for any of it, so nothing listens on any network. TCP carries only requests to a
 * phone's services, so it keeps to what those need; video is UDP, and its path allocates as little as it can.
 */
const IPV6_HEADER = 40;
const TCP_HEADER = 20;
const UDP_HEADER = 8;
const NEXT_TCP = 6;
const NEXT_UDP = 17;
const FIN = 0x01;
const SYN = 0x02;
const RST = 0x04;
const PSH = 0x08;
const ACK = 0x10;
/** The same value is sent always: with no scale option, as a whole window. */
const OUR_WINDOW = 65_535;
const FIRST_LOCAL_PORT = 50_000;
const CONNECT_MS = 6_000;
const FIRST_RTO_MS = 250;
const MAX_RTO_MS = 4_000;
const MAX_RETRIES = 8;
/** Segments that came early are held to this many, and past it dropped for the sender to send again. */
const MAX_EARLY = 64;
const CLOSE_LINGER_MS = 1_000;

/** Whether `a` comes before `b` in a sequence space that wraps at 32 bits. */
const before = (a: number, b: number) => ((a - b) | 0) < 0;

function checksum(parts: Buffer[]): number {
  let s = 0;
  for (const b of parts) {
    let i = 0;
    for (; i + 1 < b.length; i += 2) s += (b[i]! << 8) | b[i + 1]!;
    if (i < b.length) s += b[i]! << 8;
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

export interface PacketStream {
  write(b: Buffer): unknown;
  on(event: 'data', listener: (d: Buffer) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  on(event: 'error', listener: (e: Error) => void): unknown;
  destroy(): unknown;
}

type Sent = { seq: number; end: number; flags: number; data: Buffer; syn: boolean };

export class TcpConnection {
  private seq = (Math.random() * 0x7fffffff) | 0;
  private rcv = 0;
  private established = false;
  private closed = false;
  private peerWindow = OUR_WINDOW;
  private readonly waiting: Buffer[] = [];
  private readonly unacked: Sent[] = [];
  private readonly early = new Map<number, Buffer>();
  private timer: NodeJS.Timeout | undefined;
  private rto = FIRST_RTO_MS;
  private retries = 0;
  private data: ((d: Buffer) => void) | undefined;
  private closes: ((why: string) => void)[] = [];
  private connected: { resolve: () => void; reject: (e: Error) => void } | undefined;

  constructor(
    private readonly stack: IpStack,
    readonly localPort: number,
    private readonly remotePort: number,
  ) {}

  /** Resolves with the connection open; what refused it otherwise. */
  connect(timeoutMs = CONNECT_MS): Promise<void> {
    return new Promise((resolve, reject) => {
      const giveUp = setTimeout(
        () => reject(new Error(`no answer on port ${this.remotePort}`)),
        timeoutMs,
      );
      this.connected = {
        resolve: () => {
          clearTimeout(giveUp);
          resolve();
        },
        reject: (e) => {
          clearTimeout(giveUp);
          reject(e);
        },
      };
      this.transmit(SYN, Buffer.alloc(0));
    });
  }

  onData(listener: (d: Buffer) => void) {
    this.data = listener;
  }

  onClose(listener: (why: string) => void) {
    this.closes.push(listener);
  }

  private segment(flags: number, seq: number, data: Buffer, syn: boolean) {
    // the most this stack takes in a segment, as an option on the first
    const option = syn
      ? Buffer.from([2, 4, (this.stack.mss >> 8) & 0xff, this.stack.mss & 0xff])
      : undefined;
    const size = TCP_HEADER + (option?.length ?? 0);
    const h = Buffer.alloc(size + data.length);
    h.writeUInt16BE(this.localPort, 0);
    h.writeUInt16BE(this.remotePort, 2);
    h.writeUInt32BE(seq >>> 0, 4);
    h.writeUInt32BE(this.rcv >>> 0, 8);
    h[12] = (size / 4) << 4;
    h[13] = flags;
    h.writeUInt16BE(OUR_WINDOW, 14);
    option?.copy(h, TCP_HEADER);
    data.copy(h, size);
    this.stack.send(NEXT_TCP, h);
  }

  /** Sent and held until acknowledged; what takes sequence space is what can be lost. */
  private transmit(flags: number, data: Buffer) {
    const syn = (flags & SYN) !== 0;
    const span = data.length + (syn || flags & FIN ? 1 : 0);
    const sent: Sent = { seq: this.seq, end: (this.seq + span) | 0, flags, data, syn };
    this.seq = sent.end;
    this.unacked.push(sent);
    this.segment(flags | (syn ? 0 : ACK), sent.seq, data, syn);
    this.arm();
  }

  private arm() {
    if (this.timer || !this.unacked.length) return;
    this.timer = setTimeout(() => this.onTimeout(), this.rto);
    this.timer.unref();
  }

  private onTimeout() {
    this.timer = undefined;
    const first = this.unacked[0];
    if (!first) return;
    if (++this.retries > MAX_RETRIES) {
      this.end('the phone stopped answering');
      return;
    }
    this.rto = Math.min(this.rto * 2, MAX_RTO_MS);
    this.segment(first.flags | (first.syn ? 0 : ACK), first.seq, first.data, first.syn);
    this.arm();
  }

  private flush() {
    while (this.waiting.length && !this.closed) {
      const inFlight = this.unacked.reduce((n, s) => n + s.data.length, 0);
      const room = this.peerWindow - inFlight;
      if (room <= 0) return;
      const head = this.waiting[0]!;
      const take = Math.min(head.length, this.stack.mss, room);
      this.transmit(PSH, head.subarray(0, take));
      if (take === head.length) this.waiting.shift();
      else this.waiting[0] = head.subarray(take);
    }
  }

  write(d: Buffer) {
    if (this.closed || !d.length) return;
    this.waiting.push(d);
    this.flush();
  }

  private acknowledged(ack: number) {
    let moved = false;
    while (this.unacked[0] && !before(ack, this.unacked[0].end)) {
      this.unacked.shift();
      moved = true;
    }
    if (!moved) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.rto = FIRST_RTO_MS;
    this.retries = 0;
    this.arm();
  }

  /**
   * What its reader cannot read ends this connection, and only this. Each read here is a protocol's own, and a throw
   * would go on to the tunnel's stream, where nothing is left to catch it and the whole process ends.
   */
  private hand(data: Buffer) {
    try {
      this.data?.(data);
    } catch (e) {
      this.close(`what the phone sent cannot be read: ${(e as Error).message}`);
    }
  }

  private deliver(seq: number, data: Buffer) {
    if (seq !== this.rcv) {
      if (!before(seq, this.rcv) && this.early.size < MAX_EARLY) this.early.set(seq, data);
      return;
    }
    this.rcv = (this.rcv + data.length) | 0;
    this.hand(data);
    for (let next = this.early.get(this.rcv); next; next = this.early.get(this.rcv)) {
      if (this.closed) return;
      const at = this.rcv;
      this.early.delete(at);
      this.rcv = (this.rcv + next.length) | 0;
      this.hand(next);
    }
  }

  onPacket(p: Buffer) {
    const flags = p[13]!;
    const seq = p.readInt32BE(4);
    if (flags & RST) {
      const refused = new Error(`port ${this.remotePort} refused the connection`);
      this.connected?.reject(refused);
      this.connected = undefined;
      this.end(refused.message);
      return;
    }
    this.peerWindow = p.readUInt16BE(14);
    if (flags & ACK) this.acknowledged(p.readInt32BE(8));
    if (flags & SYN) {
      this.rcv = (seq + 1) | 0;
      this.segment(ACK, this.seq, Buffer.alloc(0), false);
      if (!this.established) {
        this.established = true;
        this.connected?.resolve();
        this.connected = undefined;
      }
      return;
    }
    const data = p.subarray((p[12]! >> 4) * 4);
    if (data.length) this.deliver(seq, Buffer.from(data));
    const finAt = (seq + data.length) | 0;
    if (flags & FIN && finAt === this.rcv) {
      this.rcv = (this.rcv + 1) | 0;
      this.segment(ACK, this.seq, Buffer.alloc(0), false);
      this.end('the phone closed the connection');
      return;
    }
    if (data.length || flags & FIN) this.segment(ACK, this.seq, Buffer.alloc(0), false);
    this.flush();
  }

  /** A goodbye to the phone, which is not waited for long. */
  close(why = 'closed') {
    if (this.closed) return;
    if (this.established) this.segment(FIN | ACK, this.seq, Buffer.alloc(0), false);
    this.end(why, CLOSE_LINGER_MS);
  }

  end(why: string, lingerMs = 0) {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.waiting.length = 0;
    this.unacked.length = 0;
    this.connected?.reject(new Error(why));
    this.connected = undefined;
    this.stack.forget(this, lingerMs);
    for (const c of this.closes.splice(0)) c(why);
  }
}

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
