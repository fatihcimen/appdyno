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

/** A surface's frames as SurfaceFlinger presented them: what a game or an engine draws, which `gfxinfo` never sees. */
export type SurfaceFrames = {
  /** Empty, with no frames, when the app shows no surface. */
  layer: string;
  refreshMs: number;
  frames: number;
  fps: number;
  p50Ms: number;
  p95Ms: number;
  worstMs: number;
  /** Frames not presented less than 34 and 50 ms after the last: Play's two bars for a game's session. */
  slow34Percent: number;
  slow50Percent: number;
  /** A surface left alone keeps its old frames: false when no new one came as it was read. */
  drawing: boolean;
};
