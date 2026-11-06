import { readFileSync, rmSync } from 'node:fs';
import {
  deviceStateFile,
  MirrorSession,
  NEEDS,
  pause,
  readState,
  startViewer,
  writeState,
  type MotionRegion,
  type MotionWatch,
} from '@appdyno/core';
import { z } from 'zod';
import type { ServerContext } from './context.js';
import { liveMirror } from './mirror-state.js';
import type { Session } from './session.js';
import { ToolError } from './tool.js';

/** A stream that shows nothing in this long is refused, as a window's first picture is. */
const LIVE_MS = 20_000;
const ANSWER_SLACK_MS = 5_000;
/** A stream's first frames are a keyframe and a rush: on an emulator they read as a jump. */
const SETTLE_MS = 700;
const POLL_MS = 100;
const REGIONS_SAID = 6;
/** Under this many frames a second, a speed and a jump are guesses. */
const FEW_FRAMES = 15;
const EVENTS_SAID = 3;
/** Tiles are this share of a frame's width: a region's edges are no nearer than that to the screen's. */
const EDGE = 0.07;

const cannot = (why: string, fix?: string) =>
  new ToolError(`cannot watch this device: ${why}`, 'UNSUPPORTED', fix);

/** One slot to a device: a second watch takes the first's place, and the first hears that its window did not answer. */
const asked = (serial: string) => deviceStateFile('watch', serial);
const answered = (serial: string) => deviceStateFile('watch', `${serial}.answer`);

const Request = z.object({ id: z.string(), ms: z.number(), strip: z.boolean() });
/** What a viewer said of a watch, under the id it answers. */
const Answer = z.looseObject({ id: z.string() });

/** In the process that holds a window: another's request goes to its one stream, and the answer back by a file. */
export function answerWatches(serial: string, session: Pick<MirrorSession, 'watch'>) {
  let seen: string | undefined;
  return () => {
    const r = readState(asked(serial), Request);
    if (!r || r.id === seen) return;
    seen = r.id;
    void session.watch(r.ms, r.strip).then((m) => writeState(answered(serial), { ...m, id: r.id }));
  };
}

/** The stream a window has: there is one to a device. */
async function byWindow(serial: string, ms: number, strip: boolean) {
  const id = `${process.pid}-${Date.now()}`;
  rmSync(answered(serial), { force: true });
  writeState(asked(serial), { id, ms, strip });
  const end = Date.now() + ms + ANSWER_SLACK_MS;
  while (Date.now() < end) {
    const a = readState(answered(serial), Answer);
    if (a?.id === id) {
      rmSync(answered(serial), { force: true });
      return a as MotionWatch;
    }
    await pause(POLL_MS);
  }
  throw cannot('its window did not answer', 'look at `mirror status`');
}

/** With no window, a stream of its own for this watch alone, on a viewer nothing shows. */
async function byOwnStream(ctx: ServerContext, serial: string, ms: number, strip: boolean) {
  const device = ctx.deviceFor(serial);
  const session = new MirrorSession({
    mirror: device.mirror,
    viewer: startViewer(true),
    options: { quality: 'standard' },
    title: serial,
    noInput: true,
  });
  try {
    await session.start();
    const end = Date.now() + LIVE_MS;
    for (;;) {
      const status = session.status;
      if (status.state === 'live') break;
      if (status.state === 'stopped') throw cannot(status.why);
      if (status.state === 'waiting')
        throw cannot(NEEDS[status.need].title, NEEDS[status.need].fix);
      if (Date.now() > end) throw cannot(`no picture came in ${LIVE_MS / 1_000} s`);
      await pause(POLL_MS);
    }
    await pause(SETTLE_MS);
    return await Promise.race([
      session.watch(ms, strip),
      pause(ms + ANSWER_SLACK_MS).then(() => {
        throw cannot('its stream stopped answering');
      }),
    ]);
  } finally {
    await session.stop('the watch is over');
    device.close();
  }
}

export async function watchScreen(ctx: ServerContext, s: Session, ms: number, strip: boolean) {
  const serial = s.device.serial;
  const watched = await (liveMirror(serial)
    ? byWindow(serial, ms, strip)
    : byOwnStream(ctx, serial, ms, strip));
  if (watched.why) throw cannot(watched.why);
  return watched;
}

const span = (from: number, length: number, size: number) =>
  `${Math.round(from * size)}-${Math.round((from + length) * size)}`;

const seconds = (ms: number) => `${(ms / 1_000).toFixed(1)} s`;

const eventWords = (e: NonNullable<MotionRegion['events']>[number], size: number) =>
  e.kind === 'back'
    ? `ran backwards at ${seconds(e.at)}`
    : e.kind === 'stop'
      ? `stopped at ${seconds(e.at)}`
      : `jumped ${Math.abs(Math.round(e.by * size))} at ${seconds(e.at)}`;

/**
 * A clipped edge inside the screen is what a person would call cut, the screen's own is not, and only what has
 * travelled as far as that edge shows there is one: a line that barely moved just has not got there.
 */
const cuts = (r: MotionRegion, w: number, h: number, ms: number) => {
  const [from, to, size] = r.axis === 'y' ? [r.y, r.y + r.h, h] : [r.x, r.x + r.w, w];
  const name = r.axis === 'y' ? 'y' : 'x';
  const travelled = ((r.speed ?? 0) * ms) / 1_000;
  return [
    ...(from > EDGE && travelled >= from ? [`cut at ${name} ${Math.round(from * size)}`] : []),
    ...(to < 1 - EDGE && travelled >= 1 - to ? [`cut at ${name} ${Math.round(to * size)}`] : []),
  ];
};

/** One line for a region, in the units a `tap` takes. */
export function regionLine(r: MotionRegion, screen: { w: number; h: number }, ms: number) {
  const { w, h } = screen;
  if (r.kind === 'changes')
    return `x ${span(r.x, r.w, w)}, y ${span(r.y, r.h, h)}: changes, in no direction a frame can follow`;
  const along = r.axis === 'y' ? h : w;
  const way = r.axis === 'y' ? (r.sign! < 0 ? 'up' : 'down') : r.sign! < 0 ? 'left' : 'right';
  const where = r.axis === 'y' ? `x ${span(r.x, r.w, w)}` : `y ${span(r.y, r.h, h)}`;
  const events = r.events ?? [];
  return [
    `${where}: moves ${way} at ${Math.round((r.speed ?? 0) * along)}/s`,
    ...events.slice(0, EVENTS_SAID).map((e) => eventWords(e, along)),
    ...(events.length > EVENTS_SAID ? [`${events.length - EVENTS_SAID} more of those`] : []),
    ...(events.length === 0 ? ['smoothly'] : []),
    ...cuts(r, w, h, ms),
  ].join(', ');
}

/** The answer: short, as this has to cost far less than a picture. */
export function motionText(m: MotionWatch, screen: { w: number; h: number }) {
  const { frames = 0, ms = 0, noisy = false, regions = [] } = m.summary ?? {};
  const rate = ms > 0 ? ` (${Math.round((frames * 1_000) / ms)}/s)` : '';
  const head = `watched ${seconds(ms)}: ${frames} frames${rate}`;
  if (frames < 2) return `${head}: nothing moved, as the stream sent nothing new`;
  if (regions.length === 0) return `${head}: nothing moved`;
  const big = regions.toSorted((a, b) => b.w * b.h - a.w * a.h);
  return [
    head,
    ...(noisy
      ? ['much of the screen changes at once, as a video or a game: read this as noise']
      : []),
    ...((frames * 1_000) / ms < FEW_FRAMES
      ? ['few frames came: speeds and jumps here are guesses']
      : []),
    ...big.slice(0, REGIONS_SAID).map((r) => regionLine(r, screen, ms)),
    ...(big.length > REGIONS_SAID ? [`and ${big.length - REGIONS_SAID} smaller`] : []),
  ].join('\n');
}

/**
 * Whether something moved inside this box, in tap units; none: anywhere. A spinner or a video only changes, with no way
 * it goes: that is no move to wait for, and neither is it keeping still, so `anyChange` counts those too.
 */
export const movedIn = (
  m: MotionWatch,
  screen: { w: number; h: number },
  box?: { x: number; y: number; w: number; h: number },
  anyChange = false,
) =>
  (m.summary?.regions ?? []).some(
    (r) =>
      (anyChange || r.kind === 'moves') &&
      (!box ||
        (r.x * screen.w < box.x + box.w &&
          (r.x + r.w) * screen.w > box.x &&
          r.y * screen.h < box.y + box.h &&
          (r.y + r.h) * screen.h > box.y)),
  );

/** The film strip, once: a person's screen does not stay in a file. */
export function takeStrip(m: MotionWatch) {
  if (!m.strip) return undefined;
  const data = readFileSync(m.strip.file).toString('base64');
  rmSync(m.strip.file, { force: true });
  return { data, at: m.strip.at };
}
