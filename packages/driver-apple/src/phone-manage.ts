import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PUSH_TYPES } from '@appdyno/core';
import type {
  AppManager,
  Push,
  PushRoute,
  PushTokenKind,
  BuildRequest,
  AppEntry,
  BiometricAnswer,
  LaunchOptions,
  DeviceEvent,
  DeviceEvents,
  DeviceSettings,
  SettingName,
} from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { ApnsPush } from './apns-push.js';
import { buildScheme } from './build.js';
import { PhoneConditions } from './phone-conditions.js';
import type { PhoneStreamModule } from './phone-stream-port.js';
import type { Devicectl } from './devicectl.js';
import { PhoneApnsTarget, readBuild, type PhoneBuild } from './phone-apns.js';
import { assertBundle } from './simctl.js';
import {
  DATA_FOLDERS,
  appLanguage,
  heldSize,
  holdAppLanguage,
  installingApp,
  launchLanguage,
  on,
  textSize,
} from './manage.js';

const PHONE_CANNOT = {
  push: "a real iPhone takes a push only from Apple's servers, once a person sets APNs up with `appdyno push setup apns`: else open the app's deep link, or push to a simulator",
  tapped: 'nothing taps a push on an iPhone but a person: push an alert, and a person taps it',
  // seen on one iPhone with no face enrolled: `devicectl device simulate biometrics` says so and exits 0, so it proves nothing
  biometric:
    'an iPhone takes biometrics only from a person: devicectl reads it as supporting no simulation',
  keychain: "an iPhone's keychain is emptied only by erasing it",
  fold: 'an iPhone folds only in a hand',
  call: 'an iPhone takes calls only from the network',
  sms: 'an iPhone takes messages only from the network',
} as const;

const DATA_MS = 600_000;

export class PhoneApps implements AppManager {
  // the system's reset of an authorization is the only way a grant is made here
  readonly grantResets = true;

  constructor(
    private readonly ctl: Devicectl,
    /** What this tool read of each build it installed, for APNs. */
    private readonly builds = new Map<string, PhoneBuild>(),
    /** The runner's reset of what an app was answered for a protected resource. */
    private readonly resetPermission: (app: string, service: string) => Promise<void> = () =>
      Promise.reject(new DeviceError('UNSUPPORTED', 'no runner to reset a permission')),
  ) {}

  async install(path: string, allowed?: (app: string) => void) {
    await installingApp(
      path,
      'iPhoneOS',
      async (app) => {
        // an installed app's signing is not read on an iPhone: only the build's, here
        const read = await readBuild(app).catch(() => undefined);
        await this.ctl.install(app);
        if (read) this.builds.set(...read);
      },
      allowed,
    );
    return [];
  }

  async buildAndInstall(request: BuildRequest) {
    const built = await buildScheme(request, `id=${this.ctl.udid}`);
    await this.install(built.path);
    return built.bundle;
  }

  async uninstall(app: string) {
    await this.ctl.json(
      ['device', 'uninstall', 'app', '--device', this.ctl.udid, assertBundle(app)],
      120_000,
    );
  }

  /** An empty container in its place: development-signed apps alone, as for a replace. */
  async clearData(app: string) {
    const empty = mkdtempSync(join(tmpdir(), 'appdyno-empty-'));
    try {
      for (const dir of DATA_FOLDERS) mkdirSync(join(empty, dir));
      await this.replaceData(app, empty);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  }

  private copy(way: 'from' | 'to', app: string, paths: string[]) {
    return this.ctl.json(
      [
        'device',
        'copy',
        way,
        '--device',
        this.ctl.udid,
        '--domain-type',
        'appDataContainer',
        '--domain-identifier',
        assertBundle(app),
        ...paths,
      ],
      DATA_MS,
    );
  }

  async downloadData(app: string, to: string) {
    for (const dir of DATA_FOLDERS) {
      // the tool fails on an empty folder unless the place for it is there
      mkdirSync(join(to, dir));
      await this.copy('from', app, ['--source', dir, '--destination', join(to, dir)]);
    }
  }

  /** One copy of the whole folder: the tool's removal takes the whole container, so a copy per folder keeps only the last. */
  async replaceData(app: string, from: string) {
    await this.ctl.terminate(app);
    await this.copy('to', app, [
      '--source',
      from,
      '--destination',
      '.',
      '--remove-existing-content',
      'true',
    ]);
  }

  async listApps(all: boolean): Promise<AppEntry[]> {
    const j = await this.ctl.json([
      'device',
      'info',
      'apps',
      '--device',
      this.ctl.udid,
      ...(all ? ['--include-all-apps'] : []),
    ]);
    const apps =
      (
        j.result as
          { apps?: { bundleIdentifier: string; name?: string; version?: string }[] } | undefined
      )?.apps ?? [];
    return apps.map((a) => ({
      id: a.bundleIdentifier,
      ...(a.name && { name: a.name }),
      ...(a.version && { version: a.version }),
    }));
  }

  async appState(app: string) {
    if (!(await this.ctl.app(app))) return 'not_installed';
    return (await this.ctl.pids(app)).length > 0 ? 'running' : 'stopped';
  }

  /** iOS has no grant: the answer is forgotten, so that the app asks again and `alert` answers it. */
  async permission(app: string, grant: boolean, service: string) {
    await this.resetPermission(assertBundle(app), service);
    return `${service} for ${app} is reset to ask: when the app asks, alert ${grant ? 'allow' : 'deny'}`;
  }

  /** An iPhone's link opens in the app it is sent to, by `devicectl`, and in none without one. */
  opener(_url: string, app?: string) {
    return Promise.resolve(app);
  }

  links(): Promise<never> {
    return Promise.reject(
      new DeviceError(
        'UNSUPPORTED',
        "an iPhone's installed app is not read from here: list the links of its build on a simulator",
      ),
    );
  }

  async launchWith(app: string, opts: LaunchOptions) {
    await this.ctl.json([
      'device',
      'process',
      'launch',
      '--device',
      this.ctl.udid,
      '--terminate-existing',
      ...(opts.env ? ['--environment-variables', JSON.stringify(opts.env)] : []),
      assertBundle(app),
      // what starts with a dash is the app's, not this tool's
      '--',
      ...launchLanguage(this.ctl.udid, app, opts.language),
      ...(opts.args ?? []),
    ]);
  }
}

/** What `devicectl` has a word for. */
const APPEARANCE: ReadonlySet<SettingName> = new Set<SettingName>([
  'dark_mode',
  'text_size',
  'reduce_motion',
  'increase_contrast',
  'reduce_transparency',
]);

/** `devicectl` shows "Extra Large" where it is told extra-large. */
export const phoneTextSize = (shown: string) => shown.trim().toLowerCase().replace(/\s+/g, '-');

const noSwitch = (name: SettingName) =>
  new DeviceError(
    'UNSUPPORTED',
    name === 'fold' ? PHONE_CANNOT.fold : `an iPhone has no ${name} switch this tool can reach`,
  );

/** A phone's appearance through `devicectl`; what it has no switch for says so. */
export class PhoneSettings implements DeviceSettings {
  private readonly conditions: PhoneConditions;

  constructor(
    private readonly ctl: Devicectl,
    load?: () => Promise<PhoneStreamModule | undefined>,
  ) {
    this.conditions = new PhoneConditions(ctl.udid, load);
  }

  /** An iPhone's own language is the phone's: an app's is held for the launches this tool makes. */
  private appOf(app: string | undefined) {
    if (!app)
      throw new DeviceError(
        'UNSUPPORTED',
        "an iPhone's language is set on the phone: give app, held for its launches by this tool",
      );
    return assertBundle(app);
  }

  private appearance(...words: string[]) {
    return this.ctl.json(['device', 'settings', 'appearance', '--device', this.ctl.udid, ...words]);
  }

  async get(name: SettingName, app?: string): Promise<string> {
    if (name === 'locale') return appLanguage(this.ctl.udid, this.appOf(app));
    if (name === 'network' || name === 'thermal') return this.conditions.get(name);
    if (!APPEARANCE.has(name)) throw noSwitch(name);
    const j = await this.ctl.json(['device', 'info', 'appearance', '--device', this.ctl.udid]);
    const a = (j.result ?? {}) as {
      userInterfaceStyle?: string;
      textSize?: string;
      reduceMotion?: { enabled?: boolean };
      increaseContrast?: { enabled?: boolean };
      reduceTransparency?: { enabled?: boolean };
    };
    if (name === 'dark_mode') return a.userInterfaceStyle ?? '';
    if (name === 'text_size') return phoneTextSize(a.textSize ?? '');
    const flags = {
      reduce_motion: a.reduceMotion,
      increase_contrast: a.increaseContrast,
      reduce_transparency: a.reduceTransparency,
    };
    return flags[name as keyof typeof flags]?.enabled ? 'on' : 'off';
  }

  async set(name: SettingName, value: string, app?: string): Promise<string | undefined> {
    if (name === 'locale') {
      const bundle = this.appOf(app);
      return holdAppLanguage(this.ctl.udid, bundle, value, async () => {
        if ((await this.ctl.pids(bundle)).length === 0) return;
        await this.ctl.terminate(bundle);
        await this.ctl.launch(bundle);
      });
    }
    if (name === 'network' || name === 'thermal') return this.conditions.set(name, value);
    if (name === 'dark_mode') await this.appearance('--mode', on(value, 'dark', 'light'));
    else if (name === 'text_size') {
      await this.appearance('--text-size', textSize(value));
      heldSize(value, await this.get('text_size'));
    } else if (name === 'reduce_motion') await this.appearance('--reduce-motion', value);
    else if (name === 'increase_contrast') await this.appearance('--increase-contrast', value);
    else if (name === 'reduce_transparency') await this.appearance('--reduce-transparency', value);
    else throw noSwitch(name);
  }
}

/** An iPhone's one-time events: a push by APNs, once a person sets it up; for each other, why not. */
export class PhoneEvents implements DeviceEvents {
  private readonly target: PhoneApnsTarget;
  private readonly apns: ApnsPush;

  constructor(ctl: Devicectl, builds: Map<string, PhoneBuild>) {
    this.target = new PhoneApnsTarget(ctl, builds);
    this.apns = new ApnsPush(this.target);
  }

  pushRoutes(): Promise<PushRoute[]> {
    return new Promise((resolve) => {
      const byApns = this.apns.routes();
      resolve(
        PUSH_TYPES.map(
          (type) =>
            // APNs, once set up, takes every type but a tap
            byApns.find((r) => r.type === type) ?? {
              type,
              why: byApns.length === 0 ? PHONE_CANNOT.push : PHONE_CANNOT.tapped,
            },
        ),
      );
    });
  }

  async push(app: string, push: Push): Promise<string> {
    const route = (await this.pushRoutes()).find((r) => r.type === push.type);
    if (!route || 'why' in route) throw new DeviceError('UNSUPPORTED', route?.why ?? push.type);
    return this.apns.push(app, push);
  }

  pushToken(app: string, token: string, kind?: PushTokenKind) {
    this.apns.typed(app, token, kind);
  }

  /** Lets go of each app's console followed for its tokens. */
  close() {
    this.target.close();
  }

  biometric(_answer: BiometricAnswer): Promise<undefined> {
    return Promise.reject(new DeviceError('UNSUPPORTED', PHONE_CANNOT.biometric));
  }

  resetKeychain(): Promise<number> {
    return Promise.reject(new DeviceError('UNSUPPORTED', PHONE_CANNOT.keychain));
  }

  cannot(event: DeviceEvent) {
    return PHONE_CANNOT[event];
  }

  call(): Promise<void> {
    return Promise.reject(new DeviceError('UNSUPPORTED', PHONE_CANNOT.call));
  }

  sms(): Promise<void> {
    return Promise.reject(new DeviceError('UNSUPPORTED', PHONE_CANNOT.sms));
  }
}
