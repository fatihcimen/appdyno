/**
 * TCP as the stack in `ipstack.ts` keeps it, RFC 9293: only what requests to a phone's services need, as video goes
 * by UDP.
 */
import type { IpStack } from './ipstack.js';

export const TCP_HEADER = 20;
/** TCP's number in an IPv6 header's next header. */
export const NEXT_TCP = 6;
const FIN = 0x01;
const SYN = 0x02;
const RST = 0x04;
const PSH = 0x08;
const ACK = 0x10;
/** The same value is sent always: with no scale option, as a whole window. */
const OUR_WINDOW = 65_535;
const CONNECT_MS = 6_000;
const FIRST_RTO_MS = 250;
const MAX_RTO_MS = 4_000;
const MAX_RETRIES = 8;
/** Segments that came early are held to this many, and past it dropped for the sender to send again. */
const MAX_EARLY = 64;
const CLOSE_LINGER_MS = 1_000;

/** Whether `a` comes before `b` in a sequence space that wraps at 32 bits. */
const before = (a: number, b: number) => ((a - b) | 0) < 0;

type Sent = { seq: number; end: number; flags: number; data: Buffer; syn: boolean };

/** The phone said no on a port: what carried that word works, unlike a port that says nothing. */
export class PortRefused extends Error {}

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
    for (let head = this.waiting[0]; head && !this.closed; head = this.waiting[0]) {
      const inFlight = this.unacked.reduce((n, s) => n + s.data.length, 0);
      const room = this.peerWindow - inFlight;
      if (room <= 0) return;
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
    const flags = p.readUInt8(13);
    const seq = p.readInt32BE(4);
    if (flags & RST) {
      const refused = new PortRefused(`port ${this.remotePort} refused the connection`);
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
    const data = p.subarray((p.readUInt8(12) >> 4) * 4);
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
