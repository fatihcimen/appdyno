import {
  swipeThrough,
  type ScreenRecorder,
  type SystemSwipe,
  TIMEOUTS,
  TRANSITION_MS,
  type ActOptions,
  type TreeOptions,
  reportProgress,
} from '@appdyno/core';
import { SimulatorApps } from './simulator-manage.js';
import { SimulatorEvents } from './sim-events.js';
import { SimulatorSettings } from './sim-settings.js';
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
import { HeldLaunches } from './sim-held.js';
import { SimulatorViews } from './sim-views.js';
import { IosSimulatorPerf } from './perf.js';
import { simulatorRecorder } from './record.js';
import { SimulatorWeb } from './webinspector.js';
import { DirectSim, turnedBy } from './simdirect.js';
import { SimulatorLock } from './sim-lock.js';
import { SimulatorLifecycle } from './sim-lifecycle.js';
import { type Capture, nodesBusy, settleAfter } from './simsettle.js';
import { HelperActs } from './sim-act.js';
import { HelperReads } from './sim-read.js';
import { helperSeesFront, looksOf, openerOf, ownScheme, untilOpened } from './sim-open.js';
import { pasteOnMac, setSimClipboard } from './sim-clipboard.js';
import { IosRunnerLauncher } from './runner.js';
import { assertBundle, Simctl } from './simctl.js';
import { IosDevice } from './device.js';
import { simulatorOps } from './simulator-ops.js';
import { HOME_SCREEN_APP } from './platform-screen.js';

const LAUNCH_FRONT_MS = 15_000;

/**
 * How long after a key the app in front is not taken for one that stays there: after home the helper named the app for
 * 0.5 to 1 s more, as it went away, and a launch that took that for "in front already" left the home screen up.
 */
const LEAVING_MS = 2_000;

/** An iOS simulator: the simulator tool for apps, links and location; perf from the Mac. */
export class IosSimulatorDevice extends IosDevice {
  readonly virtual = true;
  readonly direct: DirectSim;
  private readonly reads: HelperReads;
  private readonly acts: HelperActs;

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
    this.holds = new HeldLaunches(serial);
    this.viewProbe = new SimulatorViews(simctl, serial, this.holds);
    this.apps = new SimulatorApps(simctl, serial, this.viewProbe, (app) => this.target(app));
    this.settings = new SimulatorSettings(simctl, serial);
    this.events = new SimulatorEvents(simctl, serial, () =>
      this.foreground().catch(() => undefined),
    );
    this.recorder = simulatorRecorder(serial);
    this.mirror = new SimulatorMirror(serial, simctl);
    this.network = new SimulatorNetwork(simctl, serial, this.holds);
    this.web = new SimulatorWeb(simctl, serial);
    this.lock = new SimulatorLock(simctl, serial);
    this.life = new SimulatorLifecycle(simctl, serial, this);
    this.reads = new HelperReads({
      direct: this.direct,
      app: () => this.targetApp,
      runnerUp: () => this.runnerUp,
      runnerStarting: () => this.agentStarting,
      runner: async () => (await this.callNow('tree.get', {}, TIMEOUTS.read)).result,
    });
    this.acts = new HelperActs({
      direct: this.direct,
      reads: this.reads,
      helperInput: () => this.helperInput,
      read: (final) => this.readNow(final),
      byRunner: (action, opts) => this.actByRunner(action, opts),
      width: () => this.hello?.screen.w ?? Infinity,
    });
  }

  private readonly lock: SimulatorLock;
  private readonly viewProbe: SimulatorViews;
  private readonly life: SimulatorLifecycle;
  private behind = false;

  memoryWarning = (app: string, level?: string) => this.life.memoryWarning(app, level);
  shake = () => this.life.shake();
  endInBackground = (app: string) => this.life.endInBackground(app);
  addMedia = (files: string[]) => this.life.addMedia(files);

  readonly recorder: ScreenRecorder;
  readonly mirror: SimulatorMirror;
  readonly holds: HeldLaunches;
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
        why = (e instanceof Error ? e.message : String(e)) || 'it gave no reason';
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
      if (waits !== undefined) this.acts.startingMs += Date.now() - waits;
    }
  }

  /** A runner that starts later is told by `connect`. */
  override async target(bundle: string) {
    if (this.runnerUp) return super.target(bundle);
    this.targetApp = assertBundle(bundle);
  }

  /**
   * The views of the app on the screen, by the view probe a launch put in it (`SimulatorViews.read`). Past the queue and
   * with no runner, as a hung app's probe says its main thread did not answer.
   */
  views() {
    return this.viewProbe.read(this.targetApp, () => this.direct.front());
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
    return this.acts.remember(tree);
  }

  override async act(action: ActParams, opts: ActOptions = {}): Promise<ActResult> {
    this.startBehind();
    await this.wake();
    return this.queue.run(() => this.acts.act(action, opts));
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
      this.pressedAt = Date.now();
      return opts?.read === 'tree' ? { tree: await this.tree() } : {};
    }
    const r = await super.key(key, opts, modifiers);
    this.pressedAt = Date.now();
    if (key === 'lock' || key === 'power') this.lock.pressed();
    return r;
  }

  /** When a key last went: one that sends the app away, as home, leaves it named as in front a while (`LEAVING_MS`). */
  private pressedAt = 0;

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
    const looks = looksOf(this.direct, this.queue, this.reads, (tap) =>
      this.actByRunner(tap, { settle: false, read: 'none' }),
    );
    const opened = await untilOpened(pkg, app.name, looks, LAUNCH_FRONT_MS);
    // the app opening over the home screen takes no touches either
    if (opened.stayed === false) this.acts.transitionEnds = Date.now() + TRANSITION_MS;
    return opened.answered ? { answered: app.name } : undefined;
  }

  protected opener(pkg: string) {
    return openerOf(this.simctl, this.serial, pkg);
  }

  override async launch(pkg: string) {
    await this.wake();
    // an app on its way out is not in front for long: only a launch brings that one back
    const stays = Date.now() - this.pressedAt >= LEAVING_MS;
    if (
      stays &&
      this.targetApp === pkg &&
      (await this.direct.front().catch(() => undefined)) === pkg
    )
      return;
    return super.launch(pkg);
  }

  /**
   * During a launch no app is primary, for seconds on a loaded Mac. The home screen stays so under a system
   * alert over the app, and only the runner can tell that apart.
   */
  protected override async untilFront(pkg: string) {
    // an app that ended as it started never comes: the runner's look held such a launch 10 s more
    if (
      !(await helperSeesFront(this.direct, pkg, LAUNCH_FRONT_MS)) &&
      (await this.appRunning(pkg).catch(() => true))
    )
      await super.untilFront(pkg);
    // the app opening over the home screen takes no touches either: the first one was lost on a fresh boot, and the
    // runner's way too, where it told the front as it first came up (a GitHub runner, 2 of 4 first runs)
    this.acts.transitionEnds = Date.now() + TRANSITION_MS;
  }

  protected override async frontNow() {
    return (await this.direct.front().catch(() => undefined)) ?? super.frontNow();
  }

  override async hardware() {
    const model = await modelOf(this.simctl, this.serial);
    return { ...(await super.hardware()), ...(model && { model }) };
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
        return { ...r, ...(await settleAfter(this.acts.settleOn(), key, opts)).result };
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

  /** As the app in front stands, by the read helper: the runner's hello, as the helper's, is of the screen at its start. */
  async screenNow() {
    const own = this.hello?.screen;
    const turns = own && (await this.direct.turnsNow().catch(() => undefined));
    return own && turns !== undefined ? turnedBy(own, turns) : undefined;
  }

  override close() {
    this.direct.close(this.runnerUp);
    void this.mirror.close();
    this.web.close();
    super.close();
  }

  /** The app's performance, measured from the Mac; frames through the frame probe, if asked for. */
  get measure(): IosSimulatorPerf {
    return (this.perfTools ??= new IosSimulatorPerf(
      this.serial,
      this.simctl,
      (bundle) => this.appShown(bundle),
      (bundle, test) => this.xctMetrics(bundle, test),
      this.holds,
    ));
  }
  private perfTools: IosSimulatorPerf | undefined;
}
