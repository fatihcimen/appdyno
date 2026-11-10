import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type AppManager,
  type AppEntry,
  type BuildRequest,
  type LaunchOptions,
  must,
  run,
  TIMEOUTS,
} from '@appdyno/core';
import { DeviceError, type ErrorCode } from '@appdyno/protocol';
import { type Adb, amStartError, assertPkg, shq } from './adb.js';
import { apkNames } from './apk-names.js';
import { buildVariant } from './build.js';
import { heldForDialog } from './crashes.js';
import { androidLinks } from './links.js';
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

const DATA_MS = 600_000;

const UNINSTALL_FIRST =
  'app uninstall first takes the installed app away with all it keeps on the device, so it asks a person; nothing uninstalls it by itself';

/** `adb install`'s refusals a person can act on, by the reason it names: the code, what it means and what to do. */
const REFUSED: Record<string, [ErrorCode, string, string]> = {
  INSTALL_FAILED_UPDATE_INCOMPATIBLE: [
    'PERMISSION_REQUIRED',
    'the app on the device is signed with another key',
    `install a build signed with the installed app's key; or ${UNINSTALL_FIRST}`,
  ],
  INSTALL_FAILED_VERSION_DOWNGRADE: [
    'INVALID_ARGUMENT',
    'the file is an older version than the app on the device',
    `install a build whose versionCode is at least the installed one's; or ${UNINSTALL_FIRST}`,
  ],
  INSTALL_FAILED_INSUFFICIENT_STORAGE: [
    'UNSUPPORTED',
    'the device has no room for it',
    'a person frees space on the device (Settings, Storage), then install again',
  ],
  INSTALL_FAILED_OLDER_SDK: [
    'UNSUPPORTED',
    "the device's Android is older than the app's minSdk",
    'install it on a device with a newer Android, or build it with a lower minSdk',
  ],
  INSTALL_FAILED_NO_MATCHING_ABIS: [
    'UNSUPPORTED',
    "its native libraries are for another processor than the device's",
    "build it for the device's ABI (adb shell getprop ro.product.cpu.abilist), or install it on another device",
  ],
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
  readonly languageStays = true;

  constructor(
    private readonly adb: Adb,
    private readonly serial: string,
    private readonly screen: InstallScreen,
    private readonly answers: InstallAnswers = { prompts: true, warnings: false },
    /** What the agent knows of names; with no agent up, nothing. */
    private readonly labels: () => Promise<{ id: string; name: string }[]> = () =>
      Promise.resolve([]),
  ) {}

  private sh = (c: string, ms: number = TIMEOUTS.app) =>
    this.adb.exec(this.serial, `${c} 2>&1`, { timeoutMs: ms });

  /** Installs the file; what it answered on the phone along the way, in words for the caller to keep. */
  async install(path: string, allowed?: (app: string) => void): Promise<string[]> {
    if (!path.endsWith('.apk') || !existsSync(path))
      throw new DeviceError('INVALID_ARGUMENT', `not a local .apk file: ${path}`);
    // shortcut: the file is read for its id and then installed, so one swapped in between goes in; copy it first if that matters
    if (allowed) allowed((await apkNames(path)).id);
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
      const { message, cause } = e as Error;
      const adbSaid = `${message} ${typeof cause === 'string' ? cause : ''}`;
      if (adbSaid.includes('INSTALL_FAILED_USER_RESTRICTED'))
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
      const reason = /\bINSTALL_FAILED_\w+/.exec(adbSaid)?.[0];
      const refused = reason && REFUSED[reason];
      if (refused)
        throw new DeviceError(
          refused[0],
          `${path} was not installed: ${refused[1]} (${reason})${also}`,
          refused[2],
        );
      if (e instanceof DeviceError) throw new DeviceError(e.code, `${e.message}${also}`, e.hint);
      throw e;
    }
  }

  async buildAndInstall(request: BuildRequest) {
    const built = await buildVariant(request);
    await this.install(built.path);
    return built.id;
  }

  async uninstall(app: string) {
    success(await this.sh(`pm uninstall ${assertPkg(app)}`), `uninstall ${app}`);
  }

  async clearData(app: string) {
    success(await this.sh(`pm clear ${assertPkg(app)}`), `clear ${app}`);
  }

  /** Only a debuggable build lets a shell in, and `run-as` says why not on its output. */
  private async dataOpen(app: string) {
    const pkg = assertPkg(app);
    const said = (await this.sh(`run-as ${pkg} true`)).trim();
    if (said)
      throw new DeviceError(
        'UNSUPPORTED',
        `${pkg}'s data opens only on a debuggable build: ${said.slice(0, 200)}`,
      );
    return pkg;
  }

  /** A folder of ours on this Mac for the archive that carries an app's data, gone after. */
  private async withArchive(use: (file: string) => Promise<void>) {
    const folder = mkdtempSync(join(tmpdir(), 'appdyno-data-'));
    try {
      await use(join(folder, 'data.tar'));
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  }

  async downloadData(app: string, to: string) {
    const pkg = await this.dataOpen(app);
    const archive = await this.adb.execBuffer(
      this.serial,
      `run-as ${pkg} tar -cf - --exclude=./lib .`,
      { timeoutMs: DATA_MS },
    );
    await this.withArchive(async (file) => {
      writeFileSync(file, archive, { mode: 0o600 });
      await run('tar', ['-xf', file, '-C', to]);
    });
  }

  async replaceData(app: string, from: string) {
    const pkg = await this.dataOpen(app);
    const names = readdirSync(from);
    const remote = names.length ? `/data/local/tmp/appdyno-data-${pkg}.tar` : undefined;
    if (remote) {
      await this.withArchive(async (file) => {
        // by name, not `.`: that entry would put this folder's mode on the app's, and `run-as` then refuses it
        await run('tar', ['-cf', file, '-C', from, '--', ...names], {
          env: { ...process.env, COPYFILE_DISABLE: '1' },
        });
        await this.adb.run(['-s', this.serial, 'push', file, remote], DATA_MS);
      });
    }
    try {
      // the old data goes only once the app itself has read the new one
      if (remote) {
        const read = await this.sh(`run-as ${pkg} tar -tf ${remote} > /dev/null && echo read`);
        if (!/^read$/m.test(read))
          throw new DeviceError('INTERNAL', `${pkg} cannot read its data: ${read.slice(0, 200)}`);
      }
      await this.sh(`am force-stop ${pkg}`);
      const empty = 'find . -mindepth 1 -maxdepth 1 ! -name lib -exec rm -rf {} +';
      await this.sh(`run-as ${pkg} sh -c ${shq(empty)}`);
      const wrote = remote
        ? (await this.sh(`run-as ${pkg} tar -xf ${remote}`, DATA_MS)).trim()
        : '';
      if (wrote)
        throw new DeviceError('INTERNAL', `replacing ${pkg}'s data: ${wrote.slice(0, 200)}`);
    } finally {
      if (remote) await this.sh(`rm -f ${remote}`);
    }
  }

  async listApps(all: boolean): Promise<AppEntry[]> {
    const out = await this.sh(`pm list packages${all ? '' : ' -3'}`);
    const labels: { id: string; name: string }[] = await this.labels().catch(() => []);
    const names = new Map(labels.map((a) => [a.id, a.name]));
    return out
      .split('\n')
      .flatMap((l) => {
        if (!l.startsWith('package:')) return [];
        const id = l.slice(8).trim();
        const name = names.get(id);
        return [{ id, ...(name && { name }) }];
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async appState(app: string) {
    if (!(await this.sh(`pm path ${assertPkg(app)}`)).includes('package:')) return 'not_installed';
    return (await this.sh(`pidof ${app}`)).trim() ? 'running' : 'stopped';
  }

  async permission(app: string, grant: boolean, service: string): Promise<undefined> {
    const name = service.includes('.')
      ? service
      : `android.permission.${PERMISSIONS[service.toLowerCase()] ?? service.toUpperCase()}`;
    const out = await this.sh(`pm ${grant ? 'grant' : 'revoke'} ${assertPkg(app)} ${shq(name)}`);
    if (/Exception|Unknown|Error/.test(out))
      throw new DeviceError(
        'INVALID_ARGUMENT',
        `${name}: ${must(out.trim().split('\n')[0], 'a line')}`,
      );
  }

  links(app: string) {
    return androidLinks((c) => this.sh(c), assertPkg(app));
  }

  /** `-p` holds a link to the app named; with none, the system's own pick, `android` where it is its chooser. */
  async opener(url: string, app?: string) {
    if (app) return app;
    const out = await this.sh(
      `cmd package resolve-activity --brief -a android.intent.action.VIEW -d ${shq(url)}`,
    );
    const component = out.trim().split('\n').at(-1) ?? '';
    return component.includes('/') ? component.slice(0, component.indexOf('/')) : undefined;
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

  /** Starts the app's launcher activity and waits for it (`am start -W`). */
  async start(app: string, args: string[] = []) {
    const said = await this.sh(
      `cmd package resolve-activity --brief -c android.intent.category.LAUNCHER ${assertPkg(app)}`,
    );
    const activity = must(said.trim().split('\n').at(-1), 'a line');
    if (!activity.includes('/'))
      throw new DeviceError(
        'APP_NOT_RUNNING',
        `${app} is not installed or has no launcher activity`,
      );
    // a process held for its crash dialog takes no start (`am start -W` waited 10 s on it, the dialog still up): stopped
    // first, which takes the dialog with it, the start is a new one
    const pkg = shq(app);
    const stopHeld = `pidof ${pkg} >/dev/null && ${heldForDialog(app)} && am force-stop ${pkg}`;
    const out = await this.sh(`${stopHeld}; am start -W -n ${shq(activity)} ${args.join(' ')}`);
    const error = amStartError(out);
    if (error) throw new DeviceError('APP_NOT_RUNNING', `${app} did not start: ${error}`);
  }
}
