import {
  callSignal,
  deviceStateFile,
  exclusively,
  sleep,
  throwIfCancelled,
  type TraceDigest,
  type HitchSummary,
  must,
} from '@appdyno/core';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DeviceError } from '@appdyno/protocol';
import { xcodeEnv } from './simctl.js';
import { heldTable, hitchSummary, stallSpans, traceDigest } from './trace-parse.js';
import { exporting, stoppedLate, traceTable } from './trace-read.js';
import { childrenNamed, endLeftBehind, HUB } from './left-behind.js';
import { startWord } from './trace-processes.js';
import { watchKtraces } from './trace-temp.js';

export { traceDetail, traceTable } from './trace-read.js';

/**
 * How long a recording may take to stop after its time limit before it is ended (a phone took 14 s; a signal at 60 s
 * on a Mac at load 200 left a trace that reads "instrument run data is missing").
 */
const STOP_MS = 120_000;

/** The whole recording is cut at this, whatever the tool does. */
const CAP_MS = 240_000;

/** How long the tool may take to say it has started before `during` runs without it. */
const START_MS = 90_000;
const KILL_MS = 30_000;

/** A recording attached to a process leaves the tool blind to it for a while: 189 and 196 s, measured, on iOS 27.2. */
const FIND_PROCESS_MS = 240_000;
const FIND_RETRY_MS = 5_000;

export type TraceRecording = {
  template: string;
  /** `template` names one instrument: for when the whole template cannot record. */
  instrument?: boolean;
  device: string;
  /** A process to attach to; none, or one the tool cannot find: every process. */
  attach?: () => Promise<number>;
  /** What every process cannot answer: a process the tool cannot find is looked up once more instead. */
  attachedOnly?: boolean;
  /** Started by the tool itself, with this environment, in place of an attach. */
  launch?: { app: string; env?: Record<string, string> };
  seconds: number;
  dir: string;
  during?: () => Promise<unknown>;
  /** Ends when `during` does, rather than when `seconds` are up. */
  endWithDuring?: boolean;
};

/**
 * Records one trace with Xcode's trace tool: `during` starts when the tool says the recording has
 * started, and the stop is bounded. The trace stays at `dir` for Instruments.
 */
export async function recordTrace(r: TraceRecording): Promise<string> {
  const tracePath = await exclusively(
    deviceStateFile('traces-recording', r.device),
    r.template,
    (o) =>
      new DeviceError(
        'DEVICE_CLAIMED',
        `a recording is running on ${r.device} (${o.tool}, pid ${o.pid}, since ${o.since}): a second would come back empty`,
        'wait for it to end',
      ),
    () => recordInTurn(r),
  );
  newest.set(r.device, { tracePath, at: Date.now() });
  return tracePath;
}

/** The newest recording of each device, and when it ended. */
const newest = new Map<string, { tracePath: string; at: number }>();

/** How long what a recording says of a device's state stays true of it. */
const RECENT_MS = 300_000;

/** What this process last recorded of a device, while it says something of the device as it is now. */
export function recentTrace(device: string) {
  const held = newest.get(device);
  return held && Date.now() - held.at < RECENT_MS ? held.tracePath : undefined;
}

async function recordInTurn(r: TraceRecording): Promise<string> {
  const givenUp = Date.now() + FIND_PROCESS_MS;
  for (;;) {
    const pid = await r.attach?.();
    try {
      return await recordOnce(r, pid);
    } catch (e) {
      // a phone's tool stops finding running processes after an attached recording, whichever way they are named
      // (the same live process not found, then found, with the tool's service restarted too)
      if (!pid || !(e as Error).message.includes('Cannot find process')) throw e;
      // every process is still recorded, where that has what is asked
      if (!r.attachedOnly) return recordOnce(r, undefined);
      if (Date.now() > givenUp)
        throw new DeviceError(
          'TIMEOUT',
          `the trace tool did not find process ${pid} for ${FIND_PROCESS_MS / 1000} s, though it runs`,
        );
      await sleep(FIND_RETRY_MS);
      throwIfCancelled('the recording');
    }
  }
}

/** What the tool said of a failed recording: its errors, else how its output ends. */
const failure = (log: string) => {
  const lines = log.trim().split('\n');
  const errors = lines.flatMap((l) => /\[Error\]\s*(.*)/.exec(l)?.[1] ?? []);
  return (errors.length ? errors : lines.slice(-2)).join(' ');
};

async function recordOnce(r: TraceRecording, attach: number | undefined): Promise<string> {
  await mkdir(r.dir, { recursive: true });
  const tracePath = join(
    r.dir,
    `${r.template.toLowerCase().replace(/\W+/g, '-')}-${Date.now()}.trace`,
  );
  const temp = await watchKtraces({ spanMs: CAP_MS + KILL_MS });
  const note = `dev.appdyno.trace.${randomBytes(6).toString('hex')}`;
  const word = startWord(note, START_MS);
  const { started } = word;
  const signal = callSignal();
  const rec = spawn(
    'xcrun',
    [
      'xctrace',
      'record',
      r.instrument ? '--instrument' : '--template',
      r.template,
      '--device',
      r.device,
      '--time-limit',
      `${r.seconds}s`,
      '--notify-tracing-started',
      note,
      '--output',
      tracePath,
      '--no-prompt',
      // what is launched takes the rest of the line
      ...(r.launch
        ? [
            ...Object.entries(r.launch.env ?? {}).flatMap(([k, v]) => ['--env', `${k}=${v}`]),
            '--launch',
            '--',
            r.launch.app,
          ]
        : attach
          ? ['--attach', String(attach)]
          : ['--all-processes']),
    ],
    { env: xcodeEnv(), ...(signal && { signal }) },
  );
  if (rec.pid) temp.follow(rec.pid);
  const left = new Set<number>();
  const helpers = async () => {
    for (const pid of rec.pid ? await childrenNamed(rec.pid, HUB) : []) left.add(pid);
  };
  let log = '';
  rec.stdout.on('data', (b: Buffer) => (log += String(b)));
  rec.stderr.on('data', (b: Buffer) => (log += String(b)));
  const exited = new Promise<number | null>((res) => {
    rec.on('exit', res);
    rec.on('error', () => res(-1));
  });
  const began = Date.now();
  // a tool still at work at its limit: a read of what it leaves that fails says so
  const cut = () => {
    const s = Math.round((Date.now() - began) / 1000);
    stoppedLate(
      tracePath,
      `did not finish a ${r.seconds} s recording by itself: it was stopped ${s} s in`,
    );
    rec.kill('SIGINT');
  };
  let stop = setTimeout(cut, CAP_MS);
  let end = setTimeout(() => rec.kill('SIGKILL'), CAP_MS + KILL_MS);
  // its limit counts from its start, which took more than a minute on a Mac at load 200
  let over = false;
  void started.then(() => {
    if (over) return;
    void helpers();
    const limit = Math.min(r.seconds * 1000 + STOP_MS, CAP_MS);
    clearTimeout(stop);
    clearTimeout(end);
    stop = setTimeout(cut, limit);
    end = setTimeout(() => rec.kill('SIGKILL'), limit + KILL_MS);
  });
  try {
    const atOnce = await Promise.race([started.then(() => false), exited.then(() => true)]);
    if (r.during && !atOnce) await r.during();
    if (r.endWithDuring) {
      await helpers();
      rec.kill('SIGINT');
    }
    const code = await exited;
    throwIfCancelled('the recording');
    // another tool's recording: the trace it leaves is empty, whatever the exit code says
    if (/could not lock kperf/i.test(log))
      throw new DeviceError(
        'DEVICE_CLAIMED',
        `another recording holds ${r.device}'s performance counters: ${failure(log)}`,
        'wait for it to end, or stop it in Instruments',
      );
    // a phone that left, by its cable or a hub, and nothing this device cannot do
    if (/Cannot record until the device is connected/i.test(log))
      throw new DeviceError(
        'DEVICE_GONE',
        `${r.device} went away during the recording: ${failure(log)}`,
        'check its cable or hub, then measure again',
      );
    // a stopped recording still has what it caught
    if (
      code !== 0 &&
      (!existsSync(tracePath) || (code !== null && log.includes('Recording failed')))
    )
      throw new DeviceError('UNSUPPORTED', `the trace tool could not record: ${failure(log)}`);
    return tracePath;
  } finally {
    over = true;
    clearTimeout(stop);
    clearTimeout(end);
    word.end();
    // `during` failed with the tool at work: it must end before what it holds can go
    if (rec.exitCode === null && rec.signalCode === null) {
      await helpers();
      rec.kill('SIGINT');
      end = setTimeout(() => rec.kill('SIGKILL'), KILL_MS);
    }
    await exited;
    clearTimeout(end);
    await endLeftBehind(left, HUB);
    // behind the result: what wrote the files holds them for some seconds more
    void temp.done().catch(() => undefined);
  }
}

/** What a kept trace holds: one table with `table`, the list of its tables without. */
export async function queryTraceFile(
  tracePath: string,
  q: { sql?: string; table?: string; limit: number },
): Promise<TraceDigest | undefined> {
  if (!tracePath.endsWith('.trace')) return undefined;
  if (q.sql)
    throw new DeviceError(
      'INVALID_ARGUMENT',
      'an Instruments trace has tables, not SQL',
      'name a table',
    );
  if (q.table && !/^[\w-]+$/.test(q.table))
    throw new DeviceError('INVALID_ARGUMENT', `not a table name: ${q.table}`);
  const refused = (e: Error) => {
    throw new DeviceError(
      'UNSUPPORTED',
      `the trace tool could not read the trace: ${e.message.slice(0, 200)}`,
    );
  };
  if (q.table) {
    const digest = traceDigest(
      tracePath,
      `xctrace export, table ${q.table}`,
      await traceTable(tracePath, q.table).catch(refused),
      q.limit,
    );
    if (!digest.columns.length)
      throw new DeviceError(
        'INVALID_ARGUMENT',
        `the trace has no table ${q.table}`,
        'leave out the table to list them',
      );
    return digest;
  }
  const { stdout } = await exporting(['--input', tracePath, '--toc'], {
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
  }).catch(refused);
  const schemas = [
    ...new Set([...stdout.matchAll(/\bschema="([^"]+)"/g)].map((m) => must(m[1], 'a schema'))),
  ];
  return {
    tracePath,
    source: 'xctrace export --toc',
    columns: ['table'],
    rows: schemas.slice(0, q.limit).map((s) => [s]),
    dropped: Math.max(0, schemas.length - q.limit),
  };
}

/** When a trace began, by its table of contents: what its rows are counted from. */
async function traceStart(tracePath: string) {
  const { stdout } = await exporting(['--input', tracePath, '--toc'], {
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
  });
  const date = /<start-date>([^<]+)<\/start-date>/.exec(stdout)?.[1];
  return date ? Date.parse(date) : undefined;
}

/** The app's hitches and hangs while `during` runs, from when the trace began, for as long as `during` takes. */
export async function recordStallSpans(
  device: string,
  pid: () => Promise<number>,
  seconds: number,
  dir: string,
  during: () => Promise<unknown>,
) {
  const known = await pid();
  const tracePath = await recordTrace({
    template: 'Animation Hitches',
    device,
    attach: () => Promise.resolve(known),
    seconds,
    dir,
    during,
    endWithDuring: true,
  });
  return {
    tracePath,
    started: await traceStart(tracePath),
    spans: stallSpans(
      await traceTable(tracePath, 'hitches'),
      await traceTable(tracePath, 'potential-hangs'),
      known,
    ),
  };
}

/** Animation hitches of a process on a phone: the Animation Hitches template while `during` runs. */
export async function recordHitches(
  device: string,
  pid: () => Promise<number>,
  seconds: number,
  dir: string,
  during?: () => Promise<unknown>,
): Promise<HitchSummary & { tracePath: string }> {
  const known = await pid();
  const tracePath = await recordTrace({
    template: 'Animation Hitches',
    device,
    attach: () => Promise.resolve(known),
    seconds,
    dir,
    ...(during && { during }),
  });
  const held = async (schema: string) => heldTable(await traceTable(tracePath, schema), schema);
  const summary = hitchSummary(
    await held('hitches'),
    await held('displayed-surfaces-interval'),
    seconds * 1000,
    await held('potential-hangs'),
    known,
  );
  // no frames is no reading, never "no hitches"; and it is this screen's, not the device's
  if (summary.frames === 0)
    throw new DeviceError(
      'CHECK_FAILED',
      'the trace tool recorded no frames: nothing moved on the screen',
      `open a screen that scrolls or animates, in front; the trace is at ${tracePath}`,
    );
  return { ...summary, tracePath };
}
