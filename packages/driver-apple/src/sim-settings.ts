import { ORIENTATIONS, type DeviceSettings, type SettingName } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import type { RunnerTurn } from './device.js';
import { macProxy } from './network.js';
import { SIM_CANNOT } from './sim-events.js';
import { SimulatorFold } from './sim-fold.js';
import type { Simctl } from './simctl.js';
import { appLanguage, heldSize, holdAppLanguage, on, textSize } from './manage.js';

const TRANSPARENCY = ['com.apple.Accessibility', 'EnhancedBackgroundContrastEnabled'];

const KEYBOARD = 'com.apple.keyboard.preferences';
const PREDICTIVE = 'com.apple.keyboard.predictive';
/**
 * What a simulator's keyboard does to text after it is typed, as iOS 26.5 and 27.2 name it, each seen doing it:
 * autocorrection replaces a phrase as its field loses the focus, from what prediction offers; two spaces make a period;
 * smart punctuation curls quotes and makes two hyphens a dash. Autocorrection and the period come twice, the second for a
 * hardware keyboard, which Simulator connects as a person chooses.
 */
const CORRECTIONS = [
  [KEYBOARD, 'KeyboardAutocorrection'],
  [KEYBOARD, 'HWKeyboardAutocorrection'],
  [PREDICTIVE, 'KeyboardPrediction'],
  [KEYBOARD, 'KeyboardPeriodShortcut'],
  [KEYBOARD, 'HWKeyboardPeriodShortcut'],
  [KEYBOARD, 'SmartTyping'],
] as const;
/** What tells the keyboard of a change, which then holds for the text it is typing: smart punctuation waits for its next field. */
const KEYBOARD_TOLD = [
  'AppleKeyboardsPreferencesChangedNotification',
  'AppleKeyboardsPredictiveChangedNotification',
];

export class SimulatorSettings implements DeviceSettings {
  constructor(
    private readonly simctl: Simctl,
    private readonly udid: string,
    private readonly fold = new SimulatorFold(udid),
    private readonly turn?: RunnerTurn,
  ) {}

  /** The runner comes up before a turn is written down, where a read alone would not start it. */
  async willChange(name: SettingName) {
    if (name === 'orientation') await this.turn?.start();
  }

  async choices(name: SettingName) {
    return name === 'fold' ? this.fold.poses() : undefined;
  }

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
          "a simulator uses the Mac's network: a throttle of the network probe slows one app's requests there, and the Network Link Conditioner all of the Mac's",
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
      case 'orientation': {
        // the device's turn, written down and put back as Android's rotation lock is
        const turns = await this.turn?.now();
        const name = turns === undefined ? undefined : ORIENTATIONS[turns];
        if (!name)
          throw new DeviceError(
            'UNSUPPORTED',
            "a simulator's turn is read by its runner, which is not up",
          );
        return name;
      }
      case 'fold':
        return this.fold.get();
      case 'autocorrect':
        return this.corrections();
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
      case 'fold':
        return this.fold.set(value);
      case 'autocorrect':
        return this.correct(value);
      case 'orientation': {
        const turns = ORIENTATIONS.indexOf(value as (typeof ORIENTATIONS)[number]);
        if (!this.turn || turns < 0)
          throw new DeviceError('INVALID_ARGUMENT', `orientation: as get reads it, not ${value}`);
        await this.turn.set(turns as 0 | 1 | 2 | 3);
        return;
      }
      default:
        await this.get(name);
    }
  }

  /** The corrections as they are set: `default` where none is, `off`, or each by its key, `-` for one not set. */
  private async corrections() {
    const read = await Promise.all(
      CORRECTIONS.map(([domain, key]) =>
        this.spawn('defaults', 'read', domain, key).then(
          (v) => v.trim(),
          () => '-',
        ),
      ),
    );
    if (read.every((v) => v === '-')) return 'default';
    if (read.every((v) => v === '0')) return 'off';
    return CORRECTIONS.map(([, key], i) => `${key}=${read[i] ?? '-'}`).join(' ');
  }

  /** `off`, `default`, or each as `corrections` reads it: one not set is deleted, so that it is the system's again. */
  private async correct(value: string) {
    const said = new Map(value.split(' ').map((w) => w.split('=') as [string, string]));
    const values = CORRECTIONS.map(([, key]) =>
      value === 'off' ? '0' : value === 'default' ? '-' : said.get(key),
    );
    if (values.some((v) => v !== '-' && v !== '0' && v !== '1'))
      throw new DeviceError(
        'INVALID_ARGUMENT',
        `autocorrect: off, default, or as get reads it, not ${value}`,
      );
    await Promise.all(
      CORRECTIONS.map(([domain, key], i) =>
        values[i] === '-'
          ? this.spawn('defaults', 'delete', domain, key).catch(() => undefined)
          : this.spawn('defaults', 'write', domain, key, '-bool', values[i] === '1' ? 'YES' : 'NO'),
      ),
    );
    await Promise.all(KEYBOARD_TOLD.map((told) => this.spawn('notifyutil', '-p', told)));
    return undefined;
  }

  async cannotSet(name: SettingName) {
    return name === 'proxy' ? this.followsMac() : undefined;
  }

  private followsMac = async () =>
    `a simulator follows the Mac's proxy, now ${await macProxy()}: set it on the Mac (in the proxy's own settings)`;
}
