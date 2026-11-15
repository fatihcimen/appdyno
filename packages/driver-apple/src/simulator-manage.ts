import { cpSync, existsSync, readdirSync, rmSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type AppManager,
  type BuildRequest,
  type AppEntry,
  run,
  type LaunchOptions,
} from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { buildScheme } from './build.js';
import { opens, simulatorLinks } from './sim-links.js';
import { type Simctl, assertBundle } from './simctl.js';
import { DATA_FOLDERS, installingApp } from './manage.js';
import { SimulatorViews } from './sim-views.js';

const copyFolders = (from: string, to: string) => {
  for (const dir of DATA_FOLDERS) {
    if (existsSync(join(from, dir)))
      cpSync(join(from, dir), join(to, dir), { recursive: true, verbatimSymlinks: true });
  }
};

/** What `simctl privacy` takes in Xcode 26 and 27, by its help: a newer one may take more, which go to it as given. */
const PRIVACY_SERVICES = [
  'all',
  'calendar',
  'contacts-limited',
  'contacts',
  'location',
  'location-always',
  'photos-add',
  'photos',
  'media-library',
  'microphone',
  'motion',
  'reminders',
  'siri',
];

export class SimulatorApps implements AppManager {
  readonly viewProbe = true;

  constructor(
    private readonly simctl: Simctl,
    private readonly udid: string,
    private readonly views = new SimulatorViews(simctl, udid),
    /** The app a launch with options started, as the device's plain launch names it: the app reads take from then on. */
    private readonly started: (app: string) => Promise<void> = () => Promise.resolve(),
  ) {}

  async install(path: string, allowed?: (app: string) => void) {
    await installingApp(
      path,
      'iPhoneSimulator',
      (app) => this.simctl.install(this.udid, app),
      allowed,
    );
    return [];
  }

  async buildAndInstall(request: BuildRequest) {
    const built = await buildScheme(request, `platform=iOS Simulator,id=${this.udid}`);
    await this.install(built.path);
    return built.bundle;
  }

  async uninstall(app: string) {
    await this.simctl.exec(['uninstall', this.udid, assertBundle(app)], 120_000);
  }

  private async container(app: string) {
    const data = (
      await this.simctl.exec(['get_app_container', this.udid, assertBundle(app), 'data'])
    ).trim();
    if (!data.includes(`/Devices/${this.udid}/`))
      throw new DeviceError('INTERNAL', `unexpected data container: ${data}`);
    return data;
  }

  /** No tool does this: the app's data container is emptied while it is stopped. */
  async clearData(app: string) {
    await this.simctl.terminate(this.udid, app);
    const data = await this.container(app);
    // its preferences are also held in memory, and would come back at the next launch
    await this.simctl.exec(['spawn', this.udid, 'defaults', 'delete', app]).catch(() => undefined);
    for (const dir of DATA_FOLDERS) {
      const base = join(data, dir);
      if (!existsSync(base)) continue;
      for (const f of readdirSync(base)) rmSync(join(base, f), { recursive: true, force: true });
    }
  }

  async downloadData(app: string, to: string) {
    copyFolders(await this.container(app), to);
  }

  async replaceData(app: string, from: string) {
    await this.clearData(app);
    copyFolders(from, await this.container(app));
  }

  async listApps(all: boolean): Promise<AppEntry[]> {
    const plist = await this.simctl.exec(['listapps', this.udid]);
    const dir = mkdtempSync(join(tmpdir(), 'appdyno-apps-'));
    try {
      const file = join(dir, 'apps.plist');
      writeFileSync(file, plist);
      const { stdout } = await run('plutil', ['-convert', 'json', '-o', '-', file], {
        maxBuffer: 64 * 1024 * 1024,
      });
      const apps = JSON.parse(stdout) as Record<
        string,
        {
          ApplicationType?: string;
          CFBundleDisplayName?: string;
          CFBundleName?: string;
          CFBundleShortVersionString?: string;
        }
      >;
      return Object.entries(apps)
        .filter(([, a]) => all || a.ApplicationType === 'User')
        .map(([id, a]) => {
          const name = a.CFBundleDisplayName ?? a.CFBundleName;
          return {
            id,
            ...(name && { name }),
            ...(a.CFBundleShortVersionString && { version: a.CFBundleShortVersionString }),
          };
        })
        .sort((a, b) => a.id.localeCompare(b.id));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  async appState(app: string) {
    const installed = await this.simctl
      .exec(['get_app_container', this.udid, assertBundle(app)])
      .then(
        () => true,
        (e: unknown) => {
          // a look that ran out of time or was stopped tells nothing of the app
          if (e instanceof DeviceError && ['TIMEOUT', 'CANCELLED'].includes(e.code)) throw e;
          return false;
        },
      );
    if (!installed) return 'not_installed';
    return (await this.simctl.running(this.udid, app)) ? 'running' : 'stopped';
  }

  async permission(app: string, grant: boolean, service: string): Promise<undefined> {
    await this.simctl
      .privacy(this.udid, grant ? 'grant' : 'revoke', service, app)
      .catch((e: unknown) => {
        // simctl's own refusal of a word it does not know names nothing it takes
        if (PRIVACY_SERVICES.includes(service)) throw e;
        throw new DeviceError(
          'INVALID_ARGUMENT',
          `no service ${service} on a simulator: ${PRIVACY_SERVICES.join(', ')}`,
        );
      });
  }

  links(app: string) {
    return simulatorLinks(this.simctl, this.udid, app);
  }

  /**
   * A simulator opens a link in whichever app owns it: the app named, where its scheme or its domain is one the app
   * says it opens, and else none this can tell.
   * shortcut: a domain the app names opens in it once iOS has verified the site's file, and in Safari before; read
   * which opened, if a site that is not verified must be told apart
   */
  async opener(url: string, app?: string) {
    if (!app) return undefined;
    return (await this.links(app)).some((l) => opens(l, url)) ? app : undefined;
  }

  async launchWith(app: string, { probe, ...own }: LaunchOptions) {
    await (probe ? this.views.launch(app, own) : this.simctl.restart(this.udid, app, own));
    await this.started(app);
  }
}
