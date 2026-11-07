import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PUSH_TYPES } from '@appdyno/core';
import type {
  AppManager,
  PushRoute,
  BuildRequest,
  AppEntry,
  BiometricAnswer,
  LaunchOptions,
  DeviceEvents,
  DeviceSettings,
  SettingName,
} from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { buildScheme } from './build.js';
import type { Devicectl } from './devicectl.js';
import { assertBundle } from './simctl.js';
import {
  DATA_FOLDERS,
  appLanguage,
  holdAppLanguage,
  installingApp,
  launchLanguage,
  on,
} from './manage.js';

const PHONE_CANNOT = {
  clear: "an iPhone's app data can only go with the app: uninstall and install it again",
  permission: 'no tool grants an iPhone app a permission: its prompt has to be answered',
  push: "a real iPhone takes a push only from Apple's servers: open the app's deep link instead, or push to a simulator",
  // seen on one iPhone with no face enrolled: `devicectl device simulate biometrics` says so and exits 0, so it proves nothing
  biometric:
    'an iPhone takes biometrics only from a person: devicectl reads it as supporting no simulation',
  keychain: "an iPhone's keychain is emptied only by erasing it",
  fold: 'an iPhone folds only in a hand',
  call: 'an iPhone takes calls only from the network',
  sms: 'an iPhone takes messages only from the network',
} as const;

const DATA_MS = 600_000;

export class PhoneApps implements AppManager {
  readonly languageStays = true;

  constructor(private readonly ctl: Devicectl) {}

  async install(path: string) {
    await installingApp(path, 'iPhoneOS', (app) => this.ctl.install(app));
    return [];
  }

  async buildAndInstall(request: BuildRequest) {
    const built = await buildScheme(request, `id=${this.ctl.udid}`);
    await this.install(built.path);
    return built.bundle;
  }

  async uninstall(app: string) {
    await this.ctl.json(
      ['device', 'uninstall', 'app', '--device', this.ctl.udid, assertBundle(app)],
      120_000,
    );
  }

  async clearData(): Promise<void> {
    throw new DeviceError('UNSUPPORTED', PHONE_CANNOT.clear);
  }

  private copy(way: 'from' | 'to', app: string, paths: string[]) {
    return this.ctl.json(
      [
        'device',
        'copy',
        way,
        '--device',
        this.ctl.udid,
        '--domain-type',
        'appDataContainer',
        '--domain-identifier',
        assertBundle(app),
        ...paths,
      ],
      DATA_MS,
    );
  }

  async downloadData(app: string, to: string) {
    for (const dir of DATA_FOLDERS) {
      // the tool fails on an empty folder unless the place for it is there
      mkdirSync(join(to, dir));
      await this.copy('from', app, ['--source', dir, '--destination', join(to, dir)]);
    }
  }

  /** One copy of the whole folder: the tool's removal takes the whole container, so a copy per folder keeps only the last. */
  async replaceData(app: string, from: string) {
    await this.ctl.terminate(app);
    await this.copy('to', app, [
      '--source',
      from,
      '--destination',
      '.',
      '--remove-existing-content',
      'true',
    ]);
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

  async permission(): Promise<void> {
    throw new DeviceError('UNSUPPORTED', PHONE_CANNOT.permission);
  }

  async links(): Promise<string[]> {
    throw new DeviceError(
      'UNSUPPORTED',
      "an iPhone's installed app is not read from here: list the links of its build on a simulator",
    );
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
      // what starts with a dash is the app's, not this tool's
      '--',
      ...launchLanguage(this.ctl.udid, app, opts.language),
      ...(opts.args ?? []),
    ]);
  }
}

/** What `devicectl` has a word for. */
const APPEARANCE: ReadonlySet<SettingName> = new Set<SettingName>([
  'dark_mode',
  'text_size',
  'reduce_motion',
  'increase_contrast',
  'reduce_transparency',
]);

/** `devicectl` shows "Extra Large" where it is told extra-large. */
export const phoneTextSize = (shown: string) => shown.trim().toLowerCase().replace(/\s+/g, '-');

const noSwitch = (name: SettingName) =>
  new DeviceError(
    'UNSUPPORTED',
    name === 'fold' ? PHONE_CANNOT.fold : `an iPhone has no ${name} switch this tool can reach`,
  );

/** A phone's appearance through `devicectl`; what it has no switch for says so. */
export class PhoneSettings implements DeviceSettings {
  constructor(private readonly ctl: Devicectl) {}

  /** An iPhone's own language is the phone's: an app's is held for the launches this tool makes. */
  private appOf(app: string | undefined) {
    if (!app)
      throw new DeviceError(
        'UNSUPPORTED',
        "an iPhone's language is set on the phone: give app, held for its launches by this tool",
      );
    return assertBundle(app);
  }

  private appearance(...words: string[]) {
    return this.ctl.json(['device', 'settings', 'appearance', '--device', this.ctl.udid, ...words]);
  }

  async get(name: SettingName, app?: string): Promise<string> {
    if (name === 'locale') return appLanguage(this.ctl.udid, this.appOf(app));
    if (!APPEARANCE.has(name)) throw noSwitch(name);
    const j = await this.ctl.json(['device', 'info', 'appearance', '--device', this.ctl.udid]);
    const a = (j.result ?? {}) as {
      userInterfaceStyle?: string;
      textSize?: string;
      reduceMotion?: { enabled?: boolean };
      increaseContrast?: { enabled?: boolean };
      reduceTransparency?: { enabled?: boolean };
    };
    if (name === 'dark_mode') return a.userInterfaceStyle ?? '';
    if (name === 'text_size') return phoneTextSize(a.textSize ?? '');
    const flags = {
      reduce_motion: a.reduceMotion,
      increase_contrast: a.increaseContrast,
      reduce_transparency: a.reduceTransparency,
    };
    return flags[name as keyof typeof flags]?.enabled ? 'on' : 'off';
  }

  async set(name: SettingName, value: string, app?: string): Promise<string | void> {
    if (name === 'locale') {
      const bundle = this.appOf(app);
      return holdAppLanguage(this.ctl.udid, bundle, value, async () => {
        if ((await this.ctl.pids(bundle)).length === 0) return;
        await this.ctl.terminate(bundle);
        await this.ctl.launch(bundle);
      });
    }
    if (name === 'dark_mode') await this.appearance('--mode', on(value, 'dark', 'light'));
    else if (name === 'text_size') await this.appearance('--text-size', value);
    else if (name === 'reduce_motion') await this.appearance('--reduce-motion', value);
    else if (name === 'increase_contrast') await this.appearance('--increase-contrast', value);
    else if (name === 'reduce_transparency') await this.appearance('--reduce-transparency', value);
    else throw noSwitch(name);
  }
}

/** No one-time event reaches an iPhone from a Mac: each says why. */
export class PhoneEvents implements DeviceEvents {
  pushRoutes(): PushRoute[] {
    return PUSH_TYPES.map((type) => ({ type, why: PHONE_CANNOT.push }));
  }

  async push(): Promise<string> {
    throw new DeviceError('UNSUPPORTED', PHONE_CANNOT.push);
  }

  async biometric(_answer: BiometricAnswer): Promise<void> {
    throw new DeviceError('UNSUPPORTED', PHONE_CANNOT.biometric);
  }

  async resetKeychain(): Promise<number> {
    throw new DeviceError('UNSUPPORTED', PHONE_CANNOT.keychain);
  }

  async call(): Promise<void> {
    throw new DeviceError('UNSUPPORTED', PHONE_CANNOT.call);
  }

  async sms(): Promise<void> {
    throw new DeviceError('UNSUPPORTED', PHONE_CANNOT.sms);
  }
}
