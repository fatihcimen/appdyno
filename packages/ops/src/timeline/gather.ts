import {
  median,
  type ClockReading,
  type FrameMarks,
  type LiveSample,
  type LogsAnswer,
  type NetworkEntry,
} from '@appdyno/core';
import type {
  ClockSource,
  LogLine,
  RequestSpan,
  StallSpan,
  StepSpan,
  Timeline,
  TimelineRow,
  VideoFacts,
} from '@appdyno/perf';

/** A frame is in the video by the next refresh: 1 to 18 ms in the runs on an emulator, a draw stall against its freeze. */
export const STAMPED_VIDEO_MS = 20;
/** A log line's time is printed to the ms; a trace's is its own clock's, a step past it. */
const PRINTED_MS = 1;
/** A reading is taken somewhere in the second it stands for. */
const SAMPLE_MS = 1_000;
const DISPLAY_MS = 1_000 / 60;

const ON_DEVICE = 'the device';
const ON_MAC = 'this Mac';

/** What a run brought back, each by the clock it was read on. */
export type Gathered = {
  title: string;
  reason?: string;
  written: string;
  /** On the device's clock, as everything on the page is. */
  from: number;
  to: number;
  clocks: { first: ClockReading; last: ClockReading };
  frames: FrameMarks | { why: string };
  /** `by`: how it was put on the clock, in words: an estimate says it is one. */
  video?: { facts: VideoFacts; withinMs: number; by: string };
  noVideo?: string;
  samples: LiveSample[];
  logs: LogsAnswer;
  /** Why no request can be listed; none when a capture ran. */
  requests: { entries: NetworkEntry[]; why?: string };
  steps: { began: number; at: number; op: string; ok: boolean }[];
  /** Hides what is known to be secret, in anything from a device. */
  clean: (text: string) => string;
  /** A person asked for whole URLs. */
  full?: boolean;
};

/** A request by what it is called: no query, which is where a token rides, unless a person asked for it. */
export function requestName(e: NetworkEntry, clean: (s: string) => string, full = false) {
  const method = e.method ?? 'GET';
  if (!e.url) return `${e.direction ?? ''} ${e.host ?? ''}`.trim();
  if (full) return clean(`${method} ${e.url}`);
  try {
    const { host, pathname } = new URL(e.url);
    return clean(`${method} ${host}${pathname}`);
  } catch {
    // what is not a URL has no parts to keep apart: its start is all that can be said to be a name
    return clean(`${method} ${e.url.split(/[?#]/)[0]!}`);
  }
}

/** Android's own word for a main thread that came back late: all there is of a stop that left no long frame. */
const SKIPPED = /Skipped (\d+) frames!/;

/** A refresh on this device, by how its frames came. */
function refreshMs(frames: FrameMarks['frames']) {
  const gaps = frames.slice(1).map((f, i) => f.at - frames[i]!.at);
  const usual = median(gaps.filter((g) => g > 0));
  return usual >= 4 && usual <= 34 ? usual : DISPLAY_MS;
}

/**
 * Each stop of the main thread its log tells of, from `n` refreshes before the line to the line. What a long frame
 * already shows is left out: one stop is one row.
 */
export function stallsIn(logs: LogsAnswer, frames: FrameMarks['frames']): StallSpan[] {
  const each = refreshMs(frames);
  return logs.lines.flatMap((line, i) => {
    const n = SKIPPED.exec(line)?.[1];
    const mark = logs.marks?.[i];
    if (!n || !mark) return [];
    const ms = Number(n) * each;
    const span = { at: mark.at - ms, ms, how: 'Skipped frames in its log' };
    const shown = frames.some((f) => f.ms >= ms / 2 && f.at < mark.at && f.at + f.ms > span.at);
    return shown ? [] : [span];
  });
}

const inStretch = (at: number, g: Gathered) => at >= g.from && at <= g.to;

/** What the samples say of one measure: its marks, or why a device had none. */
function readings<T>(
  g: Gathered,
  field: keyof NonNullable<LiveSample['absent']>,
  make: (s: LiveSample, at: number) => T | undefined,
): TimelineRow<T> {
  const offset = g.clocks.first.offsetMs;
  const marks = g.samples.flatMap((s) => {
    const m = inStretch(s.at + offset, g) ? make(s, s.at + offset) : undefined;
    return m === undefined ? [] : [m];
  });
  const absent = g.samples.findLast((s) => s.absent?.[field])?.absent?.[field];
  return marks.length === 0 && absent ? { marks, absent } : { marks };
}

function clockSources(g: Gathered, frames: FrameMarks | undefined): ClockSource[] {
  const mac = g.clocks.first.boundMs + Math.abs(g.clocks.last.offsetMs - g.clocks.first.offsetMs);
  const moved = 'the offset measured';
  return [
    ...(g.video
      ? [
          {
            row: 'Video',
            readOn: ON_DEVICE,
            by: g.video.by,
            withinMs: g.video.withinMs,
          },
        ]
      : []),
    ...(frames?.frames.length
      ? [{ row: 'Frames', readOn: ON_DEVICE, by: 'their trace', withinMs: PRINTED_MS }]
      : []),
    ...(frames?.input?.length
      ? [{ row: 'Touches', readOn: ON_DEVICE, by: 'their trace', withinMs: PRINTED_MS }]
      : []),
    ...(g.logs.marks?.length
      ? [{ row: 'Log', readOn: ON_DEVICE, by: 'the time on each line', withinMs: PRINTED_MS }]
      : []),
    ...(g.steps.length ? [{ row: 'Steps', readOn: ON_MAC, by: moved, withinMs: mac }] : []),
    ...(g.requests.entries.length
      ? [{ row: 'Requests', readOn: ON_MAC, by: moved, withinMs: mac }]
      : []),
    ...(g.samples.length
      ? [{ row: 'Memory, traffic', readOn: ON_MAC, by: moved, withinMs: mac + SAMPLE_MS }]
      : []),
  ];
}

export const NO_REQUESTS = 'no capture ran: `network start` before a timeline lists them here';

/** All of it on one clock, as the page takes it. */
export function assemble(g: Gathered): Timeline {
  const { first, last } = g.clocks;
  const offset = first.offsetMs;
  const marks = 'why' in g.frames ? undefined : g.frames;
  const frames = (marks?.frames ?? []).filter((f) => inStretch(f.at, g));
  const logs: LogLine[] = g.logs.lines.flatMap((line, i) => {
    const mark = g.logs.marks?.[i];
    if (!mark || !inStretch(mark.at, g)) return [];
    return [{ at: mark.at, text: g.clean(line), ...(mark.level && { level: mark.level }) }];
  });
  const steps: StepSpan[] = g.steps.map((s) => ({
    at: s.began + offset,
    ms: s.at - s.began,
    name: s.op,
    ok: s.ok,
  }));
  const requests: RequestSpan[] = g.requests.entries.flatMap((e) => {
    if (!e.at) return [];
    return [
      {
        at: Date.parse(e.at) + offset,
        ...(e.ms !== undefined && { ms: e.ms }),
        name: requestName(e, g.clean, g.full),
        ...(e.status !== undefined && { status: e.status }),
        ...(e.error && { failed: true }),
      },
    ];
  });
  const stalls = stallsIn(g.logs, frames).filter((s) => inStretch(s.at + s.ms, g));
  const none = marks ? undefined : (g.frames as { why: string }).why;
  return {
    title: g.title,
    ...(g.reason && { reason: g.clean(g.reason) }),
    written: g.written,
    from: g.from,
    to: g.to,
    clock: {
      offsetMs: offset,
      boundMs: first.boundMs,
      driftMs: Math.round((last.offsetMs - offset) * 10) / 10,
      sources: clockSources(g, marks),
    },
    ...(g.video && { video: g.video.facts }),
    ...(g.noVideo && { noVideo: g.noVideo }),
    frames: {
      marks: frames,
      ...(none && { absent: none }),
      ...(marks?.limits && { note: marks.limits }),
    },
    stalls: { marks: stalls },
    touches: {
      marks: (marks?.input ?? []).filter((m) => inStretch(m.at, g)),
      ...(!marks?.input && {
        absent: 'this device does not say what reached the app: Steps are what this tool sent',
      }),
    },
    steps: { marks: steps },
    network: {
      marks: requests,
      ...(g.requests.why
        ? { absent: g.requests.why }
        : { note: g.full ? 'whole URLs, as asked' : 'method, host and path, no query' }),
    },
    traffic: readings(g, 'networkInKbps', (s, at) =>
      s.networkInKbps === undefined
        ? undefined
        : { at, inKbps: s.networkInKbps, outKbps: s.networkOutKbps ?? 0 },
    ),
    logs: {
      marks: logs,
      ...(g.logs.lines.length === 0 && g.logs.note && { absent: g.logs.note }),
    },
    memory: readings(g, 'memoryMb', (s, at) =>
      s.memoryMb === undefined ? undefined : { at, mb: s.memoryMb },
    ),
  };
}
