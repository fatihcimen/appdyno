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
  /** What the numbers can and cannot see, where the source has limits (the simulator's frame probe). */
  limits?: string;
  /** The main thread's stalls, where the source sees them. */
  stalls?: { count: number; worstMs: number; totalMs: number };
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
  /** Frames late for the app's own timing: "App Resynced Jitter". */
  appResynced?: number;
  /** The app's own share: frames whose type says the app was at fault (deadline missed, resynced). */
  appJankPercent: number;
  bufferStuffing: number;
  surfaceFlinger: number;
  p50Ms: number;
  p95Ms: number;
  worstMs: number;
  /** `android_frame_stats`, where the trace has doFrame and DrawFrame slices. */
  stats?: { frames: number; overrunP95Ms: number; overrunWorstMs: number; cpuP95Ms: number };
  /** The kept trace, for perf_query. */
  tracePath?: string;
};

/** The simulator's frame probe over a window (main-thread pacing, on the Mac's speed). */
export type ProbeSummary = {
  durationMs: number;
  frames: number;
  /** Intervals over 1.5 vsync. */
  missed: number;
  missedPercent: number;
  p50Ms: number;
  p95Ms: number;
  worstMs: number;
  /** Intervals over 100 ms. */
  stalls: { count: number; worstMs: number; totalMs: number };
  /** When the app last finished handling a touch, as ms before the window's end. */
  lastInputMsAgo?: number;
  limits: string;
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
  /** Android's live objects: growing across rounds with no change on screen is a leak signal. */
  viewRootImpl?: number;
  appContexts?: number;
  activities?: number;
};

export type LaunchMode = 'cold' | 'warm' | 'hot';

/** How the app's code is compiled for a launch (Android). */
export type CompileMode = 'speed' | 'speed-profile' | 'verify';

/** Why a start took what it took, from a Perfetto startup trace. */
export type StartupAnalysis = {
  tracePath: string;
  /** `android_startups`. */
  startupType?: string;
  durMs?: number;
  ttidMs?: number;
  ttfdMs?: number;
  /** The metric's `slow_start_reason`: what the platform names. */
  reasons: string[];
  /** `android_startup_opinionated_breakdown`: where the time went, largest first. */
  breakdown: { reason: string; ms: number }[];
  /** Over the platform's limits (bindApplication 1250 ms, inflate 450 ms, getResources 130 ms, hot 1.5 s). */
  findings: string[];
  /** The compiler filter and status the trace saw (`location=* status=* filter=* reason=*`). */
  odex?: string;
};

export type LaunchReading = {
  mode: LaunchMode;
  /** The launches measured (a first one, a warm-up, is left out). */
  samples: { totalMs?: number; state?: string; fullyDrawnMs?: number }[];
  medianMs?: number;
  fullyDrawnMedianMs?: number;
  /** The mark a sample counts up to when it is not the platform's own launch report. */
  until?: string;
  /** The compile state asked for and restored afterwards, with what the device says it was. */
  compile?: { asked: CompileMode; status?: string };
  startup?: StartupAnalysis;
};

export type BuildType = 'debug' | 'profileable' | 'release' | 'unknown';

export type ThreadReading = {
  windowMs: number;
  /** How many times every thread was read in the window. */
  reads: number;
  /** Busiest first. `over90Ms`: the time the thread stayed above 90 percent of a core. */
  threads: { tid: number; name: string; percent: number; over90Ms: number }[];
  worstOver90Ms: number;
};

export type NetworkReading = {
  windowMs: number;
  rxBytes: number;
  txBytes: number;
  /** What the numbers count and do not (loopback, other apps). */
  note?: string;
};

export type EnergyReading = {
  /** Estimated charge. Model-based: a formula over time in each state, not a power meter. */
  mah?: number;
  note: string;
  breakdown?: Record<string, number>;
};

export type ExitReading = {
  crashes: number;
  anrs: number;
  total: number;
  recent: { at: string; reason: string; description?: string }[];
};

export type SizeReading = { bytes: number; parts: Record<string, number>; note?: string };

export type HeapProfileKind = 'java_hprof' | 'heapprofd';
export type HeapProfile = {
  kind: HeapProfileKind;
  tracePath: string;
  /** The largest classes (java_hprof) or allocation sites (heapprofd). */
  top: { name: string; bytes: number; count: number }[];
  totalBytes: number;
};

export type HangReading = { hangs: number; worstMs: number; totalMs: number; tracePath: string };

/** An XCTest metric's readings under `measure()`, from the result bundle. */
export type XctMetrics = { metrics: Record<string, number[]>; resultBundle: string; note?: string };

export type TraceDigest = {
  tracePath: string;
  source: string;
  columns: string[];
  rows: string[][];
  /** Rows left out by the bound. */
  dropped: number;
};

export type HeapReading = {
  file: string;
  bytes: number;
  leaks?: number;
  leakedBytes?: number;
  kind: 'hprof' | 'memgraph';
};

export type FrameTrace =
  | ({ kind: 'hitches'; tracePath: string } & HitchSummary)
  | ({ kind: 'timeline' } & FrameTimeline)
  | ({ kind: 'probe'; tracePath: string } & ProbeSummary);

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
    opts: {
      mode: LaunchMode;
      repeats: number;
      compile?: CompileMode;
      trace?: boolean;
      /** Goes into the app's environment (iOS): a slow start of a known length, in a test. */
      env?: Record<string, string>;
    },
  ): Promise<Measured<LaunchReading>>;
  /** Debuggable, profileable or neither: what a number of this build can be compared with. */
  buildType?(app: string): Promise<BuildType>;
  /** Relaunches the app with the frame probe unless it runs under it already (simulator, opt-in). */
  attachProbe?(app: string): Promise<void>;
  threads?(app: string, windowMs: number): Promise<Measured<ThreadReading>>;
  network?(
    app: string,
    windowMs: number,
    during?: () => Promise<unknown>,
  ): Promise<Measured<NetworkReading>>;
  energy?(app: string, windowMs: number): Promise<Measured<EnergyReading>>;
  exits?(app: string): Promise<Measured<ExitReading>>;
  size?(app: string): Promise<Measured<SizeReading>>;
  heapProfile?(
    app: string,
    kind: HeapProfileKind,
    seconds: number,
    during?: () => Promise<unknown>,
  ): Promise<Measured<HeapProfile>>;
  hangs?(app: string, seconds: number, during?: () => Promise<unknown>): Promise<HangReading>;
  /** XCTest's `measure()` in a test of its own: launch, hitches, memory, CPU. */
  xctMetrics?(app: string, test: 'launch' | 'hitches'): Promise<Measured<XctMetrics>>;
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

/** One device, whichever platform: what the operations are written against. */
export interface Device {
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
  /** What this driver needs of this machine and, with `serial`, of that device. */
  doctor?(serial?: string): Promise<Check[]>;
  /** A bounded table from a kept trace of this driver's kind: no device needed. */
  queryTrace?(
    tracePath: string,
    q: { sql?: string; table?: string; limit: number },
  ): Promise<TraceDigest | undefined>;
}
