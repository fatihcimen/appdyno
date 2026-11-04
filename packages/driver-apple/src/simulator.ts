import { sleep, type ScreenRecorder, TIMEOUTS, type ActOptions, pause } from '@appdyno/core';
import { simulatorCrashes } from './crashes.js';
import { simulatorLogs } from './logs.js';
import { SimulatorApps, SimulatorEvents, SimulatorSettings } from './simulator-manage.js';
import {
  DeviceError,
  type Hello,
  type Tree,
  type ActParams,
  type ActResult,
  type Modifier,
} from '@appdyno/protocol';
import { SimulatorMirror } from './mirror-sim.js';
import { SimulatorNetwork } from './network.js';
import { IosSimulatorPerf } from './perf.js';
import { simulatorRecorder } from './record.js';
import { SimulatorWeb } from './webinspector.js';
import { DirectSim } from './simdirect.js';
import { type Capture, settleAfter } from './simsettle.js';
import { learnCopies, onKeyboard, withoutCopies } from './simtree.js';
import { IosRunnerLauncher } from './runner.js';
import { assertBundle, Simctl } from './simctl.js';
import { type IosDeviceOps, IosDevice } from './device.js';

export function simulatorOps(udid: string, simctl: Simctl): IosDeviceOps {
  return {
    up: async () => (await simctl.state(udid)) === 'Booted',
    launch: async (b) => {
      await simctl.launch(udid, b);
    },
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
    pid: (b) => simctl.pid(udid, b),
  };
}

type Node = Tree['nodes'][number];

const nodesBusy = (t: Tree) => t.nodes.some((n) => n.c === 'ActivityIndicator' && (n.f & 1) !== 0);

const firstPoint = (a: ActParams) =>
  a.kind === 'tap' || a.kind === 'longPress'
    ? { x: a.x, y: a.y }
    : a.kind === 'swipe'
      ? a.from
      : a.kind === 'gesture'
        ? { x: a.pointers[0]![0]!.x, y: a.pointers[0]![0]!.y }
        : undefined;

/** An iOS simulator: the simulator tool for apps, links and location; perf from the Mac. */
const WAKE_GAP_MS = 400;

const WAKE_PRESSES = 6;

/**
 * UIKit takes no touches during a push or a pop. The tree is final and the app's reports say all is still well
 * before it ends: a tap under 560 ms after the touch that went back was lost, 7 of 30, with the app reporting it.
 */
const TRANSITION_MS = 650;

/** How long a touch that changed nothing has to be reported, before the runner does it again. */
const LATE_TOUCH_MS = 4_000;

const LAUNCH_FRONT_MS = 15_000;

const HOME_FRONT_MS = 3_000;

const SPRINGBOARD = 'com.apple.springboard';

export class IosSimulatorDevice extends IosDevice {
  readonly virtual = true;
  readonly direct: DirectSim;
  /** Layouts recently answered, by hash: what an action's `before` names. */
  private readonly recent = new Map<string, Node[]>();
  private readonly verdicts = new Map<string, Set<string>>();

  constructor(
    serial: string,
    private readonly simctl: Simctl = new Simctl(),
    direct?: DirectSim,
  ) {
    super(serial, simulatorOps(serial, simctl), new IosRunnerLauncher(serial));
    this.direct = direct ?? new DirectSim(serial);
    this.apps = new SimulatorApps(simctl, serial);
    this.settings = new SimulatorSettings(simctl, serial);
    this.events = new SimulatorEvents(simctl, serial);
    this.recorder = simulatorRecorder(serial);
    this.mirror = new SimulatorMirror(serial, simctl);
    this.network = new SimulatorNetwork(simctl, serial);
    this.web = new SimulatorWeb(simctl, serial);
  }

  readonly recorder: ScreenRecorder;
  readonly mirror: SimulatorMirror;
  readonly network: SimulatorNetwork;
  readonly web: SimulatorWeb;
  readonly apps: SimulatorApps;
  readonly settings: SimulatorSettings;
  readonly events: SimulatorEvents;

  private get runnerUp() {
    return this.agentUp;
  }

  /** Only a runner waits on the device: the helper is read. */
  protected override get waits() {
    return this.runnerUp;
  }

  /** The helper's hello: the runner starts for what needs it, a system alert, text, an image or a control found twice. */
  override async open(): Promise<Hello> {
    if (this.hello) return this.hello;
    const hello = await this.queue.run(() => this.direct.hello()).catch(() => undefined);
    if (!hello) return super.open();
    this.helloInfo = hello;
    return hello;
  }

  /** When the transition the last touch started has ended. */
  private transitionEnds = 0;

  /** What starting the runner has taken: no settle running meanwhile counts it. */
  private startingMs = 0;

  protected override async startAgent() {
    const at = Date.now();
    try {
      return await super.startAgent();
    } finally {
      this.startingMs += Date.now() - at;
    }
  }

  protected override startAlongside(pkg: string) {
    return this.ops.launch(assertBundle(pkg)).then(() => true);
  }

  /** A runner that starts later is told by `connect`. */
  override async target(bundle: string) {
    if (this.runnerUp) return super.target(bundle);
    this.targetApp = assertBundle(bundle);
  }

  private remember(t: Tree) {
    this.recent.delete(t.hash);
    this.recent.set(t.hash, t.nodes);
    if (this.recent.size > 8) this.recent.delete(this.recent.keys().next().value!);
    return t;
  }

  /**
   * The helper's read of the app in front, when it can say what the runner would; for one in the queue.
   * `final`: this read is an answer, not one of a settle's looks. Only XCUI tells which copy of a control a
   * tap reaches, so a layout with repeated controls is believed once the runner has read it alike, and that
   * verdict is kept by the layout's digest. Any other layout needs no runner, and is checked once one is up.
   */
  private async readDirect(final: boolean): Promise<Capture | undefined> {
    const r = await this.direct.read(this.targetApp).catch(() => ({ refused: 'failed' }));
    if ('refused' in r) return undefined;
    const known = this.verdicts.get(r.tree.hash);
    if (known) return { tree: withoutCopies(r.tree, known), busy: r.busy };
    if (!r.copies && !this.runnerUp) return { tree: r.tree, busy: r.busy };
    if (!final) return { tree: r.tree, busy: r.busy, askRunner: true };
    const runner = (await this.callNow('tree.get', {}, TIMEOUTS.read)).result;
    const verdict = learnCopies(r.tree, runner);
    if (!verdict || !this.direct.checkRead(withoutCopies(r.tree, verdict), runner))
      return { tree: runner, busy: nodesBusy(runner), byRunner: true };
    this.verdicts.delete(r.tree.hash);
    this.verdicts.set(r.tree.hash, verdict);
    if (this.verdicts.size > 64) this.verdicts.delete(this.verdicts.keys().next().value!);
    return { tree: withoutCopies(r.tree, verdict), busy: r.busy };
  }

  /** A read for one in the queue: the helper's, else the runner's (a system alert, a web page). */
  private async readNow(final = true): Promise<Capture> {
    const d = await this.readDirect(final);
    if (d) return d;
    const tree = (await this.callNow('tree.get', {}, TIMEOUTS.read)).result;
    return { tree, busy: nodesBusy(tree), byRunner: true };
  }

  override async tree(opts: { maxDepth?: number; maxNodes?: number } = {}): Promise<Tree> {
    await this.wake();
    if (opts.maxDepth !== undefined || opts.maxNodes !== undefined) return super.tree(opts);
    const { tree } = await this.queue.run(() => this.readNow());
    await this.keepDump(tree);
    return this.remember(tree);
  }

  override async act(action: ActParams, opts: ActOptions = {}): Promise<ActResult> {
    await this.wake();
    return this.queue.run(async () => {
      if (!this.direct.status().input.startsWith('runner') && !this.direct.screenKnown)
        await this.readDirect(true);
      const touch = action.kind !== 'key';
      const at = touch ? firstPoint(action) : undefined;
      const armed =
        !this.direct.status().input.startsWith('runner') &&
        !!at &&
        (await this.direct.arm().catch(() => false));
      const waited =
        at && !this.direct.status().input.startsWith('runner')
          ? await this.direct.animationsOver().catch(() => undefined)
          : undefined;
      if (at) await sleep(Math.max(0, this.transitionEnds - Date.now()));
      const touchesBefore = this.direct.touchesEnded;
      const touchedAt = Date.now();
      if (!(await this.direct.send(action))) return this.actByRunner(action, opts);
      const on = {
        read: (final: boolean) => this.readNow(final),
        remember: (t: Tree) => this.remember(t),
        recent: this.recent,
        width: this.hello?.screen.w ?? Infinity,
        clock: () => Date.now() - this.startingMs,
        handled: () => this.direct.touchHandled().catch(() => undefined),
      };
      let out = await settleAfter(on, action, opts);
      // nothing moved and the app has not seen the touch finish: it never got it, or a loaded Mac has it far behind
      const reports = armed && !onKeyboard([...this.recent.values()].pop() ?? [], at!.x, at!.y);
      if (reports && out.untouched && touchesBefore === this.direct.touchesEnded) {
        await this.direct.touchHandled(LATE_TOUCH_MS).catch(() => undefined);
        if (touchesBefore === this.direct.touchesEnded) {
          this.direct.touchLost();
          return this.actByRunner(action, opts);
        }
        out = await settleAfter(on, action, opts);
      }
      this.transitionEnds = out.moved ? touchedAt + TRANSITION_MS : 0;
      return { ...out.result, ...(waited !== undefined && { animationWaitMs: waited }) };
    });
  }

  override async foreground(): Promise<string | undefined> {
    // the system's alert over an app makes the home screen the primary one: only the runner can tell
    const front = await this.direct.front().catch(() => undefined);
    return front && front === this.targetApp ? front : super.foreground();
  }

  /** A running app comes forward as it is; to start it afresh, terminate it first. */
  /** Locked by this tool: a screen under the lock still reads, and an app will not come forward. */
  private locked = false;

  override async key(key: string, opts?: ActOptions, modifiers?: Modifier[]) {
    const r = await super.key(key, opts, modifiers);
    if (key === 'lock' || key === 'power') this.locked = true;
    return r;
  }

  /** The next read or action wakes it, as on Android: one press wakes it, one more opens it (no passcode here). */
  private async wake() {
    if (!this.locked) return;
    this.locked = false;
    // the lock comes a moment after its press; a press during its animation does nothing; and a read under the lock
    // holds the runner up for 15 s
    for (let i = 0; i < WAKE_PRESSES && !(await this.lockedNow()); i++)
      await pause(WAKE_GAP_MS / 2);
    for (let i = 0; i < WAKE_PRESSES && (await this.lockedNow()); i++) {
      await super.key('home', { settle: false, read: 'none' });
      await pause(WAKE_GAP_MS);
    }
  }

  private async lockedNow() {
    const state = await this.simctl.exec([
      'spawn',
      this.serial,
      'notifyutil',
      '-g',
      'com.apple.springboard.lockstate',
    ]);
    return state.trim().endsWith(' 1');
  }

  private readonly pasteOnMac = () => this.simctl.exec(['pbpaste', this.serial]);

  /**
   * From the Mac: at times the runner's own pasteboard call held it up for its 15 s. Where the Mac's call writes
   * nothing, as `simctl pbcopy` on a new iOS 26.5 simulator with Xcode 27.1, only the runner's is left, and a stall
   * of that is refused as what it is: it was restarted for it, and a second wait saw the same at load 138.
   */
  override async setClipboard(text: string) {
    await this.simctl.pbcopy(this.serial, text);
    if ((await this.pasteOnMac()) === text) return;
    await super.setClipboard(text).catch((e: unknown) => {
      if (!(e instanceof DeviceError && e.code === 'TIMEOUT')) throw e;
      throw new DeviceError(
        'UNSUPPORTED',
        `this simulator's clipboard did not take the text: simctl pbcopy wrote nothing and the runner's call stalled`,
        'try again once the Mac is less busy, or type the text instead',
        { cause: e, retryable: true },
      );
    });
  }

  /** From the Mac: the runner may read only what it wrote itself, or a system prompt holds it up. */
  override async getClipboard() {
    return (await this.pasteOnMac()) || (this.runnerUp ? super.getClipboard() : undefined);
  }

  override async openUrl(url: string, pkg?: string) {
    await this.wake();
    return super.openUrl(url, pkg);
  }

  override async launch(pkg: string) {
    await this.wake();
    if (this.targetApp === pkg && (await this.direct.front().catch(() => undefined)) === pkg)
      return;
    return super.launch(pkg);
  }

  /**
   * During a launch no app is primary, for seconds on a loaded Mac. The home screen stays so under a system
   * alert over the app, and only the runner can tell that apart.
   */
  protected override async untilFront(pkg: string) {
    const end = Date.now() + LAUNCH_FRONT_MS;
    let homeSince: number | undefined;
    while (this.direct.reads && Date.now() < end) {
      const front = await this.direct.front().catch(() => undefined);
      if (front === pkg) {
        // the app opening over the home screen takes no touches either: the first one was lost on a fresh boot
        this.transitionEnds = Date.now() + TRANSITION_MS;
        return;
      }
      homeSince = front === SPRINGBOARD ? (homeSince ?? Date.now()) : undefined;
      if (homeSince !== undefined && Date.now() - homeSince > HOME_FRONT_MS) break;
      await sleep(20);
    }
    await super.untilFront(pkg);
  }

  protected override async frontNow() {
    return (await this.direct.front().catch(() => undefined)) ?? super.frontNow();
  }

  override async hardware() {
    const me = (await this.simctl.list()).find((d) => d.udid === this.serial);
    const type = me?.deviceType?.replace(/^.*SimDeviceType\./, '').replaceAll('-', ' ');
    return { ...(await super.hardware()), ...(type && { model: type }) };
  }

  override async setOrientation(rotation: 0 | 1 | 2 | 3) {
    this.direct.setRotation(rotation);
    await super.setOrientation(rotation);
  }

  override close() {
    this.direct.close(this.runnerUp);
    super.close();
  }

  /** The app's performance, measured from the Mac; frames through the frame probe, if asked for. */
  get measure(): IosSimulatorPerf {
    return (this.perfTools ??= new IosSimulatorPerf(
      this.serial,
      this.simctl,
      (bundle) => this.appShown(bundle),
      (bundle, test) => this.xctMetrics(bundle, test),
    ));
  }
  private perfTools: IosSimulatorPerf | undefined;
}
