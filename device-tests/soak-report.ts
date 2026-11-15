import { stats, type Stats } from './workspace.js';

/**
 * One call of the soak. `injected`: a fault the soak itself caused (a crash, an agent ended under the session), where
 * `ok` is whether appdyno reported it as it should; such calls are kept out of the success rate and the latencies.
 */
export type CallRecord = {
  cycle: number;
  scenario: string;
  tool: string;
  injected: boolean;
  ok: boolean;
  code?: string;
  ms: number;
  /** From the soak's start. */
  atMs: number;
  note?: string;
};

export type CycleRecord = { n: number; ms: number; order: string[]; failed: number; rssMb: number };

export type Recoveries = {
  /** Agents (an iOS runner, the Android agent) started, the first included. */
  agentStarts: number;
  /** "another took its place": an agent this session had was found gone and replaced. */
  tookItsPlace: number;
  agentEndsInjected: number;
  /** Agent ends after which a new agent took the old one's place within the scenario. */
  agentEndsRecovered: number;
  crashesInjected: number;
  /** `launch_app` after the crash that has the app in front: started afresh, or brought there where Android started it. */
  crashRelaunches: number;
  /** The app found gone after a scenario that failed, and launched again. */
  unplannedRelaunches: number;
  /** A refusal that said the agent was stuck and restarted. */
  stuckRestarts: number;
};

export const noRecoveries = (): Recoveries => ({
  agentStarts: 0,
  tookItsPlace: 0,
  agentEndsInjected: 0,
  agentEndsRecovered: 0,
  crashesInjected: 0,
  crashRelaunches: 0,
  unplannedRelaunches: 0,
  stuckRestarts: 0,
});

export type Memory = { rssMb: number; heapMb: number };

export const memoryNow = (): Memory => {
  const m = process.memoryUsage();
  return { rssMb: Math.round(m.rss / 2 ** 20), heapMb: Math.round(m.heapUsed / 2 ** 20) };
};

export type SoakRun = {
  device: string;
  platform: 'ios' | 'android';
  seed: number;
  minutes: number;
  threshold: number;
  startedAt: string;
  endedAt: string;
  memory: { start: Memory; end: Memory; maxRssMb: number };
  calls: CallRecord[];
  cycles: CycleRecord[];
  recoveries: Recoveries;
};

export type ToolSummary = Stats & { calls: number; ratePct: number };

export type SoakSummary = {
  /** Of the measured calls that were not faults put in. */
  ratePct: number;
  calls: number;
  failedCalls: number;
  passed: boolean;
  tools: Record<string, ToolSummary>;
  injected: Record<string, { calls: number; asExpected: number }>;
  /** Faults put in that appdyno did not report as it should: each fails the run too. */
  mismatches: CallRecord[];
  slow: (CallRecord & { medianMs: number })[];
  failures: CallRecord[];
  warmup: CallRecord[];
  cycles: Stats;
};

const pct = (part: number, whole: number) =>
  whole ? Math.round((part / whole) * 10_000) / 100 : 100;

const groupBy = <T>(xs: T[], key: (x: T) => string) => {
  const out = new Map<string, T[]>();
  for (const x of xs) out.set(key(x), [...(out.get(key(x)) ?? []), x]);
  return out;
};

/** Cycle 0 is the warm-up: an agent's first start and a build's first launch are no session's latency. */
export function summarize(run: SoakRun): SoakSummary {
  const measured = run.calls.filter((c) => c.cycle > 0);
  const plain = measured.filter((c) => !c.injected);
  const failures = plain.filter((c) => !c.ok);
  const tools: Record<string, ToolSummary> = {};
  const slow: SoakSummary['slow'] = [];
  for (const [tool, calls] of [...groupBy(plain, (c) => c.tool)].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const failed = calls.filter((c) => !c.ok).length;
    const s = stats(
      calls.map((c) => c.ms),
      failed,
    );
    tools[tool] = { ...s, calls: calls.length, ratePct: pct(calls.length - failed, calls.length) };
    for (const c of calls) if (c.ms > 3 * s.p50) slow.push({ ...c, medianMs: s.p50 });
  }
  const injected: SoakSummary['injected'] = {};
  for (const [key, calls] of groupBy(
    measured.filter((c) => c.injected),
    (c) => `${c.scenario}: ${c.tool}`,
  ))
    injected[key] = { calls: calls.length, asExpected: calls.filter((c) => c.ok).length };
  const mismatches = measured.filter((c) => c.injected && !c.ok);
  const ratePct = pct(plain.length - failures.length, plain.length);
  return {
    ratePct,
    calls: plain.length,
    failedCalls: failures.length,
    passed: ratePct >= run.threshold && mismatches.length === 0 && plain.length > 0,
    tools,
    injected,
    mismatches,
    slow: slow.sort((a, b) => b.ms / Math.max(1, b.medianMs) - a.ms / Math.max(1, a.medianMs)),
    failures,
    warmup: run.calls.filter((c) => c.cycle === 0),
    cycles: stats(
      run.cycles.map((c) => c.ms),
      0,
    ),
  };
}

const cell = (s: string | undefined) => (s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ');
const table = (head: string[], rows: (string | number)[][]) =>
  [
    `| ${head.join(' | ')} |`,
    `|${head.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.map((x) => cell(String(x))).join(' | ')} |`),
  ].join('\n');
const listed = (calls: CallRecord[], limit = 30) =>
  table(
    ['cycle', 'scenario', 'tool', 'code', 'ms', 'what'],
    calls
      .slice(0, limit)
      .map((c) => [c.cycle, c.scenario, c.tool, c.code ?? '', c.ms, c.note ?? '']),
  ) + (calls.length > limit ? `\n\n…and ${calls.length - limit} more, in soak.json` : '');

/** What a reviewer reads first; the JSON beside it holds every call. */
export function markdown(run: SoakRun, s: SoakSummary): string {
  const ranMin = (Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 60_000;
  const r = run.recoveries;
  const faults = Object.values(s.injected);
  const asExpected = faults.reduce((n, f) => n + f.asExpected, 0);
  const put = faults.reduce((n, f) => n + f.calls, 0);
  return [
    `# Soak on ${run.device} (${run.platform})`,
    '',
    `${run.startedAt} to ${run.endedAt}: ${ranMin.toFixed(1)} min of ${run.minutes} asked, ${run.cycles.length} cycles, seed ${run.seed} (\`APPDYNO_SOAK_SEED=${run.seed}\` replays the order).`,
    '',
    `**${s.passed ? 'Passed' : 'Failed'}.** ${s.ratePct} % of ${s.calls} calls succeeded, against ${run.threshold} %; of the faults put in, ${asExpected} of ${put} calls were reported as they should be.`,
    '',
    '## Each tool',
    '',
    'Calls that were not faults put in, after the warm-up.',
    '',
    table(
      ['tool', 'calls', 'failed', 'success %', 'p50 ms', 'p95 ms', 'max ms'],
      Object.entries(s.tools).map(([tool, t]) => [
        tool,
        t.calls,
        t.failed,
        t.ratePct,
        t.p50,
        t.p95,
        t.max,
      ]),
    ),
    '',
    '## Faults put in',
    '',
    table(
      ['scenario: call', 'calls', 'reported as it should'],
      Object.entries(s.injected).map(([k, v]) => [k, v.calls, v.asExpected]),
    ),
    '',
    '## Recoveries',
    '',
    table(
      ['what', 'count'],
      [
        ['agents started (the first included)', r.agentStarts],
        ['"another took its place"', r.tookItsPlace],
        [
          'agent ends put in / a new agent took its place',
          `${r.agentEndsInjected} / ${r.agentEndsRecovered}`,
        ],
        ['crashes put in / launched again', `${r.crashesInjected} / ${r.crashRelaunches}`],
        ['app gone after a failed scenario, launched again', r.unplannedRelaunches],
        ['stuck agent restarted', r.stuckRestarts],
      ],
    ),
    '',
    `## Slower than 3x the tool's median (${s.slow.length})`,
    '',
    s.slow.length
      ? table(
          ['cycle', 'scenario', 'tool', 'ms', 'median ms', 'what'],
          s.slow
            .slice(0, 30)
            .map((c) => [c.cycle, c.scenario, c.tool, c.ms, c.medianMs, c.note ?? '']),
        )
      : 'None.',
    '',
    `## Failures (${s.failures.length}) and faults not reported as they should be (${s.mismatches.length})`,
    '',
    s.failures.length + s.mismatches.length ? listed([...s.failures, ...s.mismatches]) : 'None.',
    '',
    '## The run',
    '',
    `Cycles: p50 ${s.cycles.p50} ms, p95 ${s.cycles.p95} ms, max ${s.cycles.max} ms. The host process: ${run.memory.start.rssMb} MB resident at the start, ${run.memory.end.rssMb} MB at the end, ${run.memory.maxRssMb} MB at most; heap ${run.memory.start.heapMb} MB to ${run.memory.end.heapMb} MB.`,
    '',
    `Warm-up (cycle 0, not counted): ${s.warmup.map((c) => `${c.tool} ${c.ok ? 'ok' : (c.code ?? 'failed')} ${c.ms} ms`).join(', ')}.`,
    '',
  ].join('\n');
}
