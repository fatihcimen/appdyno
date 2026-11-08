import { DeviceError } from '@appdyno/protocol';
import { run } from '@appdyno/core';
import { launchLanguage } from './manage.js';
import { xcodeEnv, xcodeTool, assertBundle } from './simctl.js';

/** An app's own arguments: what starts with a dash is the app's, not this tool's. */
const andArgs = (args: string[]) => (args.length > 0 ? ['--', ...args] : []);

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

/**
 * What the Mac knows of a paired phone, with no word to the phone: devicectl's `properties`, which its JSON version 5
 * (Xcode 27) brings, and the keys that version deprecates for it, which are all Xcode 26 gives.
 */
export type ListedPhone = {
  properties?: {
    hardware?: { udid?: string; marketingName?: string };
    connection?: { pairingState?: string };
    // a case with its values: `{ "enabled": { "mode": 1 } }`
    state?: { developerModeStatus?: Record<string, unknown> };
    software?: { osVersionNumber?: { stringValue?: string } };
  };
  hardwareProperties?: { udid?: string; marketingName?: string };
  connectionProperties?: { pairingState?: string };
  deviceProperties?: { developerModeStatus?: string; osVersionNumber?: string };
};

/** A phone's facts from devicectl's JSON, by `properties` where it has them. */
export function phoneFacts(d: ListedPhone) {
  const p = d.properties;
  const mode = p?.state?.developerModeStatus;
  return {
    udid: p?.hardware?.udid ?? d.hardwareProperties?.udid,
    marketingName: p?.hardware?.marketingName ?? d.hardwareProperties?.marketingName,
    pairingState: p?.connection?.pairingState ?? d.connectionProperties?.pairingState,
    developerModeStatus: (mode && Object.keys(mode)[0]) ?? d.deviceProperties?.developerModeStatus,
    osVersion: p?.software?.osVersionNumber?.stringValue ?? d.deviceProperties?.osVersionNumber,
  };
}

/** Xcode's device tool for one phone; JSON results. */
export class Devicectl {
  constructor(readonly udid: string) {
    assertPhoneUdid(udid);
  }

  async json(args: string[], timeoutMs = 60_000): Promise<Record<string, unknown>> {
    try {
      const env = xcodeEnv();
      const { stdout } = await run(
        ...xcodeTool('devicectl', ['--json-output', '-', '--quiet', ...args], env),
        { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, env },
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
      ...andArgs(launchLanguage(this.udid, bundle)),
    ]);
  }

  /** The phone's name as people know it. */
  async marketingName() {
    const r = await this.json(['device', 'info', 'details', '--device', this.udid]);
    return phoneFacts(r.result ?? r).marketingName;
  }

  /** This phone as the Mac lists it. */
  async listed(): Promise<ListedPhone | undefined> {
    const j = await this.json(['list', 'devices']);
    const all = (j.result as { devices?: ListedPhone[] } | undefined)?.devices ?? [];
    return all.find((d) => phoneFacts(d).udid === this.udid);
  }

  /** The text on the phone's pasteboard, '' with none. */
  async readPasteboard() {
    const { stdout } = await this.pasteboard('paste');
    // with no text there, the tool says so on the same stream
    return stdout.startsWith('No text content') ? '' : stdout;
  }

  async writePasteboard(text: string) {
    const copying = this.pasteboard('copy');
    copying.child.stdin?.end(text);
    await copying;
  }

  private pasteboard(action: 'copy' | 'paste') {
    const env = xcodeEnv();
    return run(
      ...xcodeTool('devicectl', ['device', 'pasteboard', action, '--device', this.udid], env),
      { env },
    );
  }

  /** Whether the phone wants its passcode now. */
  async lockState() {
    const r = await this.json(['device', 'info', 'lockState', '--device', this.udid]);
    const result = (r.result ?? r) as { passcodeRequired?: boolean };
    return { passcodeRequired: result.passcodeRequired === true };
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
