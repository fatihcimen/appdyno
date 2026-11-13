import {
  failedAfterSending,
  sleep,
  swipeThrough,
  type ScreenRecorder,
  type SystemSwipe,
  TIMEOUTS,
  TRANSITION_MS,
  type ActOptions,
  type TreeOptions,
  must,
  reportProgress,
  throwIfCancelled,
} from '@appdyno/core';
import { SimulatorApps, SimulatorEvents, SimulatorSettings } from './simulator-manage.js';
import { modelOf } from './simulators.js';
import { typeByKeys, typesByKeys } from './sim-keys.js';
import {
  type Hello,
  type Tree,
  type ActParams,
  type ActResult,
  type Method,
  type Modifier,
  type ParamsOf,
  DeviceError,
} from '@appdyno/protocol';
import { SimulatorMirror } from './mirror-sim.js';
import { SimulatorNetwork } from './network.js';
import { IosSimulatorPerf } from './perf.js';
import { simulatorRecorder } from './record.js';
import { SimulatorWeb } from './webinspector.js';
import { DirectSim } from './simdirect.js';
import { SimulatorLock } from './sim-lock.js';
import { type Capture, nodesBusy, settleAfter } from './simsettle.js';
import { firstPoint } from './simtouch.js';
import { onKeyboard } from './simtree.js';
import { HelperReads } from './sim-read.js';
import { helperSeesFront, looksOf, openerOf, ownScheme, untilOpened } from './sim-open.js';
import { pasteOnMac, setSimClipboard } from './sim-clipboard.js';
import { IosRunnerLauncher } from './runner.js';
import { assertBundle, Simctl } from './simctl.js';
import { IosDevice } from './device.js';
import { simulatorOps } from './simulator-ops.js';
import { HOME_SCREEN_APP } from './platform-screen.js';

type Node = Tree['nodes'][number];

/** How long a touch that changed nothing has to be reported, before the runner does it again. */
const LATE_TOUCH_MS = 4_000;

const LAUNCH_FRONT_MS = 15_000;

/** An iOS simulator: the simulator tool for apps, links and location; perf from the Mac. */
export class IosSimulatorDevice extends IosDevice {
  readonly virtual = true;
  readonly direct: DirectSim;
  /** Layouts recently answered, by hash: what an action's `before` names. */
  private readonly recent = new Map<string, Node[]>();
  private readonly reads: HelperReads;

  /** Its processes run on this Mac's kernel and read this clock, and a time needs no runner brought up for it. */
  override wallClock() {
    return Promise.resolve(Date.now());
  }

  constructor(
    serial: string,
    private readonly simctl: Simctl = new Simctl(),
    direct?: DirectSim,
    /** `behind: false`: the runner starts only for what needs it, as a command that ends with its answer would wait for it */
    private readonly opts: { behind?: boolean } = {},
  ) {
    super(serial, simulatorOps(serial, simctl), new IosRunnerLauncher(serial));
    this.direct = direct ?? new DirectSim(serial);
    this.apps = new SimulatorApps(simctl, serial);
    this.settings = new SimulatorSettings(simctl, serial);
    this.events = new SimulatorEvents(simctl, serial, () =>
      this.foreground().catch(() => undefined),
    );
    this.recorder = simulatorRecorder(serial);
    this.mirror = new SimulatorMirror(serial, simctl);
    this.network = new SimulatorNetwork(simctl, serial);
    this.web = new SimulatorWeb(simctl, serial);
    this.lock = new SimulatorLock(simctl, serial);
    this.reads = new HelperReads({
      direct: this.direct,
      app: () => this.targetApp,
      runnerUp: () => this.runnerUp,
      runnerStarting: () => this.agentStarting,
      runner: async () => (await this.callNow('tree.get', {}, TIMEOUTS.read)).result,
    });
  }

  private readonly lock: SimulatorLock;
  private behind = false;

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

  /** Whether touches and keys go by the helper. */
  private get helperInput() {
    return !this.direct.status().input.startsWith('runner');
  }

  /** Only a runner waits on the device: the helper is read. */
  protected override get waits() {
    return this.runnerUp;
  }

  warm(app?: string) {
    this.direct.warm();
    // its folder, which a launch's look at whether it ran before asks first: 110 to 235 ms of a first launch
    if (app) this.simctl.appContainer(this.serial, app).catch(() => undefined);
  }

  /** The runner, started behind the helper at the first read or touch: at the choice it slowed a launch 3.4 s. */
  private startBehind() {
    if (this.behind || !this.helloInfo || this.opts.behind === false) return;
    this.behind = true;
    this.ensure().catch(() => undefined);
  }

  /** The helper's hello: the runner starts for what needs it, a system alert, text, an image or a control found twice. */
  override async open(): Promise<Hello> {
    if (this.hello) return this.hello;
    let why = '';
    const hello = await this.queue
      .run(() => this.direct.hello())
      .catch((e: unknown) => {
        why = e instanceof Error ? e.message : String(e);
        return undefined;
      });
    if (hello) {
      this.helloInfo = hello;
      return hello;
    }
    // the runner is the slower way in: what it takes and why it is taken are said, not left to guess
    reportProgress(
      `the simulator's helper did not answer (${why}): the iOS runner starts in its place`,
    );
    return super.open().catch((e: unknown) => {
      if (!(e instanceof DeviceError)) throw e;
      throw new DeviceError(
        e.code,
        `${e.message}, after the simulator's helper did not answer: ${why}`,
        e.hint,
      );
    });
  }

  /** When the transition the last touch started has ended. */
  private transitionEnds = 0;

  /** What calls have waited for the runner to come up: no settle running meanwhile counts it. */
  private startingMs = 0;

  protected override startAgent() {
    this.runnerFront = undefined;
    return super.startAgent();
  }

  protected override startAlongside(pkg: string) {
    return this.ops.launch(assertBundle(pkg)).then(() => true);
  }

  /** The app the runner was last told is in front, while none is named. */
  private runnerFront: string | undefined;

  /**
   * With no app named the runner reads and acts on the home screen whatever is up, and a read of it was the home
   * screen's card of the app in front: it is told the app the helper sees there first.
   */
  protected override async callNow<M extends Method>(
    method: M,
    params: ParamsOf<M>,
    timeoutMs: number,
    closes?: number,
  ) {
    // a start in the background counts only from when a call waits on it
    const waits = this.runnerUp ? undefined : Date.now();
    try {
      if (!this.targetApp && method !== 'app.target') {
        const front = await this.direct.front().catch(() => undefined);
        if (front && front !== this.runnerFront) {
          await super.callNow('app.target', { pkg: front }, TIMEOUTS.action, closes);
          this.runnerFront = front;
        }
      }
      return await super.callNow(method, params, timeoutMs, closes);
    } finally {
      if (waits !== undefined) this.startingMs += Date.now() - waits;
    }
  }

  /** A runner that starts later is told by `connect`. */
  override async target(bundle: string) {
    if (this.runnerUp) return super.target(bundle);
    this.targetApp = assertBundle(bundle);
  }

  private remember(t: Tree) {
    this.recent.delete(t.hash);
    this.recent.set(t.hash, t.nodes);
    if (this.recent.size > 8) this.recent.delete(must(this.recent.keys().next().value, 'a read'));
    return t;
  }

  /** A read for one in the queue: the helper's, else the runner's (a system alert, a web page). */
  private async readNow(final = true): Promise<Capture> {
    const d = await this.reads.read(final);
    if (d) return d;
    const tree = (await this.callNow('tree.get', {}, TIMEOUTS.read)).result;
    return { tree, busy: nodesBusy(tree), byRunner: true };
  }

  override async tree({ asItIs, ...limits }: TreeOptions = {}): Promise<Tree> {
    this.startBehind();
    if (!asItIs) await this.wake();
    if (limits.maxDepth !== undefined || limits.maxNodes !== undefined) return super.tree(limits);
    const { tree } = await this.queue.run(() => this.readNow());
    await this.keepDump(tree);
    return this.remember(tree);
  }

  override async act(action: ActParams, opts: ActOptions = {}): Promise<ActResult> {
    this.startBehind();
    await this.wake();
    return this.queue.run(async () => {
      // the helper looks at no signal: a stroke of a call stopped meanwhile, as its app died, goes no further than this
      throwIfCancelled('the action');
      if (this.helperInput && !this.direct.screenKnown) await this.reads.read(true);
      const touch = action.kind !== 'key';
      const at = touch ? firstPoint(action) : undefined;
      const armed = this.helperInput && !!at && (await this.direct.arm().catch(() => false));
      const waited =
        at && this.helperInput
          ? await this.direct.animationsOver().catch(() => undefined)
          : undefined;
      if (at) await sleep(Math.max(0, this.transitionEnds - Date.now()));
      const touchesBefore = this.direct.touchesEnded;
      const touchedAt = Date.now();
      // a stop that came in the waits above holds the stroke too
      throwIfCancelled('the action');
      if (!(await this.direct.send(action))) return this.actByRunner(action, opts);
      const settled = () => settleAfter(this.settleOn(), action, opts).catch(failedAfterSending);
      let out = await settled();
      // nothing moved and the app has not seen the touch finish: it never got it, or a loaded Mac has it far behind
      const reports = armed && !onKeyboard([...this.recent.values()].pop() ?? [], at.x, at.y);
      if (reports && out.untouched && touchesBefore === this.direct.touchesEnded) {
        await this.direct.touchHandled(LATE_TOUCH_MS).catch(() => undefined);
        if (touchesBefore === this.direct.touchesEnded) {
          this.direct.touchLost();
          return this.actByRunner(action, opts);
        }
        out = await settled();
      }
      this.transitionEnds = out.moved ? touchedAt + TRANSITION_MS : 0;
      return { ...out.result, ...(waited !== undefined && { animationWaitMs: waited }) };
    });
  }

  /**
   * With the app in front the helper says so at once, and nothing stands over it: a look is no reason to start a runner,
   * which hid seconds, or a first build, in a read. With anything over it the app is not in front, and the read before
   * this look has brought a runner up. A look neither could take is no "nothing over it".
   */
  override async systemTree() {
    if (this.targetApp === HOME_SCREEN_APP) return undefined;
    const r = await this.queue
      .run(() => this.direct.read(HOME_SCREEN_APP))
      .catch(() => ({ refused: 'failed' }));
    if (!('refused' in r)) return r.tree;
    if (r.refused === 'not-foreground') return undefined;
    if (this.runnerUp) return super.systemTree();
    throw new DeviceError('AGENT_UNAVAILABLE', `no runner to read the home screen: ${r.refused}`);
  }

  override async foreground(): Promise<string | undefined> {
    // the system's alert over an app makes the home screen the primary one: only the runner can tell, of the app it
    // was given. With no target, as in a window, it has nothing to tell, and says the home screen whatever is up
    const front = await this.direct.front().catch(() => undefined);
    if (!this.runnerUp || !this.targetApp) return front;
    if (front === this.targetApp) return front;
    const runner = await super.foreground();
    if (runner !== this.targetApp) return runner;
    // the runner names its app a moment after it stopped: one is under an alert only while its process runs
    return (await this.simctl.running(this.serial, runner).catch(() => true)) ? runner : front;
  }

  /** A touch the app in front never reports is one `act` would take for lost and do again by the runner. */
  protected drag(way: SystemSwipe) {
    return swipeThrough(way, (e) => this.mirror.input(e));
  }

  /** A running app comes forward as it is; to start it afresh, terminate it first. */
  override async key(key: string, opts?: ActOptions, modifiers?: Modifier[]) {
    // what a window's control sends: the runner's drag up from the home indicator shows no switcher here
    if (key === 'siri' || key === 'appSwitch') {
      await this.mirror.input({ kind: 'button', name: key });
      return opts?.read === 'tree' ? { tree: await this.tree() } : {};
    }
    const r = await super.key(key, opts, modifiers);
    if (key === 'lock' || key === 'power') this.lock.pressed();
    return r;
  }

  /** The next read or action wakes it, if this tool locked it. */
  private wake() {
    return this.lock.wake(() => super.key('home', { settle: false, read: 'none' }));
  }

  /** From the Mac (`setSimClipboard`), else by the runner. */
  override setClipboard(text: string) {
    return setSimClipboard(this.simctl, this.serial, text, (t) => super.setClipboard(t));
  }

  /** From the Mac: the runner may read only what it wrote itself, or a system prompt holds it up. */
  override async getClipboard() {
    return (
      (await pasteOnMac(this.simctl, this.serial)) ||
      (this.runnerUp ? super.getClipboard() : undefined)
    );
  }

  /** A link in a scheme of the app's own returns once the app is in front: `untilOpened`, which answers its prompt. */
  override async openUrl(url: string, pkg?: string) {
    await this.wake();
    const app = pkg && this.direct.reads ? await this.opener(pkg) : undefined;
    if (!pkg || !app || !ownScheme(app.schemes, url)) return super.openUrl(url, pkg);
    await this.target(pkg);
    await this.queue.run(() => this.ops.openUrl(url, pkg));
    const looks = looksOf(this.direct, this.queue);
    // the app opening over the home screen takes no touches either
    if ((await untilOpened(pkg, app.name, looks, LAUNCH_FRONT_MS)) === false)
      this.transitionEnds = Date.now() + TRANSITION_MS;
  }

  protected opener(pkg: string) {
    return openerOf(this.simctl, this.serial, pkg);
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
    if (!(await helperSeesFront(this.direct, pkg, LAUNCH_FRONT_MS))) await super.untilFront(pkg);
    // the app opening over the home screen takes no touches either: the first one was lost on a fresh boot, and the
    // runner's way too, where it told the front as it first came up (a GitHub runner, 2 of 4 first runs)
    this.transitionEnds = Date.now() + TRANSITION_MS;
  }

  protected override async frontNow() {
    return (await this.direct.front().catch(() => undefined)) ?? super.frontNow();
  }

  override async hardware() {
    const model = await modelOf(this.simctl, this.serial);
    return { ...(await super.hardware()), ...(model && { model }) };
  }

  /** What a settle after an action reads and remembers, on the clock that leaves out waits for the runner. */
  private settleOn() {
    return {
      read: (final: boolean) => this.readNow(final),
      remember: (t: Tree) => this.remember(t),
      recent: this.recent,
      width: this.hello?.screen.w ?? Infinity,
      clock: () => Date.now() - this.startingMs,
      handled: () => this.direct.touchHandled().catch(() => undefined),
    };
  }

  /** A US keyboard's text by the helper's keys, as touches go (`typeByKeys`); anything else by the runner. */
  override async typeText(text: string, opts: Parameters<IosDevice['typeText']>[1] = {}) {
    if (this.direct.reads && this.helperInput && typesByKeys(text)) {
      await this.wake();
      const typed = await this.queue.run(async () => {
        const r = await typeByKeys(text, opts, {
          read: () => this.reads.front().then((x) => ('refused' in x ? undefined : x.tree)),
          send: (a) => this.direct.send(a),
          keyboardOpen: (t) => this.platformScreen.keyboardOpen(t),
        });
        const key = { kind: 'key', key: 'a' } as const; // the settle tells touches apart, and keys are none
        if (!r || typeof r === 'string') return r;
        return { ...r, ...(await settleAfter(this.settleOn(), key, opts)).result };
      });
      if (typed === 'retype') return super.typeText(text, { ...opts, replace: true });
      if (typed === 'append') return super.typeText(text, opts);
      if (typed) return typed;
    }
    return super.typeText(text, opts);
  }

  override async setOrientation(rotation: 0 | 1 | 2 | 3) {
    this.direct.setRotation(rotation);
    await super.setOrientation(rotation);
  }

  override close() {
    this.direct.close(this.runnerUp);
    void this.mirror.close();
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
