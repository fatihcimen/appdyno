import {
  type BiometricAnswer,
  type DeviceSettings,
  sleep,
  TIMEOUTS,
  type SettingName,
} from '@appdyno/core';
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
 * What an energy reading changes for its time: the count since the last charge kept from resetting, which an unplug at
 * a high level would do (seen on an emulator at level 100: 8 s back to 1 s), and only then told it runs on battery.
 */
export const BATTERY_GUARD = 'dumpsys batterystats enable no-auto-reset';
export const BATTERY_BACK = 'dumpsys battery reset; dumpsys batterystats disable no-auto-reset';

/** What asks for each radio, `enable` or `disable` after it. */
const RADIOS = {
  airplane: 'cmd connectivity airplane-mode',
  wifi: 'svc wifi',
  mobile_data: 'svc data',
} as const;
/** How long a radio has to read as asked: a change takes under a second on a calm emulator. */
const RADIO_MS = 10_000;
const READ_AGAIN_MS = 200;
/** `adb connect`, or wireless debugging: a device whose radio is also the way to it. */
const OVER_ITS_NETWORK = /:\d+$|_adb-tls-connect/;

/** The finger an emulator's enrolment is given, and one it has never seen. */
const KNOWN_FINGER = '1';
const UNKNOWN_FINGER = '99';
/** Enrolling took 3 touches on API 34; a sensor counts a touch only once the one before it is lifted. */
const ENROLL_TOUCHES = 15;
const FINGER_MS = 300;
/** How long a touch has to show in the service's counts. */
const COUNTED_MS = 3_000;
const NO_FINGERPRINT =
  "no fingerprint is enrolled here: set a screen lock, open Settings' fingerprint enrolment, then biometric enroll";

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
      case 'airplane':
        return this.switchOf('airplane_mode_on', name);
      case 'mobile_data':
        // what the user chose, not the connection: that goes in airplane mode, and a restore would keep it off
        return this.switchOf('mobile_data', name);
      case 'wifi': {
        // the state, as `wifi_on` changes first, and has values of its own for airplane mode
        const out = await this.sh("dumpsys wifi 2>/dev/null | grep -m1 '^Wi-Fi is'");
        const state = /^Wi-Fi is (\w+)/.exec(out)?.[1];
        if (!state)
          throw new DeviceError('UNSUPPORTED', `this device reads no Wi-Fi state: ${out}`);
        return { enabled: 'on', disabled: 'off' }[state] ?? state;
      }
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
        `asked for ${name} ${value} and it still reads ${now} after ${RADIO_MS / 1000} s${said.trim() ? `: ${said.trim().split('\n')[0]}` : ''}`,
      );
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
      case 'airplane':
      case 'wifi':
      case 'mobile_data':
        await this.radio(name, value);
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

  /** The service's own counts: how many are enrolled, and what it took of the touches so far. */
  private async prints() {
    const out = await this.sh('dumpsys fingerprint');
    const m = /"count":(\d+),"accept":(\d+),"reject":(\d+)/.exec(out);
    if (!m)
      throw new DeviceError(
        'UNSUPPORTED',
        `this device gives no fingerprint counts: ${out.trim().split('\n')[0]}`,
      );
    return { enrolled: Number(m[1]), accept: Number(m[2]), reject: Number(m[3]) };
  }

  private async touch(finger: string) {
    await this.emu('fingerprint sensor', 'finger', 'touch', finger);
    await sleep(FINGER_MS);
    await this.emu('fingerprint sensor', 'finger', 'remove');
    await sleep(FINGER_MS);
  }

  /** A touch of the emulator's sensor, done only when the service counted it. */
  async biometric(answer: BiometricAnswer) {
    if (!this.serial.startsWith('emulator-'))
      throw new DeviceError(
        'UNSUPPORTED',
        'an Android phone takes a fingerprint only from a person: only an emulator has a sensor to touch',
      );
    const before = await this.prints();
    if (answer === 'enroll') {
      for (let i = 0; i < ENROLL_TOUCHES && (await this.prints()).enrolled === 0; i++)
        await this.touch(KNOWN_FINGER);
      if ((await this.prints()).enrolled > 0) return;
      throw new DeviceError(
        'NOT_FOUND',
        `${ENROLL_TOUCHES} touches enrolled nothing: open Settings' fingerprint enrolment first, which needs a screen lock`,
      );
    }
    if (before.enrolled === 0) throw new DeviceError('NOT_FOUND', NO_FINGERPRINT);
    await this.touch(answer === 'match' ? KNOWN_FINGER : UNKNOWN_FINGER);
    const counted = answer === 'match' ? 'accept' : 'reject';
    const end = Date.now() + COUNTED_MS;
    let now = await this.prints();
    while (now[counted] === before[counted] && Date.now() < end) {
      await sleep(READ_AGAIN_MS);
      now = await this.prints();
    }
    if (now[counted] === before[counted])
      throw new DeviceError(
        'NOT_FOUND',
        `the touch was not counted as a ${answer} (${now.accept} accepted, ${now.reject} rejected): an app must be asking for a fingerprint, and finger ${KNOWN_FINGER} must be the one enrolled`,
      );
  }

  async resetKeychain(): Promise<number> {
    throw new DeviceError('UNSUPPORTED', 'Android has no keychain: app clear empties an app');
  }
}
