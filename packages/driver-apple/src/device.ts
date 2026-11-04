import {
  sleep,
  fold,
  type LogsQuery,
  type LogsAnswer,
  type CrashesQuery,
  type CrashesAnswer,
  RpcDevice,
  type AppManager,
  type Device,
  type DeviceEvents,
  type DeviceHardware,
  type DeviceSettings,
  type MeasureSource,
  type Mirror,
  type ScreenRecorder,
  type RpcClient,
  TIMEOUTS,
  type ActOptions,
  assertLatLon,
  SYSTEM_SWIPES,
  type SystemSwipe,
  type SystemView,
} from '@appdyno/core';
import { APPLE_CONTROLS } from './mirror-press.js';
import {
  type Tree,
  type Point,
  type Method,
  NODE_FLAGS,
  DeviceError,
  type ActParams,
  type ActResult,
  type Modifier,
  type AuditType,
  type AuditResult,
} from '@appdyno/protocol';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { IosRunnerLauncher } from './runner.js';
import { HOME_SCREEN_APP, iosScreen } from './platform-screen.js';
import { assertBundle } from './simctl.js';

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

/** How long a field has to report the focus before the keys go to whatever has the keyboard. */
const KEYS_AFTER_MS = 2_000;

/** Read-only requests are retried once on a fresh connection when the runner went away. */
const RETRY_SAFE: ReadonlySet<Method> = new Set<Method>([
  'tree.get',
  'screenshot',
  'app.foreground',
  'app.target',
  'clipboard.get',
]);

/** What differs between a simulator and a phone: whether it is up, app lifecycle, links, location. */
export type IosDeviceOps = {
  /** Up and usable (a simulator booted, a phone connected); asked only before a new runner starts. */
  up(): Promise<boolean>;
  launch(bundle: string): Promise<void>;
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

/** A point above the keyboard with no control or field on it; else near the top. */
export function inertPoint(t: Tree): Point {
  const screen = t.windows[0]?.b ?? [0, 0, 400, 800];
  const keyboard = t.nodes.find((n) => /keyboard$/i.test(n.c));
  const bottom = keyboard ? keyboard.b[1] : screen[3];
  const x = Math.round((screen[0] + screen[2]) / 2);
  const reacts = NODE_FLAGS.clickable | NODE_FLAGS.editable | NODE_FLAGS.checkable;
  const taken = (y: number) =>
    t.nodes.some(
      (n) => (n.f & reacts) !== 0 && x >= n.b[0] && x <= n.b[2] && y >= n.b[1] && y <= n.b[3],
    );
  for (let y = 120; y < bottom - 10; y += 40) if (!taken(y)) return { x, y };
  return { x, y: 120 };
}

/**
 * An iOS device driven through the runner: every command has a timeout, commands never overlap,
 * failures are typed DeviceErrors. App lifecycle, links and location go through the device's own
 * tool (`ops`). Coordinates are points.
 */
export abstract class IosDevice extends RpcDevice implements Device {
  readonly platform = 'ios' as const;
  readonly platformScreen = iosScreen;
  abstract readonly virtual: boolean;
  abstract readonly apps: AppManager;
  abstract readonly settings: DeviceSettings;
  abstract readonly events: DeviceEvents;
  abstract readonly recorder: ScreenRecorder;
  abstract readonly mirror: Mirror;
  abstract readonly measure: MeasureSource;
  protected readonly retrySafe = RETRY_SAFE;
  /** The app the runner reads and acts on (set by launch, openUrl with a bundle, or target). */
  protected targetApp: string | undefined;

  constructor(
    readonly serial: string,
    protected readonly ops: IosDeviceOps,
    private readonly launcher: IosRunnerLauncher,
  ) {
    super();
  }

  logs = (q: LogsQuery) => this.ops.logs(q);
  crashes = (q: CrashesQuery) => this.ops.crashes(q);
  appRunning = (app: string) =>
    this.ops.pid(app).then(
      () => true,
      () => false,
    );

  /**
   * iOS has no call to close a keyboard: its own hide key where it shows one, else a touch on a place
   * with no control, which closes it in an app that takes that as leaving the field.
   */
  dismissKeyboard = async () => {
    const t = await this.tree();
    const hide = t.nodes.find(
      (n) => /button$/i.test(n.c) && /^(hide keyboard|dismiss keyboard)$/i.test(n.d ?? n.t ?? ''),
    );
    const point =
      hide && hide.b
        ? { x: (hide.b[0] + hide.b[2]) / 2, y: (hide.b[1] + hide.b[3]) / 2 }
        : inertPoint(t);
    await this.tap(point, { settle: false, read: 'none' });
  };

  /** Before a new runner starts: the device must be up (a new runner would boot a shut-down simulator). */
  protected async prepareStart(): Promise<void> {
    if (!(await this.ops.up()))
      throw new DeviceError(
        'DEVICE_GONE',
        `${this.ops.name} is not up`,
        'boot or connect it first',
      );
  }

  protected async startAgent() {
    const agent = await this.launcher.connect(this.targetApp, () => this.prepareStart());
    if (this.targetApp)
      await agent.rpc.call('app.target', { pkg: this.targetApp }, { timeoutMs: TIMEOUTS.action });
    return agent;
  }

  /** A runner whose main thread stays stuck: stopped (its xcodebuild ends), the next call starts one. */
  protected async restartStuck(rpc: RpcClient) {
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

  async act(action: ActParams, opts: ActOptions = {}): Promise<ActResult> {
    return this.queue.run(() => this.actByRunner(action, opts));
  }

  /** The action done by the runner, for one already in the queue. */
  protected actByRunner(action: ActParams, opts: ActOptions): Promise<ActResult> {
    const extra = action.kind === 'longPress' || action.kind === 'swipe' ? action.durationMs : 0;
    return this.actNow(action, opts, extra);
  }

  override async key(key: string, opts?: ActOptions, modifiers?: Modifier[]) {
    if (key === 'home' && this.underView) {
      const app = this.underView;
      this.underView = undefined;
      const r = await super.key(key, { settle: {}, read: 'none' });
      await this.target(app);
      return opts?.read === 'tree' ? { ...r, tree: await this.tree() } : r;
    }
    if (key === 'appSwitch') {
      // iOS has no such key: the home indicator's slow drag up, held until the switcher shows
      const { w, h } = this.helloInfo!.screen;
      const [x, y] = [Math.round(w / 2), Math.round(h * 0.55)];
      return this.act(
        {
          kind: 'gesture',
          pointers: [
            [
              { x, y: h - 4, t: 0 },
              { x, y, t: 400 },
              { x, y, t: 900 },
            ],
          ],
        },
        opts,
      );
    }
    return super.key(key, opts, modifiers);
  }

  /**
   * A person's drag from the screen's top; Spotlight is the keyboard's, from the home screen, as an app may keep the
   * shortcut. These are the home screen app's: an app under one is still in front, and a read of it would miss the view.
   */
  async openView(view: SystemView) {
    this.underView ??= this.targetApp;
    await this.target(HOME_SCREEN_APP);
    if (view === 'spotlight') {
      await super.key('home', { settle: {}, read: 'none' });
      await super.key('space', { settle: false, read: 'none' }, ['command']);
    } else
      await this.drag(
        view === 'control_center' ? SYSTEM_SWIPES.controlCenter : SYSTEM_SWIPES.notifications,
      );
  }

  /** The app a view went over: home closes the view, and it is what is read again. */
  private underView: string | undefined;

  /** A drag that belongs to the system: the app under it is told nothing. */
  protected abstract drag(way: SystemSwipe): Promise<void>;

  /** A code entry's hidden field never reports the focus, so its keys wait this out each time. */
  override typeText(text: string, opts: Parameters<RpcDevice['typeText']>[1] = {}) {
    return super.typeText(text, { focusTimeoutMs: KEYS_AFTER_MS, ...opts });
  }

  /**
   * The platform accessibility audit of the app in front (the runner's `audit`, Xcode's audit types);
   * UNSUPPORTED where the platform cannot run it.
   */
  async audit(opts: { types?: AuditType[]; maxIssues?: number } = {}): Promise<AuditResult> {
    const { result } = await this.call('audit', opts, TIMEOUTS.audit);
    return { engine: 'platform', ...result };
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
        // returns once the link's screen has come
        await this.tap(open, { settle: {} });
        return;
      }
      await sleep(150);
    }
  }

  /** What every kind of iOS device has; a subclass adds what it knows of itself. */
  async hardware(): Promise<DeviceHardware> {
    return { platform: 'ios', controls: APPLE_CONTROLS, systemApps: true };
  }

  async launch(pkg: string) {
    if (!(await this.launchedAlongside(pkg)))
      await this.queue.run(() => this.ops.launch(assertBundle(pkg)));
    await this.target(pkg);
    await this.untilFront(pkg);
  }

  /** One read: the app's window shows content. */
  async appShown(bundle: string) {
    // nothing may have named this app yet; a warm-up launch comes first, so this is not timed
    if (this.targetApp !== bundle) await this.target(bundle).catch(() => undefined);
    const t = await this.tree().catch(() => undefined);
    return !!t && t.windows[0]?.pkg === bundle && t.nodes.filter((n) => n.w === 0).length > 3;
  }

  /** A read during a launch would get the home screen, slowly. */
  protected async untilFront(pkg: string) {
    const end = Date.now() + 10_000;
    while ((await this.foreground()) !== pkg && Date.now() < end) await sleep(20);
  }

  /** The app in front, if it can be told without starting anything. */
  protected async frontNow(): Promise<string | undefined> {
    return this.rpc && !this.rpc.closed ? this.foreground() : undefined;
  }

  async terminate(pkg: string) {
    await this.queue.run(() => this.ops.terminate(assertBundle(pkg)));
    // returns once the app has left the front (the runner may see it there for a moment)
    const end = Date.now() + 3_000;
    while ((await this.frontNow()) === pkg && Date.now() < end) await sleep(100);
  }

  async setLocation(lat: number, lon: number) {
    assertLatLon(lat, lon);
    await this.queue.run(() => this.ops.setLocation(lat, lon));
  }

  /** Stops the runner (its xcodebuild ends). */
  async stopAgent() {
    const rpc = this.rpc;
    this.rpc = undefined;
    await this.launcher.stop(rpc);
    rpc?.close();
  }

  /**
   * XCTest's `measure()` in a test of its own: it needs the runner's place on the device, so the runner
   * stops and the next command starts it again.
   */
  xctMetrics(bundle: string, test: 'launch' | 'hitches') {
    return this.queue.run(async () => {
      await this.stopAgent();
      return this.launcher.xctMetrics(bundle, test);
    });
  }
}
