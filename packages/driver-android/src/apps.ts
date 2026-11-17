import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
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
import { type Adb, amStartError, assertPkg, launcherArg, shq } from './adb.js';
import { apkId, apkNames } from './apk-names.js';
import { buildVariant } from './build.js';
import { stopIfHeld } from './crashes.js';
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
  'uninstalling it first takes the installed app away with all it keeps on the device, so it asks a person; nothing uninstalls it by itself';

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

/** What the device says of a `.dm` it cannot load, as a warning before Android 17 and as its refusal from it. */
const WRONG_PROFILE = 'The profile is in the wrong format';

const INSTALLED = /^(Success|Completed with warning\(s\))$/;

/** What the device warned of, in its own words, where it says after it that it installed the app all the same. */
const warningOf = (out: string) => {
  const at = out.search(/^Warning\b/m);
  const lines = out
    .slice(at)
    .split('\n')
    .map((l) => l.trim());
  if (at < 0 || !lines.some((l) => INSTALLED.test(l))) return undefined;
  return lines
    .filter((l) => l && !INSTALLED.test(l))
    .join(' ')
    .replace(/^Warning:?\s*/, '');
};

const PERMISSIONS: Record<string, string> = {
  camera: 'CAMERA',
  microphone: 'RECORD_AUDIO',
  location: 'ACCESS_FINE_LOCATION',
  contacts: 'READ_CONTACTS',
  notifications: 'POST_NOTIFICATIONS',
  photos: 'READ_MEDIA_IMAGES',
};

/** What a start prints after `am start` where the app has no process then. */
const NO_PROCESS = 'Process: none';

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

  /**
   * Installs the file, or one app's APKs and `.dm` files together; what it answered on the phone along the way, and
   * what the device warned of, in words for the caller to keep.
   */
  async install(path: string | string[], allowed?: (app: string) => void): Promise<string[]> {
    const files = [path].flat();
    const what = files.join(' with ');
    const apks = files.filter((f) => f.endsWith('.apk'));
    for (const f of files)
      if (!(files.length > 1 ? /\.(apk|dm)$/ : /\.apk$/).test(f) || !existsSync(f))
        throw new DeviceError(
          'INVALID_ARGUMENT',
          `not a local .apk${files.length > 1 ? ' or .dm' : ''} file: ${f}`,
        );
    // the device takes a .dm only beside the APK of its name, and installs the app without it otherwise
    const stems = new Set(apks.map((f) => basename(f, '.apk')));
    const lone = files.find((f) => f.endsWith('.dm') && !stems.has(basename(f, '.dm')));
    if (lone)
      throw new DeviceError(
        'INVALID_ARGUMENT',
        `${lone} has no APK of its name among the files: the device takes a .dm only beside ${basename(lone, '.dm')}.apk, and drops it otherwise`,
        'give it with the APK it was built for, under the names the build gave them',
      );
    // shortcut: the files are read for their id and then installed, so one swapped in between goes in; copy them first if that matters
    const ids = await Promise.all(apks.map(apkId));
    const id = must(ids[0], 'an APK');
    if (ids.some((x) => x !== id))
      throw new DeviceError(
        'INVALID_ARGUMENT',
        `the files are of different apps: ${apks.map((f, i) => `${f} is ${String(ids[i])}`).join(', ')}`,
        "one install takes one app's APKs and .dm files: install each app by itself",
      );
    if (allowed) allowed(id);
    const { screen, answers } = this;
    if (answers.prompts) await readyForInstall(screen);
    // a Xiaomi asks on its screen, and asleep it would not say no by itself
    else await this.sh('input keyevent KEYCODE_WAKEUP');
    const said: string[] = [];
    const stop = new AbortController();
    let pending = true;
    const installing = this.adb
      .run(
        [
          '-s',
          this.serial,
          ...(files.length > 1 ? ['install-multiple'] : ['install']),
          '-r',
          ...files,
        ],
        300_000,
        stop.signal,
      )
      // adb 37 exits 1 where the device installed the app and warned
      .catch((e: unknown) => {
        const { cause } = e as Error;
        if (typeof cause === 'string' && warningOf(cause)) return cause;
        throw e;
      })
      .then((out) => {
        const warned = warningOf(out);
        if (warned) said.push(`the device installed it and warned: ${warned}`);
      })
      .finally(() => (pending = false));
    // settles only by refusing: an install that ends waits for no last look at the phone
    const refusal = new Promise<never>((_, refuse) => {
      if (answers.prompts)
        answerInstallPrompts(
          screen,
          // a split APK has no label of its own: the base one's is among these
          async () => {
            const all = await Promise.all(apks.map(apkNames));
            return { id, names: [...new Set(all.flatMap((n) => n.names))] };
          },
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
          `${what} was not installed: ${refused[1]} (${reason})${also}`,
          refused[2],
        );
      // Android 17 refuses a .dm for another range of API, where an older one installs the app and compiles nothing
      if (adbSaid.includes(WRONG_PROFILE))
        throw new DeviceError(
          'INVALID_ARGUMENT',
          `${what} was not installed: the device cannot load the profile its .dm holds ("${WRONG_PROFILE}"), as one made for another range of API${also}`,
          "install the .dm made for this device's API: a build's baselineProfiles folder holds one for each range",
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
    // an app with two launcher activities, as LeakCanary adds one, is named by the first, its own, which `start` starts
    const names = new Map(labels.toReversed().map((a) => [a.id, a.name]));
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

  async appInfo(app: string) {
    const out = await this.sh(`dumpsys package ${assertPkg(app)}`);
    const version = /versionName=(\S+)/.exec(out)?.[1];
    const build = /versionCode=(\d+)/.exec(out)?.[1];
    return { ...(version && { version }), ...(build && { build }) };
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
    const activity = await launcherArg((c) => this.sh(c), app);
    const pkg = shq(app);
    const out = await this.sh(
      `${stopIfHeld(app)}; am start -W ${activity} ${args.join(' ')} 2>&1; pidof ${pkg} >/dev/null || echo '${NO_PROCESS}'`,
    );
    const error = amStartError(out);
    if (error) throw new DeviceError('APP_NOT_RUNNING', `${app} did not start: ${error}`);
    // another app's window at the top of the app's task, as a permission prompt the app's end left there, is what a
    // start brings to the front: the app gets no process, and that read as its death
    const front = /^Activity: ([^/\s]+)\//m.exec(out)?.[1];
    if (front && front !== app && out.includes(NO_PROCESS))
      throw new DeviceError(
        'APP_NOT_RUNNING',
        `${app} did not start: the start brought ${front} to the front, whose window was left in the app's task when the app ended`,
        'screen reads that window: once it is answered or closed, the app starts',
      );
  }
}
