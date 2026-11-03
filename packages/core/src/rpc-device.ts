import {
  DeviceError,
  type ActParams,
  type ActResult,
  type Hello,
  type Key,
  type Method,
  type ParamsOf,
  type Point,
  type ResultOf,
  type TextResult,
  type Tree,
} from '@appdyno/protocol';
import { TIMEOUTS, type ActOptions } from './device.js';
import { DeviceQueue } from './queue.js';
import type { RpcClient } from './rpc.js';
import { buildScreen, type Screen } from './screen/index.js';
import { afterTimeout } from './stuck.js';

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
  key(key: Key, opts?: ActOptions): Promise<ActResult> {
    return this.act({ kind: 'key', key }, opts);
  }
}

/**
 * A device driven through its on-device agent: every command has a timeout, commands never overlap,
 * failures are typed DeviceErrors. A platform's driver says how to connect and how to read.
 */
export abstract class RpcDevice extends DeviceActions {
  abstract readonly platform: 'android' | 'ios';
  protected rpc: RpcClient | undefined;
  private connecting: Promise<RpcClient> | undefined;
  protected helloInfo: Hello | undefined;
  protected readonly queue = new DeviceQueue();
  /** Whether the last connect started a new agent (a cold start), for measurements. */
  lastStartWasCold = false;

  /** Read-only requests are retried once on a fresh connection when the agent went away. */
  protected abstract readonly retrySafe: ReadonlySet<Method>;
  /** Starts or finds the agent; sets `rpc`, `helloInfo` and `lastStartWasCold`. */
  protected abstract connect(): Promise<RpcClient>;
  /** An agent whose work lane stays stuck: stopped, so the next call starts a new one. */
  protected abstract restartStuck(rpc: RpcClient): Promise<void>;
  abstract tree(opts?: { maxDepth?: number; maxNodes?: number }): Promise<Tree>;

  waitChange = async (since: string | undefined, timeoutMs: number) => {
    if (!this.helloInfo?.capabilities.includes('wait')) return undefined;
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
    return this.helloInfo!;
  }

  get hello(): Hello | undefined {
    return this.helloInfo;
  }

  private ensure(): Promise<RpcClient> {
    if (this.rpc && !this.rpc.closed) return Promise.resolve(this.rpc);
    this.connecting ??= this.connect().finally(() => (this.connecting = undefined));
    return this.connecting;
  }

  protected call<M extends Method>(method: M, params: ParamsOf<M>, timeoutMs: number) {
    return this.queue.run(() => this.callNow(method, params, timeoutMs));
  }

  /** The agent's method, for one already in the queue. */
  protected async callNow<M extends Method>(method: M, params: ParamsOf<M>, timeoutMs: number) {
    let rpc: RpcClient | undefined;
    try {
      rpc = await this.ensure();
      return await rpc.call(method, params, { timeoutMs });
    } catch (e) {
      if (!this.connectionLost(e)) throw await afterTimeout(e, rpc, () => this.restartStuck(rpc!));
      if (!this.retrySafe.has(method)) throw e;
      this.rpc = undefined;
      await this.beforeRetry(e);
      return (await this.ensure()).call(method, params, { timeoutMs });
    }
  }

  protected connectionLost(e: unknown) {
    return e instanceof DeviceError && e.code === 'AGENT_UNAVAILABLE';
  }

  protected async beforeRetry(_lost: unknown): Promise<void> {}

  /** The screen with stable refs. */
  async read(appId?: string): Promise<Screen> {
    return buildScreen(await this.tree(), { platform: this.platform, ...(appId && { appId }) });
  }

  /** The agent's `act`, for one already in the queue; `extraMs` is what the action itself takes. */
  protected async actNow(action: ActParams, opts: ActOptions, extraMs: number): Promise<ActResult> {
    const settle = opts.settle === false ? undefined : (opts.settle ?? {});
    const cap = settle ? (settle.maxMs ?? 3_000) : 0;
    const { result } = await this.callNow(
      'act',
      {
        action,
        ...(settle && { settle }),
        read: opts.read ?? 'none',
        ...(opts.before && { before: opts.before }),
      },
      TIMEOUTS.action + cap + extraMs,
    );
    return result;
  }

  /** Types into the focused field (or the field at `at`, tapped first); `replace` sets its whole text. */
  async typeText(
    text: string,
    opts: { at?: Point; replace?: boolean; submit?: boolean } & ActOptions = {},
  ): Promise<TextResult> {
    const settle = opts.settle === false ? undefined : (opts.settle ?? {});
    const { result } = await this.call(
      'text.set',
      {
        text,
        replace: opts.replace ?? false,
        submit: opts.submit ?? false,
        ...(opts.at && { at: opts.at }),
        ...(settle && { settle }),
        read: opts.read ?? 'none',
      },
      TIMEOUTS.text + (settle?.maxMs ?? 3_000),
    );
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

  async setClipboard(text: string) {
    await this.call('clipboard.set', { text }, TIMEOUTS.action);
  }
  async getClipboard(): Promise<string | undefined> {
    return (await this.call('clipboard.get', {}, TIMEOUTS.action)).result.text;
  }

  /** 0 portrait, 1 landscape (90°), 2 upside down, 3 landscape (270°); the rotation stays frozen. */
  async setOrientation(rotation: 0 | 1 | 2 | 3) {
    await this.call('orientation.set', { rotation }, TIMEOUTS.action);
  }

  /** Closes the connection; what runs on the device stays for the next host. */
  close() {
    this.rpc?.close();
    this.rpc = undefined;
  }
}

/** A position a device can be told it is at, or a refusal. */
export function assertLatLon(lat: number, lon: number) {
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180))
    throw new DeviceError('INVALID_ARGUMENT', 'latitude/longitude out of range');
}
