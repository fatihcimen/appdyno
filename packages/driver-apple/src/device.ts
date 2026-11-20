import {
  sleep,
  type LogsQuery,
  type LogsAnswer,
  type CrashesQuery,
  type CrashesAnswer,
  RETRY_SAFE,
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
  SETTINGS_PAGES,
  type SettingsPage,
  type SystemSwipe,
  type SystemView,
  must,
  INSTALLED_APPS,
} from '@appdyno/core';
import { APPLE_CONTROLS } from './mirror-press.js';
import {
  type Tree,
  type Method,
  DeviceError,
  type ActParams,
  type ActResult,
  type Modifier,
  type AuditType,
  type AuditResult,
  type Point,
} from '@appdyno/protocol';
import { IosRunnerLauncher } from './runner.js';
import { keepTreeDump } from './tree-dump.js';
import {
  HOME_SCREEN_APP,
  SPOTLIGHT_APP,
  keyboardCloser,
  iosScreen,
  staticTexts,
} from './platform-screen.js';
import type { SettingsLinks } from './settings-pages.js';
import { untilTaken } from './sim-open.js';
import { assertBundle, runsBy } from './simctl.js';

const SETTINGS_APP = 'com.apple.Preferences';
const ANOTHER_SECTION = 'prefs:root=SCREEN_TIME';
/** Long enough for Settings to take the first of two links. */
const SECTION_MS = 700;

/** How long a field has to report the focus before the keys go to whatever has the keyboard. */
const KEYS_AFTER_MS = 2_000;

/** The app goes 0.9 to 1.8 s after home, at load 7 to 40 on a simulator, by either input. */
const LEAVES_MS = 5_000;

/** How long a link to an app is watched for its prompt and its screen; the screen's first change ends it. */
const LINK_LOOK_MS = 10_000;

/** What differs between a simulator and a phone: whether it is up, app lifecycle, links, location. */
export type IosDeviceOps = {
  /** Up and usable (a simulator booted, a phone connected); asked only before a new runner starts. */
  up(): Promise<boolean>;
  launch(bundle: string): Promise<void>;
  terminate(bundle: string): Promise<void>;
  openUrl(url: string, bundle?: string): Promise<void>;
  setLocation(lat: number, lon: number): Promise<void>;
  clearLocation(): Promise<void>;
  /** A link to an app first asks "Open in …?" (the simulator does, a link given to the app does not). */
  linkPrompt: boolean;
  /** The device, for messages. */
  name: string;
  /** The process id of a running app (for the trace tool). */
  pid(bundle: string): Promise<number>;
  /** Settings' pages this device has a link to, and how a private link gets there. */
  settingsLinks: SettingsLinks;
  openSettings(link: string): Promise<void>;
  logs(q: LogsQuery): Promise<LogsAnswer>;
  crashes(q: CrashesQuery): Promise<CrashesAnswer>;
};

/**
 * A device's turn, which its runner alone reads and makes: `start` brings the runner up, `now` reads the turn where it
 * is up and nothing where it is not, and `set` turns it.
 */
export type RunnerTurn = {
  start(): Promise<void>;
  now(): Promise<number | undefined>;
  set(rotation: 0 | 1 | 2 | 3): Promise<void>;
};

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
  protected readonly retrySafe = new Set<Method>([...RETRY_SAFE, 'app.target']);
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
  appRunning = (app: string) => runsBy(this.ops.pid(app));

  /** iOS has no call to close a keyboard: a touch where one closes it (`keyboardCloser`). */
  dismissKeyboard = async () => {
    await this.tap(keyboardCloser(await this.tree()), { settle: false, read: 'none' });
  };

  /** Before a new runner starts: the device must be up (a new runner would boot a shut-down simulator). */
  /** The turn by the runner, for settings that write it down: a read alone starts no runner. */
  protected runnerTurn(): RunnerTurn {
    return {
      start: () => this.queue.run(() => this.ensure()).then(() => undefined),
      now: async () =>
        this.agentUp
          ? (await this.call('orientation.get', {}, TIMEOUTS.read)).result.rotation
          : undefined,
      set: (rotation) => this.setOrientation(rotation),
    };
  }

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
    // no shutdown asked: it is a job of the lane that is stuck, and on an iPhone waited its 6 s for nothing
    rpc.close();
    await this.launcher.stop();
    return undefined;
  }

  async tree(opts: { maxDepth?: number; maxNodes?: number } = {}): Promise<Tree> {
    const t = (await this.call('tree.get', opts, TIMEOUTS.read)).result;
    await this.keepDump(t);
    return t;
  }

  /** Diagnostics: a read kept on this machine, where its flag file asks for it. */
  protected keepDump(t: Tree) {
    return keepTreeDump(this.serial, t);
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
      // iOS has no such key: the home indicator's slow drag up, held until the switcher shows, on a phone
      const { w, h } = must(this.helloInfo, 'the hello').screen;
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
    // only an app in front at the press goes: from the switcher, home brings back the app it was opened over
    const was = key === 'home' && opts?.read === 'tree' ? await this.frontNow() : undefined;
    const r = await super.key(key, opts, modifiers);
    const app = r.tree?.windows[0]?.pkg;
    return app && app === was && app !== HOME_SCREEN_APP ? this.onceGone(app, r) : r;
  }

  /**
   * Home's answer once the app has left the front: it reads alike while it goes, so the settle saw nothing move and
   * answered with the app still there, and a second press went home.
   */
  private async onceGone(app: string, r: ActResult): Promise<ActResult> {
    const end = Date.now() + LEAVES_MS;
    while ((await this.foreground()) === app) {
      if (Date.now() >= end) return r;
      await sleep(20);
    }
    return { ...r, tree: await this.tree() };
  }

  get settingsPages() {
    return SETTINGS_PAGES.filter((p) => p in this.ops.settingsLinks);
  }

  /** An app's page has no link any more: its row is on Apps. */
  async openSettings(to: { page: SettingsPage } | { app: string }) {
    const link = this.ops.settingsLinks['app' in to ? 'apps' : to.page];
    if (!link)
      throw new DeviceError(
        'UNSUPPORTED',
        `${this.ops.name} has no ${'page' in to ? to.page : 'apps'} page in Settings`,
        'open general or apps, and tap your way from there',
      );
    const row = 'app' in to ? await this.appName(to.app) : undefined;
    await this.target(SETTINGS_APP);
    await this.queue.run(async () => {
      // a link while it shows another page of that section only brings that page back; a restart cost a read 15 s
      await this.ops.openSettings(ANOTHER_SECTION);
      await sleep(SECTION_MS);
      await this.ops.openSettings(link);
    });
    return row ? { row } : {};
  }

  private async appName(app: string) {
    const entry = (await this.apps.listApps(true)).find((a) => a.id === app);
    if (!entry?.name)
      throw new DeviceError('NOT_FOUND', `${app} is not on ${this.ops.name}`, INSTALLED_APPS);
    return entry.name;
  }

  /**
   * A person's drag from the screen's top; Spotlight is the keyboard's, from the home screen, as an app may keep the
   * shortcut. The drags' views are the home screen app's: an app under one is still in front, and a read of it would
   * miss the view. Spotlight is an app of its own, read once it is in front.
   */
  async openView(view: SystemView) {
    this.underView ??= this.targetApp;
    await this.target(HOME_SCREEN_APP);
    if (view === 'spotlight') {
      await super.key('home', { settle: {}, read: 'none' });
      await super.key('space', { settle: false, read: 'none' }, ['command']);
      // read as the home screen app's it showed nothing of itself, but its keyboard: a second late by the runner's keys
      await this.target(SPOTLIGHT_APP);
      await this.spotlightFront();
    } else
      await this.drag(
        view === 'control_center' ? SYSTEM_SWIPES.controlCenter : SYSTEM_SWIPES.notifications,
      );
  }

  /**
   * A Face ID sheet and a passcode's are the home screen app's, over an app whose read shows nothing of them, and none
   * has an id: their words, as a read of that app has them. An app's name on its card is no such word.
   */
  async systemWords() {
    const t = await this.systemTree();
    return t ? staticTexts(t) : [];
  }

  /**
   * The home screen app's read, with what it shows over the app, whichever app is in front: one call, which leaves the
   * runner's target as it was, so no call between nor a cancel leaves the runner reading the home screen app for the app.
   */
  async systemTree(): Promise<Tree | undefined> {
    if (this.targetApp === HOME_SCREEN_APP) return undefined;
    const t = (await this.call('tree.get', { pkg: HOME_SCREEN_APP }, TIMEOUTS.read)).result;
    // a runner built before it took a pkg read the app in front: one that old is replaced where it is met (`olderRunner`)
    if (t.windows[0]?.pkg !== HOME_SCREEN_APP)
      throw new DeviceError(
        'INTERNAL',
        `the runner read ${t.windows[0]?.pkg ?? 'no app'} where the home screen app was asked for`,
      );
    return t;
  }

  /** Spotlight after its keys, once it is in front or the wait for it is over. */
  protected async spotlightFront() {
    await this.untilFront(SPOTLIGHT_APP);
  }

  /** The app a view went over: home closes the view, and it is what is read again. */
  protected underView: string | undefined;

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
   * first asks "Open in …?": with the app named, the prompt's Open button is tapped, and the link returns once the
   * app's screen moved (`untilTaken`), or after its look.
   */
  async openUrl(url: string, pkg?: string) {
    if (pkg) await this.target(pkg);
    const before = pkg && this.ops.linkPrompt ? await this.tree() : undefined;
    await this.queue.run(() => this.ops.openUrl(url, pkg));
    if (!pkg || !before) return;
    const name = await this.appName(pkg).catch(() => pkg);
    // shortcut: a link that changes nothing on the app's screen costs the whole look, until the app can say it took one
    const looks = { read: () => this.tree(), tap: (at: Point) => this.tap(at, { settle: {} }) };
    return (await untilTaken(pkg, name, before, looks, LINK_LOOK_MS))
      ? { answered: name }
      : undefined;
  }

  /** What every kind of iOS device has; a subclass adds what it knows of itself. */
  hardware(): Promise<DeviceHardware> {
    return Promise.resolve({ platform: 'ios', controls: APPLE_CONTROLS, systemApps: true });
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

  /** A read during a launch would get the home screen, slowly. Whether the app came to the front in time. */
  protected async untilFront(pkg: string, withinMs = 10_000) {
    const end = Date.now() + withinMs;
    for (;;) {
      if ((await this.foreground()) === pkg) return true;
      if (Date.now() >= end) return false;
      await sleep(20);
    }
  }

  /** The app in front, if it can be told without starting anything. */
  protected async frontNow(): Promise<string | undefined> {
    return this.rpc && !this.rpc.closed ? this.foreground() : undefined;
  }

  async terminate(pkg: string) {
    await this.queue.run(() => this.ops.terminate(assertBundle(pkg)));
    // returns once the app has left the front (the runner may see it there for a moment); a look the runner does not
    // answer, as one just come up on a loaded Mac did not within 15 s, holds up nothing: the app was stopped
    const end = Date.now() + 3_000;
    const front = () => this.frontNow().catch(() => undefined);
    while ((await front()) === pkg && Date.now() < end) await sleep(100);
  }

  async setLocation(lat: number, lon: number) {
    assertLatLon(lat, lon);
    await this.queue.run(() => this.ops.setLocation(lat, lon));
  }

  clearLocation() {
    return this.queue.run(() => this.ops.clearLocation());
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
