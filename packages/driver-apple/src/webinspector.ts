import { randomUUID } from 'node:crypto';
import { connect, type Socket } from 'node:net';
import type { WebInspector, WebPage } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { assertUdid, type Simctl } from './simctl.js';

export type Plist = string | number | boolean | Buffer | null | Plist[] | { [k: string]: Plist };

/** A plist's reference to another object, by the name its XML form gives it. */
const UID = 'CF$UID';
export const plistUid = (n: number): Plist => ({ [UID]: n });
export const uidOf = (v: Plist | undefined): number | undefined =>
  v && typeof v === 'object' && !Buffer.isBuffer(v) && !Array.isArray(v)
    ? (v[UID] as number | undefined)
    : undefined;

/** Past any message here: an object may be named twice, so that a few bytes can unfold for as long as there is memory. */
export const MOST_VALUES = 1 << 20;

/** A binary property list: what the inspector's socket speaks (no dependency, no process per message). */
export function readBplist(b: Buffer): Plist {
  if (b.toString('latin1', 0, 8) !== 'bplist00') throw new Error('not a binary plist');
  const trailer = b.subarray(b.length - 32);
  const [offsetSize, refSize] = [trailer[6]!, trailer[7]!];
  const count = Number(trailer.readBigUInt64BE(8));
  const top = Number(trailer.readBigUInt64BE(16));
  const table = Number(trailer.readBigUInt64BE(24));
  let left = MOST_VALUES;
  const read = (i: number): Plist => {
    if (--left < 0) throw new Error(`a plist of more than ${MOST_VALUES} values`);
    let p = b.readUIntBE(table + i * offsetSize, offsetSize);
    const marker = b[p++]!;
    const low = marker & 15;
    const size = () => {
      if (low !== 15) return low;
      const width = 1 << (b[p++]! & 15);
      const n = b.readUIntBE(p, width);
      p += width;
      return n;
    };
    const refs = (n: number, from: number) => {
      // room is made before the first is read: a length from the wire, at every level of a list that holds itself
      if (p + (from + n) * refSize > b.length) throw new Error('a plist list past its end');
      return Array.from({ length: n }, (_, k) =>
        read(b.readUIntBE(p + (from + k) * refSize, refSize)),
      );
    };
    switch (marker >> 4) {
      case 0:
        return low === 8 ? false : low === 9 ? true : null;
      case 1:
        // the long form is 16 bytes, the value in the last 8
        return low <= 2
          ? b.readUIntBE(p, 1 << low)
          : Number(b.readBigInt64BE(low === 4 ? p + 8 : p));
      case 2:
        return low === 3 ? b.readDoubleBE(p) : b.readFloatBE(p);
      case 4: {
        const n = size();
        return b.subarray(p, p + n);
      }
      case 5: {
        const n = size();
        return b.toString('latin1', p, p + n);
      }
      case 6: {
        const n = size();
        return Buffer.from(b.subarray(p, p + n * 2))
          .swap16()
          .toString('utf16le');
      }
      case 8:
        return plistUid(b.readUIntBE(p, low + 1));
      case 10:
        return refs(size(), 0);
      case 13: {
        const n = size();
        const keys = refs(n, 0) as string[];
        const values = refs(n, n);
        return Object.fromEntries(keys.map((k, j) => [k, values[j]!]));
      }
      default:
        throw new Error(`a plist object of kind ${marker >> 4}`);
    }
  };
  if (count <= top) throw new Error('a plist with no such object');
  return read(top);
}

export function writeBplist(root: Plist): Buffer {
  const objects: { own: Buffer; refs?: number[] }[] = [];
  const sized = (kind: number, n: number) => {
    if (n < 15) return Buffer.from([(kind << 4) | n]);
    const length = Buffer.alloc(6);
    length[0] = (kind << 4) | 15;
    length[1] = 0x12;
    length.writeUInt32BE(n, 2);
    return length;
  };
  const add = (v: Plist): number => {
    const i = objects.length;
    if (typeof v === 'string') {
      const ascii = Buffer.byteLength(v) === v.length;
      const body = ascii ? Buffer.from(v, 'latin1') : Buffer.from(v, 'utf16le').swap16();
      objects.push({
        own: Buffer.concat([sized(ascii ? 5 : 6, ascii ? v.length : body.length / 2), body]),
      });
    } else if (typeof v === 'number') {
      const n = Buffer.alloc(9);
      n[0] = 0x13;
      n.writeBigInt64BE(BigInt(v), 1);
      objects.push({ own: n });
    } else if (typeof v === 'boolean') objects.push({ own: Buffer.from([v ? 9 : 8]) });
    else if (v === null) objects.push({ own: Buffer.from([0]) });
    else if (Buffer.isBuffer(v)) objects.push({ own: Buffer.concat([sized(4, v.length), v]) });
    else if (Array.isArray(v)) {
      objects.push({ own: sized(10, v.length) });
      objects[i]!.refs = v.map(add);
    } else if (uidOf(v) !== undefined) {
      const n = Buffer.alloc(5);
      n[0] = 0x83;
      n.writeUInt32BE(uidOf(v)!, 1);
      objects.push({ own: n });
    } else {
      const keys = Object.keys(v);
      objects.push({ own: sized(13, keys.length) });
      objects[i]!.refs = [...keys.map(add), ...keys.map((k) => add(v[k]!))];
    }
    return i;
  };
  add(root);
  const REF = 4;
  const parts: Buffer[] = [Buffer.from('bplist00', 'latin1')];
  let at = 8;
  const offsets = objects.map(({ own, refs = [] }) => {
    const refBytes = Buffer.alloc(refs.length * REF);
    refs.forEach((r, k) => refBytes.writeUInt32BE(r, k * REF));
    parts.push(own, refBytes);
    const start = at;
    at += own.length + refBytes.length;
    return start;
  });
  const table = Buffer.alloc(offsets.length * REF);
  offsets.forEach((o, k) => table.writeUInt32BE(o, k * REF));
  const trailer = Buffer.alloc(32);
  trailer[6] = REF;
  trailer[7] = REF;
  trailer.writeBigUInt64BE(BigInt(objects.length), 8);
  trailer.writeBigUInt64BE(0n, 16);
  trailer.writeBigUInt64BE(BigInt(at), 24);
  return Buffer.concat([...parts, table, trailer]);
}

const CONNECT_MS = 5_000;
const ANSWER_MS = 15_000;
/** An app that holds no page says nothing at all to a request for its listing. */
const LISTING_MS = 1_500;
/** `WIRIsApplicationActiveKey`: 2 is in front. */
const IN_FRONT = 2;

type Rpc = { __selector: string; __argument: Record<string, Plist> };
type App = Record<string, Plist>;

/** One conversation with a simulator's `webinspectord`: messages each way, and a wait for one. */
class Conversation {
  private readonly id = randomUUID().toUpperCase();
  private rest = Buffer.alloc(0);
  private readonly seen: Rpc[] = [];
  private wake: (() => void) | undefined;
  private closed = false;

  private constructor(private readonly socket: Socket) {
    socket.on('data', (d) => this.onData(d));
    socket.on('close', () => {
      this.closed = true;
      this.wake?.();
    });
    socket.on('error', () => undefined);
  }

  static async open(path: string) {
    const socket = connect(path);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('error', (e) =>
        reject(new DeviceError('AGENT_UNAVAILABLE', `the Safari inspector: ${e.message}`)),
      );
    });
    const c = new Conversation(socket);
    c.send('_rpc_reportIdentifier:', {});
    return c;
  }

  private onData(d: Buffer) {
    this.rest = Buffer.concat([this.rest, d]);
    try {
      while (this.rest.length >= 4) {
        const n = this.rest.readUInt32BE(0);
        if (this.rest.length < 4 + n) break;
        this.seen.push(readBplist(this.rest.subarray(4, 4 + n)) as Rpc);
        this.rest = this.rest.subarray(4 + n);
      }
    } catch {
      // nothing is left to catch it past a socket's listener: the wait ends as on a socket that said no more
      this.socket.destroy();
    }
    this.wake?.();
  }

  send(selector: string, argument: Record<string, Plist>) {
    const body = writeBplist({
      __selector: selector,
      __argument: { WIRConnectionIdentifierKey: this.id, ...argument },
    });
    const head = Buffer.alloc(4);
    head.writeUInt32BE(body.length);
    this.socket.write(Buffer.concat([head, body]));
  }

  /** The first message since the last wait that `met` takes, or undefined after `ms`. */
  async until(met: (m: Rpc) => boolean, ms: number): Promise<Rpc | undefined> {
    const end = Date.now() + ms;
    for (;;) {
      const at = this.seen.findIndex(met);
      if (at >= 0) return this.seen.splice(at, 1)[0];
      const left = end - Date.now();
      if (left <= 0 || this.closed) return undefined;
      await new Promise<void>((r) => {
        const t = setTimeout(r, left);
        this.wake = () => {
          clearTimeout(t);
          r();
        };
      });
    }
  }

  close() {
    this.socket.destroy();
  }
}

const bundleOf = (a: App) => a.WIRApplicationBundleIdentifierKey as string | undefined;
const appKeyOf = (a: App) => a.WIRApplicationIdentifierKey as string;

/**
 * Web views on a simulator, through the socket Safari's Web Inspector uses (`RWI_LISTEN_SOCKET`). From
 * iOS 16.4 a web view is listed only if its app set `isInspectable`.
 */
export class SimulatorWeb implements WebInspector {
  constructor(
    private readonly simctl: Simctl,
    private readonly udid: string,
  ) {}

  private async talking<T>(f: (c: Conversation, apps: App[]) => Promise<T>): Promise<T> {
    const path = (
      await this.simctl.exec(['getenv', assertUdid(this.udid), 'RWI_LISTEN_SOCKET'])
    ).trim();
    const c = await Conversation.open(path);
    try {
      const list = await c.until(
        (m) => m.__selector === '_rpc_reportConnectedApplicationList:',
        CONNECT_MS,
      );
      if (!list) throw new DeviceError('TIMEOUT', 'the Safari inspector said nothing');
      return await f(
        c,
        Object.values(list.__argument.WIRApplicationDictionaryKey as Record<string, App>),
      );
    } finally {
      c.close();
    }
  }

  pages(app: string | undefined): Promise<WebPage[]> {
    return this.talking(async (c, apps) => {
      const mine = apps.filter((a) => !app || bundleOf(a) === app);
      const host = (a: App) => a.WIRHostApplicationIdentifierKey as string | undefined;
      // a page in another process may hang off the app as its proxy
      const asked = [
        ...mine,
        ...apps.filter((a) => !mine.includes(a) && mine.some((m) => appKeyOf(m) === host(a))),
      ];
      const pages: WebPage[] = [];
      for (const a of asked) {
        c.send('_rpc_forwardGetListing:', { WIRApplicationIdentifierKey: appKeyOf(a) });
        const m = await c.until(
          (x) =>
            x.__selector === '_rpc_applicationSentListing:' &&
            x.__argument.WIRApplicationIdentifierKey === appKeyOf(a),
          LISTING_MS,
        );
        const listing = (m?.__argument.WIRListingKey ?? {}) as Record<
          string,
          Record<string, Plist>
        >;
        for (const p of Object.values(listing))
          if (p.WIRTypeKey === 'WIRTypeWebPage' || p.WIRTypeKey === 'WIRTypeWeb')
            pages.push({
              id: `${appKeyOf(a)}/${String(p.WIRPageIdentifierKey)}`,
              title: String(p.WIRTitleKey ?? ''),
              url: String(p.WIRURLKey ?? ''),
              ...(bundleOf(a) && { app: bundleOf(a)! }),
              ...(a.WIRIsApplicationActiveKey === IN_FRONT && { visible: true }),
            });
      }
      return pages;
    });
  }

  evaluate(page: WebPage, script: string): Promise<unknown> {
    const at = page.id.lastIndexOf('/');
    const application = page.id.slice(0, at);
    const pageId = Number(page.id.slice(at + 1));
    const sender = randomUUID().toUpperCase();
    const toPage = {
      WIRApplicationIdentifierKey: application,
      WIRPageIdentifierKey: pageId,
      WIRSenderKey: sender,
    };
    return this.talking(async (c) => {
      c.send('_rpc_forwardSocketSetup:', {
        ...toPage,
        WIRMessageDataTypeChunkSupportedKey: 0,
        WIRAutomaticallyPause: false,
      });
      const fromPage = async (
        met: (j: { method?: string; params?: Record<string, never> }) => boolean,
      ) => {
        const m = await c.until((x) => {
          if (x.__selector !== '_rpc_applicationSentData:') return false;
          return met(JSON.parse(String(x.__argument.WIRMessageDataKey)) as never);
        }, ANSWER_MS);
        if (!m)
          throw new DeviceError('TIMEOUT', `the page ${page.title || page.id} did not answer`);
        return JSON.parse(String(m.__argument.WIRMessageDataKey)) as {
          params: { targetInfo: { targetId: string }; message: string };
        };
      };
      const created = await fromPage((j) => j.method === 'Target.targetCreated');
      const targetId = created.params.targetInfo.targetId;
      c.send('_rpc_forwardSocketData:', {
        ...toPage,
        WIRSocketDataKey: Buffer.from(
          JSON.stringify({
            id: 1,
            method: 'Target.sendMessageToTarget',
            params: {
              targetId,
              message: JSON.stringify({
                id: 2,
                method: 'Runtime.evaluate',
                params: { expression: script, returnByValue: true },
              }),
            },
          }),
        ),
      });
      const answer = await fromPage(
        (j) =>
          j.method === 'Target.dispatchMessageFromTarget' &&
          (JSON.parse((j.params as unknown as { message: string }).message) as { id?: number })
            .id === 2,
      );
      const r = JSON.parse(answer.params.message) as {
        result?: { result?: { value?: unknown; description?: string }; wasThrown?: boolean };
        error?: { message?: string };
      };
      if (r.error) throw new DeviceError('INTERNAL', `the page refused: ${r.error.message}`);
      if (r.result?.wasThrown)
        throw new DeviceError(
          'INVALID_ARGUMENT',
          `the script threw: ${r.result.result?.description ?? 'an error'}`,
        );
      return r.result?.result?.value;
    });
  }
}
