import { sleep } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';

/** The text scales Android's settings take, on API 34: 0.24 and 5.1 are refused. */
const SCALES = { min: 0.25, max: 5 };
/**
 * The system writes the scale back after each change, and the write of one just before can land after the next: on an
 * API 34 emulator, within 0.2 s of it.
 */
const SCALE_HOLDS_MS = 500;
/** How long a change has to read as asked. */
const READ_BACK_MS = 10_000;

/** The text scale, `font_scale`, which Android writes with the languages, `system_locales`, on a change of either. */
export class AndroidScale {
  constructor(private readonly sh: (command: string) => Promise<string>) {}

  /** The languages, unset or not, before this tool first changed the scale: a write the system made late is no one's. */
  private languagesFirst?: string[];

  /** Which of `keys` (of `system`) read unset now. */
  private async unset(keys: string[]) {
    const out = await this.sh(keys.map((k) => `settings get system ${k}`).join('; '));
    const lines = out.split('\n').map((l) => l.trim());
    return keys.filter((_, i) => lines[i] === 'null');
  }

  /** `default` where the device never set one. */
  async get() {
    const v = (await this.sh('settings get system font_scale')).trim();
    return v === 'null' ? 'default' : v;
  }

  /**
   * Which of `keys` (of `system`) read unset now, with `unsetAfter` as unset whatever they read, and what deletes them
   * again once a change has gone: the system writes the text scale and the languages together when either changes
   * (`Settings.System.putConfigurationForUser`). `moved`: the change moved the configuration, so that write is coming,
   * and is waited for: an emulator's came more than a second after a change.
   */
  async keepingUnset(keys: string[], unsetAfter: string[] = []) {
    const were = [...new Set([...unsetAfter, ...(await this.unset(keys))])];
    const unset = () => this.unset(were);
    return async (moved: boolean) => {
      if (were.length === 0) return;
      const end = Date.now() + (moved ? READ_BACK_MS : SCALE_HOLDS_MS);
      let seen = false;
      for (;;) {
        await sleep(SCALE_HOLDS_MS);
        const now = await unset();
        const written = were.filter((k) => !now.includes(k));
        if (written.length > 0) {
          seen = true;
          await this.sh(written.map((k) => `settings delete system ${k}`).join('; '));
        }
        if ((written.length === 0 && (seen || !moved)) || Date.now() >= end) return;
      }
    };
  }

  /**
   * A text scale, asked again until it reads as asked once the system's own write has come; `default` is the scale
   * unset, as a device that never set one has it, and a delete the system answers with 1.0 is asked again. The languages
   * the system writes beside it stay unset where they were.
   */
  async set(value: string) {
    const scale = value === 'default' ? 1 : Number(value);
    if (!/^(\d+(\.\d+)?|default)$/.test(value) || scale < SCALES.min || scale > SCALES.max)
      throw new DeviceError(
        'INVALID_ARGUMENT',
        `text_size on Android is a scale, not ${value}`,
        `from ${SCALES.min} to ${SCALES.max}, such as 1.3, or default`,
      );
    this.languagesFirst ??= await this.unset(['system_locales']);
    // a scale put back unset stays so, and the languages as they were first, after the system's write of 1.0 with them
    const languagesBack = await this.keepingUnset(
      ['system_locales'],
      value === 'default' ? ['font_scale', ...this.languagesFirst] : [],
    );
    const was = await this.get();
    const end = Date.now() + READ_BACK_MS;
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
      const now = await this.get();
      if (value === 'default' ? now === 'default' : Number(now) === scale) break;
      if (Date.now() >= end)
        throw new DeviceError(
          'UNSUPPORTED',
          `asked for text_size ${value} and it still reads ${now} after ${READ_BACK_MS / 1000} s`,
        );
    }
    await languagesBack((was === 'default' ? 1 : Number(was)) !== scale);
  }
}
