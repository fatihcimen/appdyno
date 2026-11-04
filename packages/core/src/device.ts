import type {
  SettleInput,
  Read,
  Tree,
  Hello,
  ActParams,
  ActResult,
  Point,
  Key,
  TextResult,
  ParamsOf,
  ResultOf,
  AuditType,
  AuditResult,
  Platform,
} from '@appdyno/protocol';
import type { MeasureSource, TraceDigest } from './measure.js';
import type { PlatformScreen } from './screen/port.js';
import type { Mirror } from './mirror/port.js';

/** Per-command limits (ms); the settle cap is added to an action's. */
export const TIMEOUTS = {
  hello: 10_000,
  action: 15_000,
  text: 30_000,
  read: 15_000,
  screenshot: 30_000,
  app: 60_000,
  /** The iOS platform audit takes seconds on a busy screen: a stuck-runner restart must not cut it. */
  audit: 30_000,
} as const;

export type ActOptions = { settle?: SettleInput | false; read?: Read; before?: string };

export type AppEntry = { id: string; name?: string; version?: string };

export type AppState = 'not_installed' | 'stopped' | 'running' | 'foreground';

export type LaunchOptions = { args?: string[]; env?: Record<string, string> };

/** Apps on a device; what a device cannot do answers UNSUPPORTED with the reason. */
export interface AppManager {
  /** Installs the file; what it answered on the device along the way, for the caller to keep in its answer. */
  install(path: string): Promise<string[]>;
  uninstall(app: string): Promise<void>;
  clearData(app: string): Promise<void>;
  listApps(all: boolean): Promise<AppEntry[]>;
  /** Installed and running; `foreground` is told by the caller, which has the screen. */
  appState(app: string): Promise<Exclude<AppState, 'foreground'>>;
  permission(app: string, grant: boolean, service: string): Promise<void>;
  launchWith(app: string, opts: LaunchOptions): Promise<void>;
}

export const SETTINGS = [
  'dark_mode',
  'text_size',
  'reduce_motion',
  'animations',
  'locale',
  'network',
  'proxy',
  'battery',
  'airplane',
  'wifi',
  'mobile_data',
] as const;

export type SettingName = (typeof SETTINGS)[number];

/**
 * The device's conditions. `get` answers what `set` takes, so a change can be put back; `app` is the app
 * a per-app setting (Android's locale) is about.
 */
export interface DeviceSettings {
  /** Before a condition is written down and changed: whatever else holds it lets go, so that the old value read is the user's. */
  willChange?(name: SettingName): Promise<void>;
  get(name: SettingName, app?: string): Promise<string>;
  set(name: SettingName, value: string, app?: string): Promise<void>;
}

/** `enroll`: a fingerprint or a face is known to the device; the others answer a request for one. */
export type BiometricAnswer = 'match' | 'nomatch' | 'enroll';

/** What happens to a device once: a condition holds and is put back, an event is over when it is said. */
export interface DeviceEvents {
  push(app: string | undefined, title: string, body: string): Promise<void>;
  biometric(answer: BiometricAnswer): Promise<void>;
  /** Empties a simulator's keychain, and answers how many items it held. */
  resetKeychain(): Promise<number>;
  /** A foldable's pose. */
  fold(closed: boolean): Promise<void>;
  /** A call coming in from `number`, or that call ended. */
  call(number: string, end: boolean): Promise<void>;
  sms(from: string, text: string): Promise<void>;
}

/** A simulator or emulator that can be started, whatever its state. */
export type Startable = { id: string; name: string; state: 'running' | 'stopped'; serial?: string };

/** Starting and stopping the virtual devices of a driver. */
export interface VirtualDevices {
  startable(): Promise<Startable[]>;
  /** Starts it and answers its serial once it can be driven. */
  boot(id: string): Promise<string>;
  shutdown(id: string): Promise<void>;
}

/** What `stop` needs: plain values, as the stop may be another process. */
export type RecordingHandle = Record<string, string | number>;

/** One file; several, in order, only when segments could not be joined. */
export type RecordingFiles = { files: string[]; note?: string };

/** Screen video. A recording outlives the process that started it. */
export interface ScreenRecorder {
  readonly extension: 'mp4' | 'mov';
  start(file: string, opts: { maxSeconds: number }): Promise<RecordingHandle>;
  stop(handle: RecordingHandle): Promise<RecordingFiles>;
}

export type NetworkVia = 'proxy' | 'probe' | 'packets' | 'bytes';

/** One way of seeing traffic on this device: what it sees, or why it cannot. */
export type NetworkPath = { via: NetworkVia; sees?: string; refused?: string };

/** A request, or a count, whichever the way sees. */
export type NetworkEntry = {
  at?: string;
  method?: string;
  url?: string;
  status?: number;
  ms?: number;
  /** A count: which way, and what it was counted against (a port, a uid). */
  direction?: string;
  host?: string;
  packets?: number;
  bytes?: number;
  /** The export holds its response body. */
  body?: boolean;
  error?: string;
};

export type NetworkAnswer = { entries: NetworkEntry[]; note?: string };

/** What later calls need: plain values, as they may be other processes. */
export type NetworkHandle = Record<string, string | number>;

/** The traffic a device can tell about by itself; a local proxy is the operations' own, through settings. */
export interface NetworkSource {
  paths(): Promise<NetworkPath[]>;
  start(via: NetworkVia, app: string | undefined): Promise<NetworkHandle>;
  read(handle: NetworkHandle): Promise<NetworkAnswer>;
  stop(handle: NetworkHandle): Promise<NetworkAnswer>;
}

export type WebPage = { id: string; title: string; url: string; app?: string; visible?: boolean };

/** The web views of debuggable apps, as DevTools or the Safari inspector shows them. */
export interface WebInspector {
  pages(app: string | undefined): Promise<WebPage[]>;
  /** Runs a script on the page, its value back; a thrown error is a refusal with its text. */
  evaluate(page: WebPage, script: string): Promise<unknown>;
}

/** The OS by name, for a stored record too, which has no device to ask. */
const OS_NAMES: Record<Platform, string> = { android: 'Android', ios: 'iOS' };

/** The OS as people name it: Android 14, iOS 18.2. */
export const osName = (platform: Platform, version: string) => `${OS_NAMES[platform]} ${version}`;

/** One device, whichever platform: what the operations are written against. */
export interface Device {
  readonly platformScreen: PlatformScreen;
  readonly apps: AppManager;
  readonly settings: DeviceSettings;
  readonly events: DeviceEvents;
  readonly recorder: ScreenRecorder;
  readonly network?: NetworkSource;
  readonly web?: WebInspector;
  /** A live picture of the device: nothing of it starts until asked, and no agent needs to be up first. */
  readonly mirror: Mirror;
  /** One attempt to close an open keyboard; the caller reads whether it went. */
  dismissKeyboard(): Promise<void>;
  /**
   * Waits on the device until the screen differs from `since` (no `since`: answers at once with it);
   * undefined from an agent without `wait`, which the caller polls instead.
   */
  waitChange(
    since: string | undefined,
    timeoutMs: number,
  ): Promise<{ sig: string; tree?: Tree } | undefined>;
  readonly serial: string;
  readonly platform: Platform;
  /** An emulator or simulator: numbers compare only with the same kind of device. */
  readonly virtual: boolean;
  readonly hello: Hello | undefined;
  /** Whether the last connect started a new agent. */
  lastStartWasCold: boolean;
  open(): Promise<Hello>;
  close(): void;
  tree(opts?: { maxDepth?: number; maxNodes?: number }): Promise<Tree>;
  act(action: ActParams, opts?: ActOptions): Promise<ActResult>;
  tap(p: Point, opts?: ActOptions): Promise<ActResult>;
  longPress(p: Point, durationMs?: number, opts?: ActOptions): Promise<ActResult>;
  swipe(from: Point, to: Point, durationMs?: number, opts?: ActOptions): Promise<ActResult>;
  key(key: Key, opts?: ActOptions): Promise<ActResult>;
  typeText(
    text: string,
    opts?: { at?: Point; replace?: boolean; submit?: boolean } & ActOptions,
  ): Promise<TextResult>;
  screenshot(
    opts?: ParamsOf<'screenshot'>,
  ): Promise<{ meta: ResultOf<'screenshot'>; data: Buffer }>;
  audit(opts?: { types?: AuditType[]; maxIssues?: number }): Promise<AuditResult>;
  foreground(): Promise<string | undefined>;
  setClipboard(text: string): Promise<void>;
  getClipboard(): Promise<string | undefined>;
  setOrientation(rotation: 0 | 1 | 2 | 3): Promise<void>;
  openUrl(url: string, pkg?: string): Promise<void>;
  launch(pkg: string): Promise<void>;
  /** Before `open`, when a first call is to launch this app: `launch` then takes up what began here. */
  launchAlongside(pkg: string): void;
  terminate(pkg: string): Promise<void>;
  setLocation(lat: number, lon: number): Promise<void>;
  stopAgent(): Promise<void>;
  logs(q: LogsQuery): Promise<LogsAnswer>;
  crashes(q: CrashesQuery): Promise<CrashesAnswer>;
  /** Whether the app has a live process. */
  appRunning(app: string): Promise<boolean>;
  /** Its process id, where reading it is cheap enough to do on every action. */
  appPid?(app: string): Promise<string | undefined>;
  readonly measure: MeasureSource;
}

export type LogLevel = 'verbose' | 'debug' | 'info' | 'warn' | 'error';

export type LogsQuery = {
  app: string;
  /** Epoch ms; absent: the newest lines. */
  since?: number;
  level: LogLevel;
  maxLines: number;
};

/** The app's log lines as the platform prints them, and what the platform could not give. */
export type LogsAnswer = { lines: string[]; source: string; note?: string };

export type CrashesQuery = {
  app: string;
  /** Epoch ms; absent: any time. */
  since?: number;
  limit: number;
  /** A build's symbols: a `.dSYM` or a folder of them; on Android a folder of libraries that keep theirs. */
  symbols?: string;
};

export type CrashReport = {
  /** When, as the platform says it. */
  at: string;
  reason: string;
  /** The first lines of its stack or description. */
  detail?: string;
  /** The whole report on this machine. */
  file?: string;
  /** Its stack with the names `symbols` gave, on this machine. */
  symbolicated?: string;
};

/** One way an app's processes ended, as the system keeps them, with how many went that way. */
export type ExitCount = { reason: string; count: number; newest: string; memory?: string };

export type CrashesAnswer = {
  reports: CrashReport[];
  source: string;
  note?: string;
  /** Every exit the system keeps, by reason, what no one calls a crash too (Android). */
  exits?: ExitCount[];
};

/** A doctor's finding. */
export type Check = { name: string; ok: boolean; warn?: boolean; detail: string; fix?: string };

/** The devices of one driver. */
export interface DeviceProvider {
  /** `state` is the driver's own word; `ready` says whether the device can be driven now. */
  list(): Promise<{ serial: string; state: string; ready: boolean; model?: string }[]>;
  handles(serial: string): boolean;
  open(serial: string): Device;
  readonly virtual?: VirtualDevices;
  /** What this driver needs of this machine and, with `serial`, of that device. */
  doctor?(serial?: string): Promise<Check[]>;
  /** A bounded table from a kept trace of this driver's kind: no device needed. */
  queryTrace?(
    tracePath: string,
    q: { sql?: string; table?: string; limit: number },
  ): Promise<TraceDigest | undefined>;
}
