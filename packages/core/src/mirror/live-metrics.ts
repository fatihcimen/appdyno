/** What one second of a device can say; each is optional, as each kind of device has its own ways. */
export const LIVE_FIELDS = [
  'fps',
  'jankyFrames',
  'frozenFrames',
  'cpuPercent',
  'memoryMb',
  'threads',
  'networkInKbps',
  'networkOutKbps',
] as const;

export type LiveField = (typeof LIVE_FIELDS)[number];

/**
 * One second of how the app in front is doing, as a device reads it. A measure it cannot give stays out, with its reason
 * in `absent`: a window shows that as a dash and the reason, and 0 only ever means a reading of 0.
 */
export type LiveSample = Partial<Record<LiveField, number>> & {
  /** When it was read, in ms since the epoch. */
  at: number;
  /** The process it is about; none for the device as a whole. */
  app?: string;
  /** Why each measure this source cannot give is missing, in words for a person. */
  absent?: Partial<Record<LiveField, string>>;
  /** The frames behind `fps` and `jankyFrames`, where a source counts late ones: how many of what came, came on time. */
  framesDrawn?: number;
  /** The longest frame of this second, in ms, where a source sees frames: what a window marks as a stutter. */
  worstFrameMs?: number;
};

/**
 * A driver's live numbers, optional on a `Device` as `recorder?` and `network?` are. Reuses what the driver already reads
 * with. Nothing runs until `start`: sampling costs the device, so it is off until a person opens what shows it.
 */
export interface LiveMetrics {
  /**
   * Calls `onSample` about once a second until the answer is called, which is safe twice. What that returns ends with
   * the reading under way, which goes on asking the device: only then may it close.
   */
  start(onSample: (sample: LiveSample) => void, app?: string): Promise<() => unknown>;
}

/** Why a window's numbers are not a clean run's: a stream runs an encoder on the device. */
export const LIVE_NOISE = ['mirrored'] as const;

/** What a window is told, one a second: `{op: 'perf', sample, noise}`. A window asks with `{op: 'perfWatch', on}`. */
export const perfMessage = (sample: LiveSample) => ({
  op: 'perf' as const,
  sample,
  noise: LIVE_NOISE,
});
