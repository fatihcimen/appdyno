import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  pause,
  TIMEOUTS,
  type AppEntry,
  type AppManager,
  type DeviceSettings,
  type LaunchOptions,
  type SettingName,
  type Startable,
  type VirtualDevices,
} from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { shq, type Adb } from './adb.js';

const PKG = /^[A-Za-z][\w]*(\.[A-Za-z][\w]*)+$/;
export const assertPkg = (p: string) => {
  if (!PKG.test(p)) throw new DeviceError('INVALID_ARGUMENT', `not a package name: ${p}`);
  return p;
};

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
  ) {}

  private sh = (c: string, ms: number = TIMEOUTS.app) =>
    this.adb.exec(this.serial, `${c} 2>&1`, { timeoutMs: ms });

  async install(path: string) {
    if (!path.endsWith('.apk') || !existsSync(path))
      throw new DeviceError('INVALID_ARGUMENT', `not a local .apk file: ${path}`);
    await this.adb.run(['-s', this.serial, 'install', '-r', path], 300_000);
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
    const out = await this.sh(`am start -W -S -n ${shq(activity)} ${extras.join(' ')}`);
    if (/^Error|Status: (?!ok)/m.test(out))
      throw new DeviceError('APP_NOT_RUNNING', `${app} did not start: ${out.split('\n')[0]}`);
  }
}

const ANIMATION_SCALES = [
  'window_animation_scale',
  'transition_animation_scale',
  'animator_duration_scale',
];

export class AndroidSettings implements DeviceSettings {
  constructor(
    private readonly adb: Adb,
    private readonly serial: string,
  ) {}

  private sh = (c: string) => this.adb.exec(this.serial, `${c} 2>&1`, { timeoutMs: TIMEOUTS.app });

  private async emu(...words: string[]) {
    if (!this.serial.startsWith('emulator-'))
      throw new DeviceError(
        'UNSUPPORTED',
        'a phone has no network shaping: only an emulator console has',
      );
    return this.adb.run(['-s', this.serial, 'emu', ...words], 30_000);
  }

  /**
   * The seam for the session's animations-off option: all three scales, on (1), off (0) or as they were
   * (three values, `null` for a scale never set).
   */
  async setAnimations(value: string) {
    const v =
      value === 'on' ? ['1', '1', '1'] : value === 'off' ? ['0', '0', '0'] : value.split(',');
    if (v.length !== 3 || v.some((x) => x !== 'null' && !/^\d+(\.\d+)?$/.test(x)))
      throw new DeviceError('INVALID_ARGUMENT', `animations: on or off, not ${value}`);
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
        if (!app)
          throw new DeviceError(
            'INVALID_ARGUMENT',
            'on Android the locale is per app (API 33+): give app; the whole device has no shell switch',
          );
        const out = await this.sh(`cmd locale get-app-locales ${assertPkg(app)}`);
        return /are \[([^\]]*)\]/.exec(out)?.[1] ?? '';
      }
      case 'network':
        await this.emu('network', 'status');
        return 'full';
    }
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
        if (!app)
          throw new DeviceError(
            'INVALID_ARGUMENT',
            'on Android the locale is per app (API 33+): give app; the whole device has no shell switch',
          );
        const out = await this.sh(
          `cmd locale set-app-locales ${assertPkg(app)} --locales ${shq(value)}`,
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
        await this.emu('network', 'speed', value === 'slow' ? 'edge' : value);
        await this.emu('network', 'delay', ...(value === 'slow' ? ['40', '100'] : ['none']));
        return;
      }
    }
  }

  /** Posted by the shell user: Android has no way to post as the app without its own code. */
  async push(_app: string | undefined, title: string, body: string) {
    const out = await this.sh(
      `cmd notification post -S bigtext -t ${shq(title)} appdyno ${shq(body)}`,
    );
    if (/Exception|Error/.test(out))
      throw new DeviceError('INTERNAL', `the notification was not posted: ${out.split('\n')[0]}`);
  }

  async biometric() {
    throw new DeviceError(
      'UNSUPPORTED',
      'biometrics are simulator only here; an emulator takes: adb emu finger touch 1',
    );
  }
}

const sdkDir = () =>
  process.env.ANDROID_HOME ??
  process.env.ANDROID_SDK_ROOT ??
  join(homedir(), 'Library/Android/sdk');

const BOOT_MS = 300_000;
/** Where the search for a free console port starts: a Mac shared with other work may keep some. */
const firstPort = () => Number(process.env.APPDYNO_EMULATOR_FIRST_PORT ?? 5554);
const LAST_PORT = 5680;

/** The AVDs of this machine, started by the SDK's own `emulator`. */
export class AndroidEmulators implements VirtualDevices {
  constructor(private readonly adb: Adb) {}

  private run(args: string[]) {
    return new Promise<string>((resolve, reject) => {
      const p = spawn(join(sdkDir(), 'emulator/emulator'), args, {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let out = '';
      p.stdout.on('data', (b) => (out += b));
      p.on('error', (e) =>
        reject(
          new DeviceError('UNSUPPORTED', `the Android emulator is not installed: ${e.message}`),
        ),
      );
      p.on('close', () => resolve(out));
    });
  }

  private async running() {
    const avds = new Map<string, string>();
    for (const d of await this.adb.devices()) {
      if (!d.serial.startsWith('emulator-')) continue;
      const name = await this.adb
        .run(['-s', d.serial, 'emu', 'avd', 'name'], 10_000)
        .catch(() => '');
      const avd = name.split(/\r?\n/)[0]?.trim();
      if (avd) avds.set(d.serial, avd);
    }
    return avds;
  }

  async startable(): Promise<Startable[]> {
    const names = (await this.run(['-list-avds']))
      .split(/\r?\n/)
      .filter((l) => /^[\w.-]+$/.test(l));
    const running = await this.running();
    const up = [...running].map(([serial, avd]) => ({
      id: serial,
      name: avd,
      state: 'running' as const,
      serial,
    }));
    const idle = names
      .filter((n) => ![...running.values()].includes(n))
      .map((n) => ({ id: n, name: n, state: 'stopped' as const }));
    return [...up, ...idle];
  }

  async boot(id: string): Promise<string> {
    if (id.startsWith('emulator-')) return id;
    const taken = new Set((await this.adb.devices()).map((d) => d.serial));
    let port = firstPort();
    while (taken.has(`emulator-${port}`) && port < LAST_PORT) port += 2;
    const serial = `emulator-${port}`;
    // APPDYNO_EMULATOR_ARGS: for instance -no-window on a machine with no screen to spare
    const extra = process.env.APPDYNO_EMULATOR_ARGS?.split(/\s+/).filter(Boolean) ?? [
      '-no-snapshot-save',
      '-no-boot-anim',
    ];
    const child = spawn(
      join(sdkDir(), 'emulator/emulator'),
      ['-avd', id, '-port', String(port), ...extra],
      {
        detached: true,
        stdio: 'ignore',
      },
    );
    let exited: number | null | undefined;
    child.on('exit', (code) => (exited = code));
    child.on('error', () => (exited = -1));
    child.unref();
    const end = Date.now() + BOOT_MS;
    while (Date.now() < end) {
      if (exited !== undefined)
        throw new DeviceError('INTERNAL', `the emulator ${id} exited at once (code ${exited})`);
      const on = (await this.adb.devices()).find((d) => d.serial === serial);
      if (on?.state === 'device') {
        const done = await this.adb.exec(serial, 'getprop sys.boot_completed').catch(() => '');
        if (done.trim() === '1') return serial;
      }
      await pause(1_000);
    }
    throw new DeviceError('TIMEOUT', `the emulator ${id} did not finish booting in ${BOOT_MS} ms`);
  }

  async shutdown(id: string) {
    if (!id.startsWith('emulator-')) return;
    await this.adb.run(['-s', id, 'emu', 'kill'], 30_000);
    const end = Date.now() + 60_000;
    while (Date.now() < end) {
      if (!(await this.adb.devices()).some((d) => d.serial === id)) return;
      await pause(500);
    }
    throw new DeviceError('TIMEOUT', `${id} did not shut down`);
  }
}
