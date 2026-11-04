import { archive, unarchive, type Archived } from './keyed-archive.js';

const MAGIC = 0x1f3d5b79;
const HEADER = 32;
const BODY_HEAD = 16;
const OBJECT = 2;
const WANTS_REPLY = 0x1000;
const AUX_HEAD = 0x1f0;
const AUX_ITEM = 10;
const AUX_ARCHIVE = 2;
const AUX_INT = 3;
const AUX_DOUBLE = 9;
const ANSWER_MS = 5_000;

type Link = { write(b: Buffer): unknown; onData(f: (d: Buffer) => void): unknown };

export type DtxMessage = {
  id: number;
  channel: number;
  reply: boolean;
  selector: Archived;
  args: Archived[];
};

/** An argument that goes as a plain 32-bit number, not as an archive. */
export class DtxInt {
  constructor(readonly value: number) {}
}

/** An argument that goes as a plain double. */
export class DtxDouble {
  constructor(readonly value: number) {}
}

type Arg = Archived | DtxInt | DtxDouble;

/** Arguments, each an archive: the length of the whole first, in a head of its own. */
function auxOf(args: Arg[]) {
  if (!args.length) return Buffer.alloc(0);
  const items = args.map((a) => {
    if (a instanceof DtxInt) {
      const int = Buffer.alloc(12);
      int.writeUInt32LE(AUX_ITEM, 0);
      int.writeUInt32LE(AUX_INT, 4);
      int.writeUInt32LE(a.value, 8);
      return int;
    }
    if (a instanceof DtxDouble) {
      const double = Buffer.alloc(16);
      double.writeUInt32LE(AUX_ITEM, 0);
      double.writeUInt32LE(AUX_DOUBLE, 4);
      double.writeDoubleLE(a.value, 8);
      return double;
    }
    const bytes = archive(a);
    const head = Buffer.alloc(12);
    head.writeUInt32LE(AUX_ITEM, 0);
    head.writeUInt32LE(AUX_ARCHIVE, 4);
    head.writeUInt32LE(bytes.length, 8);
    return Buffer.concat([head, bytes]);
  });
  const all = Buffer.concat(items);
  const head = Buffer.alloc(16);
  head.writeUInt32LE(AUX_HEAD, 0);
  head.writeUInt32LE(all.length, 8);
  return Buffer.concat([head, all]);
}

function argsOf(aux: Buffer) {
  const args: Archived[] = [];
  let at = BODY_HEAD;
  while (at + 8 <= aux.length) {
    const kind = aux.readUInt32LE(at + 4);
    at += 8;
    if (kind !== AUX_ARCHIVE) break;
    const n = aux.readUInt32LE(at);
    args.push(unarchive(aux.subarray(at + 4, at + 4 + n)));
    at += 4 + n;
  }
  return args;
}

export function dtxFrame(
  id: number,
  selector: string,
  args: Arg[],
  wantsReply: boolean,
  channel = 0,
) {
  const aux = auxOf(args);
  const payload = archive(selector);
  const body = Buffer.alloc(BODY_HEAD);
  body.writeUInt32LE(wantsReply ? OBJECT | WANTS_REPLY : OBJECT, 0);
  body.writeUInt32LE(aux.length, 4);
  body.writeBigUInt64LE(BigInt(aux.length + payload.length), 8);
  const head = Buffer.alloc(HEADER);
  head.writeUInt32LE(MAGIC, 0);
  head.writeUInt32LE(HEADER, 4);
  head.writeUInt16LE(1, 10);
  head.writeUInt32LE(BODY_HEAD + aux.length + payload.length, 12);
  head.writeUInt32LE(id, 16);
  head.writeInt32LE(channel, 24);
  head.writeUInt32LE(wantsReply ? 1 : 0, 28);
  return Buffer.concat([head, body, aux, payload]);
}

/** Takes the frames whole from what came so far; a long message comes in pieces after a head with no body. */
export class DtxReader {
  private held = Buffer.alloc(0);
  private readonly pieces = new Map<number, Buffer[]>();

  push(data: Buffer): DtxMessage[] {
    this.held = Buffer.concat([this.held, data]);
    const out: DtxMessage[] = [];
    while (this.held.length >= HEADER) {
      if (this.held.readUInt32LE(0) !== MAGIC) throw new Error('not a DTX frame');
      const piece = this.held.readUInt16LE(8);
      const count = this.held.readUInt16LE(10);
      const size = this.held.readUInt32LE(12);
      const id = this.held.readUInt32LE(16);
      const reply = this.held.readUInt32LE(20) !== 0;
      const channel = this.held.readInt32LE(24);
      if (count > 1 && piece === 0) {
        this.pieces.set(id, []);
        this.held = this.held.subarray(HEADER);
        continue;
      }
      if (this.held.length < HEADER + size) break;
      const body = this.held.subarray(HEADER, HEADER + size);
      this.held = this.held.subarray(HEADER + size);
      if (count > 1) {
        this.pieces.get(id)?.push(body);
        if (piece < count - 1) continue;
      }
      out.push(this.message(id, channel, reply, Buffer.concat(this.pieces.get(id) ?? [body])));
      this.pieces.delete(id);
    }
    return out;
  }

  private message(id: number, channel: number, reply: boolean, body: Buffer): DtxMessage {
    if (body.length < BODY_HEAD) return { id, channel, reply, selector: null, args: [] };
    const auxLength = body.readUInt32LE(4);
    const payload = body.subarray(BODY_HEAD + auxLength);
    return {
      id,
      channel,
      reply,
      selector: payload.length ? unarchive(payload) : null,
      args: argsOf(body.subarray(BODY_HEAD, BODY_HEAD + auxLength)),
    };
  }
}

/** Calls on a connection to a DTX service, and what it sends by itself. */
export class DtxClient {
  private next = 1;
  private readonly reader = new DtxReader();
  private readonly waiting = new Map<number, (v: DtxMessage) => void>();
  onPush: (m: DtxMessage) => void = () => undefined;

  constructor(private readonly link: Link) {
    link.onData((d) => this.feed(d));
  }

  /** What came, whether by the connection or before this took it over. */
  feed(data: Buffer) {
    for (const m of this.reader.push(data)) {
      const answer = m.reply ? this.waiting.get(m.id) : undefined;
      if (answer) answer(m);
      else if (!m.reply) this.onPush(m);
    }
  }

  tell(selector: string, aux: Arg[], channel = 0) {
    this.link.write(dtxFrame(this.next++, selector, aux, false, channel));
  }

  call(selector: string, ...args: Arg[]): Promise<Archived> {
    return this.callOn(0, selector, ...args);
  }

  callOn(channel: number, selector: string, ...args: Arg[]): Promise<Archived> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error(`no answer to ${selector}`));
      }, ANSWER_MS);
      this.waiting.set(id, (m) => {
        clearTimeout(timer);
        this.waiting.delete(id);
        resolve(m.selector);
      });
      this.link.write(dtxFrame(id, selector, args, true, channel));
    });
  }
}
