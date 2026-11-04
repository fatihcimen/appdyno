import {
  DeviceError,
  type ActParams,
  type ActResult,
  type AuditResult,
  type Method,
  type Tree,
} from '@appdyno/protocol';
import {
  sleep,
  assertLatLon,
  decodePng,
  RpcDevice,
  TIMEOUTS,
  type ActOptions,
  type CrashesQuery,
  type Device,
  type LogsQuery,
  type RpcClient,
} from '@appdyno/core';
import { Adb, amStartError, assertPkg, assertSerial, shq } from './adb.js';
import { androidCrashes } from './crashes.js';
import { androidLogs } from './logs.js';
import { auditAndroid } from './audit.js';
import { AndroidAgentLauncher } from './agent.js';
import { clearStaleTestLocation, clearTestLocation, setTestLocation } from './location.js';
import { AndroidApps } from './apps.js';
import type { InstallAnswers } from './install-consent.js';
import { AndroidSettings } from './settings.js';
import { AndroidNetwork } from './network.js';
import { AndroidPerf } from './perf/index.js';
import { androidScreen } from './platform-screen.js';
import { AndroidRecorder } from './record.js';
import { AndroidWeb } from './web.js';

/** Read-only requests are retried once on a fresh connection when the agent went away. */
const RETRY_SAFE: ReadonlySet<Method> = new Set<Method>([
  'tree.get',
  'a11y.read',
  'screenshot',
  'app.foreground',
  'clipboard.get',
]);

/** How long a phone just woken gets for its focus to hold, and how long it must hold. */
const WAKE_FOCUS_MS = 5_000;
const WAKE_STEADY_MS = 600;

/**
 * An Android device or emulator driven through its agent: every command has a timeout, commands never
 * overlap, failures are typed DeviceErrors. App lifecycle, links and location go through adb's own
 * protocol (no adb process per call).
 */
export class AndroidDevice extends RpcDevice implements Device {
  readonly platform = 'android' as const;
  readonly platformScreen = androidScreen;
  protected readonly retrySafe = RETRY_SAFE;
  private readonly launcher: AndroidAgentLauncher;

  constructor(
    readonly serial: string,
    private readonly adb: Adb = new Adb(),
    /** How long a read-only call waits for an unplugged or rebooting device to come back (0: not at all). */
    private readonly reconnectWaitMs = 0,
    takeover = false,
    /** Off: the device's animations are off while this host is connected (docs/protocol.md "Animations"). */
    private animations: 'on' | 'off' = 'on',
    /** What `app install` may answer on the phone (docs/protocol.md "A phone's install prompts"). */
    installAnswers?: InstallAnswers,
  ) {
    super();
    assertSerial(serial);
    this.launcher = new AndroidAgentLauncher(adb, serial, takeover);
    this.apps = new AndroidApps(
      adb,
      serial,
      {
        currentFocus: () => this.currentFocus(),
        focusSteady: () => this.focusSteady(),
        ensureAwake: () => this.ensureAwake(),
        tree: () => this.tree(),
        press: (p, ms) => this.longPress(p, ms, { settle: false }),
        shell: (c) => this.shell(c),
      },
      installAnswers,
    );
    this.settings = new AndroidSettings(adb, serial, () => this.releaseAnimations());
    this.recorder = new AndroidRecorder(adb, serial);
    this.network = new AndroidNetwork(adb, serial);
    this.web = new AndroidWeb(adb, serial);
  }

  readonly recorder: AndroidRecorder;
  readonly network: AndroidNetwork;
  readonly web: AndroidWeb;
  logs = (q: LogsQuery) => androidLogs(this.adb, this.serial, q);
  crashes = (q: CrashesQuery) => androidCrashes(this.adb, this.serial, q);
  appPid = async (app: string) =>
    (await this.adb.exec(this.serial, `pidof ${shq(assertPkg(app))}`)).trim().split(/\s+/)[0] ||
    undefined;
  appRunning = async (app: string) => !!(await this.appPid(app));

  readonly apps: AndroidApps;
  readonly settings: AndroidSettings;
  dismissKeyboard = async () => {
    await this.key('back', { settle: false, read: 'none' });
  };

  protected async connect(): Promise<RpcClient> {
    const { rpc, hello, started } = await this.launcher.connect();
    this.rpc = rpc;
    this.helloInfo = hello;
    this.lastStartWasCold = started;
    if (this.animations === 'off')
      await rpc.call('animations.set', { off: true }, { timeoutMs: TIMEOUTS.action });
    // a new agent: a host that died without stopping its own may have left test providers
    if (started) await this.clearStaleLocation().catch(() => undefined);
    return rpc;
  }

  protected override connectionLost(e: unknown) {
    return super.connectionLost(e) || (e instanceof DeviceError && e.code === 'DEVICE_GONE');
  }

  /** An unplugged cable or a reboot: the agent may still run on the device, its state file finds it. */
  protected override async beforeRetry(lost: unknown) {
    if ((lost as DeviceError).code === 'DEVICE_GONE') await this.waitForDevice(lost);
  }

  protected async restartStuck(rpc: RpcClient) {
    if (this.rpc === rpc) this.rpc = undefined;
    rpc.close();
    await this.launcher.stop();
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

  /**
   * A screen that went dark or locked comes back: wake it, dismiss a keyguard without a credential, and
   * swipe it up when dismissing did not work. Says what it did; a locked device with a PIN stays locked.
   */
  async ensureAwake(): Promise<{ woke: boolean; unlocked: boolean; locked: boolean }> {
    const state = async () => {
      const out = await this.shell(
        "dumpsys power | grep -m1 'mWakefulness='; dumpsys window | grep -m1 -E 'isKeyguardShowing=|mShowingLockscreen='",
      );
      return {
        awake: /mWakefulness=Awake/.test(out),
        locked: /isKeyguardShowing=true|mShowingLockscreen=true/.test(out),
      };
    };
    let s = await state();
    let woke = false;
    let unlocked = false;
    if (!s.awake) {
      await this.shell('input keyevent KEYCODE_WAKEUP');
      await sleep(400);
      woke = true;
      s = await state();
    }
    if (s.locked) {
      await this.shell('wm dismiss-keyguard');
      await sleep(600);
      s = await state();
      if (s.locked) {
        const w = this.helloInfo?.screen ?? { w: 1080, h: 2400 };
        await this.shell(
          `input swipe ${Math.round(w.w / 2)} ${Math.round(w.h * 0.9)} ${Math.round(w.w / 2)} ${Math.round(w.h * 0.3)} 250`,
        );
        await sleep(600);
        s = await state();
      }
      unlocked = !s.locked;
    }
    if (woke || unlocked) await this.focusSteady();
    return { woke, unlocked, locked: s.locked };
  }

  /**
   * A phone just woken has the app on its screen before the app can take a touch: a Xiaomi passes through no focus
   * and its launcher, and a touch meanwhile reaches no window. Until the focus has held for a moment.
   */
  private async focusSteady() {
    const end = Date.now() + WAKE_FOCUS_MS;
    let last = '';
    let since = Date.now();
    while (Date.now() < end) {
      const focus = await this.currentFocus();
      if (!focus || focus !== last) {
        last = focus;
        since = Date.now();
      } else if (Date.now() - since >= WAKE_STEADY_MS) return;
      await sleep(150);
    }
  }

  private lockedError() {
    return new DeviceError(
      'DEVICE_LOCKED',
      `${this.serial} is locked behind its PIN, pattern or password`,
      'unlock it by hand: no tool can answer it',
    );
  }

  /** The window that has the focus; none between windows and on a dark screen. */
  private async currentFocus(): Promise<string> {
    const focus = /mCurrentFocus=(.*)/.exec(
      await this.shell('dumpsys window | grep -m1 mCurrentFocus'),
    )?.[1];
    return focus === undefined || focus === 'null' ? '' : focus;
  }

  async tree(opts: { maxDepth?: number; maxNodes?: number } = {}): Promise<Tree> {
    const read = async () => (await this.call('tree.get', opts, TIMEOUTS.read)).result;
    const t = await read().catch((e: unknown) => {
      if (e instanceof DeviceError && e.code === 'NOT_FOUND') return undefined;
      throw e;
    });
    // no app window at all: a dark or locked screen; once awake, read again
    if (t && t.windows.some((w) => w.type === 1)) return t;
    const s = await this.ensureAwake();
    if (s.locked) throw this.lockedError();
    if (!s.woke && !s.unlocked) {
      if (t) return t;
      throw new DeviceError('NOT_FOUND', 'no window to read');
    }
    return read();
  }

  async act(action: ActParams, opts: ActOptions = {}): Promise<ActResult> {
    const once = () => this.queue.run(() => this.actNow(action, opts, durationOf(action)));
    return once().catch(async (e: unknown) => {
      // the agent refuses a touch on a dark screen before it is made: it would reach nothing
      if (!(e instanceof DeviceError && /the screen is off/.test(e.message))) throw e;
      if ((await this.ensureAwake()).locked) throw this.lockedError();
      return once();
    });
  }

  /**
   * The screen's accessibility issues (docs/protocol.md "Accessibility audit"): the host's checks of a
   * tree read, a PNG screenshot and the characters each text does not show.
   */
  async audit(opts: { maxIssues?: number } = {}): Promise<AuditResult> {
    const startedAt = Date.now();
    const hello = await this.open();
    const full = hello.capabilities.includes('a11y.read');
    const { tree, clips, traversal } = full
      ? (await this.call('a11y.read', {}, TIMEOUTS.read)).result
      : { tree: await this.tree(), clips: [], traversal: [] };
    const shot = await this.screenshot({ format: 'png' });
    const r = auditAndroid(tree, decodePng(shot.data), {
      scale: hello.screen.density / 160,
      clips,
      ...(opts.maxIssues && { maxIssues: opts.maxIssues }),
      startedAt,
    });
    // an older agent's read has no traversal hints: no reading order is worked out from it
    return { ...r, ...(full && { read: { tree, traversal } }) };
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
    return this.launcher
      .holders()
      .then((others) => (others.length > 0 ? undefined : this.apps.start(pkg)));
  }

  /** Starts the app's launcher activity and waits for it (`am start -W`); returns its output. */
  async launch(pkg: string): Promise<string> {
    return (await this.launchedAlongside(pkg)) ?? this.queue.run(() => this.apps.start(pkg));
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
  if (a.kind === 'gesture') return Math.max(...a.pointers.map((p) => p[p.length - 1]!.t));
  return 0;
}
