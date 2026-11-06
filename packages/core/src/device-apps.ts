export type AppEntry = { id: string; name?: string; version?: string };

export type AppState = 'not_installed' | 'stopped' | 'running' | 'foreground';

export type LaunchOptions = { args?: string[]; env?: Record<string, string>; language?: string };

/** A project on this Mac: `scheme` is Xcode's, or the Gradle module; `configuration` is Xcode's, or the variant. */
export type BuildRequest = { project: string; scheme?: string; configuration?: string };

/** Apps on a device; what a device cannot do answers UNSUPPORTED with the reason. */
export interface AppManager {
  /** A launch's language stays with the app, as a condition to put back; else it lasts that launch. */
  readonly languageStays?: boolean;
  /** Installs the file; what it answered on the device along the way, for the caller to keep in its answer. */
  install(path: string): Promise<string[]>;
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
  permission(app: string, grant: boolean, service: string): Promise<void>;
  launchWith(app: string, opts: LaunchOptions): Promise<void>;
}
