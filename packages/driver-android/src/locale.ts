import { must } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { assertPkg, shq } from './adb.js';

/** Where an app has languages of its own, by `cmd locale`. */
const PER_APP_SDK = 33;

/** Tags as BCP 47 has them, so that an old code (`iw`) is the one Android reads back (`he`); undefined if one is none. */
function canonical(tags: string) {
  try {
    return Intl.getCanonicalLocales(tags.split(',')).join(',');
  } catch {
    return undefined;
  }
}

/**
 * An app's languages from API 33, given the app; else the whole device's, by the agent, as Settings sets them. The
 * device keeps those through a reboot, so the old value is written down like any.
 */
export class AndroidLocale {
  private sdk: number | undefined;

  constructor(
    private readonly sh: (command: string) => Promise<string>,
    /** The device's languages from the agent, set first when given. */
    private readonly device: (set?: string) => Promise<string>,
  ) {}

  private async perApp(app: string | undefined) {
    if (!app) return undefined;
    this.sdk ??= Number((await this.sh('getprop ro.build.version.sdk')).trim());
    return this.sdk >= PER_APP_SDK ? assertPkg(app) : undefined;
  }

  async get(app?: string) {
    const pkg = await this.perApp(app);
    if (!pkg) return this.device();
    const out = await this.sh(`cmd locale get-app-locales ${pkg}`);
    return /are \[([^\]]*)\]/.exec(out)?.[1] ?? '';
  }

  /** What the answer says: the whole device, where the app was meant and Android has no language of its own for it. */
  async set(value: string, app?: string): Promise<string | undefined> {
    const pkg = await this.perApp(app);
    if (pkg) {
      const out = await this.sh(`cmd locale set-app-locales ${pkg} --locales ${shq(value)}`);
      if (/Unknown|Exception|Error/.test(out))
        throw new DeviceError(
          'UNSUPPORTED',
          `this Android cannot set an app's locale: ${must(out.trim().split('\n')[0], 'a line')}`,
        );
      return;
    }
    const asked = canonical(value);
    if (!asked)
      throw new DeviceError('INVALID_ARGUMENT', `locale: a language such as tr-TR, not ${value}`);
    const now = await this.device(asked);
    const first = (tags: string) =>
      must((canonical(tags) ?? tags).split(',')[0], 'a tag').toLowerCase();
    if (first(now) !== first(asked))
      throw new DeviceError(
        'UNSUPPORTED',
        `asked for the locale ${value} and the device reads ${now}`,
      );
    return app
      ? 'the whole device: below Android 13 an app has no language of its own'
      : 'the whole device';
  }
}
