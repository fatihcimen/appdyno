import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IpStack, ipv6Bytes, type PacketStream } from '../ipstack.js';
import { RemoteXpc } from '../remotexpc.js';
import { encodeWrapper, WRAPPER_HEADER } from '../xpc-codec.js';

const LOCAL = 'fd81:fee2:fd54::2';
const REMOTE = 'fd81:fee2:fd54::1';
const MTU = 1_000;
const SYN = 2;
const ACK = 0x10;
const FIN = 1;
const RST = 4;

/** The phone's end of a tunnel: what this stack sent, parsed, and packets written as the phone would. */
function peer() {
  const sent: Buffer[] = [];
  const handlers: Record<string, (x: never) => void> = {};
  const stream = {
    write: (b: Buffer) => sent.push(b),
    on: (event: string, listener: (x: never) => void) => {
      handlers[event] = listener;
    },
    destroy: vi.fn(),
  } as unknown as PacketStream & { destroy: ReturnType<typeof vi.fn> };
  const stack = new IpStack(stream, { local: LOCAL, remote: REMOTE, mtu: MTU });
  const tcp = () =>
    sent
      .filter((b) => b[6] === 6)
      .map((b) => {
        const p = b.subarray(40);
        return {
          src: p.readUInt16BE(0),
          seq: p.readInt32BE(4),
          ack: p.readInt32BE(8),
          flags: p[13]!,
          data: p.subarray((p[12]! >> 4) * 4),
        };
      });
  const packet = (next: number, payload: Buffer) => {
    const h = Buffer.alloc(40);
    h[0] = 0x60;
    h.writeUInt16BE(payload.length, 4);
    h[6] = next;
    return Buffer.concat([h, payload]);
  };
  const segment = (
    to: number,
    from: number,
    o: { seq: number; ack?: number; flags: number; data?: Buffer; window?: number },
  ) => {
    const h = Buffer.alloc(20);
    h.writeUInt16BE(from, 0);
    h.writeUInt16BE(to, 2);
    h.writeInt32BE(o.seq, 4);
    h.writeInt32BE(o.ack ?? 0, 8);
    h[12] = 5 << 4;
    h[13] = o.flags;
    h.writeUInt16BE(o.window ?? 65_535, 14);
    return packet(6, Buffer.concat([h, o.data ?? Buffer.alloc(0)]));
  };
  return { stack, sent, tcp, packet, segment, stream, handlers };
}

/** A connection that is up, and the numbers the phone goes on from. */
async function connected() {
  const p = peer();
  const opening = p.stack.connect(1234);
  const syn = p.tcp()[0]!;
  p.stack.feed(p.segment(syn.src, 1234, { seq: 1000, ack: syn.seq + 1, flags: SYN | ACK }));
  const c = await opening;
  p.sent.length = 0;
  return { ...p, c, port: syn.src, ours: syn.seq + 1, theirs: 1001 };
}

describe('TCP in this process', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it('opens with what it can take, and answers the phone', async () => {
    const p = peer();
    const opening = p.stack.connect(1234);
    const syn = p.tcp()[0]!;
    expect(syn.flags).toBe(SYN);
    // its first segment names the size: the MTU less both headers
    expect(p.sent[0]!.readUInt16BE(40 + 22)).toBe(MTU - 60);
    p.stack.feed(p.segment(syn.src, 1234, { seq: 1000, ack: syn.seq + 1, flags: SYN | ACK }));
    await opening;
    expect(p.tcp().at(-1)).toMatchObject({ flags: ACK, ack: 1001, seq: syn.seq + 1 });
  });

  it('says a port refused, or that none answered', async () => {
    const p = peer();
    const refused = p.stack.connect(1234);
    p.stack.feed(p.segment(p.tcp()[0]!.src, 1234, { seq: 0, flags: RST }));
    await expect(refused).rejects.toThrow('port 1234 refused');
    const silent = p.stack.connect(4321);
    const told = expect(silent).rejects.toThrow('no answer on port 4321');
    await vi.advanceTimersByTimeAsync(6_000);
    await told;
  });

  it('cuts what it writes to the size of a segment', async () => {
    const { c, tcp } = await connected();
    c.write(Buffer.alloc(MTU * 2 + 5, 7));
    const data = tcp().map((s) => s.data.length);
    expect(data).toEqual([MTU - 60, MTU - 60, 125]);
    expect(tcp()[1]!.seq - tcp()[0]!.seq).toBe(MTU - 60);
  });

  it('sends again what is not acknowledged, later each time, and stops once it is', async () => {
    const { c, tcp, stack, segment, port, ours, theirs, sent } = await connected();
    c.write(Buffer.from('hello'));
    expect(tcp()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(249);
    expect(tcp()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(tcp()).toHaveLength(2);
    expect(tcp()[1]!.data.toString()).toBe('hello');
    await vi.advanceTimersByTimeAsync(499);
    expect(tcp()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(tcp()).toHaveLength(3);
    stack.feed(segment(port, 1234, { seq: theirs, ack: ours + 5, flags: ACK }));
    sent.length = 0;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(tcp()).toHaveLength(0);
  });

  it('gives up on a phone that stops answering, and says so', async () => {
    const { c } = await connected();
    const why: string[] = [];
    c.onClose((w) => why.push(w));
    c.write(Buffer.from('x'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(why).toEqual(['the phone stopped answering']);
  });

  it('keeps to the window the phone offers', async () => {
    const { c, tcp, stack, segment, port, ours, theirs, sent } = await connected();
    stack.feed(segment(port, 1234, { seq: theirs, ack: ours, flags: ACK, window: 100 }));
    c.write(Buffer.alloc(300, 1));
    expect(tcp().map((s) => s.data.length)).toEqual([100]);
    sent.length = 0;
    stack.feed(segment(port, 1234, { seq: theirs, ack: ours + 100, flags: ACK, window: 150 }));
    expect(tcp().map((s) => s.data.length)).toEqual([150]);
  });

  it('hands on in order what comes out of order, once each', async () => {
    const { c, stack, segment, port, theirs } = await connected();
    const got: string[] = [];
    c.onData((d) => got.push(d.toString()));
    const send = (seq: number, text: string) =>
      stack.feed(segment(port, 1234, { seq, flags: ACK, data: Buffer.from(text) }));
    send(theirs + 2, 'cd');
    send(theirs + 4, 'ef');
    expect(got).toEqual([]);
    send(theirs, 'ab');
    expect(got).toEqual(['ab', 'cd', 'ef']);
    send(theirs, 'ab');
    send(theirs + 2, 'cd');
    expect(got).toEqual(['ab', 'cd', 'ef']);
  });

  it('acknowledges all it has, and closes when the phone does', async () => {
    const { c, stack, segment, port, theirs, tcp } = await connected();
    const why: string[] = [];
    c.onClose((w) => why.push(w));
    stack.feed(segment(port, 1234, { seq: theirs, flags: ACK, data: Buffer.from('ab') }));
    expect(tcp().at(-1)).toMatchObject({ ack: theirs + 2, flags: ACK });
    stack.feed(segment(port, 1234, { seq: theirs + 2, flags: ACK | FIN }));
    expect(tcp().at(-1)).toMatchObject({ ack: theirs + 3, flags: ACK });
    expect(why).toEqual(['the phone closed the connection']);
  });

  it('says goodbye when it closes, and writes no more', async () => {
    const { c, tcp, sent } = await connected();
    c.close();
    expect(tcp().at(-1)!.flags & FIN).toBe(FIN);
    sent.length = 0;
    c.write(Buffer.from('late'));
    expect(tcp()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(tcp()).toHaveLength(0);
  });

  it('sequence numbers go round', async () => {
    const p = peer();
    const opening = p.stack.connect(1234);
    const syn = p.tcp()[0]!;
    p.stack.feed(p.segment(syn.src, 1234, { seq: -2, ack: syn.seq + 1, flags: SYN | ACK }));
    const c = await opening;
    const got: string[] = [];
    c.onData((d) => got.push(d.toString()));
    p.stack.feed(p.segment(syn.src, 1234, { seq: -1, flags: ACK, data: Buffer.from('abc') }));
    p.stack.feed(p.segment(syn.src, 1234, { seq: 2, flags: ACK, data: Buffer.from('d') }));
    expect(got).toEqual(['abc', 'd']);
  });
});

describe('UDP and the tunnel', () => {
  it('sends with a checksum that adds up', () => {
    const { stack, sent } = peer();
    const u = stack.createUdp();
    u.send(Buffer.from('hello'), 5000);
    const b = sent[0]!;
    expect(b[6]).toBe(17);
    expect(b.subarray(8, 24)).toEqual(ipv6Bytes(LOCAL));
    expect(b.subarray(24, 40)).toEqual(ipv6Bytes(REMOTE));
    const payload = b.subarray(40);
    const pseudo = Buffer.alloc(8);
    pseudo.writeUInt32BE(payload.length);
    pseudo[7] = 17;
    let sum = 0;
    for (const part of [ipv6Bytes(LOCAL), ipv6Bytes(REMOTE), pseudo, payload]) {
      for (let i = 0; i < part.length; i += 2) sum += (part[i]! << 8) | (part[i + 1] ?? 0);
    }
    while (sum > 0xffff) sum = (sum & 0xffff) + (sum >>> 16);
    expect(sum).toBe(0xffff);
  });

  it('takes packets across chunks, by port, in order', () => {
    const { stack, packet } = peer();
    const u = stack.createUdp();
    const got: [string, number][] = [];
    u.message = (m, from) => got.push([m.toString(), from]);
    const udp = (text: string, to: number) => {
      const h = Buffer.alloc(8);
      h.writeUInt16BE(777, 0);
      h.writeUInt16BE(to, 2);
      return packet(17, Buffer.concat([h, Buffer.from(text)]));
    };
    const all = Buffer.concat([udp('one', u.localPort), udp('nobody', 9), udp('two', u.localPort)]);
    stack.feed(all.subarray(0, 5));
    stack.feed(all.subarray(5, 60));
    stack.feed(all.subarray(60));
    expect(got).toEqual([
      ['one', 777],
      ['two', 777],
    ]);
  });

  it('a tunnel that ends takes its connections with it, and says so', async () => {
    const { c, stack, handlers } = await connected();
    const why: string[] = [];
    c.onClose((w) => why.push(w));
    stack.onEnded((w) => why.push(`stack: ${w}`));
    (handlers.close as () => void)();
    expect(why).toEqual(['the tunnel ended', 'stack: the tunnel ended']);
    await expect(stack.connect(1)).rejects.toThrow();
  });

  it('ends the one connection on what its reader cannot read, and tells the phone', async () => {
    const { c, port, stack, segment, tcp, theirs, sent } = await connected();
    const why: string[] = [];
    c.onClose((w) => why.push(w));
    c.onData(() => {
      throw new RangeError('an XPC value runs past its message');
    });
    const data = Buffer.from('x');
    // it would reach the tunnel's own stream, where nothing catches it, and end the process
    expect(() => stack.feed(segment(port, 1234, { seq: theirs, flags: ACK, data }))).not.toThrow();
    expect(why).toEqual([expect.stringMatching(/cannot be read: an XPC value runs past/)]);
    expect(tcp().some((s) => s.flags & FIN)).toBe(true);
    sent.length = 0;
    expect(() =>
      stack.feed(segment(port, 1234, { seq: theirs + 1, flags: ACK, data })),
    ).not.toThrow();
  });

  it('fails who waits on a service whose message cannot be read', async () => {
    const { c, port, stack, segment, theirs } = await connected();
    const x = RemoteXpc.start(c);
    const message = encodeWrapper(0x101, { a: 1n });
    message.writeUInt32LE(0x6000, WRAPPER_HEADER + 8);
    const data = Buffer.alloc(9 + message.length);
    data.writeUIntBE(message.length, 0, 3);
    data.writeUInt32BE(1, 5);
    message.copy(data, 9);
    const waiting = x.next();
    stack.feed(segment(port, 1234, { seq: theirs, flags: ACK, data }));
    await expect(waiting).rejects.toThrow(/cannot be read: an XPC value of type 0x6000/);
  });

  it('gives a reader that failed nothing more that came early', async () => {
    const { c, port, stack, segment, theirs } = await connected();
    let reads = 0;
    c.onData(() => {
      reads++;
      throw new Error('not a DTX frame');
    });
    const data = Buffer.from('x');
    stack.feed(segment(port, 1234, { seq: theirs + 1, flags: ACK, data }));
    stack.feed(segment(port, 1234, { seq: theirs, flags: ACK, data }));
    expect(reads).toBe(1);
  });

  it.each([
    ['TCP', 6, 3],
    ['TCP', 6, 6],
    ['UDP', 17, 3],
    ['UDP', 17, 6],
  ])('passes over a %s packet of %i too short for its header: %i bytes', async (_, next, size) => {
    const { c, port, stack, packet } = await connected();
    const u = stack.createUdp();
    const short = Buffer.alloc(size);
    if (size > 3) short.writeUInt16BE(next === 6 ? port : u.localPort, 2);
    expect(() => stack.feed(packet(next, short))).not.toThrow();
    c.close();
  });

  it('reads addresses with and without their shorthand', () => {
    expect(ipv6Bytes('::1').at(-1)).toBe(1);
    expect(ipv6Bytes('fd00:1:2:3:4:5:6:7').readUInt16BE(14)).toBe(7);
    expect(ipv6Bytes('fd00::7').readUInt16BE(0)).toBe(0xfd00);
    expect(ipv6Bytes('fd00::7').readUInt16BE(14)).toBe(7);
  });
});
