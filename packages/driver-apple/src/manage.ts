import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type {
  AppEntry,
  AppManager,
  DeviceSettings,
  LaunchOptions,
  SettingName,
  Startable,
  VirtualDevices,
} from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { macProxy } from './network.js';
import type { Devicectl } from './phone.js';
import { assertBundle, type Simctl } from './simctl.js';

const run = promisify(execFile);
const SIMULATOR_ID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;

const assertAppBundle = (path: string) => {
  if (!path.endsWith('.app') || !existsSync(path))
    throw new DeviceError('INVALID_ARGUMENT', `not a local .app bundle: ${path}`);
};

export class SimulatorApps implements AppManager {
  constructor(
    private readonly simctl: Simctl,
    private readonly udid: string,
  ) {}

  async install(path: string) {
    assertAppBundle(path);
    await this.simctl.install(this.udid, path);
  }

  async uninstall(app: string) {
    await this.simctl.exec(['uninstall', this.udid, assertBundle(app)], 120_000);
  }

  /** No tool does this: the app's data container is emptied while it is stopped. */
  async clearData(app: string) {
    await this.simctl.terminate(this.udid, app);
    const data = (
      await this.simctl.exec(['get_app_container', this.udid, assertBundle(app), 'data'])
    ).trim();
    if (!data.includes(`/Devices/${this.udid}/`))
      throw new DeviceError('INTERNAL', `unexpected data container: ${data}`);
    // its preferences are also held in memory, and would come back at the next launch
    await this.simctl.exec(['spawn', this.udid, 'defaults', 'delete', app]).catch(() => undefined);
    for (const dir of ['Documents', 'Library', 'tmp']) {
      const base = join(data, dir);
      if (!existsSync(base)) continue;
      for (const f of readdirSync(base)) rmSync(join(base, f), { recursive: true, force: true });
    }
  }

  async listApps(all: boolean): Promise<AppEntry[]> {
    const plist = await this.simctl.exec(['listapps', this.udid]);
    const dir = mkdtempSync(join(tmpdir(), 'appdyno-apps-'));
    try {
      const file = join(dir, 'apps.plist');
      writeFileSync(file, plist);
      const { stdout } = await run('plutil', ['-convert', 'json', '-o', '-', file], {
        maxBuffer: 64 * 1024 * 1024,
      });
      const apps = JSON.parse(stdout) as Record<
        string,
        {
          ApplicationType?: string;
          CFBundleDisplayName?: string;
          CFBundleName?: string;
          CFBundleShortVersionString?: string;
        }
      >;
      return Object.entries(apps)
        .filter(([, a]) => all || a.ApplicationType === 'User')
        .map(([id, a]) => {
          const name = a.CFBundleDisplayName ?? a.CFBundleName;
          return {
            id,
            ...(name && { name }),
            ...(a.CFBundleShortVersionString && { version: a.CFBundleShortVersionString }),
          };
        })
        .sort((a, b) => a.id.localeCompare(b.id));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  async appState(app: string) {
    const installed = await this.simctl
      .exec(['get_app_container', this.udid, assertBundle(app)])
      .then(
        () => true,
        () => false,
      );
    if (!installed) return 'not_installed';
    const list = await this.simctl.exec(['spawn', this.udid, 'launchctl', 'list']);
    return list.includes(`UIKitApplication:${app}[`) ? 'running' : 'stopped';
  }

  async permission(app: string, grant: boolean, service: string) {
    await this.simctl.privacy(this.udid, grant ? 'grant' : 'revoke', service, app);
  }

  async launchWith(app: string, opts: LaunchOptions) {
    await this.simctl.exec(
      ['launch', '--terminate-running-process', this.udid, assertBundle(app), ...(opts.args ?? [])],
      60_000,
      Object.fromEntries(Object.entries(opts.env ?? {}).map(([k, v]) => [`SIMCTL_CHILD_${k}`, v])),
    );
  }
}

const on = (v: string, yes: string, no: string) => ({ on: yes, off: no })[v] ?? v;

export class SimulatorSettings implements DeviceSettings {
  constructor(
    private readonly simctl: Simctl,
    private readonly udid: string,
  ) {}

  private ui = async (...words: string[]) =>
    (await this.simctl.exec(['ui', this.udid, ...words])).trim();
  private spawn = (...words: string[]) => this.simctl.exec(['spawn', this.udid, ...words]);

  async get(name: SettingName): Promise<string> {
    switch (name) {
      case 'dark_mode':
        return this.ui('appearance');
      case 'text_size':
        return this.ui('content_size');
      case 'reduce_motion': {
        const v = await this.spawn(
          'defaults',
          'read',
          'com.apple.Accessibility',
          'ReduceMotionEnabled',
        ).catch(() => '0');
        return v.trim() === '1' ? 'on' : 'off';
      }
      case 'locale':
        return (await this.spawn('defaults', 'read', '-g', 'AppleLocale').catch(() => '')).trim();
      case 'animations':
        throw new DeviceError('UNSUPPORTED', 'iOS has no animations setting: use reduce_motion');
      case 'network':
        throw new DeviceError(
          'UNSUPPORTED',
          "a simulator uses the Mac's network: shape it with the Network Link Conditioner on the Mac",
        );
      case 'proxy':
        return macProxy();
    }
  }

  async set(name: SettingName, value: string) {
    switch (name) {
      case 'dark_mode':
        await this.ui('appearance', on(value, 'dark', 'light'));
        return;
      case 'text_size':
        await this.ui('content_size', value);
        return;
      case 'reduce_motion':
        await this.spawn(
          'defaults',
          'write',
          'com.apple.Accessibility',
          'ReduceMotionEnabled',
          '-bool',
          value === 'on' ? 'YES' : 'NO',
        );
        await this.spawn('notifyutil', '-p', 'com.apple.accessibility.reduce.motion.status');
        return;
      case 'locale':
        if (value) {
          await this.spawn('defaults', 'write', '-g', 'AppleLocale', value.replace('-', '_'));
          await this.spawn(
            'defaults',
            'write',
            '-g',
            'AppleLanguages',
            '-array',
            value.replace('_', '-'),
          );
        } else {
          await this.spawn('defaults', 'delete', '-g', 'AppleLocale').catch(() => undefined);
          await this.spawn('defaults', 'delete', '-g', 'AppleLanguages').catch(() => undefined);
        }
        return;
      case 'proxy':
        throw new DeviceError(
          'UNSUPPORTED',
          `a simulator follows the Mac's proxy, now ${await macProxy()}: set it on the Mac (in the proxy's own settings)`,
        );
      default:
        await this.get(name);
    }
  }

  async push(app: string | undefined, title: string, body: string) {
    if (!app)
      throw new DeviceError('INVALID_ARGUMENT', 'a simulator push goes to an app: give app');
    const dir = mkdtempSync(join(tmpdir(), 'appdyno-push-'));
    try {
      const file = join(dir, 'push.apns');
      writeFileSync(file, JSON.stringify({ aps: { alert: { title, body } } }));
      await this.simctl.exec(['push', this.udid, assertBundle(app), file]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  /** Enrols if needed and answers the next biometric request: Face ID and Touch ID, whichever it has. */
  async biometric(match: boolean) {
    await this.spawn('notifyutil', '-s', 'com.apple.BiometricKit.enrollmentChanged', '1');
    await this.spawn('notifyutil', '-p', 'com.apple.BiometricKit.enrollmentChanged');
    const result = match ? 'match' : 'nomatch';
    await this.spawn('notifyutil', '-p', `com.apple.BiometricKit_Sim.pearl.${result}`);
    await this.spawn('notifyutil', '-p', `com.apple.BiometricKit_Sim.fingerTouch.${result}`);
  }
}

const PHONE_CANNOT = {
  clear: "an iPhone's app data can only go with the app: uninstall and install it again",
  permission: 'no tool grants an iPhone app a permission: answer its prompt with the alert tool',
  push: 'a push to an iPhone needs Apple push credentials, which this tool does not hold',
  biometric: 'an iPhone takes biometrics only from a person',
} as const;

export class PhoneApps implements AppManager {
  constructor(private readonly ctl: Devicectl) {}

  async install(path: string) {
    assertAppBundle(path);
    await this.ctl.install(path);
  }

  async uninstall(app: string) {
    await this.ctl.json(
      ['device', 'uninstall', 'app', '--device', this.ctl.udid, assertBundle(app)],
      120_000,
    );
  }

  clearData(): Promise<void> {
    throw new DeviceError('UNSUPPORTED', PHONE_CANNOT.clear);
  }

  async listApps(all: boolean): Promise<AppEntry[]> {
    const j = await this.ctl.json([
      'device',
      'info',
      'apps',
      '--device',
      this.ctl.udid,
      ...(all ? ['--include-all-apps'] : []),
    ]);
    const apps =
      (j.result as { apps?: { bundleIdentifier: string; name?: string; version?: string }[] })
        ?.apps ?? [];
    return apps.map((a) => ({
      id: a.bundleIdentifier,
      ...(a.name && { name: a.name }),
      ...(a.version && { version: a.version }),
    }));
  }

  async appState(app: string) {
    if (!(await this.ctl.app(app))) return 'not_installed';
    return (await this.ctl.pids(app)).length > 0 ? 'running' : 'stopped';
  }

  permission(): Promise<void> {
    throw new DeviceError('UNSUPPORTED', PHONE_CANNOT.permission);
  }

  async launchWith(app: string, opts: LaunchOptions) {
    await this.ctl.json([
      'device',
      'process',
      'launch',
      '--device',
      this.ctl.udid,
      '--terminate-existing',
      ...(opts.env ? ['--environment-variables', JSON.stringify(opts.env)] : []),
      assertBundle(app),
      ...(opts.args ?? []),
    ]);
  }
}

/** A phone's appearance through `devicectl`; what it has no switch for says so. */
export class PhoneSettings implements DeviceSettings {
  constructor(private readonly ctl: Devicectl) {}

  private appearance(...words: string[]) {
    return this.ctl.json(['device', 'settings', 'appearance', '--device', this.ctl.udid, ...words]);
  }

  async get(name: SettingName): Promise<string> {
    const key = {
      dark_mode: 'mode',
      text_size: 'textSize',
      reduce_motion: 'reduceMotion',
    } as const;
    if (name !== 'dark_mode' && name !== 'text_size' && name !== 'reduce_motion')
      throw new DeviceError('UNSUPPORTED', `an iPhone has no ${name} switch this tool can reach`);
    const j = await this.ctl.json(['device', 'info', 'appearance', '--device', this.ctl.udid]);
    const v = (j.result as Record<string, unknown> | undefined)?.[key[name]];
    return typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v ?? '');
  }

  async set(name: SettingName, value: string) {
    if (name === 'dark_mode') await this.appearance('--mode', on(value, 'dark', 'light'));
    else if (name === 'text_size') await this.appearance('--text-size', value);
    else if (name === 'reduce_motion') await this.appearance('--reduce-motion', value);
    else
      throw new DeviceError('UNSUPPORTED', `an iPhone has no ${name} switch this tool can reach`);
  }

  push(): Promise<void> {
    throw new DeviceError('UNSUPPORTED', PHONE_CANNOT.push);
  }

  biometric(): Promise<void> {
    throw new DeviceError('UNSUPPORTED', PHONE_CANNOT.biometric);
  }
}

/** This Mac's simulators. */
export class Simulators implements VirtualDevices {
  constructor(private readonly simctl: Simctl) {}

  async startable(): Promise<Startable[]> {
    return (await this.simctl.list()).map((d) => ({
      id: d.udid,
      name: `${d.name} (${d.runtime.replace(/^.*SimRuntime\./, '')})`,
      state: d.state === 'Booted' ? 'running' : 'stopped',
      ...(d.state === 'Booted' && { serial: d.udid }),
    }));
  }

  async boot(id: string) {
    if (!SIMULATOR_ID.test(id))
      throw new DeviceError('INVALID_ARGUMENT', `not a simulator id: ${id}`);
    await this.simctl.boot(id);
    return id;
  }

  shutdown(id: string) {
    return this.simctl.shutdown(id);
  }
}
