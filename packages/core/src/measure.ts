/** A measurement and the raw output it was read from (kept as its proof). */
export type Measured<T> = {
  value: T;
  raw: string;
  at: string;
  /** What read it, kept with its numbers: only the driver knows, and a device may have several ways. */
  source?: string;
};

/** A frame this long stood still for the user (Android vitals' frozen frame); every source counts by it. */
export const FROZEN_FRAME_MS = 700;

/** Below this many frames the shares say little (a few launch frames). */
export const MIN_FRAMES = 60;

/**
 * How many times the screen stood still that long: what covers the same moment is one, as a stall gives a frame and
 * the next one, due meanwhile, on Android, and a hitch and a hang on iOS. `start` and `ms` in milliseconds.
 */
export function frozenMoments(spans: { start: number; ms: number }[]) {
  let count = 0;
  let until = -Infinity;
  for (const { start, ms } of spans
    .filter((s) => s.ms >= FROZEN_FRAME_MS)
    .sort((a, b) => a.start - b.start)) {
    if (start >= until) count++;
    until = Math.max(until, start + ms);
  }
  return count;
}

/** How many functions a profile keeps: a diff of two runs needs more of them than an answer shows. */
export const PROFILE_FUNCTIONS = 200;

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
  /** Frames of FROZEN_FRAME_MS or longer. */
  frozenFrames: number;
  /** The longest hitch, where the source counts hitches. */
  worstHitchMs?: number;
  fewFrames: boolean;
  /** What the numbers can and cannot see, where the source has limits (the simulator's frame probe). */
  limits?: string;
  /** The main thread's stalls, where the source sees them. */
  stalls?: { count: number; worstMs: number; totalMs: number };
  /** The session's frames by length, where the platform keeps a histogram: what Android vitals judges. */
  histogram?: FrameHistogram;
};

export type FrameHistogram = {
  frames: number;
  /** A bucket holds a whole millisecond and those above it: 16 ms is left out, so this is the least it can be. */
  over16: number;
  over700: number;
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
  /** Kernel threads in uninterruptible sleep: Linux counts each as load, though none uses the CPU. */
  parkedKernelThreads?: number;
  /** `/proc/pressure/cpu` some avg10. */
  cpuPressure?: number;
  memAvailableKb?: number;
  memTotalKb?: number;
  /** `dumpsys thermalservice` Thermal Status (0 none … 6 shutdown). */
  thermalStatus?: number;
  batteryTempC?: number;
};

/** Where a frame's main thread went: what it waited for, or that it was at work. */
export type FrameCause = 'lock' | 'binder' | 'gc' | 'busy' | 'starved' | 'io' | 'sleeping';

/** Why the frames that missed did, longest first; `top` only where one clears a floor, else it is unexplained. */
export type SlowFrameCauses = {
  slowFrames: number;
  causes: {
    cause: FrameCause;
    msPerFrame: number;
    /** Percent of the main thread's time in those frames. */
    share: number;
    frames: number;
    detail?: string;
  }[];
  top?: FrameCause;
};

export type FrameTimeline = {
  frames: number;
  /** Frames with any jank type (on an emulator nearly all: its display's prediction errors). */
  janky: number;
  jankyPercent: number;
  appDeadlineMissed: number;
  /** Frames of FROZEN_FRAME_MS or longer. */
  frozen: number;
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
  /** Why the frames that missed did, where the trace can say. */
  causes?: SlowFrameCauses;
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
  /** Intervals of FROZEN_FRAME_MS or longer. */
  frozen: number;
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
  /** The screen stood still for FROZEN_FRAME_MS or longer: a hitch, or a hang of the main thread, of that length. */
  frozen: number;
  /** The main thread's hangs in the same recording. */
  stalls: { count: number; worstMs: number; totalMs: number };
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

/** What Android vitals' memory metric reads: the process's anonymous memory and swap, in the state it is in. */
export type ProcessMemoryState = 'foreground' | 'service' | 'background' | 'cached';

export type AnonMemory = {
  /** `RssAnon` + `VmSwap` of the main process. */
  kb: number;
  rssAnonKb: number;
  swapKb: number;
  state: ProcessMemoryState;
  processState: number;
  /** Malloced and not, as `dumpsys meminfo` lists them; none where this Android lists no such row. */
  bitmapKb?: number;
  ramMb: number;
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
  /** Estimated charge: Android's own, a formula over time in each state, not a power meter. */
  mah?: number;
  /** Millijoules, counted (a simulator app, on the Mac) or from this tool's model. */
  mj?: number;
  /** Instruments' power impact: iOS's relative score, no unit of energy. */
  impact?: number;
  /** A number worked out from others, by a model, and not read from the platform's count of it. */
  modelled?: boolean;
  note: string;
  breakdown?: Record<string, number>;
};

export type ExitReading = {
  crashes: number;
  /** Android's; iOS has no such count, and its hangs are a measure of their own. */
  anrs?: number;
  /** Those of input dispatching timed out: the only kind Android vitals calls user-perceived. */
  userAnrs?: number;
  total: number;
  recent: { at: string; reason: string; description?: string }[];
};

/** What a battery pays for, with no model in between: Android vitals' wake locks and wakeups, and jobs. */
export type BatterySignals = {
  windowMs: number;
  /** By tag, longest first. `ms`: this window's. `longestMs`: how long one has been held at all, before the window too. */
  wakeLocks: { tag: string; ms: number; longestMs: number; count: number; exempt?: string }[];
  /** Those Play counts: not what the system holds for the app's audio or location. */
  wakeLockMs: number;
  wakeLockPercent: number;
  longestLockMs: number;
  wakeups: number;
  wakeupsPerHour: number;
  alarms: number;
  alarmTags: { tag: string; alarms: number; wakeups: number }[];
  jobs: number;
  note: string;
};

/** One start of an app's process as the system kept it. `phases`: the ms up to each mark from the one before it. */
export type StartRecord = {
  reason: string;
  startType: string;
  wasForceStopped: boolean;
  phases: Record<string, number>;
};

export type StartInfo = { starts: StartRecord[]; newest: StartRecord };

export type SizeReading = { bytes: number; parts: Record<string, number>; note?: string };

export type HeapProfileKind = 'java_hprof' | 'heapprofd';

export type HeapProfile = {
  kind: HeapProfileKind;
  tracePath: string;
  /** The largest classes (java_hprof) or allocation sites (heapprofd). */
  top: { name: string; bytes: number; count: number }[];
  totalBytes: number;
};

/** Apple's triage of a hang: its thread at work, or waiting for something. */
export type HangCause = {
  ms: number;
  kind: 'busy' | 'blocked';
  /** Its CPU time as a share of the hang. */
  cpuPercent: number;
  /** The app's innermost function: what ran most, or what ran last before it stopped. An address has no symbols. */
  function?: string;
};

export type HangReading = {
  hangs: number;
  worstMs: number;
  totalMs: number;
  tracePath: string;
  causes?: HangCause[];
};

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
  kind: 'hprof' | 'memgraph' | 'trace';
  /** What the count counts, where it can be taken for something else. */
  note?: string;
};

export type FrameTrace =
  | ({ kind: 'hitches'; tracePath: string } & HitchSummary)
  | ({ kind: 'timeline' } & FrameTimeline)
  | ({ kind: 'probe'; tracePath: string } & ProbeSummary);

/** Where a build's names are, for a trace of addresses: a `.dSYM`, or a folder of them. */
export type Symbols = { dsym?: string };

/** What a device can measure: each has what it has, and `ops` names what it lacks. */
export interface MeasureSource {
  /** The device says it itself (`Device.virtual`) where it knows without asking the device. */
  readonly virtual?: boolean;
  /** What takes a recording of seconds here, so a journey does not read it between two steps. */
  readonly slowReads?: readonly Capability[];
  cpu?(app: string, windowMs?: number): Promise<Measured<CpuReading>>;
  memory?(app: string): Promise<Measured<MemoryReading>>;
  anonMemory?(app: string): Promise<Measured<AnonMemory>>;
  frames?(app: string, opts?: { reset?: boolean }): Promise<Measured<FrameStats>>;
  /** Frames of what `during` does, on a device with no counter to read before and after: it records around it. */
  framesDuring?(
    app: string,
    seconds: number,
    during: () => Promise<unknown>,
  ): Promise<Measured<FrameStats>>;
  resetFrames?(app: string): Promise<void>;
  vitals?(): Promise<Measured<DeviceVitals>>;
  launch?(
    app: string,
    opts: {
      mode: LaunchMode;
      repeats: number;
      compile?: CompileMode;
      trace?: boolean;
      /** Each cold start under the frame probe, to its first frame (iOS simulator). */
      probe?: boolean;
      /** Goes into the app's environment (iOS): a slow start of a known length, in a test. */
      env?: Record<string, string>;
    },
  ): Promise<Measured<LaunchReading>>;
  /** Debuggable, profileable or neither: what a number of this build can be compared with. */
  buildType?(app: string): Promise<BuildType>;
  /** Relaunches the app with the frame probe unless it runs under it already (simulator): true if it did. */
  attachProbe?(app: string): Promise<boolean>;
  threads?(app: string, windowMs: number): Promise<Measured<ThreadReading>>;
  network?(
    app: string,
    windowMs: number,
    during?: () => Promise<unknown>,
  ): Promise<Measured<NetworkReading>>;
  energy?(app: string, windowMs: number): Promise<Measured<EnergyReading>>;
  battery?(app: string, windowMs: number): Promise<Measured<BatterySignals>>;
  exits?(app: string): Promise<Measured<ExitReading>>;
  startInfo?(app: string): Promise<Measured<StartInfo>>;
  size?(app: string): Promise<Measured<SizeReading>>;
  heapProfile?(
    app: string,
    kind: HeapProfileKind,
    seconds: number,
    during?: () => Promise<unknown>,
  ): Promise<Measured<HeapProfile>>;
  hangs?(
    app: string,
    seconds: number,
    during?: () => Promise<unknown>,
    symbols?: Symbols,
  ): Promise<Measured<HangReading>>;
  /** XCTest's `measure()` in a test of its own: launch, hitches, memory, CPU. */
  xctMetrics?(app: string, test: 'launch' | 'hitches'): Promise<Measured<XctMetrics>>;
  cpuProfile?(
    app: string,
    ms: number,
    during?: () => Promise<unknown>,
    symbols?: Symbols,
  ): Promise<Measured<CpuProfile>>;
  heap?(app: string, dir: string): Promise<Measured<HeapReading>>;
  frameTrace?(
    app: string,
    seconds: number,
    during?: () => Promise<unknown>,
  ): Promise<Measured<FrameTrace>>;
}

export type Capability = Exclude<keyof MeasureSource, 'virtual' | 'slowReads'>;
