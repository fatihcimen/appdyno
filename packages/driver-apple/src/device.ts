import type { CrashesAnswer, CrashesQuery, LogsAnswer, LogsQuery } from '@appdyno/core';
import { simulatorCrashes } from './crashes.js';
import { simulatorLogs } from './logs.js';
import {
  DeviceError,
  type ActParams,
  type ActResult,
  type AuditResult,
  type AuditType,
  type Hello,
  type Key,
  type Method,
  type ParamsOf,
  type Point,
  type ResultOf,
  type TextResult,
  type Tree,
} from '@appdyno/protocol';
import {
  afterTimeout,
  buildScreen,
  DeviceQueue,
  fold,
  stateDir,
  TIMEOUTS,
  type ActOptions,
  type Device,
  type RpcClient,
  type Screen,
} from '@appdyno/core';
import { IosSimulatorPerf } from './perf.js';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { IosRunnerLauncher } from './runner.js';
import { recordHitches } from './trace.js';
import { assertBundle, Simctl } from './simctl.js';

/** Diagnostics: while this file exists, iOS tree reads are written to DUMP_DIR. */
const DUMP_FLAG = join(homedir(), 'Library/Caches/appdyno/dump-trees');
const DUMP_DIR = join(homedir(), 'Library/Caches/appdyno/tree-dumps');

/**
 * The confirming button of a system prompt over the screen ("Open in …?" after a link): of two buttons
 * the second (the first cancels, in any language), else one that says `words`.
 */
// shortcut: a two-button system prompt that is not the link's (a notification prompt) within the 3 s
// after a link is answered as confirmed; tell them apart by the prompt's text if one shows up there
export function promptButton(t: Tree, words: RegExp = /^open$/): Point | undefined {
  const buttons = t.nodes.filter((n) => t.windows[n.w]?.type === 3 && n.c === 'Button');
  const b = buttons.length === 2 ? buttons[1] : buttons.find((n) => words.test(fold(n.d ?? '')));
  return b && { x: (b.b[0] + b.b[2]) / 2, y: (b.b[1] + b.b[3]) / 2 };
}

/** Read-only requests are retried once on a fresh connection when the runner went away. */
const RETRY_SAFE: ReadonlySet<Method> = new Set<Method>([
  'tree.get',
  'screenshot',
  'app.foreground',
  'clipboard.get',
]);

/** What differs between a simulator and a phone: whether it is up, app lifecycle, links, location. */
export type IosDeviceOps = {
  /** Up and usable (a simulator booted, a phone connected); asked only before a new runner starts. */
  up(): Promise<boolean>;
  launch(bundle: string): Promise<string>;
  terminate(bundle: string): Promise<void>;
  openUrl(url: string, bundle?: string): Promise<void>;
  setLocation(lat: number, lon: number): Promise<void>;
  /** A link to an app first asks "Open in …?" (the simulator does, a link given to the app does not). */
  linkPrompt: boolean;
  /** The device, for messages. */
  name: string;
  /** The process id of a running app (for the trace tool). */
  pid(bundle: string): Promise<number>;
  logs(q: LogsQuery): Promise<LogsAnswer>;
  crashes(q: CrashesQuery): Promise<CrashesAnswer>;
};

export function simulatorOps(udid: string, simctl: Simctl): IosDeviceOps {
  return {
    up: async () => (await simctl.state(udid)) === 'Booted',
    launch: (b) => simctl.launch(udid, b),
    terminate: (b) => simctl.terminate(udid, b),
    openUrl: async (url) => {
      await simctl.openUrl(udid, url);
    },
    setLocation: async (lat, lon) => {
      await simctl.setLocation(udid, lat, lon);
    },
    linkPrompt: true,
    logs: (q) => simulatorLogs(simctl, udid, q),
    crashes: (q) => simulatorCrashes(udid, q),
    name: `simulator ${udid}`,
    pid: async (b) => {
      const out = await simctl.exec(['spawn', udid, 'launchctl', 'list']);
      const pid = Number(
        out
          .split('\n')
          .find((l) => l.includes(`UIKitApplication:${b}[`))
          ?.trim()
          .split(/\s+/)[0],
      );
      if (!Number.isInteger(pid) || pid <= 0)
        throw new DeviceError('APP_NOT_RUNNING', `${b} is not running`);
      return pid;
    },
  };
}

/**
 * An iOS device driven through the runner: every command has a timeout, commands never overlap,
 * failures are typed DeviceErrors. App lifecycle, links and location go through the device's own
 * tool (`ops`). Coordinates are points.
 */
export class IosDevice implements Device {
  readonly platform = 'ios' as const;
  private rpc: RpcClient | undefined;
  private connecting: Promise<RpcClient> | undefined;
  private helloInfo: Hello | undefined;
  private readonly queue = new DeviceQueue();
  /** The app the runner reads and acts on (set by launch, openUrl with a bundle, or target). */
  private targetApp: string | undefined;
  lastStartWasCold = false;

  constructor(
    readonly serial: string,
    protected readonly ops: IosDeviceOps,
    private readonly launcher: IosRunnerLauncher,
  ) {}

  logs = (q: LogsQuery) => this.ops.logs(q);
  crashes = (q: CrashesQuery) => this.ops.crashes(q);
  appRunning = (app: string) =>
    this.ops.pid(app).then(
      () => true,
      () => false,
    );

  /** Before a new runner starts: the device must be up (a new runner would boot a shut-down simulator). */
  protected async prepareStart(): Promise<void> {
    if (!(await this.ops.up()))
      throw new DeviceError(
        'DEVICE_GONE',
        `${this.ops.name} is not up`,
        'boot or connect it first',
      );
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
      const { rpc, hello, started } = await this.launcher.connect(this.targetApp, () =>
        this.prepareStart(),
      );
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
      let rpc: RpcClient | undefined;
      try {
        rpc = await this.ensure();
        return await rpc.call(method, params, { timeoutMs });
      } catch (e) {
        const lost = e instanceof DeviceError && e.code === 'AGENT_UNAVAILABLE';
        // the runner works on its main thread, one job at a time: a stuck job holds every later one
        if (!lost) throw await afterTimeout(e, rpc, () => this.restartStuck(rpc!));
        if (!RETRY_SAFE.has(method)) throw e;
        this.rpc = undefined;
        return (await this.ensure()).call(method, params, { timeoutMs });
      }
    });
  }

  /** A runner whose main thread stays stuck: stopped (its xcodebuild ends), the next call starts one. */
  private async restartStuck(rpc: RpcClient) {
    if (this.rpc === rpc) this.rpc = undefined;
    await this.launcher.stop(rpc);
    rpc.close();
  }

  async tree(opts: { maxDepth?: number; maxNodes?: number } = {}): Promise<Tree> {
    const t = (await this.call('tree.get', opts, TIMEOUTS.read)).result;
    // diagnostics: while the flag file exists, every read is kept (this machine only)
    if (existsSync(DUMP_FLAG))
      await mkdir(DUMP_DIR, { recursive: true, mode: 0o700 })
        .then(() =>
          writeFile(
            join(DUMP_DIR, `${Date.now()}-${this.serial.slice(0, 8)}.json`),
            JSON.stringify(t),
            { mode: 0o600 },
          ),
        )
        .catch(() => undefined);
    return t;
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

  /**
   * The platform accessibility audit of the app in front (the runner's `audit`, Xcode's audit types);
   * UNSUPPORTED from a runner built without it or where the platform cannot run it.
   */
  async audit(opts: { types?: AuditType[]; maxIssues?: number } = {}): Promise<AuditResult> {
    const hello = await this.open();
    if (!hello.capabilities.includes('audit'))
      throw new DeviceError(
        'UNSUPPORTED',
        'this runner has no platform accessibility audit',
        'rebuild the runner (appdyno ios build)',
      );
    const { result } = await this.call('audit', opts, TIMEOUTS.audit);
    return { engine: 'platform', ...result };
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

  /**
   * Opens a link; `pkg` names the app that should handle it (it becomes the target). A link to an app
   * first asks "Open in …?": with the app named, the prompt's Open button is tapped.
   */
  async openUrl(url: string, pkg?: string) {
    if (pkg) await this.target(pkg);
    await this.queue.run(() => this.ops.openUrl(url, pkg));
    if (!pkg || !this.ops.linkPrompt) return;
    // shortcut: the prompt is looked for during 3 s after every link to an app; a link without one costs that time
    const end = Date.now() + 3_000;
    while (Date.now() < end) {
      const open = promptButton(await this.tree());
      if (open) {
        await this.tap(open, { settle: false });
        return;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  async launch(pkg: string): Promise<string> {
    const out = await this.queue.run(() => this.ops.launch(assertBundle(pkg)));
    await this.target(pkg);
    // returns once the app is in front: a read during the launch would get the home screen, slowly
    const end = Date.now() + 10_000;
    while ((await this.foreground()) !== pkg && Date.now() < end)
      await new Promise((r) => setTimeout(r, 100));
    return out;
  }

  async terminate(pkg: string) {
    await this.queue.run(() => this.ops.terminate(assertBundle(pkg)));
    // returns once the app has left the front (the runner may see it there for a moment)
    if (!this.rpc || this.rpc.closed) return;
    const end = Date.now() + 3_000;
    while ((await this.foreground()) === pkg && Date.now() < end)
      await new Promise((r) => setTimeout(r, 100));
  }

  async setLocation(lat: number, lon: number) {
    if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180))
      throw new DeviceError('INVALID_ARGUMENT', 'latitude/longitude out of range');
    await this.queue.run(() => this.ops.setLocation(lat, lon));
  }

  /**
   * Animation hitches of the app while `during` runs (Xcode's trace tool, Animation Hitches): frames
   * shown, the app's hitches, their time; the trace is kept for Instruments.
   */
  async hitches(bundle: string, seconds = 5, during?: () => Promise<unknown>) {
    const pid = await this.ops.pid(assertBundle(bundle));
    return recordHitches(
      this.serial,
      pid,
      Math.min(Math.max(Math.round(seconds), 1), 30),
      join(stateDir(), 'traces'),
      during,
    );
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

/** An iOS simulator: the simulator tool for apps, links and location; perf from the Mac. */
export class IosSimulatorDevice extends IosDevice {
  constructor(
    serial: string,
    private readonly simctl: Simctl = new Simctl(),
  ) {
    super(serial, simulatorOps(serial, simctl), new IosRunnerLauncher(serial));
  }

  /** The trace tool's Animation Hitches recording fails on simulators (measured on Xcode 27.1). */
  override hitches(): never {
    throw new DeviceError(
      'UNSUPPORTED',
      'animation hitches are recorded on an iPhone only',
      'use a phone',
    );
  }

  /** The app's performance, measured from the Mac (memory, CPU, launch, CPU profile). */
  get measure(): IosSimulatorPerf {
    return (this.perfTools ??= new IosSimulatorPerf(this.serial, this.simctl, async (bundle) => {
      const t = await this.tree().catch(() => undefined);
      return !!t && t.windows[0]?.pkg === bundle && t.nodes.filter((n) => n.w === 0).length > 3;
    }));
  }
  private perfTools: IosSimulatorPerf | undefined;
}
