import { callSignal, stateDir, throwIfCancelled } from '@appdyno/core';
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type {
  CpuProfile,
  HitchSummary,
  Measured,
  ProfileEntry,
  TraceDigest,
  XctMetrics,
} from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { xcodeEnv } from './simctl.js';

const run = promisify(execFile);

/** One cell of an exported trace table: its value and the tool's formatted text. */
export type Cell = { value: string; fmt?: string };

/**
 * The rows of a table that the trace tool exported as XML (`xctrace export --xpath`): column mnemonics
 * from the schema, each row's cells in column order; `ref` cells are resolved to the element with that id.
 */
export function parseTraceTable(xml: string): Record<string, Cell>[] {
  const cols = [...xml.matchAll(/<col><mnemonic>([^<]+)<\/mnemonic>/g)].map((m) => m[1]!);
  const ids = new Map<string, Cell>();
  const rows: Record<string, Cell>[] = [];
  for (const rowXml of xml.split('<row>').slice(1)) {
    const body = rowXml.slice(0, rowXml.indexOf('</row>'));
    // the row's top-level elements, in column order: <x id="1" fmt="…">value</x> or <x ref="1"/>
    const cells: Cell[] = [];
    let depth = 0;
    let start = -1;
    const tag = /<(\/?)([\w-]+)([^>]*?)(\/?)>/g;
    for (let m = tag.exec(body); m; m = tag.exec(body)) {
      const [whole, close, , , selfClose] = m;
      if (!close && depth === 0) start = m.index;
      if (!close && !selfClose) depth++;
      if (close) depth--;
      if (depth === 0 && start >= 0) {
        const el = body.slice(start, m.index + whole!.length);
        const ref = /^<[\w-]+[^>]*\bref="([^"]+)"/.exec(el)?.[1];
        const id = /^<[\w-]+[^>]*\bid="([^"]+)"/.exec(el)?.[1];
        const fmt = /^<[\w-]+[^>]*\bfmt="([^"]*)"/.exec(el)?.[1];
        let cell: Cell;
        if (ref) cell = ids.get(ref) ?? { value: '' };
        else {
          const inner = el.replace(/^<[^>]+>/, '').replace(/<\/[\w-]+>$/, '');
          cell = {
            value: /^[^<]*$/.test(inner) ? inner : (/>([^<]+)</.exec(inner)?.[1] ?? inner),
            ...(fmt !== undefined && { fmt }),
          };
          if (id) ids.set(id, cell);
        }
        // nested elements (a process's pid) carry ids too
        for (const n of el.matchAll(
          /<[\w-]+[^>]*\bid="([^"]+)"[^>]*\bfmt="([^"]*)"[^>]*>([^<]*)(?=<)/g,
        ))
          if (!ids.has(n[1]!)) ids.set(n[1]!, { value: n[3]!, fmt: n[2]! });
        cells.push(cell);
        start = -1;
      }
    }
    rows.push(Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? { value: '' }])));
  }
  return rows;
}

export function hitchSummary(
  hitchesXml: string,
  surfacesXml: string,
  durationMs: number,
): HitchSummary {
  const hitches = parseTraceTable(hitchesXml).filter((r) => r['is-system']?.value !== '1');
  const ms = hitches.map((r) => Number(r.duration?.value ?? 0) / 1e6);
  const causes: Record<string, number> = {};
  for (const r of hitches) {
    const c = r['narrative-description']?.value || 'unknown';
    causes[c] = (causes[c] ?? 0) + 1;
  }
  const total = ms.reduce((a, b) => a + b, 0);
  const round = (x: number) => Math.round(x * 10) / 10;
  return {
    durationMs,
    frames: parseTraceTable(surfacesXml).length,
    hitches: hitches.length,
    hitchMs: round(total),
    worstMs: round(Math.max(0, ...ms)),
    hitchRatio: round(total / (durationMs / 1000)),
    causes,
  };
}

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

/** A test's readings from `xcresulttool get test-results metrics`, by the metric's id. */
export function parseXctMetrics(json: string): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  const tests = JSON.parse(json) as {
    testRuns?: { metrics?: { identifier: string; measurements: number[] }[] }[];
  }[];
  for (const m of tests.flatMap((t) => t.testRuns ?? []).flatMap((r) => r.metrics ?? []))
    (out[m.identifier] ??= []).push(...m.measurements);
  return out;
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

/** An exported table as strings, the heaviest rows first where it has a duration or a weight. */
export function traceDigest(
  tracePath: string,
  source: string,
  xml: string,
  limit: number,
): TraceDigest {
  const columns = [...xml.matchAll(/<col><mnemonic>([^<]+)<\/mnemonic>/g)].map((m) => m[1]!);
  const rows = parseTraceTable(xml);
  const key = ['duration', 'weight'].find((k) => columns.includes(k));
  if (key) rows.sort((a, b) => Number(b[key]?.value ?? 0) - Number(a[key]?.value ?? 0));
  return {
    tracePath,
    source,
    columns,
    rows: rows
      .slice(0, limit)
      .map((r) => columns.map((c) => (r[c]?.fmt ?? r[c]?.value ?? '').slice(0, 200))),
    dropped: Math.max(0, rows.length - limit),
  };
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

/**
 * The Time Profiler's samples: the busiest functions by the weight of the samples they were on top of,
 * and the app's own functions (of a binary inside an .app) by the weight of the samples they were
 * anywhere in. Only running threads are sampled, so there are no idle waits to leave out.
 */
export function parseTimeProfile(
  xml: string,
  pid?: number,
  limit = 10,
): CpuProfile & { appTop: ProfileEntry[] } {
  type Frame = { name: string; binary: string };
  const binaries = new Map<string, string>();
  const frames = new Map<string, Frame>();
  const stacks = new Map<string, Frame[]>();
  const weights = new Map<string, number>();
  const processes = new Map<string, number>();
  const top = new Map<string, number>();
  const app = new Map<string, number>();
  let total = 0;
  for (const row of xml.split('<row>').slice(1)) {
    const w = /<weight (?:id="(\d+)"[^>]*>(\d+)|ref="(\d+)")/.exec(row);
    if (w?.[1]) weights.set(w[1], Number(w[2]));
    const weight = w ? (w[3] ? (weights.get(w[3]) ?? 0) : Number(w[2])) : 0;
    const proc = /<process (?:id="(\d+)" fmt="[^"]*\((\d+)\)"|ref="(\d+)")/.exec(row);
    if (proc?.[1]) processes.set(proc[1], Number(proc[2]));
    const ofProcess = proc ? (proc[3] ? processes.get(proc[3]) : Number(proc[2])) : undefined;
    const known = /<(?:tagged-)?backtrace ref="(\d+)"/.exec(row)?.[1];
    let stack = known ? stacks.get(known) : undefined;
    if (!stack) {
      stack = [];
      const frame =
        /<frame (?:id="(\d+)" name="([^"]*)"[^>]*?(?:\/>|>\s*<binary (?:id="(\d+)" name="[^"]*"[^>]*? path="([^"]*)"[^>]*|ref="(\d+)")\/>)|ref="(\d+)"\/>)/g;
      for (let m = frame.exec(row); m; m = frame.exec(row)) {
        if (m[6]) {
          const f = frames.get(m[6]);
          if (f) stack.push(f);
          continue;
        }
        if (m[3]) binaries.set(m[3], m[4]!);
        const f = { name: m[2]!, binary: m[3] ? m[4]! : (binaries.get(m[5] ?? '') ?? '') };
        frames.set(m[1]!, f);
        stack.push(f);
      }
      const id = /<(?:tagged-)?backtrace id="(\d+)"/.exec(row)?.[1];
      if (id) stacks.set(id, stack);
    }
    if (!stack.length || (pid !== undefined && ofProcess !== pid)) continue;
    total += weight;
    const head = stack[0]!.name.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    top.set(head, (top.get(head) ?? 0) + weight);
    for (const name of new Set(stack.filter((f) => f.binary.includes('.app/')).map((f) => f.name)))
      app.set(name, (app.get(name) ?? 0) + weight);
  }
  const entries = (m: Map<string, number>) =>
    [...m]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([symbol, w]) => ({
        symbol,
        samples: Math.round(w / 1e6),
        percent: total ? Math.round((w / total) * 1000) / 10 : 0,
      }));
  // an address (a thunk with no symbol) ties with the function around it: the name says more
  const named = [...app].filter(([name]) => !name.startsWith('0x'));
  return {
    durationMs: 0,
    samples: Math.round(total / 1e6),
    top: entries(top),
    appTop: entries(named.length ? new Map(named) : app),
  };
}

/** Of Activity Monitor's table, one process: its footprint at the end, its CPU over the recording. */
export function parseActivityMonitor(
  xml: string,
  pid: number,
): { footprintBytes: number; cpuPercent?: number; windowMs?: number } | undefined {
  const rows = parseTraceTable(xml).filter((r) => r.pid?.value === String(pid));
  const last = rows[rows.length - 1];
  if (!last) return undefined;
  const first = rows[0]!;
  const ns = Number(last.start?.value) - Number(first.start?.value);
  const busy = Number(last['cpu-total']?.value) - Number(first['cpu-total']?.value);
  return {
    footprintBytes: Number(last['memory-physical-footprint']?.value),
    ...(ns > 0 && { cpuPercent: Math.round((busy / ns) * 100), windowMs: Math.round(ns / 1e6) }),
  };
}

/** The Power Profiler's impact of one process by subsystem, summed over the recording; none without rows. */
export function parsePowerImpact(xml: string, pid: number): Record<string, number> | undefined {
  const rows = parseTraceTable(xml).filter((r) => r.process?.fmt?.includes(`(${pid})`));
  if (!rows.length) return undefined;
  const sum = (c: string) => rows.reduce((a, r) => a + (Number(r[c]?.value) || 0), 0);
  return {
    cpu: sum('cpu-impact'),
    display: sum('display-impact'),
    gpu: sum('gpu-impact'),
    networking: sum('networking-impact'),
  };
}

/** The Time Profiler's report of the main thread's hangs (over 250 ms): how many and the worst. */
export function parseHangs(
  xml: string,
  pid?: number,
): { hangs: number; worstMs: number; totalMs: number } {
  const ms = parseTraceTable(xml)
    .filter((r) => pid === undefined || r.process?.fmt?.includes(`(${pid})`))
    .map((r) => Number(r.duration?.value ?? 0) / 1e6);
  const round = (x: number) => Math.round(x * 10) / 10;
  return {
    hangs: ms.length,
    worstMs: round(Math.max(0, ...ms)),
    totalMs: round(ms.reduce((a, b) => a + b, 0)),
  };
}
