import type {
  AppManager,
  AppEntry,
  LaunchOptions,
  DeviceSettings,
  SettingName,
} from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import type { Devicectl } from './devicectl.js';
import { assertBundle } from './simctl.js';
import { assertAppBundle, on } from './manage.js';

const PHONE_CANNOT = {
  clear: "an iPhone's app data can only go with the app: uninstall and install it again",
  permission: 'no tool grants an iPhone app a permission: answer its prompt with the alert tool',
  push: 'a push to an iPhone needs Apple push credentials, which this tool does not hold',
  biometric: 'an iPhone takes biometrics only from a person',
  fold: 'an iPhone folds only in a hand',
  call: 'an iPhone takes calls only from the network',
  sms: 'an iPhone takes messages only from the network',
} as const;

export class PhoneApps implements AppManager {
  constructor(private readonly ctl: Devicectl) {}

  async install(path: string) {
    assertAppBundle(path);
    await this.ctl.install(path);
    return [];
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

/** `devicectl` shows "Extra Large" where it is told extra-large. */
export const phoneTextSize = (shown: string) => shown.trim().toLowerCase().replace(/\s+/g, '-');

/** A phone's appearance through `devicectl`; what it has no switch for says so. */
export class PhoneSettings implements DeviceSettings {
  constructor(private readonly ctl: Devicectl) {}

  private appearance(...words: string[]) {
    return this.ctl.json(['device', 'settings', 'appearance', '--device', this.ctl.udid, ...words]);
  }

  async get(name: SettingName): Promise<string> {
    if (name !== 'dark_mode' && name !== 'text_size' && name !== 'reduce_motion')
      throw new DeviceError('UNSUPPORTED', `an iPhone has no ${name} switch this tool can reach`);
    const j = await this.ctl.json(['device', 'info', 'appearance', '--device', this.ctl.udid]);
    const a = (j.result ?? {}) as {
      userInterfaceStyle?: string;
      textSize?: string;
      reduceMotion?: { enabled?: boolean };
    };
    if (name === 'dark_mode') return a.userInterfaceStyle ?? '';
    if (name === 'reduce_motion') return a.reduceMotion?.enabled ? 'on' : 'off';
    return phoneTextSize(a.textSize ?? '');
  }

  async set(name: SettingName, value: string) {
    if (name === 'dark_mode') await this.appearance('--mode', on(value, 'dark', 'light'));
    else if (name === 'text_size') await this.appearance('--text-size', value);
    else if (name === 'reduce_motion') await this.appearance('--reduce-motion', value);
    else
      throw new DeviceError('UNSUPPORTED', `an iPhone has no ${name} switch this tool can reach`);
  }

  async push(): Promise<void> {
    throw new DeviceError('UNSUPPORTED', PHONE_CANNOT.push);
  }

  async biometric(): Promise<void> {
    throw new DeviceError('UNSUPPORTED', PHONE_CANNOT.biometric);
  }

  async fold(): Promise<void> {
    throw new DeviceError('UNSUPPORTED', PHONE_CANNOT.fold);
  }

  async call(): Promise<void> {
    throw new DeviceError('UNSUPPORTED', PHONE_CANNOT.call);
  }

  async sms(): Promise<void> {
    throw new DeviceError('UNSUPPORTED', PHONE_CANNOT.sms);
  }
}
