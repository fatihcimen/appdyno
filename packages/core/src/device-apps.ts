import type { Owner } from './owner.js';

export type AppEntry = { id: string; name?: string; version?: string };

export type AppState = 'not_installed' | 'stopped' | 'running' | 'foreground';

/** What to do about an app a device does not have, as each platform refuses one. */
export const INSTALLED_APPS = 'manage_app list names the installed apps';

/** `probe`: the view probe in the app, which `Device.views` reads, held in this tool's later launches of it too. */
export type LaunchOptions = {
  args?: string[];
  env?: Record<string, string>;
  language?: string;
  probe?: boolean;
};

/**
 * What each launch of an app by this tool carries until it is let go, kept on this Mac as a condition is: a probe held
 * in the app. A launch made elsewhere carries none.
 */
export type LaunchHolds = {
  /** Who answers for what is held from now: a session's owner; none, a command line's, holds until restore. */
  owner: Owner | undefined;
  /** Who holds what launches carry, where anything is held. */
  holder(): { owner?: Owner | undefined } | undefined;
  /**
   * What launches carried, let go, each named: a probe stays in its app until the app next starts. `capturing`: the app
   * of a network capture that still runs, whose probe stays held with no holder to answer for it, as the capture's stop
   * lets it go.
   */
  letGo(capturing?: string): string[];
};

/**
 * A link an installed app opens: one of its URL schemes, a domain it opens web links of (an App Link's, with Android's
 * verification `state`), or an Android filter, as `scheme://host/path` with `*` for a path's rest.
 */
export type AppLink = { url: string; kind: 'scheme' | 'domain' | 'filter'; state?: string };

/** A project on this Mac: `scheme` is Xcode's, or the Gradle module; `configuration` is Xcode's, or the variant. */
export type BuildRequest = { project: string; scheme?: string; configuration?: string };

/** Apps on a device; what a device cannot do answers UNSUPPORTED with the reason. */
export type AppManager = {
  /** A launch's language stays with the app, as a condition to put back; else it lasts that launch. */
  readonly languageStays?: boolean;
  /** A grant resets the permission to ask, as a revoke does, and so takes away the answer the person gave. */
  readonly grantResets?: boolean;
  /** A launch can put the view probe in the app: `LaunchOptions.probe`. */
  readonly viewProbe?: boolean;
  /**
   * Installs the file; what it answered on the device along the way, for the caller to keep in its answer. `allowed`
   * is told the id the file holds, read from it before anything reaches the device, and refuses an app by throwing.
   */
  install(path: string, allowed?: (app: string) => void): Promise<string[]>;
  /** Builds a project for this device and installs it; the app's id. */
  buildAndInstall(request: BuildRequest): Promise<string>;
  uninstall(app: string): Promise<void>;
  clearData(app: string): Promise<void>;
  /** The app's data, into an empty folder on this Mac. */
  downloadData(app: string, to: string): Promise<void>;
  /** The folder's content becomes the app's data, with the app stopped. */
  replaceData(app: string, from: string): Promise<void>;
  listApps(all: boolean): Promise<AppEntry[]>;
  /** The installed app's version and build, where one read tells them: else `listApps` has the version. */
  appInfo?(app: string): Promise<{ version?: string; build?: string }>;
  /** Installed and running; `foreground` is told by the caller, which has the screen. */
  appState(app: string): Promise<Exclude<AppState, 'foreground'>>;
  /** What the answer says, where a grant or a revoke is less than its name. */
  permission(app: string, grant: boolean, service: string): Promise<string | undefined>;
  launchWith(app: string, opts: LaunchOptions): Promise<void>;
  /** The links the installed app says it opens: its schemes, its domains, Android's filters and their verification. */
  links(app: string): Promise<AppLink[]>;
  /**
   * The app `openUrl(url, app)` opens a link in, as the device tells before it is sent; undefined where it cannot tell,
   * or no app would.
   */
  opener(url: string, app?: string): Promise<string | undefined>;
};
