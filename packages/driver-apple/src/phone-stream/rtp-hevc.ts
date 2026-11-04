/** HEVC out of RTP (RFC 7798), a picture at a time, and the RTCP a phone expects back for it (RFC 3550, 4585). */

const RTP_VERSION = 2;
const RTCP_FIRST = 200;
const RTCP_LAST = 206;
const NAL_AP = 48;
const NAL_FU = 49;
const IRAP_FIRST = 16;
const IRAP_LAST = 21;
const START_CODE = Buffer.from([0, 0, 0, 1]);
/** No key picture this long after asking: asked again. */
const ASK_AGAIN_MS = 1_000;

export type Picture = { annexB: Buffer; key: boolean; rtpTime: number };

export type RtpStats = {
  packets: number;
  bytes: number;
  pictures: number;
  lost: number;
  late: number;
  keys: number;
  held: number;
};

/**
 * Whole pictures, in order. The tunnel keeps packets in order, so a gap is a loss: from it nothing is passed on until a
 * key picture comes, which is a freeze and never garbage, and the key is asked for until it does.
 */
export class RtpReceiver {
  readonly stats: RtpStats = {
    packets: 0,
    bytes: 0,
    pictures: 0,
    lost: 0,
    late: 0,
    keys: 0,
    held: 0,
  };
  sender = 0;
  private lastSeq: number | undefined;
  private firstSeq: number | undefined;
  private time: number | undefined;
  private nals: Buffer[] = [];
  private fragment: Buffer[] | undefined;
  private key = false;
  private broken = false;
  private waitingForKey = true;
  private askedAt = -Infinity;

  constructor(
    private readonly onPicture: (p: Picture) => void,
    private readonly askForKey: () => void,
    private readonly now: () => number = performance.now.bind(performance),
  ) {}

  /** How far this stream's sequence has come, for the phone's rate control. */
  get received() {
    return ((this.lastSeq ?? 0) - (this.firstSeq ?? 0)) & 0xffff;
  }

  get highestSeq() {
    return this.lastSeq ?? 0;
  }

  /** The next picture a viewer can show is a key picture: after a drop, or for a decoder that asks. */
  needKey() {
    this.waitingForKey = true;
    this.askedAt = -Infinity;
    this.ask();
  }

  private ask() {
    const now = this.now();
    if (now - this.askedAt < ASK_AGAIN_MS) return;
    this.askedAt = now;
    this.askForKey();
  }

  /** One UDP payload; what is not RTP, RTCP included, is dropped here. */
  push(m: Buffer) {
    if (m.length < 12 || m[0]! >> 6 !== RTP_VERSION) return;
    const type = m[1]! & 0x7f;
    if (m[1]! >= RTCP_FIRST && m[1]! <= RTCP_LAST) return;
    const seq = m.readUInt16BE(2);
    const time = m.readUInt32BE(4);
    this.sender = m.readUInt32BE(8);
    if (!type) return;
    if (this.lastSeq === undefined) this.firstSeq = seq;
    else {
      const jump = (seq - this.lastSeq) & 0xffff;
      if (jump === 0 || jump > 0x8000) {
        // an earlier packet, come after its picture has gone on
        this.stats.late++;
        return;
      }
      if (jump !== 1) {
        this.stats.lost += jump - 1;
        this.broken = true;
        this.fragment = undefined;
      }
    }
    this.lastSeq = seq;
    this.stats.packets++;
    this.stats.bytes += m.length;
    if (this.time !== undefined && time !== this.time) this.finish();
    this.time = time;
    const csrc = m[0]! & 0x0f;
    let at = 12 + csrc * 4;
    if (m[0]! & 0x10) at += 4 + m.readUInt16BE(at + 2) * 4;
    this.payload(m.subarray(at));
    if (m[1]! & 0x80) this.finish();
  }

  private addNal(nal: Buffer) {
    const type = (nal[0]! >> 1) & 0x3f;
    if (type >= IRAP_FIRST && type <= IRAP_LAST) this.key = true;
    this.nals.push(START_CODE, nal);
  }

  private payload(p: Buffer) {
    if (p.length < 3) return;
    const type = (p[0]! >> 1) & 0x3f;
    if (type === NAL_AP) {
      let i = 2;
      while (i + 2 <= p.length) {
        const n = p.readUInt16BE(i);
        this.addNal(p.subarray(i + 2, i + 2 + n));
        i += 2 + n;
      }
    } else if (type === NAL_FU) {
      const fu = p[2]!;
      if (fu & 0x80) {
        // the NAL's own header, rebuilt with the type the fragment carries
        this.fragment = [Buffer.from([(p[0]! & 0x81) | ((fu & 0x3f) << 1), p[1]!])];
      }
      if (!this.fragment) return;
      this.fragment.push(p.subarray(3));
      if (fu & 0x40) {
        this.addNal(Buffer.concat(this.fragment));
        this.fragment = undefined;
      }
    } else {
      this.addNal(p);
    }
  }

  private finish() {
    const nals = this.nals;
    const key = this.key;
    const broken = this.broken;
    const time = this.time ?? 0;
    this.nals = [];
    this.key = false;
    this.broken = false;
    this.fragment = undefined;
    this.time = undefined;
    if (!nals.length && !broken) return;
    this.stats.pictures++;
    if (broken || (this.waitingForKey && !key)) {
      if (broken) this.waitingForKey = true;
      this.stats.held++;
      this.ask();
      return;
    }
    if (key) {
      this.stats.keys++;
      this.waitingForKey = false;
    }
    this.onPicture({ annexB: Buffer.concat(nals), key, rtpTime: time });
  }
}

/** Reports to a phone, from the receiver's end of a stream. */
export class RtcpWriter {
  private fir = 0;

  constructor(
    private readonly ssrc: number,
    private readonly name = 'appdyno',
  ) {}

  private app(name: Buffer, body: Buffer) {
    const b = Buffer.alloc(12 + body.length);
    b[0] = 0x80;
    b[1] = 204;
    b.writeUInt16BE(b.length / 4 - 1, 2);
    b.writeUInt32BE(this.ssrc, 4);
    name.copy(b, 8);
    body.copy(b, 12);
    return b;
  }

  /** Each picture is acknowledged by its time. */
  ack(rtpTime: number) {
    const body = Buffer.alloc(4);
    body.writeUInt32BE(rtpTime >>> 0);
    return this.app(Buffer.from([0, 0, 0, 5]), body);
  }

  /** Every 50 ms: past it the phone's encoder drifts and the picture breaks. */
  rateControl(pictures: number, nowMs: number, received: number) {
    const body = Buffer.alloc(20);
    body.set([0x85, 0, 0, 4]);
    body.writeUInt16BE(pictures & 0xffff, 4);
    body.writeUInt16BE(Math.floor(nowMs) & 0xffff, 12);
    body.writeUInt16BE(received & 0xffff, 16);
    return this.app(Buffer.from('RCTL'), body);
  }

  /** A receiver report and our name, each second: the phone ends a stream that goes without. */
  alive(sender: number, highestSeq: number) {
    const report = Buffer.alloc(32);
    report[0] = 0x81;
    report[1] = 201;
    report.writeUInt16BE(7, 2);
    report.writeUInt32BE(this.ssrc, 4);
    report.writeUInt32BE(sender >>> 0, 8);
    report.writeUInt32BE(highestSeq >>> 0, 16);
    const name = Buffer.from(this.name);
    const sdes = Buffer.alloc(((8 + 2 + name.length + 1 + 3) >> 2) << 2);
    sdes[0] = 0x81;
    sdes[1] = 202;
    sdes.writeUInt16BE(sdes.length / 4 - 1, 2);
    sdes.writeUInt32BE(this.ssrc, 4);
    sdes[8] = 1;
    sdes[9] = name.length;
    name.copy(sdes, 10);
    return Buffer.concat([report, sdes]);
  }

  /** Both ways of asking for a key picture, in one packet. */
  askForKey(sender: number) {
    const pli = Buffer.alloc(12);
    pli[0] = 0x81;
    pli[1] = 206;
    pli.writeUInt16BE(2, 2);
    pli.writeUInt32BE(this.ssrc, 4);
    pli.writeUInt32BE(sender >>> 0, 8);
    const fir = Buffer.alloc(20);
    fir[0] = 0x84;
    fir[1] = 206;
    fir.writeUInt16BE(4, 2);
    fir.writeUInt32BE(this.ssrc, 4);
    fir.writeUInt32BE(sender >>> 0, 12);
    fir[16] = this.fir++ & 0xff;
    return Buffer.concat([pli, fir]);
  }
}
