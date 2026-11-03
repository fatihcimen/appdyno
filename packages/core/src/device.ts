import type {
  ActParams,
  ActResult,
  AuditResult,
  AuditType,
  Hello,
  Key,
  ParamsOf,
  Point,
  Read,
  ResultOf,
  SettleInput,
  TextResult,
  Tree,
} from '@appdyno/protocol';

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

/** A measurement and the raw output it was read from (kept as its proof). */
export type Measured<T> = { value: T; raw: string; at: string };

export type ProfileEntry = { percent: number; samples: number; symbol: string };
export type CpuProfile = {
  durationMs: number;
  samples: number;
  top: ProfileEntry[];
  /** The app's own functions by busy inclusive time, where the source can tell. */
  appTop?: ProfileEntry[];
};

export type FrameSummary = {
  totalFrames: number;
  jankyFrames: number;
  jankyPercent: number;
  p50Ms?: number;
  p90Ms?: number;
  p95Ms?: number;
  p99Ms?: number;
  slowUiThread?: number;
  deadlineMissed?: number;
  /** Frames over FROZEN_FRAME_MS (histogram buckets from 700 ms on). */
  frozenFrames: number;
  fewFrames: boolean;
};

export type FrameStats = FrameSummary & {
  /** From the per-frame rows (the last ~120 frames). */
  frames?: {
    count: number;
    slow: number;
    slowPercent: number;
    p50Ms: number;
    p95Ms: number;
    worstMs: number;
    /** The worst second: the one-second window of frames with the most slow frames. */
    worstWindow?: { frames: number; slow: number; avgMs: number };
  };
};

export type DeviceVitals = {
  load?: number[];
  /** `/proc/pressure/cpu` some avg10. */
  cpuPressure?: number;
  memAvailableKb?: number;
  memTotalKb?: number;
  /** `dumpsys thermalservice` Thermal Status (0 none … 6 shutdown). */
  thermalStatus?: number;
  batteryTempC?: number;
};

export type FrameTimeline = {
  frames: number;
  /** Frames with any jank type (on an emulator nearly all: its display's prediction errors). */
  janky: number;
  jankyPercent: number;
  appDeadlineMissed: number;
  /** The app's own share: frames whose type says the app missed its deadline. */
  appJankPercent: number;
  bufferStuffing: number;
  surfaceFlinger: number;
  p50Ms: number;
  p95Ms: number;
  worstMs: number;
};

export type HitchSummary = {
  durationMs: number;
  /** Frames the display showed (all surfaces). */
  frames: number;
  /** The app's hitches (system ones left out). */
  hitches: number;
  hitchMs: number;
  worstMs: number;
  /** Hitch time per second of recording (Apple's hitch ratio, ms/s). */
  hitchRatio: number;
  causes: Record<string, number>;
};

export type CpuReading = { percent: number; windowMs: number };

export type MemoryReading = {
  kb: number;
  /** What `kb` counts: Android's PSS, or Apple's physical footprint. */
  kind: 'pss' | 'footprint';
  peakKb?: number;
  javaHeapKb?: number;
  nativeHeapKb?: number;
  graphicsKb?: number;
};

export type LaunchReading = {
  mode: 'cold' | 'warm';
  /** The launches measured (a first one, a warm-up, is left out). */
  samples: { totalMs?: number; state?: string }[];
  medianMs?: number;
  /** The mark a sample counts up to when it is not the platform's own launch report. */
  until?: string;
};

export type HeapReading = {
  file: string;
  bytes: number;
  leaks?: number;
  leakedBytes?: number;
  kind: 'hprof' | 'memgraph';
};

export type FrameTrace =
  ({ kind: 'hitches'; tracePath: string } & HitchSummary) | ({ kind: 'timeline' } & FrameTimeline);

/** What a device can measure: each has what it has, and `ops` names what it lacks. */
export interface MeasureSource {
  /** The device says it itself (`Device.virtual`) where it knows without asking the device. */
  readonly virtual?: boolean;
  cpu?(app: string, windowMs?: number): Promise<Measured<CpuReading>>;
  memory?(app: string): Promise<Measured<MemoryReading>>;
  frames?(app: string, opts?: { reset?: boolean }): Promise<Measured<FrameStats>>;
  resetFrames?(app: string): Promise<void>;
  vitals?(): Promise<Measured<DeviceVitals>>;
  launch?(
    app: string,
    opts: { mode: 'cold' | 'warm'; repeats: number },
  ): Promise<Measured<LaunchReading>>;
  cpuProfile?(
    app: string,
    ms: number,
    during?: () => Promise<unknown>,
  ): Promise<Measured<CpuProfile>>;
  heap?(app: string, dir: string): Promise<Measured<HeapReading>>;
  frameTrace?(
    app: string,
    seconds: number,
    during?: () => Promise<unknown>,
  ): Promise<Measured<FrameTrace>>;
}

export type Capability = Exclude<keyof MeasureSource, 'virtual'>;

export type AppEntry = { id: string; name?: string; version?: string };
export type AppState = 'not_installed' | 'stopped' | 'running' | 'foreground';
export type LaunchOptions = { args?: string[]; env?: Record<string, string> };

/** Apps on a device; what a device cannot do answers UNSUPPORTED with the reason. */
export interface AppManager {
  install(path: string): Promise<void>;
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
] as const;
export type SettingName = (typeof SETTINGS)[number];

/**
 * The device's conditions. `get` answers what `set` takes, so a change can be put back; `app` is the app
 * a per-app setting (Android's locale) is about.
 */
export interface DeviceSettings {
  get(name: SettingName, app?: string): Promise<string>;
  set(name: SettingName, value: string, app?: string): Promise<void>;
  push(app: string | undefined, title: string, body: string): Promise<void>;
  biometric(match: boolean): Promise<void>;
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

/** One device, whichever platform: what the operations are written against. */
export interface Device {
  readonly apps?: AppManager;
  readonly settings?: DeviceSettings;
  readonly recorder?: ScreenRecorder;
  readonly network?: NetworkSource;
  readonly web?: WebInspector;
  /** One attempt to close an open keyboard; the caller reads whether it went. */
  dismissKeyboard?(): Promise<void>;
  /**
   * Waits on the device until the screen differs from `since` (no `since`: answers at once with it);
   * undefined from an agent without `wait`, which the caller polls instead.
   */
  waitChange?(
    since: string | undefined,
    timeoutMs: number,
  ): Promise<{ sig: string; tree?: Tree } | undefined>;
  readonly serial: string;
  readonly platform: 'android' | 'ios';
  /** An emulator or simulator: numbers compare only with the same kind of device. */
  readonly virtual?: boolean;
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
  launch(pkg: string): Promise<string>;
  terminate(pkg: string): Promise<void>;
  setLocation(lat: number, lon: number): Promise<void>;
  stopAgent(): Promise<void>;
  logs?(q: LogsQuery): Promise<LogsAnswer>;
  crashes?(q: CrashesQuery): Promise<CrashesAnswer>;
  /** Whether the app has a live process. */
  appRunning?(app: string): Promise<boolean>;
  /** Its process id, where reading it is cheap enough to do on every action. */
  appPid?(app: string): Promise<string | undefined>;
  readonly measure?: MeasureSource;
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
};
export type CrashReport = {
  /** When, as the platform says it. */
  at: string;
  reason: string;
  /** The first lines of its stack or description. */
  detail?: string;
  /** The whole report on this machine. */
  file?: string;
};
export type CrashesAnswer = { reports: CrashReport[]; source: string; note?: string };

/** A doctor's finding. */
export type Check = { name: string; ok: boolean; warn?: boolean; detail: string; fix?: string };

/** The devices of one driver. */
export interface DeviceProvider {
  list(): Promise<{ serial: string; state: string; model?: string }[]>;
  handles(serial: string): boolean;
  open(serial: string): Device;
  readonly virtual?: VirtualDevices;
  /** What this driver needs of this machine and, with `serial`, of that device. */
  doctor?(serial?: string): Promise<Check[]>;
}
