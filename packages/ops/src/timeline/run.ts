import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  measuredLive,
  measureClock,
  reportProgress,
  type ClockReading,
  type LiveSample,
} from '@appdyno/core';
import type { ServerContext } from '../context.js';
import { endRecording, filming } from '../record.js';
import type { Session } from '../session.js';
import { ToolError } from '../tool.js';
import { placeVideo, recordFrames, writePage, type TimelineDone } from './sources.js';

/** One segment of a recording keeps its frames' own times: past it they are lost in the join. */
const MAX_SECONDS = 180;

export type RunningTimeline = {
  /** Ends every source and writes the page; a second call is answered by the first. */
  finish(reason?: string): Promise<TimelineDone>;
};

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
  const frames = await recordFrames(device, app, MAX_SECONDS);

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
    // the video first: an iPhone's trace takes a minute to end, and the video would go on filming it
    const movie = await endRecording(s).catch((e: Error) => {
      noVideo = e.message;
      return undefined;
    });
    const marks = await frames.finish();
    const last = await measureClock(() => device.wallClock()).catch(() => first);
    const video =
      movie && !noVideo
        ? await placeVideo(file, recorder, startedAt, first.offsetMs).catch(() => undefined)
        : undefined;
    return writePage(ctx, s, {
      app,
      ...(pid && { pid }),
      ...(reason && { reason }),
      from,
      to,
      clocks: { first, last },
      frames: marks,
      ...(video && { video }),
      ...(noVideo && { noVideo }),
      samples,
      steps: dir,
      dir,
      videoFile: file,
    });
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
