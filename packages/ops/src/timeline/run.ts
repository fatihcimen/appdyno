import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  type ClockReading,
  type FrameMarks,
  measuredLive,
  measureClock,
  osName,
  readVideo,
  reportProgress,
  videoStamps,
  type LiveSample,
  type LogsAnswer,
} from '@appdyno/core';
import { writeTimeline } from '@appdyno/perf';
import type { ServerContext } from '../context.js';
import { captures, readCapture } from '../network.js';
import { redactLog } from '../policy.js';
import { endRecording, filming } from '../record.js';
import { stepsIn } from '../report-state.js';
import type { Session } from '../session.js';
import { ToolError } from '../tool.js';
import { assemble, NO_REQUESTS, STAMPED_VIDEO_MS, type Gathered } from './gather.js';

/** One segment of a recording keeps its frames' own times: past it they are lost in the join. */
const MAX_SECONDS = 180;
/** What is said of a recorder no one has measured: a reason, not a reading, and the page says it is one. */
const UNMEASURED_VIDEO_MS = 1_000;
const MAX_LOG_LINES = 2_000;

export type TimelineDone = { file: string; bytes: number; videoInside: boolean; text: string };

export type RunningTimeline = {
  /** Ends every source and writes the page; a second call is answered by the first. */
  finish(reason?: string): Promise<TimelineDone>;
};

const size = (bytes: number) => `${(bytes / 2 ** 20).toFixed(1)} MB`;

async function requestsOf(s: Session): Promise<Gathered['requests']> {
  const c = captures.read(s.device.serial);
  if (!c) return { entries: [], why: NO_REQUESTS };
  const read = await readCapture(s, c).catch(() => undefined);
  if (!read) return { entries: [], why: `the capture by ${c.via} could not be read` };
  return read.entries.some((e) => e.at) || read.entries.length === 0
    ? { entries: read.entries }
    : { entries: [], why: `the capture by ${c.via} counts traffic, and names no request` };
}

/** The video as the page takes it: on the device's clock by its own stamps, or by what was measured of its recorder. */
async function placed(file: string, startedAt: number, s: Session, offsetMs: number) {
  const info = await readVideo(file);
  const stamps = await videoStamps(file);
  const lead = s.device.recorder.lead;
  return {
    facts: {
      bytes: info.bytes,
      codec: info.codec,
      width: info.width,
      height: info.height,
      firstAt: stamps?.[0] ?? startedAt - (lead?.ms ?? 0) + offsetMs,
    },
    withinMs: stamps ? STAMPED_VIDEO_MS : (lead?.withinMs ?? UNMEASURED_VIDEO_MS),
  };
}

/**
 * Starts every source of a timeline, frames first, as only what lies inside a trace is on it. Each stands alone: one a
 * device cannot give leaves its row empty, with its reason, and takes nothing else with it.
 */
export async function startTimeline(
  ctx: ServerContext,
  s: Session,
  app: string,
  dir: string,
): Promise<string> {
  const { device } = s;
  const { serial, recorder, measure } = device;
  const running = filming.read(serial);
  if (running)
    throw new ToolError(
      `a recording has run on ${serial} since ${running.since}: stop it first, as a timeline makes its own`,
      'INVALID_ARGUMENT',
    );
  const first: ClockReading = await measureClock(() => device.wallClock());
  if (measure.framesByProbe) await measure.attachProbe(app);

  let endFrames = () => undefined as void;
  const ended = new Promise<void>((r) => (endFrames = r));
  let up = () => undefined as void;
  const recording = new Promise<void>((r) => (up = r));
  const frames: Promise<FrameMarks | { why: string }> = measure
    .frameMarks(app, MAX_SECONDS, () => (up(), ended))
    .then(
      (m) => m.value,
      (e: Error) => (up(), { why: e.message }),
    );
  await recording;

  const pid = await device.appPid?.(app);
  const file = join(dir, 'video', `screen.${recorder.extension}`);
  mkdirSync(dirname(file), { recursive: true });
  let noVideo: string | undefined;
  await recorder.start(file, { maxSeconds: MAX_SECONDS }).then(
    (handle) =>
      filming.write(serial, { handle, since: new Date().toISOString(), file, owner: s.owner }),
    (e: Error) => (noVideo = e.message),
  );
  const startedAt = Date.now();

  const samples: LiveSample[] = [];
  const endLive = await (device.liveMetrics ?? measuredLive(device)).start(
    (sample) => samples.push(sample),
    app,
  );
  const from = startedAt + first.offsetMs;

  const finishing = async (reason?: string): Promise<TimelineDone> => {
    reportProgress('ending the timeline');
    const to = Date.now() + first.offsetMs;
    endLive();
    endFrames();
    const marks = await frames;
    const movie = await endRecording(s).catch((e: Error) => {
      noVideo = e.message;
      return undefined;
    });
    const last = await measureClock(() => device.wallClock()).catch(() => first);
    const logs: LogsAnswer = await device
      .logs({
        app,
        level: 'info',
        since: from,
        maxLines: MAX_LOG_LINES,
        timed: true,
        ...(pid && { pid }),
      })
      .catch((e: Error) => ({ lines: [], source: '', note: e.message }));
    const video =
      movie && !noVideo
        ? await placed(file, startedAt, s, first.offsetMs).catch(() => undefined)
        : undefined;
    const t = assemble({
      title: `${app} on ${device.hello?.model ?? serial}${device.hello ? `, ${osName(device.platform, device.hello.osVersion)}` : ''}`,
      ...(reason && { reason }),
      written: new Date().toISOString(),
      from,
      to,
      clocks: { first, last },
      frames: marks,
      ...(video && { video }),
      ...(noVideo && { noVideo }),
      samples,
      logs: {
        ...logs,
        lines: logs.lines.slice(-MAX_LOG_LINES),
        ...(logs.marks && { marks: logs.marks.slice(-MAX_LOG_LINES) }),
      },
      requests: await requestsOf(s),
      steps: stepsIn(dir).flatMap((step) =>
        step.began === undefined
          ? []
          : [{ began: step.began, at: Date.parse(step.at), op: step.op, ok: step.ok }],
      ),
      clean: (text) => redactLog(ctx.policy, text),
    });
    const out = await writeTimeline(t, dir, video && file);
    const said = video
      ? `video ${out.videoInside ? 'inside it' : `beside it, at ${size(video.facts.bytes)} too large to carry`}`
      : `no video: ${noVideo ?? 'it could not be read'}`;
    return {
      ...out,
      text: `timeline: ${out.file} (${size(out.bytes)}, ${said}; ${t.frames.marks.length} frames, ${t.logs.marks.length} log lines)`,
    };
  };

  let finished: Promise<TimelineDone> | undefined;
  s.timeline = {
    finish: (reason) => {
      s.timeline = undefined;
      return (finished ??= finishing(reason));
    },
  };
  return `timeline of ${app} on one clock, at most ${MAX_SECONDS} s, in ${dir}: its device reads ${first.offsetMs} ms from this Mac, ±${first.boundMs} ms. stop writes it`;
}
