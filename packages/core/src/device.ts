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
  readonly measure?: MeasureSource;
}

/** A doctor's finding. */
export type Check = { name: string; ok: boolean; warn?: boolean; detail: string; fix?: string };

/** The devices of one driver. */
export interface DeviceProvider {
  list(): Promise<{ serial: string; state: string; model?: string }[]>;
  handles(serial: string): boolean;
  open(serial: string): Device;
  /** What this driver needs of this machine and, with `serial`, of that device. */
  doctor?(serial?: string): Promise<Check[]>;
}
