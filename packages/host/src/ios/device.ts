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
import { type ActOptions, TIMEOUTS } from '../android/device.js';
import { DeviceQueue } from '../queue.js';
import type { RpcClient } from '../rpc.js';
import { buildScreen, type Screen } from '../screen/index.js';
import { IosRunnerLauncher } from './runner.js';
import { assertBundle, Simctl } from './simctl.js';

/** The confirmation's button (English, Turkish). */
const OPEN = /^(Open|Aç)$/;

/** Read-only requests are retried once on a fresh connection when the runner went away. */
const RETRY_SAFE: ReadonlySet<Method> = new Set<Method>([
  'tree.get',
  'screenshot',
  'app.foreground',
  'clipboard.get',
]);

/**
 * An iOS simulator driven through the runner: every command has a timeout, commands never overlap,
 * failures are typed DeviceErrors. App lifecycle, links and location go through the simulator tool.
 * Coordinates are points.
 */
export class IosSimulatorDevice {
  readonly platform = 'ios' as const;
  private rpc: RpcClient | undefined;
  private connecting: Promise<RpcClient> | undefined;
  private helloInfo: Hello | undefined;
  private readonly queue = new DeviceQueue();
  private readonly launcher: IosRunnerLauncher;
  /** The app the runner reads and acts on (set by launch, openUrl with a bundle, or target). */
  private targetApp: string | undefined;
  lastStartWasCold = false;

  constructor(
    readonly serial: string,
    private readonly simctl: Simctl = new Simctl(),
  ) {
    this.launcher = new IosRunnerLauncher(serial);
  }

  async open(): Promise<Hello> {
    await this.queue.run(() => this.ensure());
    return this.helloInfo!;
  }

  get hello(): Hello | undefined {
    return this.helloInfo;
  }

  private ensure(): Promise<RpcClient> {
    if (this.rpc && !this.rpc.closed) return Promise.resolve(this.rpc);
    this.connecting ??= (async () => {
      if ((await this.simctl.state(this.serial)) !== 'Booted')
        throw new DeviceError(
          'DEVICE_GONE',
          `simulator ${this.serial} is not booted`,
          'boot it first',
        );
      const { rpc, hello, started } = await this.launcher.connect(this.targetApp);
      if (this.targetApp)
        await rpc.call('app.target', { pkg: this.targetApp }, { timeoutMs: TIMEOUTS.action });
      this.rpc = rpc;
      this.helloInfo = hello;
      this.lastStartWasCold = started;
      return rpc;
    })().finally(() => (this.connecting = undefined));
    return this.connecting;
  }

  private call<M extends Method>(method: M, params: ParamsOf<M>, timeoutMs: number) {
    return this.queue.run(async () => {
      try {
        return await (await this.ensure()).call(method, params, { timeoutMs });
      } catch (e) {
        const lost = e instanceof DeviceError && e.code === 'AGENT_UNAVAILABLE';
        if (!lost || !RETRY_SAFE.has(method)) throw e;
        this.rpc = undefined;
        return (await this.ensure()).call(method, params, { timeoutMs });
      }
    });
  }

  async tree(opts: { maxDepth?: number; maxNodes?: number } = {}): Promise<Tree> {
    return (await this.call('tree.get', opts, TIMEOUTS.read)).result;
  }

  async read(appId?: string): Promise<Screen> {
    return buildScreen(await this.tree(), { platform: 'ios', ...(appId && { appId }) });
  }

  async act(action: ActParams, opts: ActOptions = {}): Promise<ActResult> {
    const settle = opts.settle === false ? undefined : (opts.settle ?? {});
    const cap = settle ? (settle.maxMs ?? 3_000) : 0;
    const extra = action.kind === 'longPress' || action.kind === 'swipe' ? action.durationMs : 0;
    const { result } = await this.call(
      'act',
      {
        action,
        ...(settle && { settle }),
        read: opts.read ?? 'none',
        ...(opts.before && { before: opts.before }),
      },
      TIMEOUTS.action + cap + extra,
    );
    return result;
  }

  tap(p: Point, opts?: ActOptions) {
    return this.act({ kind: 'tap', x: p.x, y: p.y }, opts);
  }
  longPress(p: Point, durationMs = 800, opts?: ActOptions) {
    return this.act({ kind: 'longPress', x: p.x, y: p.y, durationMs }, opts);
  }
  swipe(from: Point, to: Point, durationMs = 300, opts?: ActOptions) {
    return this.act({ kind: 'swipe', from, to, durationMs }, opts);
  }
  key(key: Key, opts?: ActOptions) {
    return this.act({ kind: 'key', key }, opts);
  }

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

  async setOrientation(rotation: 0 | 1 | 2 | 3) {
    await this.call('orientation.set', { rotation }, TIMEOUTS.action);
  }

  /** The app the runner reads and acts on while it is in front. */
  async target(bundle: string) {
    this.targetApp = assertBundle(bundle);
    await this.call('app.target', { pkg: bundle }, TIMEOUTS.action);
  }

  /** Opens a link; `pkg` names the app that should handle it (it becomes the target). */
  async openUrl(url: string, pkg?: string) {
    if (pkg) await this.target(pkg);
    await this.queue.run(() => this.simctl.openUrl(this.serial, url));
    // a link to an app asks "Open in …?" first: with the app named, its Open button is tapped
    if (!pkg) return;
    // shortcut: the prompt is looked for during 1 s after every link to an app, without it the link costs that second
    const end = Date.now() + 1_000;
    while (Date.now() < end) {
      const t = await this.tree();
      const open = t.nodes.find(
        (n) => t.windows[n.w]?.type === 3 && n.c === 'Button' && OPEN.test(n.d ?? ''),
      );
      if (open) {
        await this.tap(
          { x: (open.b[0] + open.b[2]) / 2, y: (open.b[1] + open.b[3]) / 2 },
          { settle: false },
        );
        return;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  async launch(pkg: string): Promise<string> {
    const out = await this.queue.run(() => this.simctl.launch(this.serial, assertBundle(pkg)));
    await this.target(pkg);
    return out;
  }

  async terminate(pkg: string) {
    await this.queue.run(() => this.simctl.terminate(this.serial, assertBundle(pkg)));
  }

  async setLocation(lat: number, lon: number) {
    if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180))
      throw new DeviceError('INVALID_ARGUMENT', 'latitude/longitude out of range');
    await this.queue.run(() => this.simctl.setLocation(this.serial, lat, lon));
  }

  close() {
    this.rpc?.close();
    this.rpc = undefined;
  }

  /** Stops the runner (its xcodebuild ends). */
  async stopAgent() {
    const rpc = this.rpc;
    this.rpc = undefined;
    await this.launcher.stop(rpc);
    rpc?.close();
  }
}
