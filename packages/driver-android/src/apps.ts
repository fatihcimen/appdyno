import { existsSync } from 'node:fs';
import { type AppManager, TIMEOUTS, type AppEntry, type LaunchOptions } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { type Adb, amStartError, assertPkg, shq } from './adb.js';
import { apkNames } from './apk-names.js';
import {
  answerInstallPrompts,
  CONSENT_TAPPED,
  readyForInstall,
  type InstallAnswers,
  type InstallScreen,
} from './install-consent.js';

/** `pm` prints Success, or the reason, and exits 0 on some versions either way. */
const success = (out: string, what: string) => {
  if (!/^Success/m.test(out))
    throw new DeviceError('INTERNAL', `${what}: ${out.trim().slice(0, 300)}`);
};

const PERMISSIONS: Record<string, string> = {
  camera: 'CAMERA',
  microphone: 'RECORD_AUDIO',
  location: 'ACCESS_FINE_LOCATION',
  contacts: 'READ_CONTACTS',
  notifications: 'POST_NOTIFICATIONS',
  photos: 'READ_MEDIA_IMAGES',
};

export class AndroidApps implements AppManager {
  constructor(
    private readonly adb: Adb,
    private readonly serial: string,
    private readonly screen: InstallScreen,
    private readonly answers: InstallAnswers = { prompts: true, warnings: false },
  ) {}

  private sh = (c: string, ms: number = TIMEOUTS.app) =>
    this.adb.exec(this.serial, `${c} 2>&1`, { timeoutMs: ms });

  /** Installs the file; what it answered on the phone along the way, in words for the caller to keep. */
  async install(path: string): Promise<string[]> {
    if (!path.endsWith('.apk') || !existsSync(path))
      throw new DeviceError('INVALID_ARGUMENT', `not a local .apk file: ${path}`);
    const { screen, answers } = this;
    if (answers.prompts) await readyForInstall(screen);
    // a Xiaomi asks on its screen, and asleep it would not say no by itself
    else await this.sh('input keyevent KEYCODE_WAKEUP');
    const said: string[] = [];
    const stop = new AbortController();
    let pending = true;
    const installing = this.adb
      .run(['-s', this.serial, 'install', '-r', path], 300_000, stop.signal)
      .finally(() => (pending = false));
    // settles only by refusing: an install that ends waits for no last look at the phone
    const refusal = new Promise<never>((_, refuse) => {
      if (answers.prompts)
        answerInstallPrompts(
          screen,
          () => apkNames(path),
          answers.warnings,
          () => pending,
          said,
        ).catch(refuse);
    });
    try {
      await Promise.race([installing, refusal]);
      return said;
    } catch (e) {
      stop.abort();
      const also = said.length > 0 ? `. ${said.join('. ')}` : '';
      if (/INSTALL_FAILED_USER_RESTRICTED/.test((e as Error).message))
        throw said.some((s) => s.includes(CONSENT_TAPPED))
          ? new DeviceError(
              'PERMISSION_REQUIRED',
              `the phone said no to the install over USB though its prompt was tapped${also}`,
              'the system can block injected touches on that window: see "USB debugging (Security settings)" in Developer options, or answer it on the phone within 10 s',
            )
          : new DeviceError(
              'PERMISSION_REQUIRED',
              `the phone asked on its screen whether to install over USB, and no one said yes in time${also}`,
              'install again and answer it on the phone within 10 s; ticking its remember box stops it asking',
            );
      if (e instanceof DeviceError) throw new DeviceError(e.code, `${e.message}${also}`, e.hint);
      throw e;
    }
  }

  async uninstall(app: string) {
    success(await this.sh(`pm uninstall ${assertPkg(app)}`), `uninstall ${app}`);
  }

  async clearData(app: string) {
    success(await this.sh(`pm clear ${assertPkg(app)}`), `clear ${app}`);
  }

  async listApps(all: boolean): Promise<AppEntry[]> {
    const out = await this.sh(`pm list packages${all ? '' : ' -3'}`);
    return out
      .split('\n')
      .flatMap((l) => (l.startsWith('package:') ? [{ id: l.slice(8).trim() }] : []))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async appState(app: string) {
    if (!(await this.sh(`pm path ${assertPkg(app)}`)).includes('package:')) return 'not_installed';
    return (await this.sh(`pidof ${app}`)).trim() ? 'running' : 'stopped';
  }

  async permission(app: string, grant: boolean, service: string) {
    const name = service.includes('.')
      ? service
      : `android.permission.${PERMISSIONS[service.toLowerCase()] ?? service.toUpperCase()}`;
    const out = await this.sh(`pm ${grant ? 'grant' : 'revoke'} ${assertPkg(app)} ${shq(name)}`);
    if (/Exception|Unknown|Error/.test(out))
      throw new DeviceError('INVALID_ARGUMENT', `${name}: ${out.trim().split('\n')[0]}`);
  }

  async launchWith(app: string, opts: LaunchOptions) {
    if (opts.env && Object.keys(opts.env).length > 0)
      throw new DeviceError(
        'UNSUPPORTED',
        'an Android app is not started with an environment: give args, which become intent extras',
      );
    const extras = (opts.args ?? []).map((a) => {
      const eq = a.indexOf('=');
      if (eq < 1)
        throw new DeviceError('INVALID_ARGUMENT', `an Android launch argument is key=value: ${a}`);
      return `--es ${shq(a.slice(0, eq))} ${shq(a.slice(eq + 1))}`;
    });
    await this.start(app, ['-S', ...extras]);
  }

  /** Starts the app's launcher activity and waits for it (`am start -W`); returns its output. */
  async start(app: string, args: string[] = []): Promise<string> {
    const activity = (
      await this.sh(
        `cmd package resolve-activity --brief -c android.intent.category.LAUNCHER ${assertPkg(app)}`,
      )
    )
      .trim()
      .split('\n')
      .pop()!;
    if (!activity.includes('/'))
      throw new DeviceError(
        'APP_NOT_RUNNING',
        `${app} is not installed or has no launcher activity`,
      );
    const out = await this.sh(`am start -W -n ${shq(activity)} ${args.join(' ')}`);
    const error = amStartError(out);
    if (error) throw new DeviceError('APP_NOT_RUNNING', `${app} did not start: ${error}`);
    return out;
  }
}
