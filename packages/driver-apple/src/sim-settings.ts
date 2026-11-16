import type { DeviceSettings, SettingName } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { macProxy } from './network.js';
import { SIM_CANNOT } from './sim-events.js';
import type { Simctl } from './simctl.js';
import { appLanguage, heldSize, holdAppLanguage, on, textSize } from './manage.js';

const TRANSPARENCY = ['com.apple.Accessibility', 'EnhancedBackgroundContrastEnabled'];

export class SimulatorSettings implements DeviceSettings {
  constructor(
    private readonly simctl: Simctl,
    private readonly udid: string,
  ) {}

  /** An app that runs starts again, in what it is held in now. */
  private async restart(app: string) {
    if (!(await this.simctl.pid(this.udid, app).catch(() => 0))) return;
    await this.simctl.terminate(this.udid, app);
    await this.simctl.launch(this.udid, app);
  }

  private ui = async (...words: string[]) =>
    (await this.simctl.exec(['ui', this.udid, ...words])).trim();
  private spawn = (...words: string[]) => this.simctl.exec(['spawn', this.udid, ...words]);

  async get(name: SettingName, app?: string): Promise<string> {
    switch (name) {
      case 'dark_mode':
        return this.ui('appearance');
      case 'text_size':
        // simctl reads extra-small back as extra-Small
        return (await this.ui('content_size')).toLowerCase();
      case 'reduce_motion': {
        const v = await this.spawn(
          'defaults',
          'read',
          'com.apple.Accessibility',
          'ReduceMotionEnabled',
        ).catch(() => '0');
        return v.trim() === '1' ? 'on' : 'off';
      }
      case 'increase_contrast':
        return (await this.ui('increase_contrast')) === 'enabled' ? 'on' : 'off';
      case 'reduce_transparency': {
        const v = await this.spawn('defaults', 'read', ...TRANSPARENCY).catch(() => '0');
        return v.trim() === '1' ? 'on' : 'off';
      }
      case 'locale':
        if (app) return appLanguage(this.udid, app);
        return (await this.spawn('defaults', 'read', '-g', 'AppleLocale').catch(() => '')).trim();
      case 'animations':
        throw new DeviceError('UNSUPPORTED', 'iOS has no animations setting: use reduce_motion');
      case 'network':
        throw new DeviceError(
          'UNSUPPORTED',
          "a simulator uses the Mac's network: network with throttle slows one app's requests there, and the Network Link Conditioner all of the Mac's",
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
      case 'screen_lock':
        throw new DeviceError('UNSUPPORTED', 'a simulator has no screen lock to set');
      case 'orientation':
        throw new DeviceError('UNSUPPORTED', 'a simulator has no rotation lock to set');
      case 'fold':
        throw new DeviceError('UNSUPPORTED', SIM_CANNOT.fold);
      case 'thermal':
        throw new DeviceError(
          'UNSUPPORTED',
          "a simulator has no thermal state of its own: Xcode's conditions are a phone's",
        );
    }
  }

  async set(name: SettingName, value: string, app?: string): Promise<string | undefined> {
    switch (name) {
      case 'dark_mode':
        await this.ui('appearance', on(value, 'dark', 'light'));
        return;
      case 'text_size': {
        const said = await this.ui('content_size', textSize(value));
        heldSize(value, await this.get('text_size'), said);
        return;
      }
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
      case 'increase_contrast':
        await this.ui('increase_contrast', on(value, 'enabled', 'disabled'));
        return;
      case 'reduce_transparency':
        await this.spawn(
          'defaults',
          'write',
          ...TRANSPARENCY,
          '-bool',
          value === 'on' ? 'YES' : 'NO',
        );
        await this.spawn('notifyutil', '-p', 'com.apple.accessibility.reduce.transparency.status');
        return;
      case 'locale':
        if (app) {
          const held = await holdAppLanguage(this.udid, app, value, () => this.restart(app));
          return `${held}: app "" for the whole simulator`;
        }
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
        return "the whole simulator: app for one app's launches";
      case 'proxy':
        throw new DeviceError('UNSUPPORTED', await this.followsMac());
      default:
        await this.get(name);
    }
  }

  async cannotSet(name: SettingName) {
    return name === 'proxy' ? this.followsMac() : undefined;
  }

  private followsMac = async () =>
    `a simulator follows the Mac's proxy, now ${await macProxy()}: set it on the Mac (in the proxy's own settings)`;
}
