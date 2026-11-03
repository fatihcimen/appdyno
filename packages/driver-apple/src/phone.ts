import { phoneCrashes } from './crashes.js';
import { phoneLogs } from './logs.js';
import { PhoneApps, PhoneSettings } from './manage.js';
import { existsSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DeviceError } from '@appdyno/protocol';
import { pause, run, stateDir, type MeasureSource, type ScreenRecorder } from '@appdyno/core';
import { IosDevice, type IosDeviceOps } from './device.js';
import { phoneRecorder } from './record.js';
import { IosRunnerLauncher, iosProducts, type RunnerTransport } from './runner.js';
import { findPhoneSigning, phoneXctestrun, signedRunner, type PhoneSigning } from './signing.js';
import { assertBundle, xcodeEnv } from './simctl.js';
import {
  parseActivityMonitor,
  parseHangs,
  parsePowerImpact,
  parseTimeProfile,
} from './trace-parse.js';
import { recordTrace, traceTable } from './trace.js';
import { connectPort, listDevices } from './usbmux.js';

const PHONE_UDID = /^[0-9A-F]{8}-[0-9A-F]{16}$|^[0-9a-f]{40}$/;
export const assertPhoneUdid = (u: string) => {
  if (!PHONE_UDID.test(u)) throw new DeviceError('INVALID_ARGUMENT', `not an iPhone UDID: ${u}`);
  return u;
};

type PhoneApp = {
  bundleIdentifier?: string;
  version?: string;
  bundleVersion?: string;
  url?: string;
  builtByDeveloper?: boolean;
};

/** Xcode's device tool for one phone; JSON results. */
export class Devicectl {
  constructor(readonly udid: string) {
    assertPhoneUdid(udid);
  }

  async json(args: string[], timeoutMs = 60_000): Promise<Record<string, unknown>> {
    try {
      const { stdout } = await run(
        'xcrun',
        ['devicectl', ...args, '--json-output', '-', '--quiet'],
        {
          timeout: timeoutMs,
          maxBuffer: 64 * 1024 * 1024,
          env: xcodeEnv(),
        },
      );
      return JSON.parse(stdout) as Record<string, unknown>;
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; message: string; killed?: boolean };
      if (err.killed)
        throw new DeviceError(
          'TIMEOUT',
          `devicectl ${args.slice(0, 3).join(' ')} took over ${timeoutMs} ms`,
        );
      const detail = (() => {
        try {
          const j = JSON.parse(err.stdout ?? '') as {
            error?: { userInfo?: { NSLocalizedDescription?: { string?: string } } };
          };
          return j.error?.userInfo?.NSLocalizedDescription?.string;
        } catch {
          return undefined;
        }
      })();
      throw new DeviceError(
        'INTERNAL',
        `devicectl ${args.slice(0, 3).join(' ')}: ${(detail ?? err.stderr ?? err.message).trim().slice(0, 300)}`,
      );
    }
  }

  /** The installed app with this bundle id (version, build, path), if any. */
  async app(bundle: string): Promise<PhoneApp | undefined> {
    // system apps (Settings, Safari) are listed only with --include-all-apps
    const j = await this.json([
      'device',
      'info',
      'apps',
      '--device',
      this.udid,
      '--include-all-apps',
      '--bundle-id',
      assertBundle(bundle),
    ]);
    const apps = ((j.result as { apps?: PhoneApp[] } | undefined)?.apps ?? []).filter(
      (a) => a.bundleIdentifier === bundle,
    );
    return apps[0];
  }

  async install(appPath: string) {
    await this.json(['device', 'install', 'app', '--device', this.udid, appPath], 600_000);
  }

  /**
   * Starts the app (`env` goes into its environment), or brings it forward as it is; with `url`, hands
   * the link to it (its state kept).
   */
  async launch(bundle: string, url?: string, env?: Record<string, string>) {
    return this.json([
      'device',
      'process',
      'launch',
      '--device',
      this.udid,
      ...(url ? ['--payload-url', url] : []),
      ...(env ? ['--environment-variables', JSON.stringify(env)] : []),
      assertBundle(bundle),
    ]);
  }

  /** The phone's simulated position (Xcode's location simulation; it stays until cleared). */
  async setLocation(lat: number, lon: number) {
    await this.json([
      'device',
      'simulate',
      'location',
      'coordinate',
      '--device',
      this.udid,
      '--latitude',
      String(lat),
      '--longitude',
      String(lon),
    ]);
  }

  async clearLocation() {
    await this.json(['device', 'simulate', 'location', 'clear', '--device', this.udid]);
  }

  /** Process ids of the running app. */
  async pids(bundle: string): Promise<number[]> {
    const app = await this.app(bundle);
    if (!app?.url) return [];
    const j = await this.json(['device', 'info', 'processes', '--device', this.udid]);
    const procs =
      (
        j.result as
          { runningProcesses?: { processIdentifier: number; executable?: string }[] } | undefined
      )?.runningProcesses ?? [];
    // the app's own process, not an extension inside its bundle (Settings has some)
    const base = app.url.endsWith('/') ? app.url : `${app.url}/`;
    return procs
      .filter(
        (x) => x.executable?.startsWith(base) && !x.executable.slice(base.length).includes('/'),
      )
      .map((x) => x.processIdentifier);
  }

  /** The newest process of the app (right after a relaunch the old one may still be listed). */
  async pid(bundle: string): Promise<number> {
    const pid = Math.max(0, ...(await this.pids(bundle)));
    if (!pid) throw new DeviceError('APP_NOT_RUNNING', `${bundle} is not running`);
    return pid;
  }

  /** Stops the app and waits until it is gone: a launch right after must not bring the dying one forward. */
  async terminate(bundle: string) {
    const pids = await this.pids(bundle);
    for (const pid of pids)
      await this.json([
        'device',
        'process',
        'terminate',
        '--device',
        this.udid,
        '--pid',
        String(pid),
      ]).catch(() => undefined);
    const end = Date.now() + 5_000;
    while (pids.length && Date.now() < end) {
      const left = await this.pids(bundle).catch(() => [] as number[]);
      if (!left.some((p) => pids.includes(p))) break;
    }
  }
}

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
  private readonly ctl: Devicectl;
  /** What Instruments and XCTest can read from a phone: what they cannot says why. */
  readonly measure: MeasureSource & { hangs: IosPhoneDevice['hangs'] } = {
    frameTrace: async (bundle, seconds, during) => {
      const v = await this.hitches(bundle, seconds, during);
      return { value: { kind: 'hitches', ...v }, raw: v.tracePath, at: new Date().toISOString() };
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
    cpuProfile: async (bundle, ms, during) => {
      const { trace, profile } = await this.profile(bundle, ms, during);
      return {
        value: { ...profile, durationMs: Math.round(ms / 1000) * 1000 },
        raw: trace,
        at: new Date().toISOString(),
      };
    },
    launch: async (bundle, opts) => {
      const samples: number[] = [];
      for (let i = 0; i < opts.repeats + 1; i++) {
        if (opts.mode === 'cold') await this.terminate(bundle);
        else await this.ctl.launch('com.apple.Preferences').catch(() => undefined);
        await pause(500);
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
        },
        raw: samples.join(' '),
        at: new Date().toISOString(),
      };
    },
    hangs: (bundle, seconds, during) => this.hangs(bundle, seconds, during),
    network: async () => {
      // measured with Xcode 27.1 on iOS 27.0.1. The HTTP Traffic instrument alone records, but on a simulator
      // it had no rows for an attached app's known fetch; this phone had no network to try it on
      throw new DeviceError(
        'UNSUPPORTED',
        "the trace tool's Network template crashes when it stops (EXC_BREAKPOINT in NetworkConnectionStatsModeling), no trace is written",
      );
    },
    energy: async (bundle, windowMs) => {
      const pid = await this.ctl.pid(assertBundle(bundle));
      // the instrument alone: the Power Profiler template crashes as the Network one does
      const trace = await recordTrace({
        template: 'Power Profiler',
        instrument: true,
        device: this.serial,
        seconds: Math.min(Math.max(Math.round(windowMs / 1000), 2), 30),
        dir: join(stateDir(), 'traces'),
      });
      const breakdown = parsePowerImpact(
        await traceTable(trace, 'ProcessSubsystemPowerImpact'),
        pid,
      );
      if (!breakdown)
        throw new DeviceError(
          'UNSUPPORTED',
          `the Power Profiler recorded no power for ${bundle}: its per-process table came empty, as it did for every recording of a phone on USB`,
          `the trace is at ${trace}`,
        );
      return {
        value: {
          note: "Instruments' estimate of the app's power impact by subsystem, not a meter: no mAh.",
          breakdown,
        },
        raw: trace,
        at: new Date().toISOString(),
      };
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
  private async profile(bundle: string, ms: number, during?: () => Promise<unknown>) {
    const pid = await this.ctl.pid(assertBundle(bundle));
    const trace = await recordTrace({
      template: 'Time Profiler',
      device: this.serial,
      seconds: Math.min(Math.max(Math.round(ms / 1000), 1), 30),
      dir: join(stateDir(), 'traces'),
      ...(during && { during }),
    });
    return { trace, pid, profile: parseTimeProfile(await traceTable(trace, 'time-profile'), pid) };
  }

  /** The main thread's hangs (over 250 ms) while `during` runs: part of the Time Profiler's recording. */
  async hangs(bundle: string, seconds = 5, during?: () => Promise<unknown>) {
    const { trace, pid } = await this.profile(bundle, seconds * 1000, during);
    return { ...parseHangs(await traceTable(trace, 'potential-hangs'), pid), tracePath: trace };
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
