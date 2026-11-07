import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type AppManager,
  type AppEntry,
  type BuildRequest,
  type LaunchOptions,
  run,
  TIMEOUTS,
} from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { type Adb, amStartError, assertPkg, shq } from './adb.js';
import { apkNames } from './apk-names.js';
import { buildVariant } from './build.js';
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
    private readonly labels: () => Promise<{ id: string; name: string }[]> = async () => [],
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

  async permission(app: string, grant: boolean, service: string) {
    const name = service.includes('.')
      ? service
      : `android.permission.${PERMISSIONS[service.toLowerCase()] ?? service.toUpperCase()}`;
    const out = await this.sh(`pm ${grant ? 'grant' : 'revoke'} ${assertPkg(app)} ${shq(name)}`);
    if (/Exception|Unknown|Error/.test(out))
      throw new DeviceError('INVALID_ARGUMENT', `${name}: ${out.trim().split('\n')[0]}`);
  }

  links(app: string) {
    return androidLinks((c) => this.sh(c), assertPkg(app));
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
  }
}
