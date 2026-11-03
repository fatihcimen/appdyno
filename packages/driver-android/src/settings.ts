import { type DeviceSettings, TIMEOUTS, type SettingName } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { type Adb, assertPkg, shq } from './adb.js';

const ANIMATION_SCALES = [
  'window_animation_scale',
  'transition_animation_scale',
  'animator_duration_scale',
];

const localeApp = (app: string | undefined) => {
  if (!app)
    throw new DeviceError(
      'INVALID_ARGUMENT',
      'on Android the locale is per app (API 33+): give app; the whole device has no shell switch',
    );
  return assertPkg(app);
};

/**
 * What an energy reading changes for its time: told it runs on battery, and the count since the last charge kept
 * from resetting, which an unplug at a high level would do (seen on an emulator at level 100: 8 s back to 1 s).
 */
export const BATTERY_UNPLUG = 'dumpsys batterystats enable no-auto-reset; dumpsys battery unplug';
export const BATTERY_BACK = 'dumpsys battery reset; dumpsys batterystats disable no-auto-reset';

export class AndroidSettings implements DeviceSettings {
  constructor(
    private readonly adb: Adb,
    private readonly serial: string,
    /** The session's animations-off option lets go: the agent puts the scales back and holds nothing. */
    private readonly releaseAnimations: () => Promise<void> = async () => undefined,
  ) {}

  private sh = (c: string) => this.adb.exec(this.serial, `${c} 2>&1`, { timeoutMs: TIMEOUTS.app });

  private async emu(what: string, ...words: string[]) {
    if (!this.serial.startsWith('emulator-'))
      throw new DeviceError('UNSUPPORTED', `a phone has no ${what}: only an emulator console has`);
    const out = await this.adb.run(['-s', this.serial, 'emu', ...words], 30_000);
    // the console answers OK or KO; adb says nothing of it in its exit code
    const ko = /^KO:?\s*(.*)$/m.exec(out);
    if (ko) throw new DeviceError('UNSUPPORTED', `this emulator refused ${what}: ${ko[1]}`);
    return out;
  }

  async willChange(name: SettingName) {
    if (name === 'animations' || name === 'reduce_motion') await this.releaseAnimations();
  }

  /**
   * All three scales, on (1), off (0) or as they were (three values, `null` for a scale never set). The agent's
   * animations-off option gives way first: only one holds the scales' old value at a time, or each would
   * restore over the other.
   */
  async setAnimations(value: string) {
    const v =
      value === 'on' ? ['1', '1', '1'] : value === 'off' ? ['0', '0', '0'] : value.split(',');
    if (v.length !== 3 || v.some((x) => x !== 'null' && !/^\d+(\.\d+)?$/.test(x)))
      throw new DeviceError('INVALID_ARGUMENT', `animations: on or off, not ${value}`);
    await this.releaseAnimations();
    for (const [i, key] of ANIMATION_SCALES.entries())
      await this.sh(
        v[i] === 'null' ? `settings delete global ${key}` : `settings put global ${key} ${v[i]}`,
      );
  }

  private async getAnimations() {
    const values = [];
    for (const key of ANIMATION_SCALES)
      values.push((await this.sh(`settings get global ${key}`)).trim());
    return values.join(',');
  }

  async get(name: SettingName, app?: string): Promise<string> {
    switch (name) {
      case 'dark_mode':
        return /Night mode: (\w+)/.exec(await this.sh('cmd uimode night'))?.[1] ?? 'no';
      case 'text_size': {
        const v = (await this.sh('settings get system font_scale')).trim();
        return v === 'null' ? 'default' : v;
      }
      case 'reduce_motion':
      case 'animations':
        return this.getAnimations();
      case 'locale': {
        const out = await this.sh(`cmd locale get-app-locales ${localeApp(app)}`);
        return /are \[([^\]]*)\]/.exec(out)?.[1] ?? '';
      }
      case 'network':
        await this.emu('network shaping', 'network', 'status');
        return 'full';
      case 'battery': {
        const out = await this.sh('dumpsys battery');
        const level = /^\s*level: (\d+)/m.exec(out)?.[1] ?? '?';
        return /UPDATES STOPPED/.test(out) ? level : `default (now ${level})`;
      }
      case 'proxy': {
        const v = (await this.sh('settings get global http_proxy')).trim();
        return v === 'null' || v === ':0' || v === '' ? 'none' : v;
      }
    }
  }

  async set(name: SettingName, value: string, app?: string) {
    switch (name) {
      case 'dark_mode': {
        const mode = { on: 'yes', off: 'no' }[value] ?? value;
        if (!['yes', 'no', 'auto'].includes(mode))
          throw new DeviceError('INVALID_ARGUMENT', `dark_mode: on or off, not ${value}`);
        await this.sh(`cmd uimode night ${mode}`);
        return;
      }
      case 'text_size':
        if (value === 'default') {
          await this.sh('settings delete system font_scale');
          return;
        }
        if (!/^\d+(\.\d+)?$/.test(value))
          throw new DeviceError(
            'INVALID_ARGUMENT',
            `text_size on Android is a scale such as 1.3, not ${value}`,
          );
        await this.sh(`settings put system font_scale ${value}`);
        return;
      case 'reduce_motion':
        await this.setAnimations({ on: 'off', off: 'on' }[value] ?? value);
        return;
      case 'animations':
        await this.setAnimations(value);
        return;
      case 'locale': {
        const out = await this.sh(
          `cmd locale set-app-locales ${localeApp(app)} --locales ${shq(value)}`,
        );
        if (/Unknown|Exception|Error/.test(out))
          throw new DeviceError(
            'UNSUPPORTED',
            `this Android cannot set an app's locale: ${out.trim().split('\n')[0]}`,
          );
        return;
      }
      case 'network': {
        if (!/^\w+$/.test(value))
          throw new DeviceError(
            'INVALID_ARGUMENT',
            `network: slow, full or a speed name, not ${value}`,
          );
        await this.emu('network shaping', 'network', 'speed', value === 'slow' ? 'edge' : value);
        await this.emu(
          'network shaping',
          'network',
          'delay',
          ...(value === 'slow' ? ['40', '100'] : ['none']),
        );
        return;
      }
      case 'proxy':
        await this.setProxy(value);
        return;
      case 'battery':
        if (value.startsWith('default')) await this.sh(BATTERY_BACK);
        else if (/^\d{1,3}$/.test(value) && Number(value) <= 100)
          await this.sh(`dumpsys battery set level ${value}`);
        else throw new DeviceError('INVALID_ARGUMENT', `battery: a level 0 to 100, not ${value}`);
        return;
    }
  }

  async fold(closed: boolean) {
    await this.emu('fold pose', closed ? 'fold' : 'unfold');
  }

  async call(number: string, end: boolean) {
    await this.emu('calls', 'gsm', end ? 'cancel' : 'call', number);
  }

  async sms(from: string, text: string) {
    await this.emu('SMS', 'sms', 'send', from, text.replace(/\s+/g, ' '));
  }

  /**
   * A proxy on this Mac by its loopback address, through `adb reverse`, so that an emulator and a phone
   * reach it the same way and it need not listen on the network. `:0` takes effect at once where deleting
   * the setting alone would not.
   */
  private async setProxy(value: string) {
    const was = await this.get('proxy');
    const loopback = (v: string) => /^(127\.0\.0\.1|localhost):(\d+)$/.exec(v)?.[2];
    if (value !== 'none' && !/^[\w.-]+:\d+$/.test(value))
      throw new DeviceError('INVALID_ARGUMENT', `proxy: host:port or none, not ${value}`);
    const port = loopback(value);
    if (port) await this.adb.run(['-s', this.serial, 'reverse', `tcp:${port}`, `tcp:${port}`]);
    await this.sh(`settings put global http_proxy ${value === 'none' ? ':0' : shq(value)}`);
    if (value === 'none') await this.sh('settings delete global http_proxy');
    const old = loopback(was);
    if (old && old !== port)
      await this.adb
        .run(['-s', this.serial, 'reverse', '--remove', `tcp:${old}`])
        .catch(() => undefined);
  }

  /** Posted by the shell user: Android has no way to post as the app without its own code. */
  async push(_app: string | undefined, title: string, body: string) {
    const out = await this.sh(
      `cmd notification post -S bigtext -t ${shq(title)} appdyno ${shq(body)}`,
    );
    if (/Exception|Error/.test(out))
      throw new DeviceError('INTERNAL', `the notification was not posted: ${out.split('\n')[0]}`);
  }

  async biometric() {
    throw new DeviceError(
      'UNSUPPORTED',
      'biometrics are simulator only here; an emulator takes: adb emu finger touch 1',
    );
  }
}
