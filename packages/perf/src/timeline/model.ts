/**
 * One stretch of a device's time, each thing where it was. Every `at` is in ms since the epoch by the device's own clock:
 * what was read there needs nothing done to it, and what was read on the Mac is moved by the offset measured.
 */
export type Span = { at: number; ms: number };

/** A row of the page: what it holds, or why a device could not give it, as `cannot` says it. */
export type TimelineRow<T> = { marks: T[]; absent?: string; note?: string };

export type FrameSpan = Span & { late?: boolean };
export type StepSpan = Span & { name: string; ok: boolean };
/** A long stop of the main thread that no frame shows: `how` says what saw it. */
export type StallSpan = Span & { how: string };
export type RequestSpan = {
  at: number;
  ms?: number;
  /** Method, host and path, unless a person asked for more. */
  name: string;
  status?: number;
  failed?: boolean;
};
export type LogLine = { at: number; text: string; level?: 'warn' | 'error' };
export type MemorySample = { at: number; mb: number };
export type TrafficSample = { at: number; inKbps: number; outKbps: number };

/** How one row was put on the clock, and how far it can be from the truth, in ms either way. */
export type ClockSource = { row: string; readOn: string; by: string; withinMs: number };

export type TimelineClock = {
  /** The device's clock minus the Mac's, in ms, and how far that can be out. */
  offsetMs: number;
  boundMs: number;
  /** What it moved by between the first reading and the last. */
  driftMs: number;
  sources: ClockSource[];
};

export type VideoFacts = {
  bytes: number;
  codec: string;
  width: number;
  height: number;
  /** The first frame, on the clock: a moment's place in the video is its distance from this. */
  firstAt: number;
};

export type Timeline = {
  title: string;
  /** Why this was kept, where something set it off. */
  reason?: string;
  written: string;
  from: number;
  to: number;
  clock: TimelineClock;
  video?: VideoFacts;
  /** Why there is no video. */
  noVideo?: string;
  frames: TimelineRow<FrameSpan>;
  stalls: TimelineRow<StallSpan>;
  touches: TimelineRow<Span>;
  steps: TimelineRow<StepSpan>;
  network: TimelineRow<RequestSpan>;
  traffic: TimelineRow<TrafficSample>;
  logs: TimelineRow<LogLine>;
  memory: TimelineRow<MemorySample>;
};

/** What a frame this long is called, where a source calls none late: a screen that visibly stopped. */
export const SLOW_FRAME_MS = 100;
