import {
  osName,
  readVideo,
  reportProgress,
  videoStamps,
  type Device,
  type FrameMarks,
  type LogsAnswer,
  type ScreenRecorder,
} from '@appdyno/core';
import { writeTimeline } from '@appdyno/perf';
import type { ServerContext } from '../context.js';
import { captures, readCapture } from '../network.js';
import { redactLog } from '../policy.js';
import { stepsIn } from '../report-state.js';
import type { Session } from '../session.js';
import { assemble, NO_REQUESTS, STAMPED_VIDEO_MS, type Gathered } from './gather.js';

/** What is said of a recorder no one has measured: a reason, not a reading, and the page says it is one. */
const UNMEASURED_VIDEO_MS = 1_000;
const MAX_LOG_LINES = 2_000;

export type TimelineDone = { file: string; bytes: number; videoInside: boolean; text: string };

export type FrameRecording = { finish(): Promise<FrameMarks | { why: string }> };

/** Frames from now until `finish`: answered once they record, so what comes next lies inside them. */
export async function recordFrames(
  device: Device,
  app: string,
  seconds: number,
  keepSeconds?: number,
): Promise<FrameRecording> {
  let end: () => void = () => undefined;
  const ended = new Promise<void>((r) => (end = r));
  let up: () => void = () => undefined;
  const recording = new Promise<void>((r) => (up = r));
  const frames = device.measure
    .frameMarks(app, seconds, () => (up(), ended), keepSeconds)
    .then(
      (m): FrameMarks => m.value,
      (e: unknown) => {
        up();
        return { why: e instanceof Error ? e.message : String(e) };
      },
    );
  await recording;
  return {
    finish: () => {
      end();
      return frames;
    },
  };
}

/** A video on the device's clock: by its own stamps, or by what was measured of its recorder. */
export async function placeVideo(
  file: string,
  recorder: ScreenRecorder,
  startedAt: number,
  offsetMs: number,
) {
  const info = await readVideo(file);
  const stamps = await videoStamps(file);
  const lead = recorder.lead;
  return {
    facts: {
      bytes: info.bytes,
      codec: info.codec,
      width: info.width,
      height: info.height,
      firstAt: stamps?.[0] ?? startedAt - (lead?.ms ?? 0) + offsetMs,
    },
    withinMs: stamps ? STAMPED_VIDEO_MS : (lead?.withinMs ?? UNMEASURED_VIDEO_MS),
    by: stamps
      ? "each frame's own time in the file"
      : lead
        ? 'when its recording began, as measured of this recorder'
        : 'when its recording began, which no one has measured here: a guess',
  };
}

async function requestsOf(s: Session): Promise<Gathered['requests']> {
  const c = captures.read(s.device.serial);
  if (!c) return { entries: [], why: NO_REQUESTS };
  const read = await readCapture(s, c).catch(() => undefined);
  if (!read) return { entries: [], why: `the capture by ${c.via} could not be read` };
  return read.entries.some((e) => e.at) || read.entries.length === 0
    ? { entries: read.entries }
    : { entries: [], why: `the capture by ${c.via} counts traffic, and names no request` };
}

const size = (bytes: number) => `${(bytes / 2 ** 20).toFixed(1)} MB`;

type Page = Pick<
  Gathered,
  'reason' | 'from' | 'to' | 'clocks' | 'frames' | 'video' | 'noVideo' | 'samples'
> & {
  app: string;
  /** The process, for a log of one that may have gone. */
  pid?: string;
  /** Where its steps are. */
  steps: string;
  /** Where the page goes, and what it is called there. */
  dir: string;
  name?: string;
  videoFile?: string;
};

/** What every timeline ends with: the log and requests of its stretch, read now, and the page. */
export async function writePage(ctx: ServerContext, s: Session, p: Page): Promise<TimelineDone> {
  const { device } = s;
  reportProgress('writing the timeline');
  const logs: LogsAnswer = await device
    .logs({
      app: p.app,
      level: 'info',
      since: p.from,
      maxLines: MAX_LOG_LINES,
      timed: true,
      ...(p.pid && { pid: p.pid }),
    })
    .catch((e: unknown) => ({
      lines: [],
      source: '',
      note: e instanceof Error ? e.message : String(e),
    }));
  const t = assemble({
    title: `${p.app} on ${device.hello?.model ?? device.serial}${device.hello ? `, ${osName(device.platform, device.hello.osVersion)}` : ''}`,
    written: new Date().toISOString(),
    from: p.from,
    to: p.to,
    clocks: p.clocks,
    frames: p.frames,
    samples: p.samples,
    ...(p.reason && { reason: p.reason }),
    ...(p.video && { video: p.video }),
    ...(p.noVideo && { noVideo: p.noVideo }),
    logs: {
      ...logs,
      lines: logs.lines.slice(-MAX_LOG_LINES),
      ...(logs.marks && { marks: logs.marks.slice(-MAX_LOG_LINES) }),
    },
    requests: await requestsOf(s),
    steps: stepsIn(p.steps).flatMap((step) =>
      step.began === undefined
        ? []
        : [{ began: step.began, at: Date.parse(step.at), op: step.op, ok: step.ok }],
    ),
    clean: (text) => redactLog(ctx.policy, text),
    full: ctx.fullUrls,
  });
  const out = await writeTimeline(t, p.dir, p.video && p.videoFile, p.name);
  const said = p.video
    ? `video ${out.videoInside ? 'inside it' : `beside it, at ${size(p.video.facts.bytes)} too large to carry`}`
    : `no video: ${p.noVideo ?? 'it could not be read'}`;
  return {
    ...out,
    text: `timeline: ${out.file} (${size(out.bytes)}, ${said}; ${t.frames.marks.length} frames, ${t.logs.marks.length} log lines)`,
  };
}
