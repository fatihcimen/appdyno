import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { CpuProfile, HitchSummary, ProfileEntry } from '@appdyno/core';
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
          /<[\w-]+[^>]*\bid="([^"]+)"[^>]*\bfmt="([^"]*)"[^>]*>([^<]*)</g,
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
  device: string;
  /** A process id to attach to; none: every process. */
  attach?: number;
  seconds: number;
  dir: string;
  during?: () => Promise<unknown>;
};

/**
 * Records one trace with Xcode's trace tool: `during` starts when the tool says the recording has
 * started, and the stop is bounded. The trace stays at `dir` for Instruments.
 */
export async function recordTrace(r: TraceRecording): Promise<string> {
  await mkdir(r.dir, { recursive: true });
  const tracePath = join(
    r.dir,
    `${r.template.toLowerCase().replace(/\W+/g, '-')}-${Date.now()}.trace`,
  );
  const note = `dev.appdyno.trace.${randomBytes(6).toString('hex')}`;
  const watcher = spawn('notifyutil', ['-w', note], { stdio: 'ignore' });
  const started = new Promise<void>((resolve) => {
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
      '--template',
      r.template,
      '--device',
      r.device,
      ...(r.attach ? ['--attach', String(r.attach)] : ['--all-processes']),
      '--time-limit',
      `${r.seconds}s`,
      '--notify-tracing-started',
      note,
      '--output',
      tracePath,
      '--no-prompt',
    ],
    { env: xcodeEnv() },
  );
  let log = '';
  rec.stdout.on('data', (b: Buffer) => (log += String(b)));
  rec.stderr.on('data', (b: Buffer) => (log += String(b)));
  const exited = new Promise<number | null>((res) => {
    rec.on('exit', res);
    rec.on('error', () => res(-1));
  });
  const stop = setTimeout(() => rec.kill('SIGINT'), Math.min(r.seconds * 1000 + STOP_MS, CAP_MS));
  const end = setTimeout(() => rec.kill('SIGKILL'), Math.min(r.seconds * 1000 + STOP_MS, CAP_MS) + 30_000);
  try {
    await Promise.race([started, exited]);
    if (r.during) await r.during();
    const code = await exited;
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

/** Animation hitches of a process on a phone: the Animation Hitches template while `during` runs. */
export async function recordHitches(
  device: string,
  pid: number,
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
  return {
    ...hitchSummary(
      await traceTable(tracePath, 'hitches'),
      await traceTable(tracePath, 'displayed-surfaces-interval'),
      seconds * 1000,
    ),
    tracePath,
  };
}

/**
 * The Time Profiler's samples: the busiest functions by the weight of the samples they were on top of,
 * and the app's own functions (of a binary inside an .app) by the weight of the samples they were
 * anywhere in. Only running threads are sampled, so there are no idle waits to leave out.
 */
export function parseTimeProfile(xml: string, limit = 10): CpuProfile & { appTop: ProfileEntry[] } {
  type Frame = { name: string; binary: string };
  const binaries = new Map<string, string>();
  const frames = new Map<string, Frame>();
  const stacks = new Map<string, Frame[]>();
  const weights = new Map<string, number>();
  const top = new Map<string, number>();
  const app = new Map<string, number>();
  let total = 0;
  for (const row of xml.split('<row>').slice(1)) {
    const w = /<weight (?:id="(\d+)"[^>]*>(\d+)|ref="(\d+)")/.exec(row);
    if (w?.[1]) weights.set(w[1], Number(w[2]));
    const weight = w ? (w[3] ? (weights.get(w[3]) ?? 0) : Number(w[2])) : 0;
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
    if (!stack.length) continue;
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
  return { durationMs: 0, samples: Math.round(total / 1e6), top: entries(top), appTop: entries(app) };
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

/** The Time Profiler's report of the main thread's hangs (over 250 ms): how many and the worst. */
export function parseHangs(xml: string): { hangs: number; worstMs: number; totalMs: number } {
  const ms = parseTraceTable(xml).map((r) => Number(r.duration?.value ?? 0) / 1e6);
  const round = (x: number) => Math.round(x * 10) / 10;
  return {
    hangs: ms.length,
    worstMs: round(Math.max(0, ...ms)),
    totalMs: round(ms.reduce((a, b) => a + b, 0)),
  };
}
