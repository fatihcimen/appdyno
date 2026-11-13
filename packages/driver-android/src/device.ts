import {
  DeviceError,
  type ActParams,
  type ActResult,
  type AuditResult,
  type AuditType,
  type Method,
  type Tree,
} from '@appdyno/protocol';
import {
  sleep,
  assertLatLon,
  must,
  decodePng,
  RETRY_SAFE,
  RpcDevice,
  swipeThrough,
  SYSTEM_SWIPES,
  TIMEOUTS,
  type ActOptions,
  type TreeOptions,
  type CrashesQuery,
  type Device,
  type LogsQuery,
  type Mirror,
  type RpcClient,
  type SettingsPage,
  type SystemView,
} from '@appdyno/core';
import { Adb, amStartError, assertPkg, assertSerial, shq, wholeAnswer } from './adb.js';
import { androidCrashes, androidCrashing, androidRunning } from './crashes.js';
import { androidLogs } from './logs.js';
import { auditAndroid } from './audit.js';
import { AndroidAgentLauncher } from './agent.js';
import { clearStaleTestLocation, clearTestLocation, setTestLocation } from './location.js';
import { AndroidApps } from './apps.js';
import type { InstallAnswers } from './install-consent.js';
import { AndroidEvents } from './events.js';
import { AndroidSettings } from './settings.js';
import { AndroidNetwork } from './network.js';
import { AndroidPerf } from './perf/index.js';
import { AndroidMirror } from './mirror.js';
import { androidHardware } from './hardware.js';
import { EmulatorMirror } from './mirror-emulator.js';
import { androidScreen } from './platform-screen.js';
import { AndroidRecorder } from './record.js';
import { ANDROID_PAGES, openSearch, openSettingsAt } from './settings-pages.js';
import { AndroidWeb } from './web.js';
import { currentFocus, focusSteady, lockedError, wakeScreen } from './wake.js';
import { noWindowHint } from './window-dump.js';

export type AndroidOptions = {
  /** How long a read-only call waits for an unplugged or rebooting device to come back (0: not at all). */
  reconnectWaitMs?: number;
  takeover?: boolean | undefined;
  /** Off: the device's animations are off while this host is connected (docs/reference/protocol.md "Animations"). */
  animations?: 'on' | 'off' | undefined;
  /** What `app install` may answer on the phone (docs/reference/protocol.md "A phone's install prompts"). */
  installAnswers?: InstallAnswers | undefined;
};

/**
 * An Android device or emulator driven through its agent: every command has a timeout, commands never
 * overlap, failures are typed DeviceErrors. App lifecycle, links and location go through adb's own
 * protocol (no adb process per call).
 */
export class AndroidDevice extends RpcDevice implements Device {
  readonly platform = 'android' as const;
  readonly platformScreen = androidScreen;
  readonly settingsPages = ANDROID_PAGES;
  protected readonly retrySafe = new Set<Method>([...RETRY_SAFE, 'a11y.read']);
  private readonly launcher: AndroidAgentLauncher;

  private readonly reconnectWaitMs: number;
  private animations: 'on' | 'off';

  constructor(
    readonly serial: string,
    private readonly adb: Adb = new Adb(),
    {
      reconnectWaitMs = 0,
      takeover = false,
      animations = 'on',
      installAnswers,
    }: AndroidOptions = {},
  ) {
    super();
    assertSerial(serial);
    this.reconnectWaitMs = reconnectWaitMs;
    this.animations = animations;
    this.launcher = new AndroidAgentLauncher(adb, serial, takeover);
    this.apps = new AndroidApps(
      adb,
      serial,
      {
        currentFocus: () => currentFocus(this.sh),
        focusSteady: () => focusSteady(this.sh),
        ensureAwake: () => this.ensureAwake(),
        tree: () => this.tree(),
        press: (p, ms) => this.longPress(p, ms, { settle: false }),
        shell: (c) => this.shell(c),
      },
      installAnswers,
      async () => (await this.call('app.labels', {}, TIMEOUTS.action)).result.apps,
    );
    this.settings = new AndroidSettings(
      adb,
      serial,
      () => this.releaseAnimations(),
      async (set) => (await this.call('locales', set ? { set } : {}, TIMEOUTS.action)).result.tags,
    );
    this.events = new AndroidEvents(adb, serial, () => this.tree());
    this.recorder = new AndroidRecorder(adb, serial);
    this.network = new AndroidNetwork(adb, serial);
    this.web = new AndroidWeb(adb, serial);
    const mirror = new AndroidMirror(adb, serial, this.launcher);
    this.mirror = this.virtual ? new EmulatorMirror(serial, mirror) : mirror;
  }

  get virtual() {
    return this.serial.startsWith('emulator-');
  }

  readonly mirror: Mirror;
  readonly recorder: AndroidRecorder;
  readonly network: AndroidNetwork;
  readonly web: AndroidWeb;
  logs = (q: LogsQuery) => androidLogs(this.adb, this.serial, q);
  crashes = (q: CrashesQuery) => androidCrashes(this.adb, this.serial, q);
  appPid = async (app: string) =>
    (await wholeAnswer(this.adb, this.serial, `pidof ${shq(assertPkg(app))}`))
      .trim()
      .split(/\s+/)[0] || undefined;
  appRunning = (app: string) => androidRunning(this.adb, this.serial, app);
  appCrashing = (app: string) => androidCrashing(this.adb, this.serial, app);
  readonly apps: AndroidApps;
  readonly settings: AndroidSettings;
  readonly events: AndroidEvents;
  dismissKeyboard = async () => {
    await this.key('back', { settle: false, read: 'none' });
  };

  protected async startAgent() {
    const agent = await this.launcher.connect();
    if (this.animations === 'off')
      await agent.rpc
        .call('animations.set', { off: true }, { timeoutMs: TIMEOUTS.action })
        .catch((e: unknown) => {
          agent.rpc.close();
          throw e;
        });
    // a new agent: a host that died without stopping its own may have left test providers
    if (agent.started) await this.clearStaleLocation().catch(() => undefined);
    return agent;
  }

  protected override connectionLost(e: unknown, had: RpcClient | undefined) {
    return super.connectionLost(e, had) || (e instanceof DeviceError && e.code === 'DEVICE_GONE');
  }

  /** An unplugged cable or a reboot: the agent may still run on the device, its state file finds it. */
  protected override async beforeRetry(lost: unknown) {
    if ((lost as DeviceError).code === 'DEVICE_GONE') await this.waitForDevice(lost);
  }

  protected async restartStuck(rpc: RpcClient) {
    if (this.rpc === rpc) this.rpc = undefined;
    rpc.close();
    await this.launcher.stop();
    // a touch on an app that is not responding waits on it, and the agent with it; the system's dialog stays until answered
    const dialog = await this.sh(
      "dumpsys window windows 2>/dev/null | grep -m 1 -o 'Application Not Responding: [^ }]*'",
    ).catch(() => '');
    const app = /Application Not Responding: (\S+)/.exec(dialog)?.[1];
    return (
      app &&
      `${app} is not responding, and the system asks whether to wait for it or close it: alert answers that`
    );
  }

  /** Waits until adb lists the device as usable again, at most reconnectWaitMs; else rethrows `cause`. */
  private async waitForDevice(cause: unknown) {
    const end = Date.now() + this.reconnectWaitMs;
    while (Date.now() < end) {
      const d = (await this.adb.devices().catch(() => [])).find((x) => x.serial === this.serial);
      if (d?.state === 'device') return;
      await sleep(1_000);
    }
    throw cause;
  }

  /** A screen that went dark or locked comes back, and says what it did (`wake.ts`). */
  ensureAwake() {
    return wakeScreen(this.sh, () => this.helloInfo?.screen);
  }

  private readonly sh = (command: string) => this.shell(command);

  async tree({ asItIs, ...limits }: TreeOptions = {}): Promise<Tree> {
    const read = async () =>
      (await this.call('tree.get', limits, TIMEOUTS.read).catch(noWindowHint)).result;
    // what the agent found goes with the refusal: an app that does not answer is told from a dark screen by it
    let refusal = new DeviceError('NOT_FOUND', 'no window to read');
    const t = await read().catch((e: unknown) => {
      if (!(e instanceof DeviceError && e.code === 'NOT_FOUND')) throw e;
      refusal = e;
      return undefined;
    });
    if (asItIs) {
      if (t) return t;
      throw refusal;
    }
    // no app window at all: a dark or locked screen; once awake, read again
    if (t && !t.dark && t.windows.some((w) => w.type === 1)) return t;
    const s = await this.ensureAwake();
    if (s.locked) throw lockedError(this.serial);
    if (!s.woke && !s.unlocked) {
      if (t) return t;
      throw refusal;
    }
    return read();
  }

  async act(action: ActParams, opts: ActOptions = {}): Promise<ActResult> {
    const once = () => this.queue.run(() => this.actNow(action, opts, durationOf(action)));
    return once().catch(async (e: unknown) => {
      // the agent refuses a touch on a dark screen before it is made: it would reach nothing
      if (!(e instanceof DeviceError && e.code === 'SCREEN_OFF')) throw e;
      if ((await this.ensureAwake()).locked) throw lockedError(this.serial);
      return once();
    });
  }

  /**
   * The screen's accessibility issues (docs/reference/protocol.md "Accessibility audit"): the host's checks of a
   * tree read, a PNG screenshot and the characters each text does not show.
   */
  async audit(opts: { types?: AuditType[]; maxIssues?: number } = {}): Promise<AuditResult> {
    const startedAt = Date.now();
    const hello = await this.open();
    const { tree, clips, traversal } = (await this.call('a11y.read', {}, TIMEOUTS.read)).result;
    const shot = await this.screenshot({ format: 'png' });
    const r = auditAndroid(tree, decodePng(shot.data), {
      scale: hello.screen.density / 160,
      clips,
      ...(opts.types && { types: opts.types }),
      ...(opts.maxIssues && { maxIssues: opts.maxIssues }),
      startedAt,
    });
    return { ...r, read: { tree, traversal } };
  }

  /** Opens a link (`am start -W` with VIEW); `pkg` keeps it in that app. */
  async openUrl(url: string, pkg?: string) {
    const out = await this.shell(
      `am start -W -a android.intent.action.VIEW -d ${shq(url)}${pkg ? ` -p ${assertPkg(pkg)}` : ''} 2>&1`,
      TIMEOUTS.app,
    );
    const error = amStartError(out);
    if (error) throw new DeviceError('NOT_FOUND', `the link did not open: ${error}`);
  }

  /** Over another tool's automation this session is refused, and must have left the device alone. */
  protected override startAlongside(pkg: string) {
    return this.launcher.holders().then(async (others) => {
      if (others.length > 0) return false;
      await this.apps.start(pkg);
      return true;
    });
  }

  hardware() {
    const read = (command: string) =>
      this.adb.exec(this.serial, command).then(
        (out) => out.trim(),
        () => '',
      );
    return androidHardware(read, this.virtual);
  }

  /** Quick Settings is Android's Control Center; its search is the app that answers the system's request for one. */
  async openView(view: SystemView) {
    if (view === 'spotlight') return openSearch(this.startActivity);
    await swipeThrough(
      view === 'control_center' ? SYSTEM_SWIPES.quickSettings : SYSTEM_SWIPES.notifications,
      (e) => this.mirror.input(e),
    );
  }

  private readonly startActivity = async (intent: string) =>
    amStartError(await this.shell(`am start -W ${intent} 2>&1`, TIMEOUTS.app));

  /** Stopped by name, as `am start -S` refuses an intent several activities answer, on a Samsung. */
  async openSettings(to: { page: SettingsPage } | { app: string }) {
    // an intent to Settings while it shows another page only brings that page back
    await this.terminate('com.android.settings');
    await openSettingsAt(to, this.startActivity);
    return {};
  }

  /** Starts the app's launcher activity and waits for it (`am start -W`). */
  async launch(pkg: string) {
    if (!(await this.launchedAlongside(pkg))) await this.queue.run(() => this.apps.start(pkg));
  }

  async terminate(pkg: string) {
    await this.shell(`am force-stop ${assertPkg(pkg)}`, TIMEOUTS.app);
  }

  async setLocation(lat: number, lon: number) {
    assertLatLon(lat, lon);
    await setTestLocation((c, ms) => this.shell(c, ms), lat, lon);
  }

  async clearLocation() {
    await clearTestLocation((c, ms) => this.shell(c, ms));
  }

  /** Not through `shell`: it runs while connecting, inside the queue. */
  private clearStaleLocation() {
    return clearStaleTestLocation((c, ms = TIMEOUTS.action) =>
      this.adb.exec(this.serial, c, { timeoutMs: ms }),
    );
  }

  /** A shell command on the device (adb protocol, no adb process); output with stderr when redirected. */
  async shell(command: string, timeoutMs: number = TIMEOUTS.action): Promise<string> {
    return this.queue.run(() => this.adb.exec(this.serial, command, { timeoutMs }));
  }

  /**
   * As `shell`, but not queued behind the device's other commands: a recording that runs while the
   * caller acts on the device (its own adb connection).
   */
  async shellAlongside(command: string, timeoutMs: number = TIMEOUTS.action): Promise<string> {
    return this.adb.exec(this.serial, command, { timeoutMs });
  }

  /** As `shell`, the output as bytes. */
  async shellBuffer(command: string, timeoutMs: number = TIMEOUTS.action): Promise<Buffer> {
    return this.queue.run(() => this.adb.execBuffer(this.serial, command, { timeoutMs }));
  }

  /** Copies a file from the device (adb's file transfer). */
  async pull(remote: string, local: string): Promise<void> {
    await this.queue.run(() => this.adb.run(['-s', this.serial, 'pull', remote, local], 300_000));
  }

  /**
   * A measurement must see what a user sees, and only that: animations are back on for the rest of the session,
   * and the transition an answer can come before has ended (its frames are not the app's).
   */
  async readyToMeasure() {
    await this.releaseAnimations();
    await this.ensureAwake();
    await this.call('rest.wait', {}, TIMEOUTS.action + 5_000);
  }

  /** The session's animations-off option ends here, for the rest of the session. */
  private async releaseAnimations() {
    if (this.animations !== 'off') return;
    this.animations = 'on';
    if (this.rpc && !this.rpc.closed)
      await this.call('animations.set', { off: false }, TIMEOUTS.action);
  }

  /** The app's and the device's performance (frames, memory, CPU, launch, device state). */
  get measure(): AndroidPerf {
    return (this.perfTools ??= new AndroidPerf(this));
  }
  private perfTools: AndroidPerf | undefined;

  /** Stops the agent on the device (the UI automation connection is released); its test providers go. */
  async stopAgent() {
    this.close();
    await this.clearLocation().catch(() => undefined);
    await this.launcher.stop();
  }
}

function durationOf(a: ActParams): number {
  if (a.kind === 'longPress' || a.kind === 'swipe') return a.durationMs;
  if (a.kind === 'gesture') return Math.max(...a.pointers.map((p) => must(p.at(-1), 'a point').t));
  return 0;
}
