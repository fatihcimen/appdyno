import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { run, type TraceDigest, pause, stateDir } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { traceProcessor } from '../tools.js';
import { parseCsv } from './parse.js';
import type { PerfDevice } from './shared.js';

/**
 * Without these a process born during the trace keeps the name zygote gave it, and nothing in the trace
 * is about the app (the start scan of `linux.process_stats` sees only what runs already).
 */
export const NAME_NEW_PROCESSES =
  'ftrace_events: "task/task_newtask" ftrace_events: "task/task_rename" ftrace_events: "sched/sched_process_exit" ftrace_events: "sched/sched_process_free"';

export const PROCESS_STATS =
  'data_sources { config { name: "linux.process_stats" target_buffer: 0 process_stats_config { scan_all_processes_on_start: true } } }';

/** The trace processor's answer to `sql`, as its CSV text. */
export async function queryFile(file: string, sql: string): Promise<string> {
  const tp = await traceProcessor();
  const dir = await mkdtemp(join(tmpdir(), 'appdyno-trace-'));
  try {
    const query = join(dir, 'query.sql');
    await writeFile(query, sql);
    const { stdout } = await run(tp, ['-q', query, file], {
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const CELL_CHARS = 200;

const INCLUDE = /^\s*INCLUDE\s+PERFETTO\s+MODULE\s+[\w.*]+\s*;/i;

// strings, quoted names and comments, whatever they hold, say nothing about what the statement does
const LITERALS = /'(?:[^']|'')*'|"(?:[^"]|"")*"|`[^`]*`|\[[^\]]*\]|--[^\n]*|\/\*[\s\S]*?\*\//g;

// a WITH may lead a write; SELECT cannot hold one
const WRITES =
  /\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|REPLACE\s+INTO)\b/i;

/** Module includes, then one SELECT or WITH that writes nothing, or a DeviceError. */
export function assertReadOnlySql(sql: string): void {
  const refuse = (why: string) =>
    new DeviceError(
      'INVALID_ARGUMENT',
      `not a read-only query: ${why}`,
      'INCLUDE PERFETTO MODULE lines, then one SELECT or WITH',
    );
  let rest = sql.replace(LITERALS, ' ');
  if (/['"`]|\/\*/.test(rest)) throw refuse('an unclosed string or comment');
  while (INCLUDE.test(rest)) rest = rest.replace(INCLUDE, '');
  if (!/^\s*(SELECT|WITH)\b/i.test(rest)) throw refuse('it must be one SELECT or WITH');
  if (rest.replace(/;\s*$/, '').includes(';')) throw refuse('more than one statement');
  const write = WRITES.exec(rest);
  if (write) throw refuse(`it holds ${write[1]}`);
}

/** A bounded table from a kept Perfetto trace; undefined for a file of another kind. */
export async function queryTrace(
  tracePath: string,
  q: { sql?: string; limit: number },
): Promise<TraceDigest | undefined> {
  if (!/\.(pftrace|perfetto-trace)$/.test(tracePath)) return undefined;
  if (!q.sql) throw new DeviceError('INVALID_ARGUMENT', 'a Perfetto trace is asked with sql');
  assertReadOnlySql(q.sql);
  // absolute: a path that starts with a dash would read as an option
  const file = resolve(tracePath);
  const csv = await queryFile(file, q.sql).catch((e: { stderr?: string; message: string }) => {
    if (e instanceof DeviceError) throw e;
    const why = (e.stderr ?? e.message).split('\n').slice(-6).join('\n').trim();
    throw new DeviceError('INVALID_ARGUMENT', `the trace processor refused: ${why}`);
  });
  const { columns, rows } = parseCsv(csv);
  const limit = Math.max(q.limit, 0);
  return {
    tracePath: file,
    source: 'perfetto trace processor',
    columns,
    rows: rows.slice(0, limit).map((r) => r.map((c) => c.slice(0, CELL_CHARS))),
    dropped: Math.max(rows.length - limit, 0),
  };
}

/**
 * Records a Perfetto trace while `during` runs and keeps it under the state directory. It ends at its
 * `duration_ms`, or as soon as `during` is over with `stop`.
 */
export async function recordTrace(
  d: PerfDevice,
  pkg: string,
  name: string,
  config: string[],
  opts: { during?: () => Promise<unknown>; stop?: boolean } = {},
): Promise<string> {
  const remote = `/data/misc/perfetto-traces/appdyno-${randomBytes(4).toString('hex')}.pftrace`;
  // --background-wait: a launch right after it is inside the recording
  const started = await d.shell(
    `echo '${config.join('\n')}' | perfetto --txt -c - -o ${remote} --background-wait 2>&1`,
    45_000,
  );
  const pid = Number(/^(\d+)\s*$/m.exec(started)?.[1]);
  if (!pid)
    throw new DeviceError('UNSUPPORTED', `perfetto did not start: ${started.trim().slice(0, 200)}`);
  try {
    if (opts.during) await opts.during();
    if (opts.stop) await d.shell(`kill -TERM ${pid}`);
    // the longest asked for, with the time a heap dump may take to end
    const end = Date.now() + 200_000;
    while (Date.now() < end && (await d.shell(`[ -d /proc/${pid} ] && echo up`)).includes('up'))
      await pause(300);
    const trace = await d.shellBuffer(`cat ${remote}`, 120_000);
    if (trace.length === 0) throw new DeviceError('INTERNAL', 'the trace is empty');
    const dir = join(stateDir(), 'traces');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, `${pkg}-${name}-${Date.now()}.pftrace`);
    await writeFile(file, trace, { mode: 0o600 });
    return file;
  } finally {
    await d.shell(`rm -f ${remote}`).catch(() => undefined);
  }
}
