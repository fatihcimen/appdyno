import { describe, expect, it, vi } from 'vitest';
import { RtcpWriter, RtpReceiver, type Picture } from '../rtp-hevc.js';

const VPS = 32;
const IDR = 19;
const TRAIL = 1;

const nal = (type: number, body = 'xyz') =>
  Buffer.concat([Buffer.from([type << 1, 1]), Buffer.from(body)]);

function rtp(seq: number, time: number, payload: Buffer, marker = false, extras = Buffer.alloc(0)) {
  const h = Buffer.alloc(12);
  h[0] = 0x80 | (extras.length ? 0x10 : 0);
  h[1] = 100 | (marker ? 0x80 : 0);
  h.writeUInt16BE(seq & 0xffff, 2);
  h.writeUInt32BE(time, 4);
  h.writeUInt32BE(0xabcd, 8);
  return Buffer.concat([h, extras, payload]);
}

const aggregate = (...nals: Buffer[]) =>
  Buffer.concat([
    Buffer.from([48 << 1, 1]),
    ...nals.flatMap((n) => {
      const l = Buffer.alloc(2);
      l.writeUInt16BE(n.length);
      return [l, n];
    }),
  ]);

const fragments = (type: number, parts: string[]) =>
  parts.map((p, i) =>
    Buffer.concat([
      Buffer.from([49 << 1, 1, type | (i === 0 ? 0x80 : 0) | (i === parts.length - 1 ? 0x40 : 0)]),
      Buffer.from(p),
    ]),
  );

const annexB = (...nals: Buffer[]) =>
  Buffer.concat(nals.flatMap((n) => [Buffer.from([0, 0, 0, 1]), n]));

function setup() {
  const pictures: Picture[] = [];
  const asked = vi.fn();
  let now = 0;
  const r = new RtpReceiver(
    (p) => pictures.push(p),
    asked,
    () => now,
  );
  return { r, pictures, asked, tick: (ms: number) => (now += ms) };
}

describe('pictures out of RTP', () => {
  it('asks for a key at the start, and passes nothing on until it comes', () => {
    const { r, pictures, asked } = setup();
    r.push(rtp(1, 100, nal(TRAIL), true));
    expect(pictures).toEqual([]);
    expect(asked).toHaveBeenCalledTimes(1);
    r.push(rtp(2, 200, nal(IDR), true));
    expect(pictures).toHaveLength(1);
    expect(pictures[0]).toMatchObject({ key: true, rtpTime: 200 });
    r.push(rtp(3, 300, nal(TRAIL), true));
    expect(pictures[1]).toMatchObject({ key: false });
  });

  it('takes single, aggregated and fragmented NALs as one picture', () => {
    const { r, pictures } = setup();
    r.push(rtp(1, 100, aggregate(nal(VPS, 'a'), nal(33, 'b'))));
    const [one, two] = fragments(IDR, ['first-', 'second']);
    r.push(rtp(2, 100, one!));
    r.push(rtp(3, 100, two!));
    r.push(rtp(4, 100, nal(TRAIL, 'tail'), true));
    expect(pictures).toHaveLength(1);
    expect(pictures[0]!.annexB).toEqual(
      annexB(nal(VPS, 'a'), nal(33, 'b'), nal(IDR, 'first-second'), nal(TRAIL, 'tail')),
    );
  });

  it('ends a picture at a new time, for a sender that sets no marker', () => {
    const { r, pictures } = setup();
    r.push(rtp(1, 100, nal(IDR)));
    expect(pictures).toHaveLength(0);
    r.push(rtp(2, 200, nal(TRAIL)));
    expect(pictures).toHaveLength(1);
    expect(pictures[0]).toMatchObject({ rtpTime: 100 });
  });

  it('skips a header extension and contributing sources', () => {
    const { r, pictures } = setup();
    const extension = Buffer.alloc(8);
    extension.writeUInt16BE(1, 2);
    r.push(rtp(1, 100, nal(IDR, 'body'), true, extension));
    expect(pictures[0]!.annexB).toEqual(annexB(nal(IDR, 'body')));
  });

  it('a gap freezes the picture until a key, and asks for it, then again', () => {
    const { r, pictures, asked, tick } = setup();
    r.push(rtp(1, 100, nal(IDR), true));
    asked.mockClear();
    tick(5_000);
    r.push(rtp(5, 200, nal(TRAIL), true));
    expect(r.stats.lost).toBe(3);
    expect(pictures).toHaveLength(1);
    expect(asked).toHaveBeenCalledTimes(1);
    r.push(rtp(6, 300, nal(TRAIL), true));
    expect(asked).toHaveBeenCalledTimes(1);
    tick(1_000);
    r.push(rtp(7, 400, nal(TRAIL), true));
    expect(asked).toHaveBeenCalledTimes(2);
    expect(pictures).toHaveLength(1);
    r.push(rtp(8, 500, nal(IDR), true));
    expect(pictures).toHaveLength(2);
    expect(r.stats.held).toBe(3);
    r.push(rtp(9, 600, nal(TRAIL), true));
    expect(pictures).toHaveLength(3);
  });

  it('asks at the gap itself, and says how long the picture stood still', () => {
    const { r, asked, tick } = setup();
    r.push(rtp(1, 100, nal(IDR), true));
    asked.mockClear();
    tick(5_000);
    r.push(rtp(3, 200, nal(TRAIL)));
    expect(asked).toHaveBeenCalledTimes(1);
    tick(100);
    r.push(rtp(4, 200, nal(TRAIL), true));
    tick(300);
    r.push(rtp(5, 300, nal(IDR), true));
    expect(r.stats).toMatchObject({ freezes: 1, longestFreezeMs: 400, frozenMs: 400 });
    tick(1_000);
    r.needKey();
    tick(100);
    r.push(rtp(6, 400, nal(IDR), true));
    expect(r.stats).toMatchObject({ freezes: 2, longestFreezeMs: 400, frozenMs: 500 });
  });

  it('the wait for a first key is no freeze', () => {
    const { r, tick } = setup();
    r.push(rtp(1, 100, nal(TRAIL), true));
    tick(900);
    r.push(rtp(2, 200, nal(IDR), true));
    expect(r.stats.freezes).toBe(0);
  });

  it('a fragment cut by a gap is dropped whole', () => {
    const { r, pictures } = setup();
    r.push(rtp(1, 100, nal(IDR), true));
    const [one, , three] = fragments(IDR, ['a', 'b', 'c']);
    r.push(rtp(2, 200, one!));
    r.push(rtp(4, 200, three!, true));
    expect(pictures).toHaveLength(1);
    expect(r.stats.lost).toBe(1);
  });

  it('a late or repeated packet changes nothing', () => {
    const { r, pictures } = setup();
    r.push(rtp(10, 100, nal(IDR), true));
    r.push(rtp(10, 100, nal(IDR), true));
    r.push(rtp(9, 90, nal(IDR), true));
    expect(pictures).toHaveLength(1);
    expect(r.stats.late).toBe(2);
    expect(r.stats.lost).toBe(0);
  });

  it('sequence numbers go round with no loss', () => {
    const { r, pictures } = setup();
    r.push(rtp(0xffff, 100, nal(IDR), true));
    r.push(rtp(0, 200, nal(TRAIL), true));
    expect(pictures).toHaveLength(2);
    expect(r.stats.lost).toBe(0);
  });

  it('a decoder that asks for a key waits for one', () => {
    const { r, pictures, asked } = setup();
    r.push(rtp(1, 100, nal(IDR), true));
    asked.mockClear();
    r.needKey();
    expect(asked).toHaveBeenCalledTimes(1);
    r.push(rtp(2, 200, nal(TRAIL), true));
    expect(pictures).toHaveLength(1);
    r.push(rtp(3, 300, nal(IDR), true));
    expect(pictures).toHaveLength(2);
  });

  it('what is not RTP is dropped: RTCP, short packets, and another version', () => {
    const { r, pictures } = setup();
    const rtcp = Buffer.alloc(12);
    rtcp[0] = 0x80;
    rtcp[1] = 201;
    r.push(rtcp);
    r.push(Buffer.alloc(4));
    const other = rtp(1, 100, nal(IDR), true);
    other[0] = 0x40;
    r.push(other);
    expect(pictures).toEqual([]);
    expect(r.stats.packets).toBe(0);
  });

  it('counts how far the stream has come', () => {
    const { r } = setup();
    r.push(rtp(0xfffe, 100, nal(IDR), true));
    r.push(rtp(0xffff, 200, nal(TRAIL), true));
    r.push(rtp(1, 300, nal(TRAIL), true));
    expect(r.received).toBe(3);
    expect(r.highestSeq).toBe(1);
    expect(r.sender).toBe(0xabcd);
  });
});

describe('RTCP back to the phone', () => {
  const w = new RtcpWriter(0x11223344);
  /** Every packet's length says how many 32-bit words follow it, as RFC 3550 has it. */
  const packets = (b: Buffer) => {
    const out: Buffer[] = [];
    for (let o = 0; o < b.length;) {
      const n = (b.readUInt16BE(o + 2) + 1) * 4;
      out.push(b.subarray(o, o + n));
      o += n;
    }
    expect(out.reduce((a, p) => a + p.length, 0)).toBe(b.length);
    return out;
  };

  it('a report and a name, from us about the sender', () => {
    const [report, sdes] = packets(w.alive(0xabcd, 77));
    expect(report![1]).toBe(201);
    expect(report!.readUInt32BE(4)).toBe(0x11223344);
    expect(report!.readUInt32BE(8)).toBe(0xabcd);
    expect(report!.readUInt32BE(16)).toBe(77);
    expect(sdes![1]).toBe(202);
    expect(sdes!.toString('latin1', 10, 17)).toBe('appdyno');
    expect(sdes!.length % 4).toBe(0);
  });

  it('each picture acknowledged by its time', () => {
    const [ack] = packets(w.ack(0xdeadbeef));
    expect(ack![1]).toBe(204);
    expect(ack!.subarray(8, 12)).toEqual(Buffer.from([0, 0, 0, 5]));
    expect(ack!.readUInt32BE(12)).toBe(0xdeadbeef);
  });

  it('rate control, with its counters going round', () => {
    const [rctl] = packets(w.rateControl(0x12345, 0x54321 + 0.9, 0x10002));
    expect(rctl!.toString('latin1', 8, 12)).toBe('RCTL');
    expect(rctl!.readUInt16BE(12 + 4)).toBe(0x2345);
    expect(rctl!.readUInt16BE(12 + 12)).toBe(0x4321);
    expect(rctl!.readUInt16BE(12 + 16)).toBe(2);
  });

  it('asks for a key both ways, numbering its requests', () => {
    const first = packets(w.askForKey(0xabcd));
    expect(first[0]![0]! & 0x1f).toBe(1);
    expect(first[1]![0]! & 0x1f).toBe(4);
    expect(first[1]![1]).toBe(206);
    const second = packets(w.askForKey(0xabcd));
    expect(second[1]![16]).toBe(first[1]![16]! + 1);
  });
});
