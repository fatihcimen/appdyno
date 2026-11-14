import { randomUUID } from 'node:crypto';
import { connect, type Socket } from 'node:net';
import { reportProgress, type WebInspector, type WebPage } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { assertUdid, type Simctl } from './simctl.js';

export * from './bplist.js';
import { type Plist, plistText, readBplist, writeBplist } from './bplist.js';

/**
 * A simulator's inspector serves a new connection some 10 s after the last one closed; one opened at once after a close
 * it closes, where the one after it is served.
 */
const LIST_MS = 15_000;
/** How often a wait for the app list says it still waits. */
const PROGRESS_MS = 3_000;
const ANSWER_MS = 15_000;
/** An app that holds no page says nothing at all to a request for its listing. */
const LISTING_MS = 1_500;
/** How long the connection outlives its last call, for the next call to find it open. */
const IDLE_MS = 60_000;
/** `WIRIsApplicationActiveKey`: 2 is in front. */
const IN_FRONT = 2;

const NOT_LISTED_HINT =
  "ask again: the simulator's inspector takes a new connection some 10 s after the last one closed, and now and then not at all";

type Rpc = { __selector: string; __argument: Record<string, unknown> };
type App = Record<string, Plist>;

const isList = (m: Rpc) => m.__selector === '_rpc_reportConnectedApplicationList:';

/** One conversation with a simulator's `webinspectord`: messages each way, and a wait for one. */
class Conversation {
  private readonly id = randomUUID().toUpperCase();
  private rest = Buffer.alloc(0);
  private readonly seen: Rpc[] = [];
  private wake: (() => void) | undefined;
  closed = false;

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
    // kept between calls: a wait for an answer holds the process, an open connection does not
    socket.unref();
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
    // what came before a request is not its answer, and a connection kept open would hold it for ever
    this.seen.length = 0;
    const body = writeBplist({
      __selector: selector,
      __argument: { WIRConnectionIdentifierKey: this.id, ...argument },
    });
    const head = Buffer.alloc(4);
    head.writeUInt32BE(body.length);
    this.socket.write(Buffer.concat([head, body]));
  }

  /** The first message since the last request that `met` takes, or undefined after `ms`. */
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
  /** Kept between calls: a page's listing and its script would otherwise be two connections, 10 s apart. */
  private held: Conversation | undefined;
  /** One call at a time on it, as each waits for the answer to what it sent. */
  private turn: Promise<unknown> = Promise.resolve();
  private idle: NodeJS.Timeout | undefined;

  constructor(
    private readonly simctl: Simctl,
    private readonly udid: string,
  ) {}

  /** A connection the inspector has listed its apps on: one it leaves unserved is closed for another. */
  private async connect(): Promise<Conversation> {
    // read again for each: a boot gives the socket a new path
    const path = (
      await this.simctl.exec(['getenv', assertUdid(this.udid), 'RWI_LISTEN_SOCKET'])
    ).trim();
    const started = Date.now();
    for (let tries = 0; tries < 2; tries++) {
      const c = await Conversation.open(path);
      for (let waited = PROGRESS_MS; ; waited += PROGRESS_MS) {
        if (await c.until(isList, PROGRESS_MS)) return c;
        if (c.closed || waited >= LIST_MS) break;
        reportProgress(
          `the Safari inspector has said nothing for ${Math.round((Date.now() - started) / 1000)} s: a simulator's takes a new connection some 10 s after the last one closed`,
        );
      }
      c.close();
    }
    throw new DeviceError('TIMEOUT', 'the Safari inspector said nothing', NOT_LISTED_HINT);
  }

  /** `f` on the kept connection, opened if there is none; a call that failed closes it, for the next to open another. */
  private talking<T>(f: (c: Conversation) => Promise<T>): Promise<T> {
    const call = this.turn.then(async () => {
      clearTimeout(this.idle);
      try {
        if (this.held?.closed) this.held = undefined;
        return await f((this.held ??= await this.connect()));
      } catch (e) {
        this.close();
        throw e;
      } finally {
        if (this.held) this.idle = setTimeout(() => this.close(), IDLE_MS).unref();
      }
    });
    this.turn = call.catch(() => undefined);
    return call;
  }

  /** Closes the kept connection: the next call opens another. */
  close() {
    clearTimeout(this.idle);
    this.held?.close();
    this.held = undefined;
  }

  pages(app: string | undefined): Promise<WebPage[]> {
    return this.talking(async (c) => {
      // asked each time: an app may have come or gone since the connection opened
      c.send('_rpc_getConnectedApplications:', {});
      const list = await c.until(isList, ANSWER_MS);
      if (!list)
        throw new DeviceError('TIMEOUT', 'the Safari inspector said nothing', NOT_LISTED_HINT);
      const apps = Object.values(
        list.__argument.WIRApplicationDictionaryKey as Record<string, App>,
      );
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
          Record<string, unknown>
        >;
        const app = bundleOf(a);
        for (const p of Object.values(listing))
          if (p.WIRTypeKey === 'WIRTypeWebPage' || p.WIRTypeKey === 'WIRTypeWeb')
            pages.push({
              id: `${appKeyOf(a)}/${String(p.WIRPageIdentifierKey)}`,
              title: plistText(p.WIRTitleKey),
              url: plistText(p.WIRURLKey),
              ...(app && { app }),
              ...(a.WIRIsApplicationActiveKey === IN_FRONT && { visible: true }),
            });
      }
      return pages;
    });
  }

  async evaluate(page: WebPage, script: string): Promise<unknown> {
    const at = page.id.lastIndexOf('/');
    const application = page.id.slice(0, at);
    const pageId = Number(page.id.slice(at + 1));
    const sender = randomUUID().toUpperCase();
    const toPage = {
      WIRApplicationIdentifierKey: application,
      WIRPageIdentifierKey: pageId,
      WIRSenderKey: sender,
    };
    // the page's own answers: a refusal or a throw leaves the connection open
    const r = await this.talking(async (c) => {
      c.send('_rpc_forwardSocketSetup:', {
        ...toPage,
        WIRMessageDataTypeChunkSupportedKey: 0,
        WIRAutomaticallyPause: false,
      });
      const fromPage = async (
        met: (j: { method?: string; params?: Record<string, never> }) => boolean,
      ) => {
        const m = await c.until((x) => {
          // an earlier call's page may still be talking on the same connection
          if (x.__selector !== '_rpc_applicationSentData:') return false;
          if (x.__argument.WIRDestinationKey !== sender) return false;
          return met(JSON.parse(String(x.__argument.WIRMessageDataKey)) as never);
        }, ANSWER_MS);
        if (!m)
          throw new DeviceError(
            'TIMEOUT',
            `the page ${page.title || page.id} did not answer`,
            'a dialog or a long script may hold the page, or it is gone: list the pages and ask again',
          );
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
      // the connection outlives the call, and the page's end of it would too; a failure closes both
      c.send('_rpc_forwardDidClose:', toPage);
      return JSON.parse(answer.params.message) as {
        result?: { result?: { value?: unknown; description?: string }; wasThrown?: boolean };
        error?: { message?: string };
      };
    });
    if (r.error) throw new DeviceError('INTERNAL', `the page refused: ${String(r.error.message)}`);
    if (r.result?.wasThrown)
      throw new DeviceError(
        'INVALID_ARGUMENT',
        `the script threw: ${r.result.result?.description ?? 'an error'}`,
      );
    return r.result?.result?.value;
  }
}
