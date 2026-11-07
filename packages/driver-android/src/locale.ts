import { DeviceError } from '@appdyno/protocol';
import { assertPkg, shq } from './adb.js';

/** Where an app has languages of its own, by `cmd locale`. */
const PER_APP_SDK = 33;
const TAGS = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*(,[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*)*$/;

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

  async set(value: string, app?: string) {
    const pkg = await this.perApp(app);
    if (pkg) {
      const out = await this.sh(`cmd locale set-app-locales ${pkg} --locales ${shq(value)}`);
      if (/Unknown|Exception|Error/.test(out))
        throw new DeviceError(
          'UNSUPPORTED',
          `this Android cannot set an app's locale: ${out.trim().split('\n')[0]}`,
        );
      return;
    }
    if (!TAGS.test(value))
      throw new DeviceError('INVALID_ARGUMENT', `locale: a language such as tr-TR, not ${value}`);
    const now = await this.device(value);
    const first = (tags: string) => tags.split(',')[0]!.toLowerCase();
    if (first(now) !== first(value))
      throw new DeviceError(
        'UNSUPPORTED',
        `asked for the locale ${value} and the device reads ${now}`,
      );
  }
}
