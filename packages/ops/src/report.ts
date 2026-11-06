import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { safeName, stateDir } from '@appdyno/core';
import { z } from 'zod';
import type { ServerContext } from './context.js';
import { checkApp } from './policy.js';
import { journaled } from './report-journal.js';
import { openReports } from './report-state.js';
import { writeReport } from './report-write.js';
import { ReportOut } from './schemas.js';
import type { Session } from './session.js';
import {
  DEFAULT_FLIGHT_SECONDS,
  MAX_FLIGHT_SECONDS,
  MIN_FLIGHT_SECONDS,
  startFlight,
  type RunningFlight,
} from './timeline/flight.js';
import { startTimeline } from './timeline/run.js';
import { defineOp, DESTRUCTIVE, reply, ToolError } from './tool.js';

/** Sources run in this process, so one that ends with the command has nothing to give. */
function stayingApp(ctx: ServerContext, s: Session, command: 'timeline' | 'flight') {
  if (!s.owner)
    throw new ToolError(
      `this runs in a process that stays, and a command ends here: \`appdyno ${command}\``,
      'UNSUPPORTED',
    );
  const app = checkApp(ctx.policy, s.appId ?? '');
  if (!app) throw new ToolError('select an app with use_device first', 'INVALID_ARGUMENT');
  return app;
}

async function startFlightOn(ctx: ServerContext, s: Session, dir: string | undefined) {
  if (s.flight)
    throw new ToolError(`a flight recorder runs on ${s.device.serial}`, 'INVALID_ARGUMENT');
  const asked = ctx.flightSeconds ?? DEFAULT_FLIGHT_SECONDS;
  const seconds = Math.max(MIN_FLIGHT_SECONDS, Math.min(asked, MAX_FLIGHT_SECONDS));
  const app = stayingApp(ctx, s, 'flight');
  s.flight = await startFlight(ctx, s, app, seconds, dir && resolve(dir));
  const t = `flight recorder on: the last ${seconds} s of ${app}, kept on a crash or a stall; report stop ends it`;
  return reply(t, { done: t, dir: dir ?? '' });
}

async function stopFlight(s: Session, flight: RunningFlight) {
  await flight.stop();
  s.flight = undefined;
  const t = [`flight recorder off, ${flight.saved.length} kept`, ...flight.saved].join('\n');
  return reply(t, { done: t, dir: '', saved: flight.saved });
}

async function keepFlight(flight: RunningFlight) {
  const page = await flight.save();
  const t = page ? `kept: ${page}` : 'a save is under way';
  return reply(t, { done: t, dir: dirname(page ?? ''), ...(page && { file: page }) });
}

/** Where a report goes that was not told. */
const namedDir = (serial: string, dir: string | undefined) =>
  resolve(
    dir ??
      join(
        stateDir(),
        'reports',
        `${safeName(serial)}-${new Date().toISOString().replace(/\W/g, '')}`,
      ),
  );

async function startReport(
  ctx: ServerContext,
  s: Session,
  action: 'start' | 'timeline',
  dir: string | undefined,
) {
  const serial = s.device.serial;
  const open = openReports.read(serial);
  if (open)
    throw new ToolError(
      `a report is open on ${serial} since ${new Date(open.since).toISOString()}: stop it first`,
      'INVALID_ARGUMENT',
    );
  const app = action === 'timeline' ? stayingApp(ctx, s, 'timeline') : undefined;
  const to = namedDir(serial, dir);
  mkdirSync(to, { recursive: true });
  openReports.write(serial, { dir: to, since: Date.now(), owner: s.owner });
  const t = app
    ? await startTimeline(ctx, s, app, to).catch((e: unknown) => {
        openReports.remove(serial);
        throw e;
      })
    : `keeping steps for a report in ${to}`;
  return reply(t, { done: t, dir: to });
}

async function finishReport(
  ctx: ServerContext,
  s: Session,
  action: 'write' | 'stop',
  dir: string | undefined,
) {
  const serial = s.device.serial;
  const open = openReports.read(serial);
  if (action === 'stop' && !open)
    throw new ToolError(`no report is open on ${serial}`, 'NOT_FOUND');
  const timeline = action === 'stop' ? await s.timeline?.finish() : undefined;
  const r = await writeReport(ctx, s, open?.dir ?? namedDir(serial, dir), open?.since);
  if (action === 'stop') openReports.remove(serial);
  const t = [
    `report: ${r.file} (${r.steps} steps, ${r.measurements} measurements)`,
    ...(timeline ? [timeline.text] : []),
  ].join('\n');
  return reply(t, {
    done: t,
    dir: dirOf(r.file),
    file: r.file,
    steps: r.steps,
    ...(timeline && { timeline: timeline.file, timelineBytes: timeline.bytes }),
  });
}

const dirOf = (file: string) => file.slice(0, -'/index.html'.length);

export function reportFor(ctx: ServerContext) {
  /** A session is over: its open report is written. */
  const close = async (s: Session) => {
    const open = openReports.read(s.device.serial);
    if (!open) return undefined;
    await s.timeline?.finish();
    const r = await writeReport(ctx, s, open.dir, open.since);
    openReports.remove(s.device.serial);
    return r;
  };

  const ops = () => [
    defineOp({
      name: 'report',
      title: 'Session report',
      description:
        "index.html: steps, video, logs, crashes, measurements; secrets hidden. start (dir), until stop or the session's end; write: now. timeline: one page on one clock. flight: last seconds, kept on a crash or stall.",
      input: z
        .object({
          action: z.enum(['start', 'timeline', 'flight', 'write', 'stop']),
          dir: z.string().max(1_000).optional(),
        })
        .strict(),
      output: ReportOut,
      annotations: DESTRUCTIVE,
      run: async ({ action, dir }) => {
        const s = await ctx.session();
        if (action === 'flight') return startFlightOn(ctx, s, dir);
        if (action === 'stop' && s.flight) return stopFlight(s, s.flight);
        if (action === 'write' && s.flight) return keepFlight(s.flight);
        if (action === 'start' || action === 'timeline') return startReport(ctx, s, action, dir);
        return finishReport(ctx, s, action, dir);
      },
    }),
  ];

  return { wrap: journaled(ctx), close, ops };
}
