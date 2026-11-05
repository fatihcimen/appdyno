import { DeviceError } from '@appdyno/protocol';
import type { SettingName } from './device.js';
import type {
  FrameMarks,
  FrameStats,
  FrameTimeline,
  HitchSummary,
  ProbeSummary,
  SurfaceFrames,
} from './frames.js';

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

/** An Android app's Baseline Profile: in its APK, compiled on the device, and what it does for a cold start. */
export type BaselineReading = {
  /** `assets/dexopt/baseline.prof` in its APK. */
  present: boolean;
  /** What the device says of its code before any of this: `status=verify reason=install`. */
  state?: string;
  /** Compiled from a profile now: by the status, as a `.dm` of the wrong format has the reason and no code. */
  applied: boolean;
  /** Of the profile once installed, where the device can say. */
  rules?: number;
  /** Cold starts, taken in turns; none with no profile to try. */
  without: number[];
  with: number[];
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

/** A hang in words: what a trace answers and what the gate's answer says. */
export const hangText = (c: HangCause) =>
  `${c.ms} ms hang: ${c.kind}, on the CPU ${c.cpuPercent} % of it${c.function ? `, in ${c.function}${c.function.startsWith('0x') ? ' (an address: `dsym` names it)' : ''}` : ''}`;

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

/** What a device has no way of measuring, as against a measure that refused this time: no row is about it. */
export class Cannot extends DeviceError {
  constructor(what: string) {
    super('UNSUPPORTED', `cannot measure ${what}`);
  }
}

/** A member of `MeasureSource` a device does not have, naming what that takes away. */
export const cannot = (what: string) => (): Promise<never> => Promise.reject(new Cannot(what));

/** What a device can measure: every member answers, by `cannot` where this device has no way. */
export interface MeasureSource {
  /** What has no quick read here, so a journey does not read it between two steps. */
  readonly slowReads: readonly Capability[];
  /** Its frames come through a probe in the app, which `attachProbe` puts there unless a caller says no. */
  readonly framesByProbe: boolean;
  /** Names in a build's frames come from files on this Mac (`Symbols`), not from the device. */
  readonly symbolFiles: boolean;
  /** Its log says when a main thread came back late, and reads in a moment: a stop no frame shows can be watched for. */
  readonly logTellsStalls?: boolean;
  /** The condition reading energy changes for its time, where it changes one. */
  readonly energyHolds?: SettingName;
  cpu(app: string, windowMs?: number): Promise<Measured<CpuReading>>;
  memory(app: string): Promise<Measured<MemoryReading>>;
  anonMemory(app: string): Promise<Measured<AnonMemory>>;
  frames(app: string, opts?: { reset?: boolean }): Promise<Measured<FrameStats>>;
  /** Frames of what `during` does: recorded around it, or a counter read before and after it. */
  framesDuring(
    app: string,
    seconds: number,
    during: () => Promise<unknown>,
  ): Promise<Measured<FrameStats>>;
  resetFrames(app: string): Promise<void>;
  surfaceFrames(app: string): Promise<Measured<SurfaceFrames>>;
  vitals(): Promise<Measured<DeviceVitals>>;
  launch(
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
  buildType(app: string): Promise<BuildType>;
  baselineProfile(app: string, opts: { repeats: number }): Promise<Measured<BaselineReading>>;
  /** Relaunches the app with the frame probe unless it runs under it already (simulator): true if it did. */
  attachProbe(app: string): Promise<boolean>;
  threads(app: string, windowMs: number): Promise<Measured<ThreadReading>>;
  network(
    app: string,
    windowMs: number,
    during?: () => Promise<unknown>,
  ): Promise<Measured<NetworkReading>>;
  energy(app: string, windowMs: number): Promise<Measured<EnergyReading>>;
  battery(app: string, windowMs: number): Promise<Measured<BatterySignals>>;
  exits(app: string): Promise<Measured<ExitReading>>;
  startInfo(app: string): Promise<Measured<StartInfo>>;
  size(app: string): Promise<Measured<SizeReading>>;
  heapProfile(
    app: string,
    kind: HeapProfileKind,
    seconds: number,
    during?: () => Promise<unknown>,
  ): Promise<Measured<HeapProfile>>;
  hangs(
    app: string,
    seconds: number,
    during?: () => Promise<unknown>,
    symbols?: Symbols,
  ): Promise<Measured<HangReading>>;
  /** XCTest's `measure()` in a test of its own: launch, hitches, memory, CPU. */
  xctMetrics(app: string, test: 'launch' | 'hitches'): Promise<Measured<XctMetrics>>;
  cpuProfile(
    app: string,
    ms: number,
    during?: () => Promise<unknown>,
    symbols?: Symbols,
  ): Promise<Measured<CpuProfile>>;
  heap(app: string, dir: string): Promise<Measured<HeapReading>>;
  frameTrace(
    app: string,
    seconds: number,
    during?: () => Promise<unknown>,
  ): Promise<Measured<FrameTrace>>;
  /**
   * Every frame from when `during` is called until it ends, or `seconds` pass, each on the device's clock. `keepSeconds`:
   * only about the last so many are wanted, so the source need hold no more.
   */
  frameMarks(
    app: string,
    seconds: number,
    during: () => Promise<unknown>,
    keepSeconds?: number,
  ): Promise<Measured<FrameMarks>>;
}

/** The measures, as against what a source says of itself. */
export type Capability = Exclude<
  keyof MeasureSource,
  'slowReads' | 'framesByProbe' | 'symbolFiles' | 'energyHolds' | 'logTellsStalls'
>;
