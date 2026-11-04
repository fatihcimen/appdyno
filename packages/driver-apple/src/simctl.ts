import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sleep, run, callSignal, cancelled } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';

/**
 * The developer folder for Xcode's tools without DEVELOPER_DIR: the selected one when it is a full
 * Xcode (it may be the command line tools, which have no simulator tool), else the newest installed.
 */
export function chooseDeveloperDir(
  selected: string | undefined,
  installed: { dir: string; version: string }[],
): string | undefined {
  if (selected && /\.app\/Contents\/Developer\/?$/.test(selected)) return selected;
  return installed
    .toSorted((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }))
    .at(-1)?.dir;
}

function selectedDeveloperDir(): string | undefined {
  try {
    return execFileSync('xcode-select', ['-p'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

/** Xcode*.app in /Applications that are Xcodes (Xcodes.app, a version manager, has no developer folder). */
function installedXcodes(): { dir: string; version: string }[] {
  const apps = '/Applications';
  if (!existsSync(apps)) return [];
  return readdirSync(apps)
    .filter((f) => /^Xcode.*\.app$/.test(f) && existsSync(join(apps, f, 'Contents/Developer')))
    .map((f) => {
      const plist = join(apps, f, 'Contents/version.plist');
      const version = existsSync(plist)
        ? /CFBundleShortVersionString<\/key>\s*<string>([^<]*)/.exec(readFileSync(plist, 'utf8'))
        : null;
      return { dir: join(apps, f, 'Contents/Developer'), version: version?.[1] ?? '' };
    });
}

let developerDir: { dir: string | undefined } | undefined;

/** The environment for Xcode's tools; without any Xcode it is unchanged, and doctor says so. */
export function xcodeEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (env.DEVELOPER_DIR) return env;
  developerDir ??= { dir: chooseDeveloperDir(selectedDeveloperDir(), installedXcodes()) };
  return developerDir.dir ? { ...env, DEVELOPER_DIR: developerDir.dir } : env;
}

const UDID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;
export const assertUdid = (u: string) => {
  if (!UDID.test(u)) throw new DeviceError('INVALID_ARGUMENT', `not a simulator id: ${u}`);
  return u;
};

const BUNDLE = /^[A-Za-z0-9][A-Za-z0-9-]*(\.[A-Za-z0-9-]+)+$/;
export const assertBundle = (b: string) => {
  if (!BUNDLE.test(b)) throw new DeviceError('INVALID_ARGUMENT', `not a bundle id: ${b}`);
  return b;
};

export type Simulator = {
  udid: string;
  name: string;
  state: string;
  runtime: string;
  deviceType?: string;
};

const HOME_SCREEN = 'com.apple.springboard';

/** The simulator tool, always for one named simulator (never "booted": other simulators may run). */
export class Simctl {
  constructor(private readonly env: NodeJS.ProcessEnv = xcodeEnv()) {}

  /** The process id of a running app. */
  async pid(udid: string, bundle: string): Promise<number> {
    assertBundle(bundle);
    const out = await this.exec(['spawn', udid, 'launchctl', 'list']);
    // the home screen is a system service: it has a label of its own, with capitals its bundle id has not
    const listed = (l: string) =>
      bundle === HOME_SCREEN
        ? l.endsWith('\tcom.apple.SpringBoard')
        : l.includes(`UIKitApplication:${bundle}[`);
    // a process just ended stays listed for a while, with no pid, beside the one that runs now
    const pid = out
      .split('\n')
      .filter(listed)
      .map((l) => Number(l.trim().split(/\s+/)[0]))
      .find((n) => Number.isInteger(n) && n > 0);
    if (!pid) throw new DeviceError('APP_NOT_RUNNING', `${bundle} is not running`);
    return pid;
  }

  async exec(args: string[], timeoutMs = 60_000, env?: NodeJS.ProcessEnv): Promise<string> {
    try {
      const { stdout } = await run('xcrun', ['simctl', ...args], {
        timeout: timeoutMs,
        maxBuffer: 64 * 1024 * 1024,
        env: { ...this.env, ...env },
        ...(callSignal() && { signal: callSignal()! }),
      });
      return stdout;
    } catch (e) {
      const err = e as { stderr?: string; message: string; killed?: boolean; name?: string };
      if (err.name === 'AbortError') throw cancelled(`simctl ${args[0]}`);
      if (err.killed)
        throw new DeviceError('TIMEOUT', `simctl ${args[0]} took over ${timeoutMs} ms`);
      const msg = (err.stderr || err.message).trim().split('\n').slice(-2).join(' ').slice(0, 300);
      throw new DeviceError(
        /Invalid device|not found/i.test(msg) ? 'NOT_FOUND' : 'INTERNAL',
        `simctl ${args[0]}: ${msg}`,
      );
    }
  }

  async list(): Promise<Simulator[]> {
    const j = JSON.parse(await this.exec(['list', '-j', 'devices'])) as {
      devices: Record<
        string,
        {
          udid: string;
          name: string;
          state: string;
          deviceTypeIdentifier?: string;
          isAvailable?: boolean;
        }[]
      >;
    };
    return Object.entries(j.devices).flatMap(([runtime, ds]) =>
      ds
        .filter((d) => d.isAvailable !== false)
        .map((d) => ({
          udid: d.udid,
          name: d.name,
          state: d.state,
          runtime,
          ...(d.deviceTypeIdentifier && { deviceType: d.deviceTypeIdentifier }),
        })),
    );
  }

  async state(udid: string): Promise<string | undefined> {
    return (await this.list()).find((d) => d.udid === assertUdid(udid))?.state;
  }

  /** Boots and waits until the simulator has finished booting. */
  async boot(udid: string) {
    if ((await this.state(udid)) !== 'Booted')
      // a runner still alive on it may boot it first
      await this.exec(['boot', assertUdid(udid)], 120_000).catch((e: unknown) => {
        if (!(e instanceof DeviceError && /current state: Booted/i.test(e.message))) throw e;
      });
    await this.exec(['bootstatus', udid, '-b'], 300_000);
  }

  /** Shuts down and waits until the state says so (a loaded Mac can leave a first request unfinished). */
  async shutdown(udid: string) {
    const end = Date.now() + 180_000;
    for (;;) {
      const state = await this.state(udid);
      if (state === 'Shutdown') return;
      await this.exec(['shutdown', assertUdid(udid)], 120_000).catch((e: unknown) => {
        if (!(e instanceof DeviceError && /current state: Shutdown/i.test(e.message))) throw e;
      });
      if (Date.now() > end)
        throw new DeviceError('TIMEOUT', `simulator ${udid} did not shut down (state ${state})`);
      await sleep(2_000);
    }
  }

  install(udid: string, appPath: string) {
    return this.exec(['install', assertUdid(udid), appPath], 300_000);
  }
  /** Puts `text` on the simulator's clipboard, from the Mac. */
  pbcopy(udid: string, text: string) {
    return new Promise<void>((resolve, reject) => {
      const p = spawn('xcrun', ['simctl', 'pbcopy', assertUdid(udid)], {
        env: this.env,
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

  /**
   * Starts the app (`vars` go into its environment), or brings it forward as it is when it runs. `stopped`: it waits
   * before its first instruction, as for a debugger.
   */
  launch(udid: string, bundle: string, vars: Record<string, string> = {}, stopped = false) {
    const child = Object.entries(vars).map(([k, v]) => [`SIMCTL_CHILD_${k}`, v]);
    const wait = stopped ? ['--wait-for-debugger'] : [];
    return this.exec(['launch', ...wait, assertUdid(udid), assertBundle(bundle)], 60_000, {
      ...this.env,
      ...Object.fromEntries(child),
    });
  }
  async terminate(udid: string, bundle: string) {
    await this.exec(['terminate', assertUdid(udid), assertBundle(bundle)], 60_000).catch(
      (e: unknown) => {
        // not running is not an error
        if (!(
          e instanceof DeviceError && /found nothing to terminate|not running/i.test(e.message)
        ))
          throw e;
      },
    );
  }
  openUrl(udid: string, url: string) {
    return this.exec(['openurl', assertUdid(udid), url], 60_000);
  }
  setLocation(udid: string, lat: number, lon: number) {
    return this.exec(['location', assertUdid(udid), 'set', `${lat},${lon}`]);
  }
  /** grant, revoke or reset a privacy service (location, photos, …) for an app. */
  privacy(udid: string, action: 'grant' | 'revoke' | 'reset', service: string, bundle: string) {
    return this.exec(['privacy', assertUdid(udid), action, service, assertBundle(bundle)]);
  }
  async appContainer(udid: string, bundle: string): Promise<string> {
    return (await this.exec(['get_app_container', assertUdid(udid), assertBundle(bundle)])).trim();
  }
}
