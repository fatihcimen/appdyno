import { cpSync, existsSync, readdirSync, rmSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type AppManager,
  type BuildRequest,
  type AppEntry,
  run,
  type LaunchOptions,
  type BiometricAnswer,
  type DeviceEvents,
  type DeviceSettings,
  type SettingName,
  type VirtualDevices,
  type Startable,
} from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { buildScheme } from './build.js';
import { macProxy } from './network.js';
import { type Simctl, assertBundle } from './simctl.js';
import { assertAppBundle, DATA_FOLDERS, on } from './manage.js';

const SIMULATOR_ID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;

const copyFolders = (from: string, to: string) => {
  for (const dir of DATA_FOLDERS) {
    if (existsSync(join(from, dir)))
      cpSync(join(from, dir), join(to, dir), { recursive: true, verbatimSymlinks: true });
  }
};

export class SimulatorApps implements AppManager {
  constructor(
    private readonly simctl: Simctl,
    private readonly udid: string,
  ) {}

  async install(path: string) {
    assertAppBundle(path);
    await this.simctl.install(this.udid, path);
    return [];
  }

  async buildAndInstall(request: BuildRequest) {
    const built = await buildScheme(request, `platform=iOS Simulator,id=${this.udid}`);
    await this.install(built.path);
    return built.bundle;
  }

  async uninstall(app: string) {
    await this.simctl.exec(['uninstall', this.udid, assertBundle(app)], 120_000);
  }

  private async container(app: string) {
    const data = (
      await this.simctl.exec(['get_app_container', this.udid, assertBundle(app), 'data'])
    ).trim();
    if (!data.includes(`/Devices/${this.udid}/`))
      throw new DeviceError('INTERNAL', `unexpected data container: ${data}`);
    return data;
  }

  /** No tool does this: the app's data container is emptied while it is stopped. */
  async clearData(app: string) {
    await this.simctl.terminate(this.udid, app);
    const data = await this.container(app);
    // its preferences are also held in memory, and would come back at the next launch
    await this.simctl.exec(['spawn', this.udid, 'defaults', 'delete', app]).catch(() => undefined);
    for (const dir of DATA_FOLDERS) {
      const base = join(data, dir);
      if (!existsSync(base)) continue;
      for (const f of readdirSync(base)) rmSync(join(base, f), { recursive: true, force: true });
    }
  }

  async downloadData(app: string, to: string) {
    copyFolders(await this.container(app), to);
  }

  async replaceData(app: string, from: string) {
    await this.clearData(app);
    copyFolders(from, await this.container(app));
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

const SIM_CANNOT = {
  fold: 'simctl has no fold pose (its ui and io options name none)',
  call: 'a simulator has no telephony: it cannot take a call',
  sms: 'a simulator has no telephony: it cannot take an SMS',
  radio: "a simulator has no radios: it uses the Mac's network",
} as const;

/** The rows of the keychain's tables that are not the system's own. */
const APP_ITEMS = `select count(*) from (${['genp', 'inet', 'cert', 'keys']
  .map((t) => `select agrp from ${t}`)
  .join(' union all ')}) where agrp != 'apple' and agrp not like 'com.apple.%'`;

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
      case 'battery':
        throw new DeviceError(
          'UNSUPPORTED',
          'a simulator has no battery to set: simctl status_bar only draws one',
        );
      case 'airplane':
      case 'wifi':
      case 'mobile_data':
        throw new DeviceError('UNSUPPORTED', SIM_CANNOT.radio);
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
}

/** A simulator's one-time events; what it has no way to take says so. */
export class SimulatorEvents implements DeviceEvents {
  constructor(
    private readonly simctl: Simctl,
    private readonly udid: string,
  ) {}

  private spawn = (...words: string[]) => this.simctl.exec(['spawn', this.udid, ...words]);

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
  async biometric(answer: BiometricAnswer) {
    await this.spawn('notifyutil', '-s', 'com.apple.BiometricKit.enrollmentChanged', '1');
    await this.spawn('notifyutil', '-p', 'com.apple.BiometricKit.enrollmentChanged');
    if (answer === 'enroll') return;
    await this.spawn('notifyutil', '-p', `com.apple.BiometricKit_Sim.pearl.${answer}`);
    await this.spawn('notifyutil', '-p', `com.apple.BiometricKit_Sim.fingerTouch.${answer}`);
  }

  /** What apps hold in the simulator's store: a reset leaves the system's own rows, and says nothing itself. */
  private async keychainItems() {
    const home = (await this.simctl.exec(['getenv', this.udid, 'HOME'])).trim();
    const db = join(home, 'Library/Keychains/keychain-2-debug.db');
    const { stdout } = await run('sqlite3', ['-readonly', db, APP_ITEMS]);
    return Number(stdout.trim());
  }

  async resetKeychain() {
    const held = await this.keychainItems();
    await this.simctl.exec(['keychain', this.udid, 'reset']);
    const left = await this.keychainItems();
    if (left > 0)
      throw new DeviceError('INTERNAL', `apps still hold ${left} keychain items after a reset`);
    return held;
  }

  async fold(): Promise<void> {
    throw new DeviceError('UNSUPPORTED', SIM_CANNOT.fold);
  }

  async call(): Promise<void> {
    throw new DeviceError('UNSUPPORTED', SIM_CANNOT.call);
  }

  async sms(): Promise<void> {
    throw new DeviceError('UNSUPPORTED', SIM_CANNOT.sms);
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
