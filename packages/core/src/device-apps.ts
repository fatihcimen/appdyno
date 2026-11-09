export type AppEntry = { id: string; name?: string; version?: string };

export type AppState = 'not_installed' | 'stopped' | 'running' | 'foreground';

export type LaunchOptions = { args?: string[]; env?: Record<string, string>; language?: string };

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
  /**
   * Installs the file; what it answered on the device along the way, for the caller to keep in its answer. `allowed`
   * refuses an app by the id the file holds, read from it before anything reaches the device.
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
  /** Installed and running; `foreground` is told by the caller, which has the screen. */
  appState(app: string): Promise<Exclude<AppState, 'foreground'>>;
  /** What the answer says, where a grant or a revoke is less than its name. */
  permission(app: string, grant: boolean, service: string): Promise<string | undefined>;
  launchWith(app: string, opts: LaunchOptions): Promise<void>;
  /** The links the installed app says it opens: its schemes, its domains, Android's filters and their verification. */
  links(app: string): Promise<AppLink[]>;
};
