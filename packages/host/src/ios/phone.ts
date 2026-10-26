import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DeviceError } from '@appdyno/protocol';
import { stateDir } from '../android/agent.js';
import { IosDevice, type IosDeviceOps } from './device.js';
import { IosRunnerLauncher, iosProducts, type RunnerTransport } from './runner.js';
import { phoneSigningFromEnv, phoneXctestrun, signedRunner, type PhoneSigning } from './signing.js';
import { assertBundle, xcodeEnv } from './simctl.js';
import { connectPort, listDevices } from './usbmux.js';

const run = promisify(execFile);

const PHONE_UDID = /^[0-9A-F]{8}-[0-9A-F]{16}$|^[0-9a-f]{40}$/;
export const assertPhoneUdid = (u: string) => {
  if (!PHONE_UDID.test(u)) throw new DeviceError('INVALID_ARGUMENT', `not an iPhone UDID: ${u}`);
  return u;
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
  async app(
    bundle: string,
  ): Promise<{ version?: string; bundleVersion?: string; url?: string } | undefined> {
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
    const apps = ((j.result as { apps?: Record<string, string>[] } | undefined)?.apps ?? []).filter(
      (a) => a.bundleIdentifier === bundle,
    );
    return apps[0];
  }

  async install(appPath: string) {
    await this.json(['device', 'install', 'app', '--device', this.udid, appPath], 600_000);
  }

  async launch(bundle: string, url?: string) {
    return this.json([
      'device',
      'process',
      'launch',
      '--device',
      this.udid,
      '--terminate-existing',
      ...(url ? ['--payload-url', url] : []),
      assertBundle(bundle),
    ]);
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
    return procs.filter((x) => x.executable?.startsWith(app.url!)).map((x) => x.processIdentifier);
  }

  /** The newest process of the app (right after a relaunch the old one may still be listed). */
  async pid(bundle: string): Promise<number> {
    const pid = Math.max(0, ...(await this.pids(bundle)));
    if (!pid) throw new DeviceError('APP_NOT_RUNNING', `${bundle} is not running`);
    return pid;
  }

  async terminate(bundle: string) {
    for (const pid of await this.pids(bundle))
      await this.json([
        'device',
        'process',
        'terminate',
        '--device',
        this.udid,
        '--pid',
        String(pid),
      ]).catch(() => undefined);
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
  signing: PhoneSigning,
): RunnerTransport & { signed(): ReturnType<typeof signedRunner> } {
  const cache = join(homedir(), 'Library/Caches/appdyno/ios-phone');
  // the signed runner is looked up once per runner build and profile in this process (a reconnect
  // does not ask the keychain again)
  const signed = async () => {
    const app = await phoneRunnerApp();
    const key = [join(app, 'PlugIns/Runner.xctest/Runner'), signing.profile]
      .map((f) => `${f}@${statSync(f).mtimeMs}`)
      .join(':');
    let result = signedRunners.get(key);
    if (!result) {
      result = signedRunner(app, signing, cache);
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
          'give the app',
        );
      await ctl.launch(b, url);
    },
    setLocation: async () => {
      throw new DeviceError('UNSUPPORTED', 'no test location on an iPhone yet');
    },
    linkPrompt: false,
    name: `iPhone ${udid}`,
    pid: (b) => ctl.pid(b),
  };
}

/**
 * A real iPhone over USB: the runner signed for the development profile and installed when the phone
 * has another build under that id (another tool's runner, an older one); apps and links via devicectl.
 */
export class IosPhoneDevice extends IosDevice {
  private readonly transport: ReturnType<typeof phoneTransport>;
  private readonly ctl: Devicectl;

  constructor(serial: string, signing: PhoneSigning = phoneSigningFromEnv()) {
    const transport = phoneTransport(serial, signing);
    const ctl = new Devicectl(serial);
    super(serial, phoneOps(serial, ctl), new IosRunnerLauncher(serial, transport));
    this.transport = transport;
    this.ctl = ctl;
  }

  /** Our runner on the phone: installed when the phone has another build under the profile's id. */
  override async prepareStart() {
    await super.prepareStart();
    const r = await this.transport.signed();
    const onPhone = await this.ctl.app(r.appId);
    if (onPhone?.bundleVersion !== r.stamp) await this.ctl.install(r.app);
  }
}
