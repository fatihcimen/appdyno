import {
  callSignal,
  throwIfCancelled,
  run,
  type Measured,
  type XctMetrics,
  stateDir,
  type TraceDigest,
  type HitchSummary,
} from '@appdyno/core';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DeviceError } from '@appdyno/protocol';
import { xcodeEnv } from './simctl.js';
import { parseXctMetrics, traceDigest, hitchSummary } from './trace-parse.js';

/** How long a recording may take to stop after its time limit before it is ended (a phone took 14 s). */
const STOP_MS = 60_000;

/** The whole recording is cut at this, whatever the tool does. */
const CAP_MS = 180_000;

export type TraceRecording = {
  template: string;
  /** `template` names one instrument: for when the whole template cannot record. */
  instrument?: boolean;
  device: string;
  /** A process to attach to; none, or one the tool cannot find: every process. */
  attach?: () => Promise<number>;
  seconds: number;
  dir: string;
  during?: () => Promise<unknown>;
};

/**
 * Records one trace with Xcode's trace tool: `during` starts when the tool says the recording has
 * started, and the stop is bounded. The trace stays at `dir` for Instruments.
 */
export async function recordTrace(r: TraceRecording): Promise<string> {
  const pid = await r.attach?.();
  return recordOnce(r, pid).catch((e: Error) => {
    // a phone's tool stops finding running processes at times, whichever way they are named (measured
    // on iOS 27.0.1, with the tool's service restarted too); every process is still recorded
    if (!pid || !/Cannot find process/.test(e.message)) throw e;
    return recordOnce(r, undefined);
  });
}

async function recordOnce(r: TraceRecording, attach: number | undefined): Promise<string> {
  await mkdir(r.dir, { recursive: true });
  const tracePath = join(
    r.dir,
    `${r.template.toLowerCase().replace(/\W+/g, '-')}-${Date.now()}.trace`,
  );
  const note = `dev.appdyno.trace.${randomBytes(6).toString('hex')}`;
  const watcher = spawn('notifyutil', ['-w', note], { stdio: ['ignore', 'pipe', 'ignore'] });
  const started = new Promise<void>((resolve) => {
    // it prints the name when the note comes, and goes on waiting
    watcher.stdout.once('data', () => resolve());
    watcher.once('exit', () => resolve());
    watcher.once('error', () => resolve());
    // a tool that never says: `during` runs anyway, and the result shows what it caught
    setTimeout(resolve, 30_000).unref();
  });
  const rec = spawn(
    'xcrun',
    [
      'xctrace',
      'record',
      r.instrument ? '--instrument' : '--template',
      r.template,
      '--device',
      r.device,
      ...(attach ? ['--attach', String(attach)] : ['--all-processes']),
      '--time-limit',
      `${r.seconds}s`,
      '--notify-tracing-started',
      note,
      '--output',
      tracePath,
      '--no-prompt',
    ],
    { env: xcodeEnv(), ...(callSignal() && { signal: callSignal()! }) },
  );
  let log = '';
  rec.stdout.on('data', (b: Buffer) => (log += String(b)));
  rec.stderr.on('data', (b: Buffer) => (log += String(b)));
  const exited = new Promise<number | null>((res) => {
    rec.on('exit', res);
    rec.on('error', () => res(-1));
  });
  const stop = setTimeout(() => rec.kill('SIGINT'), Math.min(r.seconds * 1000 + STOP_MS, CAP_MS));
  const end = setTimeout(
    () => rec.kill('SIGKILL'),
    Math.min(r.seconds * 1000 + STOP_MS, CAP_MS) + 30_000,
  );
  try {
    const atOnce = await Promise.race([started.then(() => false), exited.then(() => true)]);
    if (r.during && !atOnce) await r.during();
    const code = await exited;
    throwIfCancelled('the recording');
    // a stopped recording still has what it caught
    if (code !== 0 && !existsSync(tracePath))
      throw new DeviceError(
        'UNSUPPORTED',
        `the trace tool could not record: ${log.trim().split('\n').slice(-2).join(' ')}`,
      );
    if (code !== 0 && code !== null && /Recording failed/.test(log))
      throw new DeviceError(
        'UNSUPPORTED',
        `the trace tool could not record: ${log.trim().split('\n').slice(0, 2).join(' ')}`,
      );
    return tracePath;
  } finally {
    clearTimeout(stop);
    clearTimeout(end);
    watcher.kill();
  }
}

/** One table of a trace, as XML. */
export async function traceTable(tracePath: string, schema: string): Promise<string> {
  return (
    await run(
      'xcrun',
      [
        'xctrace',
        'export',
        '--input',
        tracePath,
        '--xpath',
        `/trace-toc/run[@number="1"]/data/table[@schema="${schema}"]`,
      ],
      { env: xcodeEnv(), maxBuffer: 256 * 1024 * 1024, timeout: 300_000 },
    )
  ).stdout;
}

/** One `measure()` test of the runner's bundle in a run of its own, and what its result bundle holds. */
export async function recordXctMetrics(
  udid: string,
  xctestrun: string,
  bundle: string,
  test: 'launch' | 'hitches',
): Promise<Measured<XctMetrics>> {
  const name = test === 'hitches' ? 'testHitches' : 'testLaunch';
  const dir = join(stateDir(), 'traces');
  await mkdir(dir, { recursive: true });
  const resultBundle = join(dir, `xct-${test}-${Date.now()}.xcresult`);
  const failed = (why: string) =>
    new DeviceError(
      'UNSUPPORTED',
      `XCTest's ${test} metric: ${why}`,
      `the result bundle is at ${resultBundle}`,
    );
  await run(
    'xcodebuild',
    [
      'test-without-building',
      '-xctestrun',
      xctestrun,
      '-destination',
      `id=${udid}`,
      `-only-testing:Runner/PerfMetricsTests/${name}`,
      '-resultBundlePath',
      resultBundle,
    ],
    {
      env: { ...xcodeEnv(), TEST_RUNNER_APPDYNO_METRICS_APP: bundle },
      maxBuffer: 256 * 1024 * 1024,
      timeout: 600_000,
      ...(callSignal() && { signal: callSignal()! }),
    },
  ).catch((e: { stdout?: string; message: string }) => {
    throw failed((e.stdout ?? e.message).trim().split('\n').slice(-3).join(' ').slice(0, 300));
  });
  const { stdout } = await run(
    'xcrun',
    [
      'xcresulttool',
      'get',
      'test-results',
      'metrics',
      '--path',
      resultBundle,
      '--test-id',
      `PerfMetricsTests/${name}()`,
      '--compact',
    ],
    { env: xcodeEnv(), maxBuffer: 64 * 1024 * 1024, timeout: 60_000 },
  );
  const metrics = parseXctMetrics(stdout);
  if (!Object.keys(metrics).length) throw failed('the test ran and recorded no value');
  return { value: { metrics, resultBundle }, raw: stdout, at: new Date().toISOString() };
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
  const { stdout } = await run('xcrun', ['xctrace', 'export', '--input', tracePath, '--toc'], {
    env: xcodeEnv(),
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
  }).catch(refused);
  const schemas = [...new Set([...stdout.matchAll(/\bschema="([^"]+)"/g)].map((m) => m[1]!))];
  return {
    tracePath,
    source: 'xctrace export --toc',
    columns: ['table'],
    rows: schemas.slice(0, q.limit).map((s) => [s]),
    dropped: Math.max(0, schemas.length - q.limit),
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
  const tracePath = await recordTrace({
    template: 'Animation Hitches',
    device,
    attach: pid,
    seconds,
    dir,
    ...(during && { during }),
  });
  const summary = hitchSummary(
    await traceTable(tracePath, 'hitches'),
    await traceTable(tracePath, 'displayed-surfaces-interval'),
    seconds * 1000,
  );
  // no frames is no reading, never "no hitches"
  if (summary.frames === 0)
    throw new DeviceError(
      'UNSUPPORTED',
      'the trace tool recorded no frames on this device',
      `the trace is at ${tracePath}`,
    );
  return { ...summary, tracePath };
}
