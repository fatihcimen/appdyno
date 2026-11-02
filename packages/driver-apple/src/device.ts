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
import {
  actionable,
  DirectSim,
  hasAlert,
  learnCopies,
  sameContent,
  sameLayout,
  settle,
  withoutCopies,
} from './simdirect.js';
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
  protected readonly queue = new DeviceQueue();
  /** The app the runner reads and acts on (set by launch, openUrl with a bundle, or target). */
  protected targetApp: string | undefined;
  lastStartWasCold = false;

  constructor(
    readonly serial: string,
    protected readonly ops: IosDeviceOps,
    private readonly launcher: IosRunnerLauncher,
  ) {}

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
    return this.queue.run(() => this.callNow(method, params, timeoutMs));
  }

  /** The runner's method, for one already in the queue. */
  protected async callNow<M extends Method>(method: M, params: ParamsOf<M>, timeoutMs: number) {
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
  }

  /** A runner whose main thread stays stuck: stopped (its xcodebuild ends), the next call starts one. */
  private async restartStuck(rpc: RpcClient) {
    if (this.rpc === rpc) this.rpc = undefined;
    await this.launcher.stop(rpc);
    rpc.close();
  }

  async tree(opts: { maxDepth?: number; maxNodes?: number } = {}): Promise<Tree> {
    const t = (await this.call('tree.get', opts, TIMEOUTS.read)).result;
    await this.keepDump(t);
    return t;
  }

  /** Diagnostics: while the flag file exists, every read is kept (this machine only). */
  protected async keepDump(t: Tree) {
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
  }

  async read(appId?: string): Promise<Screen> {
    return buildScreen(await this.tree(), { platform: 'ios', ...(appId && { appId }) });
  }

  async act(action: ActParams, opts: ActOptions = {}): Promise<ActResult> {
    return this.queue.run(() => this.actByRunner(action, opts));
  }

  /** The action done by the runner, for one already in the queue. */
  protected async actByRunner(action: ActParams, opts: ActOptions): Promise<ActResult> {
    const settle = opts.settle === false ? undefined : (opts.settle ?? {});
    const cap = settle ? (settle.maxMs ?? 3_000) : 0;
    const extra = action.kind === 'longPress' || action.kind === 'swipe' ? action.durationMs : 0;
    const { result } = await this.callNow(
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

type Node = Tree['nodes'][number];
type Capture = { tree: Tree; busy: boolean; byRunner?: boolean };
const nodesBusy = (t: Tree) => t.nodes.some((n) => n.c === 'ActivityIndicator' && (n.f & 1) !== 0);
/** Reads cost about 30 ms here: the settle can look far more often than the runner's 80 ms. */
const POLL_MS = 20;
const INERT_QUIET_MS = 80;
const ALERT_WATCH_MS = 800;
const ALERT_APPEAR_MS = 450;
const ANIMATION_WAIT_MS = 1_000;

/** An iOS simulator: the simulator tool for apps, links and location; perf from the Mac. */
export class IosSimulatorDevice extends IosDevice {
  readonly virtual = true;
  readonly direct: DirectSim;
  /** Layouts recently answered, by hash: what an action's `before` names. */
  private readonly recent = new Map<string, Node[]>();
  private readonly copyVerdicts = new Map<string, Set<string>>();
  private readMismatches = 0;

  constructor(
    serial: string,
    private readonly simctl: Simctl = new Simctl(),
    direct?: DirectSim,
  ) {
    super(serial, simulatorOps(serial, simctl), new IosRunnerLauncher(serial));
    this.direct = direct ?? new DirectSim(serial);
  }

  private remember(t: Tree) {
    this.recent.delete(t.hash);
    this.recent.set(t.hash, t.nodes);
    if (this.recent.size > 8) this.recent.delete(this.recent.keys().next().value!);
    return t;
  }

  /**
   * The helper's read of the app in front, when it can say what the runner would; for one in the queue.
   * `final`: this read is an answer, not one of a settle's looks, and the runner is asked what only it
   * can tell. Its verdict on a screen's repeated controls is kept by the layout's digest.
   */
  private async readDirect(final: boolean): Promise<Capture | undefined> {
    const r = await this.direct.read(this.targetApp).catch(() => ({ refused: 'failed' }));
    if ('refused' in r) return undefined;
    let hidden = this.copyVerdicts.get(r.tree.hash);
    const proven = this.direct.readProven;
    if ((!hidden && r.copies && final) || !proven) {
      const runner = (await this.callNow('tree.get', {}, TIMEOUTS.read)).result;
      const verdict = learnCopies(r.tree, runner);
      if (!proven) {
        const believed = verdict && this.direct.checkRead(withoutCopies(r.tree, verdict), runner);
        if (!believed && ++this.readMismatches >= 3)
          this.direct.turnReadOff('its read differed from the runner');
        if (!believed) return { tree: runner, busy: nodesBusy(runner), byRunner: true };
      }
      // the screen moved between the two reads: the runner's is the answer
      if (!verdict) return { tree: runner, busy: nodesBusy(runner), byRunner: true };
      hidden = verdict;
      this.copyVerdicts.delete(r.tree.hash);
      this.copyVerdicts.set(r.tree.hash, hidden);
      if (this.copyVerdicts.size > 8) this.copyVerdicts.delete(this.copyVerdicts.keys().next().value!);
    }
    return { tree: hidden ? withoutCopies(r.tree, hidden) : r.tree, busy: r.busy };
  }

  /** A read for one in the queue: the helper's, else the runner's (a system alert, a web page). */
  private async readNow(final = true): Promise<Capture> {
    const d = await this.readDirect(final);
    if (d) return d;
    const tree = (await this.callNow('tree.get', {}, TIMEOUTS.read)).result;
    return { tree, busy: nodesBusy(tree), byRunner: true };
  }

  override async tree(opts: { maxDepth?: number; maxNodes?: number } = {}): Promise<Tree> {
    if (opts.maxDepth !== undefined || opts.maxNodes !== undefined) return super.tree(opts);
    const { tree } = await this.queue.run(() => this.readNow());
    await this.keepDump(tree);
    return this.remember(tree);
  }

  override async act(action: ActParams, opts: ActOptions = {}): Promise<ActResult> {
    return this.queue.run(async () => {
      // the first read tells the helper the screen's size
      if (!this.direct.status().input.startsWith('runner') && !this.direct.readProven)
        await this.readDirect(true);
      const touch = action.kind !== 'key';
      const waitStart = Date.now();
      // UIKit takes no touches while a view animates, and the tree already shows where it ends
      if (touch) await this.direct.animationsOver(ANIMATION_WAIT_MS);
      const animationWaitMs = Date.now() - waitStart;
      const touchesBefore = this.direct.touchesEnded;
      if (!(await this.direct.send(action))) return this.actByRunner(action, opts);
      const out = await this.settleAfter(action, opts);
      // nothing moved and the app has not seen the touch finish: it never got it
      if (touch && out.untouched && touchesBefore === this.direct.touchesEnded) {
        this.direct.touchLost();
        return this.actByRunner(action, opts);
      }
      return { ...out.result, ...(touch && { animationWaitMs }) };
    });
  }

  private async settleAfter(action: ActParams, opts: ActOptions) {
    const want = opts.read ?? 'none';
    const answer = (c: Capture | undefined) => {
      if (c) this.remember(c.tree);
      return {
        ...(want !== 'none' && c && { hash: c.tree.hash }),
        ...(want === 'tree' && c && { tree: c.tree }),
      };
    };
    if (opts.settle === false) {
      const c = want === 'none' ? undefined : await this.readNow();
      return { untouched: false, result: answer(c) };
    }
    const s = opts.settle ?? {};
    const actionAt = Date.now();
    const before = opts.before ? this.recent.get(opts.before) : undefined;
    const tap = action.kind === 'tap' ? action : undefined;
    const inert = !!tap && !!before && !actionable(before, tap.x, tap.y);
    const quietMs = inert ? Math.min(s.quietMs ?? 200, INERT_QUIET_MS) : (s.quietMs ?? 200);
    const maxMs = s.maxMs ?? 3_000;
    // an alert or sheet that came up during the settle is still animating in: a tap on it then is lost
    let alertSince: number | undefined = before && hasAlert(before) ? 0 : undefined;
    const r = await settle<Capture | { tree: { nodes: Node[] }; busy: false }>({
      actionAt,
      quietMs,
      maxMs,
      pollMs: POLL_MS,
      before: before && { tree: { nodes: before }, busy: false },
      read: async () => {
        const c = await this.readNow(false);
        if (hasAlert(c.tree.nodes)) {
          alertSince ??= Date.now();
          if (Date.now() - alertSince < ALERT_APPEAR_MS) return { ...c, busy: true };
        } else alertSince = undefined;
        return c;
      },
      same: (a, b) => sameContent(a.tree.nodes, b.tree.nodes),
      busy: (c) => c.busy,
    });
    let last = r.last as Capture;
    let extraMs = 0;
    const unchanged =
      !!before && sameLayout(before, last.tree.nodes) && !hasAlert(last.tree.nodes);
    // an actionable tap that changed nothing in the app may have asked the system for something: its
    // alert comes a moment later, while the app is idle
    if (tap && !inert && unchanged) {
      const idleAt = Date.now();
      while (Date.now() - idleAt < ALERT_WATCH_MS) {
        await new Promise((res) => setTimeout(res, 100));
        const c = await this.readNow(false);
        last = c;
        if (c.byRunner || !sameLayout(before, c.tree.nodes)) break;
      }
      extraMs = Date.now() - idleAt;
    }
    const untouched = unchanged && sameLayout(before, last.tree.nodes);
    // the last look may have left to the runner what only it can tell
    if (want !== 'none' && !last.byRunner && !untouched) last = await this.readNow(true);
    return {
      untouched,
      result: {
        settle: { settled: r.settled, ms: r.elapsedMs + extraMs, reads: r.reads, quietMs },
        ...answer(last),
      },
    };
  }

  override async foreground(): Promise<string | undefined> {
    return (await this.direct.front().catch(() => undefined)) ?? super.foreground();
  }

  /** A running app comes forward as it is; to start it afresh, terminate it first. */
  override async launch(pkg: string): Promise<string> {
    if (this.targetApp === pkg && (await this.direct.front().catch(() => undefined)) === pkg)
      return 'in front';
    return super.launch(pkg);
  }

  override async setOrientation(rotation: 0 | 1 | 2 | 3) {
    this.direct.setRotation(rotation);
    await super.setOrientation(rotation);
  }

  override close() {
    this.direct.close();
    super.close();
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
