import { crashExits, phoneCrashes } from './crashes.js';
import { phoneLogs } from './logs.js';
import { PhoneApps, PhoneSettings } from './phone-manage.js';
import { existsSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DeviceError, type Tree } from '@appdyno/protocol';
import {
  sleep,
  stateDir,
  type MeasureSource,
  type ScreenRecorder,
  type Symbols,
} from '@appdyno/core';
import { type IosDeviceOps, IosDevice } from './device.js';
import { phoneRecorder } from './record.js';
import { iosProducts, type RunnerTransport, IosRunnerLauncher } from './runner.js';
import { signedRunner, type PhoneSigning, findPhoneSigning, phoneXctestrun } from './signing.js';
import { assertBundle } from './simctl.js';
import {
  hitchFrames,
  parseActivityMonitor,
  parseHangs,
  parseThermal,
  parseTimeProfile,
} from './trace-parse.js';
import { appLaunchPhases } from './phone-launch.js';
import { phoneLeaks } from './phone-leaks.js';
import { phoneEnergy, phoneNetwork } from './phone-power.js';
import { parseHangCauses } from './hang-cause.js';
import { nameFrames } from './frame-names.js';
import { recentTrace, recordTrace, traceTable } from './trace.js';
import { connectPort, listDevices } from './usbmux.js';
import { Devicectl } from './devicectl.js';

/** The runner built for phones (unsigned; signed for the profile at first use): built once when missing. */
export async function phoneRunnerApp(build = true): Promise<string> {
  const dir = await iosProducts('device', build);
  const app = dir && join(dir, 'Debug-iphoneos/Runner-Runner.app');
  if (!app || !existsSync(app))
    throw new DeviceError(
      'UNSUPPORTED',
      'the iPhone runner is not built',
      "build it: (cd ios && xcodebuild build-for-testing -project Appdyno.xcodeproj -scheme Runner -destination 'generic/platform=iOS' -derivedDataPath .derived-device CODE_SIGNING_ALLOWED=NO)",
    );
  return app;
}

/** What the phone's lock screen shows, in any language. */
const LOCK_SCREEN = 'lockscreen-date-view';
const UNLOCK = 'unlock it by hand: no tool can answer a passcode';
const LOCK_PRESSES = 3;
const LOCK_GOES_MS = 1_500;

const signedRunners = new Map<string, ReturnType<typeof signedRunner>>();

/** A phone: the runner signed for the profile, a port on the phone, reached over USB. */
export function phoneTransport(
  udid: string,
  given?: PhoneSigning,
): RunnerTransport & { signed(): ReturnType<typeof signedRunner> } {
  const cache = join(stateDir(), 'ios-phone');
  // the signed runner is looked up once per runner build and profile in this process (a reconnect
  // does not ask the keychain again)
  let signing = given;
  const signed = async () => {
    signing ??= await findPhoneSigning(udid);
    const current = signing;
    const app = await phoneRunnerApp();
    const key = [join(app, 'PlugIns/Runner.xctest/Runner'), current.profile]
      .map((f) => `${f}@${statSync(f).mtimeMs}`)
      .join(':');
    let result = signedRunners.get(key);
    if (!result) {
      result = signedRunner(app, current, cache);
      signedRunners.set(key, result);
      result.catch(() => signedRunners.delete(key));
    }
    return result;
  };
  return {
    signed,
    async build() {
      const r = await signed();
      const xctestrun = join(stateDir(), `ios-${udid}.xctestrun`);
      await mkdir(stateDir(), { recursive: true, mode: 0o700 });
      await writeFile(xctestrun, phoneXctestrun(r.app, r.appId), { mode: 0o600 });
      return { xctestrun, sha256: r.key };
    },
    port: async () => 20_000 + Math.floor(Math.random() * 20_000),
    open: (port) => connectPort(udid, port),
  };
}

export function phoneOps(udid: string, ctl: Devicectl): IosDeviceOps {
  return {
    up: async () =>
      (await listDevices()).some(
        (d) => d.connection === 'USB' && d.serial.replace(/-/g, '') === udid.replace(/-/g, ''),
      ),
    launch: async (b) => JSON.stringify(await ctl.launch(b)),
    terminate: (b) => ctl.terminate(b),
    openUrl: async (url, b) => {
      if (!b)
        throw new DeviceError(
          'UNSUPPORTED',
          'on an iPhone a link is opened in a named app',
          'select the app first: use_device with app, or the --app of the server',
        );
      await ctl.launch(b, url);
    },
    setLocation: (lat, lon) => ctl.setLocation(lat, lon),
    linkPrompt: false,
    logs: phoneLogs,
    crashes: (q) => phoneCrashes(ctl, q),
    name: `iPhone ${udid}`,
    pid: (b) => ctl.pid(b),
  };
}

/**
 * A real iPhone over USB: the runner signed for the development profile and installed when the phone
 * has another build under that id (another tool's runner, an older one); apps and links via devicectl.
 */
export class IosPhoneDevice extends IosDevice {
  readonly virtual = false;
  private readonly transport: ReturnType<typeof phoneTransport>;
  readonly ctl: Devicectl;
  /** What Instruments and XCTest can read from a phone: what they cannot says why. */
  readonly measure: MeasureSource = {
    slowReads: ['memory'],
    // no tool answers this by itself: every recording holds it, so it costs what the recording cost
    vitals: async () => {
      const trace = recentTrace(this.serial);
      const thermalStatus = trace
        ? parseThermal(await traceTable(trace, 'device-thermal-state-intervals'))
        : undefined;
      return {
        value: thermalStatus === undefined ? {} : { thermalStatus },
        raw: trace ?? 'no recording of this phone in the last minutes',
        at: new Date().toISOString(),
      };
    },
    frameTrace: async (bundle, seconds, during) => {
      await this.inFront(bundle);
      const v = await this.hitches(bundle, seconds, during);
      return {
        value: { kind: 'hitches', ...v },
        raw: v.tracePath,
        at: new Date().toISOString(),
        source: 'xctrace Animation Hitches',
      };
    },
    framesDuring: async (bundle, seconds, during) => {
      await this.inFront(bundle);
      const v = await this.hitches(bundle, seconds, during);
      return { value: hitchFrames(v), raw: v.tracePath, at: new Date().toISOString() };
    },
    memory: async (bundle) => {
      const { value, raw } = await this.activity(bundle, 2_000);
      const kb = Math.round(value.footprintBytes / 1024);
      return { value: { kb, kind: 'footprint' }, raw, at: new Date().toISOString() };
    },
    cpu: async (bundle, windowMs = 3_000) => {
      const { value, raw } = await this.activity(bundle, windowMs);
      if (value.cpuPercent === undefined)
        throw new DeviceError(
          'UNSUPPORTED',
          `the trace has one reading of ${bundle}: no CPU share`,
        );
      return {
        value: { percent: value.cpuPercent, windowMs: value.windowMs! },
        raw,
        at: new Date().toISOString(),
      };
    },
    cpuProfile: async (bundle, ms, during, symbols) => {
      const { trace, profile } = await this.profile(bundle, ms, during, symbols);
      return {
        value: { ...profile, durationMs: Math.round(ms / 1000) * 1000 },
        raw: trace,
        at: new Date().toISOString(),
      };
    },
    launch: async (bundle, opts) => {
      // first: a system app is refused at once, before the launches
      const startup = opts.trace
        ? await this.terminate(bundle).then(() => appLaunchPhases(this.serial, bundle, opts.env))
        : undefined;
      const samples: number[] = [];
      for (let i = 0; i < opts.repeats + 1; i++) {
        if (opts.mode === 'cold') await this.terminate(bundle);
        else await this.ctl.launch('com.apple.Preferences').catch(() => undefined);
        await sleep(500);
        const t = performance.now();
        if (opts.env) {
          await this.ctl.launch(bundle, undefined, opts.env);
          await this.target(bundle);
        } else await this.launch(bundle);
        const end = t + 20_000;
        while (performance.now() < end) {
          const tree = await this.tree().catch(() => undefined);
          if (tree?.windows[0]?.pkg === bundle && tree.nodes.filter((n) => n.w === 0).length > 3)
            break;
        }
        // the first warms up
        if (i > 0) samples.push(Math.round(performance.now() - t));
      }
      const sorted = [...samples].sort((a, b) => a - b);
      return {
        value: {
          mode: opts.mode,
          samples: samples.map((totalMs) => ({ totalMs })),
          ...(sorted.length && { medianMs: sorted[Math.floor((sorted.length - 1) / 2)]! }),
          until: 'the first screen is read',
          ...(startup && { startup: { startupType: opts.mode, ...startup } }),
        },
        raw: samples.join(' '),
        at: new Date().toISOString(),
      };
    },
    hangs: async (bundle, seconds, during, symbols) => {
      const value = await this.hangs(bundle, seconds, during, symbols);
      return {
        value,
        raw: value.tracePath,
        at: new Date().toISOString(),
        source: 'xctrace Time Profiler potential-hangs',
      };
    },
    network: async (bundle, windowMs, during) => {
      await this.inFront(bundle);
      return phoneNetwork(this.serial, bundle, () => this.ctl.pid(bundle), windowMs, during);
    },
    energy: async (bundle, windowMs) => {
      await this.inFront(bundle);
      return phoneEnergy(this.serial, bundle, () => this.ctl.pid(bundle), windowMs);
    },
    exits: (bundle) => crashExits(this.crashes, bundle),
    heap: async (bundle, dir) => {
      await this.inFront(bundle);
      return phoneLeaks(this.serial, bundle, () => this.ctl.pid(bundle), dir);
    },
    size: async () => {
      throw new DeviceError(
        'UNSUPPORTED',
        "devicectl lists no size of an app, and a phone's app bundle cannot be read from the Mac",
      );
    },
    // a Release build signed for development has the debugger's entitlement too, and its bundle cannot be read here
    buildType: async (bundle) => {
      const app = await this.ctl.app(bundle);
      return app?.builtByDeveloper === false ? 'release' : 'unknown';
    },
    xctMetrics: (bundle, test) => this.xctMetrics(bundle, test),
  };

  constructor(serial: string, signing?: PhoneSigning) {
    const transport = phoneTransport(serial, signing);
    const ctl = new Devicectl(serial);
    super(serial, phoneOps(serial, ctl), new IosRunnerLauncher(serial, transport));
    this.transport = transport;
    this.ctl = ctl;
    this.apps = new PhoneApps(ctl);
    this.settings = new PhoneSettings(ctl);
    this.recorder = phoneRecorder(serial);
  }

  readonly recorder: ScreenRecorder;
  readonly apps: PhoneApps;
  readonly settings: PhoneSettings;

  /**
   * A phone locks itself about a minute after the last touch, and a swipe or a tap on its lock screen goes to the system
   * (one opened Spotlight): with no passcode the home button gets past it, then the app comes back; with one, nothing
   * here can, and the read refuses by name before anything touches it.
   */
  override async tree(opts: { maxDepth?: number; maxNodes?: number } = {}) {
    const onLock = (t: Tree) => t.nodes.some((n) => n.id === LOCK_SCREEN);
    const read = await super.tree(opts);
    if (!onLock(read)) return read;
    if ((await this.ctl.lockState()).passcodeRequired)
      throw new DeviceError(
        'DEVICE_LOCKED',
        `${this.serial} is locked behind its passcode`,
        UNLOCK,
      );
    // on a dark screen the first press only wakes it, with the lock screen still up; a launch does that as well
    for (let press = 0; press < LOCK_PRESSES; press++) {
      await this.key('home', { settle: false });
      if (this.targetApp) await this.launch(this.targetApp);
      await sleep(LOCK_GOES_MS);
      const after = await super.tree(opts);
      if (!onLock(after)) return after;
    }
    throw new DeviceError('DEVICE_LOCKED', `${this.serial} stays on its lock screen`, UNLOCK);
  }

  /** The app in front on a screen that is on: a launch brings a running app forward as it is and lights a dark screen. */
  async inFront(bundle: string) {
    await this.launch(assertBundle(bundle));
    await this.tree();
  }

  /** Activity Monitor over every process (no attach: a system app has no get-task-allow), one process read. */
  private async activity(bundle: string, windowMs: number) {
    const pid = await this.ctl.pid(assertBundle(bundle));
    const trace = await recordTrace({
      template: 'Activity Monitor',
      device: this.serial,
      seconds: Math.min(Math.max(Math.round(windowMs / 1000), 2), 30),
      dir: join(stateDir(), 'traces'),
    });
    const value = parseActivityMonitor(
      await traceTable(trace, 'activity-monitor-process-live'),
      pid,
    );
    if (!value) throw new DeviceError('UNSUPPORTED', `no reading of ${bundle} in the trace`);
    return { value, raw: trace };
  }

  /** The Time Profiler over every process (attaching fails at times on a phone), one process read. */
  private async profile(
    bundle: string,
    ms: number,
    during?: () => Promise<unknown>,
    symbols?: Symbols,
  ) {
    const pid = await this.ctl.pid(assertBundle(bundle));
    const trace = await recordTrace({
      template: 'Time Profiler',
      device: this.serial,
      seconds: Math.min(Math.max(Math.round(ms / 1000), 1), 30),
      dir: join(stateDir(), 'traces'),
      ...(during && { during }),
    });
    const exported = await traceTable(trace, 'time-profile');
    const samples = symbols?.dsym ? await nameFrames(exported, symbols.dsym) : exported;
    return { trace, pid, samples, profile: parseTimeProfile(samples, pid) };
  }

  /** The main thread's hangs (over 250 ms) while `during` runs: part of the Time Profiler's recording. */
  async hangs(bundle: string, seconds = 5, during?: () => Promise<unknown>, symbols?: Symbols) {
    const { trace, pid, samples } = await this.profile(bundle, seconds * 1000, during, symbols);
    const hangs = await traceTable(trace, 'potential-hangs');
    return {
      ...parseHangs(hangs, pid),
      causes: parseHangCauses(hangs, samples, pid),
      tracePath: trace,
    };
  }

  /** Ends the phone's simulated position (setLocation's). */
  async clearLocation() {
    await this.ctl.clearLocation();
  }

  /** Our runner on the phone: installed when the phone has another build under the profile's id. */
  override async prepareStart() {
    await super.prepareStart();
    const r = await this.transport.signed();
    const onPhone = await this.ctl.app(r.appId);
    if (onPhone?.bundleVersion !== r.stamp) await this.ctl.install(r.app);
  }
}
