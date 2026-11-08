import { must, type DeviceSettings, sleep, TIMEOUTS, type SettingName } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { type Adb, shq } from './adb.js';
import { AndroidFold } from './fold.js';
import { AndroidLocale } from './locale.js';
import { AndroidShaping } from './shaping.js';

const ANIMATION_SCALES = [
  'window_animation_scale',
  'transition_animation_scale',
  'animator_duration_scale',
];

/** Android's own: high contrast text, the nearest it has to increasing contrast. */
const HIGH_CONTRAST = 'high_text_contrast_enabled';
const NO_THERMAL =
  "this tool sets no thermal state on Android: only an iPhone's, through Xcode's conditions";
const NO_TRANSPARENCY =
  'Android has no reduce_transparency switch: its blurs are a developer option';

/**
 * What an energy reading changes for its time: the count since the last charge kept from resetting, which an unplug at
 * a high level would do (seen on an emulator at level 100: 8 s back to 1 s), and only then told it runs on battery.
 */
export const BATTERY_GUARD = 'dumpsys batterystats enable no-auto-reset';
export const BATTERY_BACK = 'dumpsys battery reset; dumpsys batterystats disable no-auto-reset';

/** Where Wi-Fi is going by `wifi_on`: 2 and 3 are its values while airplane mode holds it, 3 until that ends. */
const WIFI_GOING: Record<string, string> = { '0': 'off', '1': 'on', '2': 'on', '3': 'off' };

/** What asks for each radio, `enable` or `disable` after it. */
const RADIOS = {
  airplane: 'cmd connectivity airplane-mode',
  wifi: 'svc wifi',
  mobile_data: 'svc data',
} as const;
/** How long a radio has to read as asked: a change takes under a second on a calm emulator. */
const RADIO_MS = 10_000;
const READ_AGAIN_MS = 200;
/** The text scales Android's settings take, on API 34: 0.24 and 5.1 are refused. */
const SCALES = { min: 0.25, max: 5 };
/**
 * The system writes the scale back after each change, and the write of one just before can land after the next: on an
 * API 34 emulator, within 0.2 s of it.
 */
const SCALE_HOLDS_MS = 500;
/** `adb connect`, or wireless debugging: a device whose radio is also the way to it. */
const OVER_ITS_NETWORK = /:\d+$|_adb-tls-connect/;

/** The PIN this tool gives an emulator for a fingerprint, and types where Settings asks for it. */
export const EMULATOR_PIN = '1234';
const NOT_A_PHONE_LOCK = "a screen lock is set only on an emulator: a phone's is its owner's";

/** A shell command on the device, its errors in its answer. */
export const shellOf = (adb: Adb, serial: string) => (command: string) =>
  adb.exec(serial, `${command} 2>&1`, { timeoutMs: TIMEOUTS.app });

/** The emulator's console; `what` names it in a refusal. */
export async function emulatorConsole(adb: Adb, serial: string, what: string, words: string[]) {
  if (!serial.startsWith('emulator-'))
    throw new DeviceError('UNSUPPORTED', `a phone has no ${what}: only an emulator console has`);
  const out = await adb.run(['-s', serial, 'emu', ...words], 30_000);
  // the console answers OK or KO; adb says nothing of it in its exit code
  const ko = /^KO:?\s*(.*)$/m.exec(out);
  if (ko)
    throw new DeviceError(
      'UNSUPPORTED',
      `this emulator refused ${what}: ${must(ko[1], 'a reason')}`,
    );
  return out;
}

export class AndroidSettings implements DeviceSettings {
  constructor(
    private readonly adb: Adb,
    private readonly serial: string,
    /** The session's animations-off option lets go: the agent puts the scales back and holds nothing. */
    private readonly releaseAnimations: () => Promise<void> = () => Promise.resolve(),
    /** The whole device's languages, by the agent, set first when given. */
    deviceLocales: (set?: string) => Promise<string> = () =>
      Promise.reject(new DeviceError('UNSUPPORTED', 'no agent to reach the device languages')),
  ) {
    this.locale = new AndroidLocale(this.sh, deviceLocales);
    this.fold = new AndroidFold(this.sh);
    this.shaping = new AndroidShaping(serial, this.sh, this.emu);
  }

  private sh = (c: string) => shellOf(this.adb, this.serial)(c);
  private readonly locale: AndroidLocale;
  private readonly fold: AndroidFold;
  private readonly shaping: AndroidShaping;

  private emu = (what: string, ...words: string[]) =>
    emulatorConsole(this.adb, this.serial, what, words);

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
    for (const [i, key] of ANIMATION_SCALES.entries()) {
      const scale = must(v[i], 'a scale');
      await this.sh(
        scale === 'null' ? `settings delete global ${key}` : `settings put global ${key} ${scale}`,
      );
    }
  }

  private async getAnimations() {
    const values: string[] = [];
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
        // a scale deleted is written back by the system as 1.0
        return v === 'null' || Number(v) === 1 ? 'default' : v;
      }
      case 'reduce_motion':
      case 'animations':
        return this.getAnimations();
      case 'increase_contrast': {
        const v = (await this.sh(`settings get secure ${HIGH_CONTRAST}`)).trim();
        return v === '1' ? 'on' : 'off';
      }
      case 'reduce_transparency':
        throw new DeviceError('UNSUPPORTED', NO_TRANSPARENCY);
      case 'locale':
        return this.locale.get(app);
      case 'network':
        return this.shaping.get();
      case 'battery': {
        const out = await this.sh('dumpsys battery');
        const level = /^\s*level: (\d+)/m.exec(out)?.[1] ?? '?';
        return out.includes('UPDATES STOPPED') ? level : `default (now ${level})`;
      }
      case 'proxy': {
        const v = (await this.sh('settings get global http_proxy')).trim();
        return v === 'null' || v === ':0' || v === '' ? 'none' : v;
      }
      case 'airplane':
        return this.switchOf('airplane_mode_on', name);
      case 'mobile_data':
        // what the user chose, not the connection: that goes in airplane mode, and a restore would keep it off
        return this.switchOf('mobile_data', name);
      case 'wifi':
        return this.wifi();
      case 'fold':
        return this.fold.get();
      case 'thermal':
        throw new DeviceError('UNSUPPORTED', NO_THERMAL);
      case 'screen_lock':
        // which emulator had none: a serial is reused, and another's lock is not this tool's to clear
        return (await this.unlocked()) ? `none on ${await this.avd()}` : 'pin';
    }
  }

  /** With no credential to give, the check passes only where there is none. */
  private async unlocked() {
    return (await this.sh('cmd lock_settings verify')).includes('verified successfully');
  }

  private async avd() {
    return must((await this.emu('its name', 'avd', 'name')).split('\n')[0], 'a line').trim();
  }

  /**
   * On an emulator only, and only this tool's PIN on the emulator it set it on: clearing it deletes the fingerprints
   * with it. One already gone is done.
   */
  private async setScreenLock(value: string) {
    if (!this.serial.startsWith('emulator-'))
      throw new DeviceError('UNSUPPORTED', NOT_A_PHONE_LOCK);
    const on = /^none on (.+)$/.exec(value)?.[1];
    if (on) {
      const now = await this.avd();
      if (now !== on)
        throw new DeviceError(
          'UNSUPPORTED',
          `${this.serial} is ${now} now, not ${on}, whose PIN this tool set: it is put back when ${on} is here`,
        );
      value = 'none';
    }
    if (value === 'none' && (await this.unlocked())) return;
    const change =
      value === 'pin'
        ? { command: `set-pin ${EMULATOR_PIN}`, done: /Pin set/ }
        : value === 'none'
          ? { command: `clear --old ${EMULATOR_PIN}`, done: /cleared/ }
          : undefined;
    if (!change)
      throw new DeviceError('INVALID_ARGUMENT', `screen_lock: pin or none, not ${value}`);
    const out = await this.sh(`cmd lock_settings ${change.command}`);
    if (!change.done.test(out))
      throw new DeviceError(
        'UNSUPPORTED',
        `the screen lock did not change: ${must(out.trim().split('\n')[0], 'a line')}`,
      );
  }

  /**
   * The state, once it has come to where `wifi_on` says it is going: that moves first, and a radio that airplane
   * mode's end is bringing back still reads off for a moment, which would be written down as the user's value.
   */
  private async wifi() {
    const end = Date.now() + RADIO_MS;
    for (;;) {
      const out = await this.sh(
        "settings get global wifi_on; settings get global airplane_mode_on; dumpsys wifi 2>/dev/null | grep -m1 '^Wi-Fi is'",
      );
      const [chosen = '', airplane] = out.split('\n').map((l) => l.trim());
      const state = /^Wi-Fi is (\w+)/m.exec(out)?.[1];
      if (!state) throw new DeviceError('UNSUPPORTED', `this device reads no Wi-Fi state: ${out}`);
      const now = { enabled: 'on', disabled: 'off' }[state] ?? state;
      const going = airplane === '0' && chosen === '3' ? 'on' : WIFI_GOING[chosen];
      if (!going || now === going || Date.now() >= end) return now;
      await sleep(READ_AGAIN_MS);
    }
  }

  private async switchOf(key: string, name: SettingName) {
    const v = (await this.sh(`settings get global ${key}`)).trim();
    const read = { '1': 'on', '0': 'off' }[v];
    if (!read) throw new DeviceError('UNSUPPORTED', `this device has no ${name} switch: ${v}`);
    return read;
  }

  /**
   * Asks, then reads until it holds: a command says nothing when a phone's maker keeps it from working, so
   * only the reading says it was done.
   */
  private async radio(name: keyof typeof RADIOS, value: string) {
    if (value !== 'on' && value !== 'off')
      throw new DeviceError('INVALID_ARGUMENT', `${name}: on or off, not ${value}`);
    const cuts = name === 'airplane' ? value === 'on' : name === 'wifi' && value === 'off';
    if (cuts && OVER_ITS_NETWORK.test(this.serial))
      throw new DeviceError(
        'UNSUPPORTED',
        `${this.serial} is reached over its network: with ${name} ${value} nothing could reach it to put it back`,
      );
    const said = await this.sh(`${RADIOS[name]} ${value === 'on' ? 'enable' : 'disable'}`);
    const end = Date.now() + RADIO_MS;
    let now = await this.get(name);
    while (now !== value && Date.now() < end) {
      await sleep(READ_AGAIN_MS);
      now = await this.get(name);
    }
    if (now !== value)
      throw new DeviceError(
        'UNSUPPORTED',
        `asked for ${name} ${value} and it still reads ${now} after ${RADIO_MS / 1000} s${said.trim() ? `: ${must(said.trim().split('\n')[0], 'a line')}` : ''}`,
      );
  }

  /** A text scale, asked again until it reads as asked once the system's own write has come. */
  private async setScale(value: string) {
    const scale = value === 'default' ? 1 : Number(value);
    if (!/^(\d+(\.\d+)?|default)$/.test(value) || scale < SCALES.min || scale > SCALES.max)
      throw new DeviceError(
        'INVALID_ARGUMENT',
        `text_size on Android is a scale, not ${value}`,
        `from ${SCALES.min} to ${SCALES.max}, such as 1.3, or default`,
      );
    const end = Date.now() + RADIO_MS;
    for (;;) {
      const said = await this.sh(
        value === 'default'
          ? 'settings delete system font_scale'
          : `settings put system font_scale ${value}`,
      );
      const refused = /\w+Exception: (.*)/.exec(said)?.[1];
      if (refused)
        throw new DeviceError('UNSUPPORTED', `this device refused text_size ${value}: ${refused}`);
      await sleep(SCALE_HOLDS_MS);
      const now = await this.get('text_size');
      if ((now === 'default' ? 1 : Number(now)) === scale) return;
      if (Date.now() >= end)
        throw new DeviceError(
          'UNSUPPORTED',
          `asked for text_size ${value} and it still reads ${now} after ${RADIO_MS / 1000} s`,
        );
    }
  }

  async set(name: SettingName, value: string, app?: string): Promise<string | undefined> {
    switch (name) {
      case 'dark_mode': {
        const mode = { on: 'yes', off: 'no' }[value] ?? value;
        if (!['yes', 'no', 'auto'].includes(mode))
          throw new DeviceError('INVALID_ARGUMENT', `dark_mode: on or off, not ${value}`);
        await this.sh(`cmd uimode night ${mode}`);
        return;
      }
      case 'text_size':
        await this.setScale(value);
        return;
      case 'reduce_motion':
        await this.setAnimations({ on: 'off', off: 'on' }[value] ?? value);
        return;
      case 'animations':
        await this.setAnimations(value);
        return;
      case 'increase_contrast':
        if (value !== 'on' && value !== 'off')
          throw new DeviceError('INVALID_ARGUMENT', `${name}: on or off, not ${value}`);
        // off is the key gone, as a device that never had it left it
        await this.sh(
          value === 'on'
            ? `settings put secure ${HIGH_CONTRAST} 1`
            : `settings delete secure ${HIGH_CONTRAST}`,
        );
        return;
      case 'reduce_transparency':
        throw new DeviceError('UNSUPPORTED', NO_TRANSPARENCY);
      case 'locale':
        return this.locale.set(value, app);
      case 'network':
        return this.shaping.set(value);
      case 'proxy':
        await this.setProxy(value);
        return;
      case 'battery':
        if (value.startsWith('default')) await this.sh(BATTERY_BACK);
        else if (/^\d{1,3}$/.test(value) && Number(value) <= 100)
          await this.sh(`dumpsys battery set level ${value}`);
        else throw new DeviceError('INVALID_ARGUMENT', `battery: a level 0 to 100, not ${value}`);
        return;
      case 'airplane':
      case 'wifi':
      case 'mobile_data':
        await this.radio(name, value);
        return;
      case 'screen_lock':
        await this.setScreenLock(value);
        return;
      case 'fold':
        await this.fold.set(value);
        return;
      case 'thermal':
        throw new DeviceError('UNSUPPORTED', NO_THERMAL);
    }
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
}
