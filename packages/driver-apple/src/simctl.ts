import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sleep, run, callSignal, cancelled, must } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { launchLanguage } from './manage.js';

/** An app with no process, where one was to be read. */
export const notRunning = (bundle: string) =>
  new DeviceError('APP_NOT_RUNNING', `${bundle} is not running`, 'launch it, then ask again');

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

const toolPaths = new Map<string, string | undefined>();

/**
 * A command of Xcode's developer folder as a file and its arguments: its own path there, looked for once, as xcrun's
 * lookup costs 4-5 ms a call; xcrun where `env` names no such folder, or one without it, as before.
 */
export function xcodeTool(
  tool: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): [string, string[]] {
  const dir = env.DEVELOPER_DIR;
  const key = dir && `${dir}/usr/bin/${tool}`;
  if (key && !toolPaths.has(key)) toolPaths.set(key, existsSync(key) ? key : undefined);
  const path = key && toolPaths.get(key);
  return path ? [path, args] : ['xcrun', [tool, ...args]];
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

/**
 * The app's own process in the Mac's list (`ps -o pid=,stat=,command=`), by the folder its app is installed in on this
 * Mac: the executable right in that folder, not an extension's further in. One that is ending (`E`, `Z`) is left out,
 * and of two the newer is the one that runs now, as one just stopped is listed beside the one started after it.
 */
export function pidOfApp(processes: string, app: string): number | undefined {
  let found: number | undefined;
  for (const line of processes.split('\n')) {
    const [, pid, stat, command] = /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(line) ?? [];
    const executable =
      command?.startsWith(`${app}/`) && command.slice(app.length + 1).split(' ')[0];
    if (pid && executable && !executable.includes('/') && !/[EZ]/.test(stat ?? ''))
      found = Math.max(found ?? 0, Number(pid));
  }
  return found;
}

type Runtime = {
  identifier: string;
  version: string;
  platform?: string;
  isAvailable?: boolean;
  supportedDeviceTypes?: { name: string }[];
};

/** Of the runtimes that take this model, the newest iOS: not each runs every model of its time. */
export const newestRuntimeOf = (runtimes: Runtime[], model: string) =>
  runtimes
    .filter(
      (r) =>
        r.isAvailable !== false &&
        r.platform !== 'watchOS' &&
        r.supportedDeviceTypes?.some((t) => t.name === model),
    )
    .toSorted((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }))
    .at(-1);

/** The simulator tool, always for one named simulator (never "booted": other simulators may run). */
export class Simctl {
  constructor(private readonly env: NodeJS.ProcessEnv = xcodeEnv()) {}

  /**
   * The process id of a running app. A simulator's apps are this Mac's processes, and the Mac's list is a fraction of
   * launchctl's in the simulator, which spawns into it: 90 against 340 ms at load 22. That list tells an app installed
   * on this simulator by its folder in the simulator's own; a system app runs from the runtime's, as it does on every
   * simulator of that runtime, so it is asked of the simulator.
   */
  async pid(udid: string, bundle: string): Promise<number> {
    assertBundle(bundle);
    const app = bundle === HOME_SCREEN ? undefined : await this.appContainer(udid, bundle);
    if (app?.includes(`/Devices/${udid}/`)) {
      const pid = pidOfApp(await this.processes(), app);
      if (!pid) throw notRunning(bundle);
      return pid;
    }
    const out = await this.exec(['spawn', udid, 'launchctl', 'list']);
    // the home screen is a system service: it has a label of its own, with capitals its bundle id has not
    const listed = (l: string) =>
      bundle === HOME_SCREEN
        ? l.endsWith('\tcom.apple.SpringBoard')
        : l.includes(`UIKitApplication:${bundle}[`);
    // a job that is not running is listed with - for its pid
    const pid = out
      .split('\n')
      .filter(listed)
      .map((l) => Number(l.trim().split(/\s+/)[0]))
      .find((n) => Number.isInteger(n) && n > 0);
    if (!pid) throw notRunning(bundle);
    return pid;
  }

  /** Whether the app runs now, by `pid`'s rules; what cannot be told is thrown. */
  running(udid: string, bundle: string): Promise<boolean> {
    return this.pid(udid, bundle).then(
      () => true,
      (e: unknown) => {
        if (e instanceof DeviceError && e.code === 'APP_NOT_RUNNING') return false;
        throw e;
      },
    );
  }

  /** This Mac's processes, each with its state and its whole command line. */
  async processes(): Promise<string> {
    const { stdout } = await run('/bin/ps', ['-axww', '-o', 'pid=,stat=,command='], {
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  }

  /** What people call each kind of device: an id says less, and these do not change as a Mac runs. */
  typeNames() {
    this.names ??= this.exec(['list', 'devicetypes', '-j']).then((out) => {
      const { devicetypes } = JSON.parse(out) as {
        devicetypes: { name: string; identifier: string }[];
      };
      return new Map(devicetypes.map((t) => [t.identifier, t.name]));
    });
    return this.names;
  }

  private names: Promise<Map<string, string>> | undefined;

  async exec(args: string[], timeoutMs = 60_000, env?: NodeJS.ProcessEnv): Promise<string> {
    const command = must(args[0], 'a simctl command');
    try {
      const all = { ...this.env, ...env };
      const signal = callSignal();
      const { stdout } = await run(...xcodeTool('simctl', args, all), {
        timeout: timeoutMs,
        maxBuffer: 64 * 1024 * 1024,
        env: all,
        ...(signal && { signal }),
      });
      return stdout;
    } catch (e) {
      const err = e as { stderr?: string; message: string; killed?: boolean; name?: string };
      if (err.name === 'AbortError') throw cancelled(`simctl ${command}`);
      if (err.killed)
        throw new DeviceError('TIMEOUT', `simctl ${command} took over ${timeoutMs} ms`);
      const msg = (err.stderr || err.message).trim().split('\n').slice(-2).join(' ').slice(0, 300);
      throw new DeviceError(
        /Invalid device|not found/i.test(msg) ? 'NOT_FOUND' : 'INTERNAL',
        `simctl ${command}: ${msg}`,
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

  /** The newest runtime that takes this model; a refusal names the models there are. */
  async runtimeFor(model: string) {
    const { runtimes } = JSON.parse(await this.exec(['list', '-j', 'runtimes'])) as {
      runtimes: Runtime[];
    };
    const runtime = newestRuntimeOf(runtimes, model);
    if (!runtime) {
      const names = new Set(runtimes.flatMap((r) => r.supportedDeviceTypes?.map((t) => t.name)));
      throw new DeviceError(
        'NOT_FOUND',
        `no runtime on this Mac runs a ${model}`,
        `models here: ${[...names].filter(Boolean).slice(0, 30).join(', ')}`,
      );
    }
    return runtime.identifier;
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
        throw new DeviceError(
          'TIMEOUT',
          `simulator ${udid} did not shut down (state ${String(state)})`,
        );
      await sleep(2_000);
    }
  }

  install(udid: string, appPath: string) {
    return this.exec(['install', assertUdid(udid), appPath], 300_000);
  }
  /** Puts `text` on the simulator's clipboard, from the Mac. */
  pbcopy(udid: string, text: string) {
    return new Promise<void>((resolve, reject) => {
      const p = spawn(...xcodeTool('simctl', ['pbcopy', assertUdid(udid)], this.env), {
        env: this.env,
        stdio: ['pipe', 'ignore', 'ignore'],
      });
      p.on('error', reject);
      p.on('close', (code) =>
        code === 0
          ? resolve()
          : reject(new DeviceError('INTERNAL', `simctl pbcopy exited with ${String(code)}`)),
      );
      p.stdin.end(text);
    });
  }

  /**
   * Starts the app (`vars` go into its environment), or brings it forward as it is when it runs. `stopped`: it waits
   * before its first instruction, as for a debugger.
   */
  launch(udid: string, bundle: string, vars: Record<string, string> = {}, stopped = false) {
    const child = Object.entries(vars).map(([k, v]): [string, string] => [`SIMCTL_CHILD_${k}`, v]);
    const wait = stopped ? ['--wait-for-debugger'] : [];
    const args = [assertUdid(udid), assertBundle(bundle), ...launchLanguage(udid, bundle)];
    return this.exec(['launch', ...wait, ...args], 60_000, {
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
  /** An app's folder on this Mac, kept while it stands: a reinstall puts the app in a new one and removes the old. */
  async appContainer(udid: string, bundle: string): Promise<string> {
    const key = `${udid} ${bundle}`;
    const known = this.containers.get(key);
    if (known && existsSync(known)) return known;
    const found = (
      await this.exec(['get_app_container', assertUdid(udid), assertBundle(bundle)])
    ).trim();
    this.containers.set(key, found);
    return found;
  }
  private readonly containers = new Map<string, string>();
}
