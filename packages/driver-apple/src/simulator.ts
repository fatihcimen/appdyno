import { spawn } from 'node:child_process';
import { type ScreenRecorder, TIMEOUTS, type ActOptions, pause } from '@appdyno/core';
import { simulatorCrashes } from './crashes.js';
import { simulatorLogs } from './logs.js';
import { SimulatorApps, SimulatorSettings } from './simulator-manage.js';
import {
  DeviceError,
  type Tree,
  type ActParams,
  type ActResult,
  type Key,
} from '@appdyno/protocol';
import { SimulatorNetwork } from './network.js';
import { IosSimulatorPerf } from './perf.js';
import { simulatorRecorder } from './record.js';
import { SimulatorWeb } from './webinspector.js';
import { DirectSim } from './simdirect.js';
import { type Capture, settleAfter } from './simsettle.js';
import { learnCopies, onKeyboard, withoutCopies } from './simtree.js';
import { IosRunnerLauncher } from './runner.js';
import { Simctl, xcodeEnv } from './simctl.js';
import { type IosDeviceOps, IosDevice } from './device.js';

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
    this.recorder = simulatorRecorder(serial);
    this.network = new SimulatorNetwork(simctl, serial);
    this.web = new SimulatorWeb(simctl, serial);
  }

  readonly recorder: ScreenRecorder;
  readonly network: SimulatorNetwork;
  readonly web: SimulatorWeb;
  readonly apps: SimulatorApps;
  readonly settings: SimulatorSettings;

  private remember(t: Tree) {
    this.recent.delete(t.hash);
    this.recent.set(t.hash, t.nodes);
    if (this.recent.size > 8) this.recent.delete(this.recent.keys().next().value!);
    return t;
  }

  /**
   * The helper's read of the app in front, when it can say what the runner would; for one in the queue.
   * `final`: this read is an answer, not one of a settle's looks. Each layout is believed once the runner has
   * read it alike (XCUI leaves out what a modal covers, and alone tells which copy of a control a tap
   * reaches), and that verdict is kept by the layout's digest.
   */
  private async readDirect(final: boolean): Promise<Capture | undefined> {
    const r = await this.direct.read(this.targetApp).catch(() => ({ refused: 'failed' }));
    if ('refused' in r) return undefined;
    const known = this.verdicts.get(r.tree.hash);
    if (known) return { tree: withoutCopies(r.tree, known), busy: r.busy };
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
      // the first read tells the helper the screen's size
      if (!this.direct.status().input.startsWith('runner') && !this.direct.readProven)
        await this.readDirect(true);
      const touch = action.kind !== 'key';
      const at = touch ? firstPoint(action) : undefined;
      const armed =
        !this.direct.status().input.startsWith('runner') &&
        !!at &&
        (await this.direct.arm().catch(() => false));
      // UIKit takes no touches while a view animates, and the tree already shows where it ends
      const waited =
        at && !this.direct.status().input.startsWith('runner')
          ? (await this.callNow('animations.wait', at, TIMEOUTS.action)).result.ms
          : undefined;
      const touchesBefore = this.direct.touchesEnded;
      if (!(await this.direct.send(action))) return this.actByRunner(action, opts);
      const out = await settleAfter(
        {
          read: (final) => this.readNow(final),
          remember: (t) => this.remember(t),
          recent: this.recent,
          width: this.hello?.screen.w ?? Infinity,
        },
        action,
        opts,
      );
      // nothing moved and the app has not seen the touch finish: it never got it
      const reports = armed && !onKeyboard([...this.recent.values()].pop() ?? [], at!.x, at!.y);
      if (reports && out.untouched && touchesBefore === this.direct.touchesEnded) {
        this.direct.touchLost();
        return this.actByRunner(action, opts);
      }
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

  override async key(key: Key, opts?: ActOptions) {
    const r = await super.key(key, opts);
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

  /** From the Mac: at times the runner's own pasteboard call held it up for its 15 s. */
  override setClipboard(text: string) {
    return new Promise<void>((resolve, reject) => {
      const p = spawn('xcrun', ['simctl', 'pbcopy', this.serial], {
        env: xcodeEnv(),
        stdio: ['pipe', 'ignore', 'ignore'],
      });
      p.on('error', reject);
      p.on('close', (code) =>
        code === 0
          ? resolve()
          : reject(new DeviceError('INTERNAL', `simctl pbcopy exited with ${code}`)),
      );
      p.stdin.end(text);
    });
  }

  /** From the Mac: the runner may read only what it wrote itself, or a system prompt holds it up. */
  override async getClipboard() {
    return (await this.simctl.exec(['pbpaste', this.serial])) || undefined;
  }

  override async openUrl(url: string, pkg?: string) {
    await this.wake();
    return super.openUrl(url, pkg);
  }

  override async launch(pkg: string): Promise<string> {
    await this.wake();
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

  /** The app's performance, measured from the Mac; frames through the frame probe, if asked for. */
  get measure(): IosSimulatorPerf {
    return (this.perfTools ??= new IosSimulatorPerf(
      this.serial,
      this.simctl,
      async (bundle) => {
        // nothing may have named this app yet; a warm-up launch comes first, so this is not timed
        if (this.targetApp !== bundle) await this.target(bundle).catch(() => undefined);
        const t = await this.tree().catch(() => undefined);
        return !!t && t.windows[0]?.pkg === bundle && t.nodes.filter((n) => n.w === 0).length > 3;
      },
      (bundle, test) => this.xctMetrics(bundle, test),
    ));
  }
  private perfTools: IosSimulatorPerf | undefined;
}
