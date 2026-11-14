import { DeviceError } from '@appdyno/protocol';
import type { SettingName } from './device-conditions.js';
import type { FrameStats, SurfaceFrames, FrameMarks } from './frames.js';
import type {
  Measured,
  CpuReading,
  MemoryReading,
  AnonMemory,
  DeviceVitals,
  LaunchMode,
  CompileMode,
  LaunchReading,
  BuildType,
  BaselineReading,
  ThreadReading,
  NetworkReading,
  EnergyReading,
  BatterySignals,
  ExitReading,
  StartInfo,
  SizeReading,
  HeapProfileKind,
  HeapProfile,
  Symbols,
  HangReading,
  XctMetrics,
  CpuProfile,
  HeapReading,
  FrameTrace,
} from './measure.js';

/** Why a device has no way of measuring something, and what to do instead where the device can say it. */
export type CannotWhy = { reason: string; hint?: string };

/** What a device has no way of measuring, as against a measure that refused this time: no row is about it. */
export class Cannot extends DeviceError {
  constructor(what: string, why?: CannotWhy) {
    super('UNSUPPORTED', `cannot measure ${what}${why ? `: ${why.reason}` : ''}`, why?.hint);
  }
}

/** A member of `MeasureSource` a device does not have, naming what that takes away, and why where a call asks for it. */
export const cannot = (what: string, why?: CannotWhy) => (): Promise<never> =>
  Promise.reject(new Cannot(what, why));

/** What a device can measure: every member answers, by `cannot` where this device has no way. */
export type MeasureSource = {
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
  /**
   * The frames since the last reset, then a reset, so that the next read starts a window of its own; `reset: false` leaves
   * this one open. `asItIs` only looks: a dark screen stays dark, where a measure would light it to see what a person sees.
   * `after` (a `newestNs`) leaves out of the per-frame rows those up to it, for a reader that resets nothing.
   */
  frames(
    app: string,
    opts?: { reset?: boolean; asItIs?: boolean; after?: number },
  ): Promise<Measured<FrameStats>>;
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
  /** `since`: epoch ms by this Mac's clock; with none, only what the system holds. */
  exits(app: string, since?: number): Promise<Measured<ExitReading>>;
  /** `seen`: the stamp of the newest start the last run read. */
  startInfo(app: string, seen?: number): Promise<Measured<StartInfo>>;
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
};

/** The measures, as against what a source says of itself. */
export type Capability = Exclude<
  keyof MeasureSource,
  'slowReads' | 'framesByProbe' | 'symbolFiles' | 'energyHolds' | 'logTellsStalls'
>;
