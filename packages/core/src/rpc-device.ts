import {
  DeviceError,
  Settle,
  type ActParams,
  type ActResult,
  type ErrorCode,
  type Hello,
  type Method,
  type Modifier,
  type ParamsOf,
  type Platform,
  type Point,
  type ResultOf,
  type TextResult,
  type Tree,
} from '@appdyno/protocol';
import { agentMet } from './agent-hosts.js';
import { must } from './must.js';
import { TIMEOUTS, type ActOptions, type TreeOptions } from './device.js';
import { DeviceQueue } from './queue.js';
import type { RpcClient } from './rpc.js';
import { buildScreen, type PlatformScreen, type Screen } from './screen/index.js';
import { afterTimeout } from './stuck.js';

/** What an agent refuses before it touches anything: any other failure of an action may have come after the touch. */
const REFUSED_FIRST: ReadonlySet<ErrorCode> = new Set([
  'AGENT_CONFLICT',
  'AGENT_VERSION_MISMATCH',
  'INVALID_ARGUMENT',
  'NO_FOCUS',
  'PERMISSION_REQUIRED',
  'POLICY_DENIED',
  'SCREEN_OFF',
  'STALE',
  'UNSUPPORTED',
]);

/** The failure of an action that left for the device. */
export function failedAfterSending(e: unknown): never {
  if (e instanceof DeviceError && !REFUSED_FIRST.has(e.code)) e.sent = true;
  throw e;
}

const closedHere = () => new DeviceError('AGENT_UNAVAILABLE', 'the connection was closed');

/** The touches and keys every device words as one `act`. */
export abstract class DeviceActions {
  abstract act(action: ActParams, opts?: ActOptions): Promise<ActResult>;

  tap(p: Point, opts?: ActOptions) {
    return this.act({ kind: 'tap', x: p.x, y: p.y }, opts);
  }
  longPress(p: Point, durationMs = 800, opts?: ActOptions) {
    return this.act({ kind: 'longPress', x: p.x, y: p.y, durationMs }, opts);
  }
  swipe(from: Point, to: Point, durationMs = 300, opts?: ActOptions) {
    return this.act({ kind: 'swipe', from, to, durationMs }, opts);
  }
  key(key: string, opts?: ActOptions, modifiers: Modifier[] = []): Promise<ActResult> {
    return this.act({ kind: 'key', key, ...(modifiers.length > 0 && { modifiers }) }, opts);
  }
}

/**
 * A device driven through its on-device agent: every command has a timeout, commands never overlap,
 * failures are typed DeviceErrors. A platform's driver says how to connect and how to read.
 */
export abstract class RpcDevice extends DeviceActions {
  abstract readonly platform: Platform;
  abstract readonly serial: string;
  abstract readonly platformScreen: PlatformScreen;
  protected rpc: RpcClient | undefined;
  private connecting: Promise<RpcClient> | undefined;
  protected helloInfo: Hello | undefined;
  protected readonly queue = new DeviceQueue();
  /** Whether the last connect started a new agent (a cold start), for measurements. */
  lastStartWasCold = false;

  get agentUp() {
    return !!this.rpc && !this.rpc.closed;
  }

  /** Read-only requests are retried once on a fresh connection when the agent went away. */
  protected abstract readonly retrySafe: ReadonlySet<Method>;
  /** Starts or finds the agent, ready for the commands of this device. */
  protected abstract startAgent(): Promise<{ rpc: RpcClient; hello: Hello; started: boolean }>;
  /** An agent whose work lane stays stuck: stopped, so the next call starts a new one. */
  protected abstract restartStuck(rpc: RpcClient): Promise<void>;
  abstract tree(opts?: TreeOptions): Promise<Tree>;

  /** Whether the device can be asked to `wait`; where not, the caller polls. */
  // eslint-disable-next-line @typescript-eslint/class-literal-property-style -- a simulator's own reads its state
  protected get waits() {
    return true;
  }

  waitChange = async (since: string | undefined, timeoutMs: number) => {
    if (!this.waits) return undefined;
    const { result } = await this.call(
      'wait',
      { ...(since && { since }), timeoutMs },
      TIMEOUTS.read + timeoutMs,
    );
    return { sig: result.sig, ...(result.tree && { tree: result.tree }) };
  };

  /** Connects (starting the agent when needed); the agent's hello. */
  async open(): Promise<Hello> {
    await this.queue.run(() => this.ensure());
    return must(this.helloInfo, "the agent's hello");
  }

  get hello(): Hello | undefined {
    return this.helloInfo;
  }

  /** The app a first call will launch, on its way while the device opens: each takes about as long. */
  private alongside: { pkg: string; began: Promise<boolean> } | undefined;

  launchAlongside(pkg: string) {
    const began = this.startAlongside(pkg);
    began.catch(() => undefined);
    this.alongside = { pkg, began };
  }

  /** Begins the app's launch, where nothing can go wrong for that; false: `launch` does it. */
  protected startAlongside(_pkg: string): Promise<boolean> {
    return Promise.resolve(false);
  }

  /** Whether the launch that began alongside was this app's; `launch` takes it up once. */
  protected async launchedAlongside(pkg: string): Promise<boolean> {
    const was = this.alongside;
    this.alongside = undefined;
    return was?.pkg === pkg ? was.began : false;
  }

  /** Counts `close`: what began before one must not connect, as nothing would then close that connection. */
  private closes = 0;

  private async connect() {
    const closes = this.closes;
    const { rpc, hello, started } = await this.startAgent();
    if (closes !== this.closes) {
      rpc.close();
      throw closedHere();
    }
    this.rpc = rpc;
    this.helloInfo = hello;
    this.lastStartWasCold = started;
    agentMet(this.serial, hello.pid);
    return rpc;
  }

  /** Whether an agent is on its way up. */
  protected get agentStarting() {
    return this.connecting !== undefined;
  }

  protected ensure(): Promise<RpcClient> {
    if (this.rpc && !this.rpc.closed) return Promise.resolve(this.rpc);
    this.connecting ??= this.connect().finally(() => (this.connecting = undefined));
    return this.connecting;
  }

  protected call<M extends Method>(method: M, params: ParamsOf<M>, timeoutMs: number) {
    const closes = this.closes;
    return this.queue.run(() => this.callNow(method, params, timeoutMs, closes));
  }

  /** The agent's method, for one already in the queue. */
  protected async callNow<M extends Method>(
    method: M,
    params: ParamsOf<M>,
    timeoutMs: number,
    closes = this.closes,
  ) {
    let rpc: RpcClient | undefined;
    try {
      if (closes !== this.closes) throw closedHere();
      rpc = await this.ensure();
      return await rpc.call(method, params, { timeoutMs });
    } catch (e) {
      // no connection to lose: a start that failed takes as long again, for the same answer
      if (!this.connectionLost(e, rpc))
        throw await afterTimeout(e, rpc, (stuck) => this.restartStuck(stuck));
      // closed here is not lost: a connection that dropped is worth a new one, and this one was let go
      if (closes !== this.closes || !this.retrySafe.has(method)) throw e;
      this.rpc = undefined;
      await this.beforeRetry(e);
      return (await this.ensure()).call(method, params, { timeoutMs });
    }
  }

  protected connectionLost(e: unknown, had: RpcClient | undefined) {
    return !!had && e instanceof DeviceError && e.code === 'AGENT_UNAVAILABLE';
  }

  protected beforeRetry(_lost: unknown): Promise<void> {
    return Promise.resolve();
  }

  /** The screen with stable refs. */
  async read(appId?: string): Promise<Screen> {
    return buildScreen(await this.tree(), { port: this.platformScreen, ...(appId && { appId }) });
  }

  /** The agent's `act`, for one already in the queue; `extraMs` is what the action itself takes. */
  protected async actNow(action: ActParams, opts: ActOptions, extraMs: number): Promise<ActResult> {
    const settle = opts.settle === false ? undefined : Settle.parse(opts.settle ?? {});
    const { result } = await this.callNow(
      'act',
      {
        action,
        ...(settle && { settle }),
        read: opts.read ?? 'none',
        ...(opts.before && { before: opts.before }),
        ...(opts.pidOf && { pidOf: opts.pidOf }),
      },
      TIMEOUTS.action + (settle?.maxMs ?? 0) + extraMs,
    ).catch(failedAfterSending);
    return result;
  }

  /** Types into the focused field (or the field at `at`, tapped first); `replace` sets its whole text. */
  async typeText(
    text: string,
    opts: {
      at?: Point;
      replace?: boolean;
      submit?: boolean;
      focusTimeoutMs?: number;
    } & ActOptions = {},
  ): Promise<TextResult> {
    const settle = opts.settle === false ? undefined : Settle.parse(opts.settle ?? {});
    const { result } = await this.call(
      'text.set',
      {
        text,
        replace: opts.replace ?? false,
        submit: opts.submit ?? false,
        ...(opts.at && { at: opts.at }),
        ...(opts.focusTimeoutMs !== undefined && { focusTimeoutMs: opts.focusTimeoutMs }),
        ...(settle && { settle }),
        read: opts.read ?? 'none',
        ...(opts.pidOf && { pidOf: opts.pidOf }),
      },
      TIMEOUTS.text + (settle?.maxMs ?? 0),
    ).catch(failedAfterSending);
    return result;
  }

  async screenshot(
    opts: ParamsOf<'screenshot'> = {},
  ): Promise<{ meta: ResultOf<'screenshot'>; data: Buffer }> {
    const r = await this.call('screenshot', opts, TIMEOUTS.screenshot);
    if (!r.binary) throw new DeviceError('INTERNAL', 'the screenshot came without its image');
    return { meta: r.result, data: r.binary };
  }

  async foreground(): Promise<string | undefined> {
    return (await this.call('app.foreground', {}, TIMEOUTS.read)).result.pkg;
  }

  /** Past the queue: an agent answers a ping at once, whatever it is doing, and the time it took is what counts. */
  async wallClock(): Promise<number> {
    const { result } = await (await this.ensure()).call('ping', {}, { timeoutMs: TIMEOUTS.read });
    return result.atMs;
  }

  async setClipboard(text: string) {
    await this.call('clipboard.set', { text }, TIMEOUTS.action);
  }
  async getClipboard(): Promise<string | undefined> {
    return (await this.call('clipboard.get', {}, TIMEOUTS.action)).result.text;
  }

  /** 0 portrait, 1 landscape (90°), 2 upside down, 3 landscape (270°); the rotation stays frozen. */
  async setOrientation(rotation: 0 | 1 | 2 | 3, kept = false) {
    await this.call('orientation.set', { rotation, ...(kept && { kept }) }, TIMEOUTS.action);
  }

  /** Closes the connection; what runs on the device stays for the next host. */
  close() {
    this.closes++;
    this.rpc?.close();
    this.rpc = undefined;
  }
}

/** A position a device can be told it is at, or a refusal. */
export function assertLatLon(lat: number, lon: number) {
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180))
    throw new DeviceError('INVALID_ARGUMENT', 'latitude/longitude out of range');
}
