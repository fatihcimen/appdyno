import {
  frozenMoments,
  MIN_FRAMES,
  PROFILE_FUNCTIONS,
  type FrameStats,
  type HitchSummary,
  round1,
  type TraceDigest,
  type CpuProfile,
  type ProfileEntry,
} from '@appdyno/core';

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

type Span = { start: number; ms: number };

const spansOf = (rows: Record<string, Cell>[]): Span[] =>
  rows.map((r) => ({
    start: Number(r.start?.value ?? 0) / 1e6,
    ms: Number(r.duration?.value ?? 0) / 1e6,
  }));

/** The main thread's hangs of a process in the template's table: what it only suspects is no hang. */
export const hangRows = (xml: string, pid?: number) =>
  parseTraceTable(xml)
    .filter((r) => pid === undefined || r.process?.fmt?.includes(`(${pid})`))
    .filter((r) => !/Interaction Delay/.test(r['hang-type']?.value ?? ''));

/** The app's hitches and its main thread's hangs, each counted from the trace's start. */
export const stallSpans = (hitchesXml: string, hangsXml: string, pid?: number): Span[] => [
  ...spansOf(parseTraceTable(hitchesXml).filter((r) => r['is-system']?.value !== '1')),
  ...spansOf(hangRows(hangsXml, pid)),
];

/**
 * The app's hitches over a recording. A main thread blocked during a scroll may show in no hitch, as no frame was on
 * its way (a 1 s stall read 50 ms in the hitch table and 1.02 s in the hang table of one recording), so what froze the
 * screen is read from both.
 */
export function hitchSummary(
  hitchesXml: string,
  surfacesXml: string,
  durationMs: number,
  hangsXml = '',
  pid?: number,
): HitchSummary {
  const hitches = parseTraceTable(hitchesXml).filter((r) => r['is-system']?.value !== '1');
  const spans = spansOf(hitches);
  const hangs = hangRows(hangsXml, pid);
  const ms = spans.map((s) => s.ms);
  const stalled = spansOf(hangs).map((s) => s.ms);
  const causes: Record<string, number> = {};
  for (const r of hitches) {
    const c = r['narrative-description']?.value || 'unknown';
    causes[c] = (causes[c] ?? 0) + 1;
  }
  const total = ms.reduce((a, b) => a + b, 0);
  return {
    durationMs,
    frames: parseTraceTable(surfacesXml).length,
    hitches: hitches.length,
    hitchMs: round1(total),
    worstMs: round1(Math.max(0, ...ms)),
    frozen: frozenMoments([...spans, ...spansOf(hangs)]),
    stalls: {
      count: stalled.length,
      worstMs: round1(Math.max(0, ...stalled)),
      totalMs: round1(stalled.reduce((a, b) => a + b, 0)),
    },
    hitchRatio: round1(total / (durationMs / 1000)),
    causes,
  };
}

/** The same as the frame reading every platform gives: a janky frame is a hitch of the app. */
export const hitchFrames = (h: HitchSummary): FrameStats => ({
  totalFrames: h.frames,
  jankyFrames: h.hitches,
  jankyPercent: h.frames ? round1((h.hitches / h.frames) * 100) : 0,
  frozenFrames: h.frozen,
  worstHitchMs: h.worstMs,
  stalls: h.stalls,
  fewFrames: h.frames < MIN_FRAMES,
  limits: 'Janky here is a hitch of the app, as Animation Hitches counts it.',
});

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

export type SampleFrame = { name: string; binary: string };

export type Sample = {
  /** From the start of the recording. */
  ns: number;
  tid?: number | undefined;
  pid?: number | undefined;
  /** Nanoseconds of CPU. */
  weight: number;
  /** Innermost first. */
  stack: SampleFrame[];
};

/** The Time Profiler's rows one at a time: a value seen once is a `ref` from then on, each kind with its own ids. */
export function* samplesOf(xml: string): Generator<Sample> {
  const binaries = new Map<string, string>();
  const frames = new Map<string, SampleFrame>();
  const stacks = new Map<string, SampleFrame[]>();
  const weights = new Map<string, number>();
  const processes = new Map<string, number>();
  const threads = new Map<string, number>();
  const times = new Map<string, number>();
  for (const row of xml.split('<row>').slice(1)) {
    const t = /<sample-time (?:id="(\d+)"[^>]*>(\d+)|ref="(\d+)")/.exec(row);
    if (t?.[1]) times.set(t[1], Number(t[2]));
    const w = /<weight (?:id="(\d+)"[^>]*>(\d+)|ref="(\d+)")/.exec(row);
    if (w?.[1]) weights.set(w[1], Number(w[2]));
    const weight = w ? (w[3] ? (weights.get(w[3]) ?? 0) : Number(w[2])) : 0;
    const proc = /<process (?:id="(\d+)" fmt="[^"]*\((\d+)\)"|ref="(\d+)")/.exec(row);
    if (proc?.[1]) processes.set(proc[1], Number(proc[2]));
    const thread = /<thread (?:id="(\d+)"[^>]*><tid [^>]*>(\d+)|ref="(\d+)")/.exec(row);
    if (thread?.[1]) threads.set(thread[1], Number(thread[2]));
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
    yield {
      ns: t ? (t[3] ? (times.get(t[3]) ?? 0) : Number(t[2])) : 0,
      tid: thread ? (thread[3] ? threads.get(thread[3]) : Number(thread[2])) : undefined,
      pid: proc ? (proc[3] ? processes.get(proc[3]) : Number(proc[2])) : undefined,
      weight,
      stack,
    };
  }
}

/** A frame's name as the export escapes it, as it reads. */
const unescaped = (name: string) =>
  name.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** In the app's own binary, and so what a reader can change. */
export const inApp = (f: SampleFrame) => f.binary.includes('.app/');

/**
 * The Time Profiler's samples: the busiest functions by the weight of the samples they were on top of,
 * and the app's own functions (of a binary inside an .app) by the weight of the samples they were
 * anywhere in. Only running threads are sampled, so there are no idle waits to leave out.
 */
export function parseTimeProfile(
  xml: string,
  pid?: number,
  limit = PROFILE_FUNCTIONS,
): CpuProfile & { appTop: ProfileEntry[] } {
  const top = new Map<string, number>();
  const app = new Map<string, number>();
  let total = 0;
  for (const { stack, weight, pid: of } of samplesOf(xml)) {
    if (!stack.length || (pid !== undefined && of !== pid)) continue;
    total += weight;
    const head = unescaped(stack[0]!.name);
    top.set(head, (top.get(head) ?? 0) + weight);
    for (const name of new Set(stack.filter(inApp).map((f) => f.name)))
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

const powerRows = (xml: string, pid: number) =>
  parseTraceTable(xml).filter((r) => r.process?.fmt?.includes(`(${pid})`));

/** The Power Profiler's impact of one process by subsystem, the mean of each one's rows; none without rows. */
export function parsePowerImpact(xml: string, pid: number): Record<string, number> | undefined {
  const rows = powerRows(xml, pid);
  if (!rows.length) return undefined;
  // a row holds the subsystems of its period, and an empty cell for the others
  const mean = (c: string) => {
    const xs = rows.flatMap((r) => (r[c]?.value ? [Number(r[c]!.value)] : []));
    return xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;
  };
  return {
    cpu: mean('cpu-impact'),
    display: mean('display-impact'),
    gpu: mean('gpu-impact'),
    networking: mean('networking-impact'),
  };
}

/** The bytes of one process in the Power Profiler's table: its rows of network periods, added up. */
export function parsePowerBytes(xml: string, pid: number) {
  const periods = powerRows(xml, pid).filter((r) => r['row-kind']?.value === '1');
  const sum = (...cols: string[]) =>
    periods.reduce((a, r) => a + cols.reduce((b, c) => b + (Number(r[c]?.value) || 0), 0), 0);
  return {
    windowMs: Math.round(sum('duration') / 1e6),
    rxBytes: sum('wifi-received', 'cellular-received'),
    txBytes: sum('wifi-transmitted', 'cellular-transmitted'),
  };
}

/** The Leaks instrument's rows, each a leaked object; what it says of them is in their attributes. */
export function parseLeakRows(xml: string) {
  const attr = (row: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(row)?.[1];
  const rows = xml.match(/<row\b[^>]*>/g) ?? [];
  const sum = (name: string) => rows.reduce((a, r) => a + (Number(attr(r, name)) || 0), 0);
  return { leaks: sum('count'), leakedBytes: sum('size') };
}

/** iOS's thermal states on Android's scale, which a run's noise is judged by: from "serious" it throttles. */
const THERMAL_STATUS: Record<string, number> = { Nominal: 0, Fair: 1, Serious: 2, Critical: 4 };

/** The device's thermal state at the end of a recording: every template but a lone instrument's has the table. */
export const parseThermal = (xml: string) =>
  THERMAL_STATUS[parseTraceTable(xml).at(-1)?.['thermal-state']?.value ?? ''];

/** The Time Profiler's report of the main thread's hangs (over 250 ms): how many and the worst. */
export function parseHangs(
  xml: string,
  pid?: number,
): { hangs: number; worstMs: number; totalMs: number } {
  const ms = spansOf(hangRows(xml, pid)).map((s) => s.ms);
  return {
    hangs: ms.length,
    worstMs: round1(Math.max(0, ...ms)),
    totalMs: round1(ms.reduce((a, b) => a + b, 0)),
  };
}
