import { z } from 'zod';
import type { TestCase, TestSuite } from './junit.js';

/** Where a failed attempt ended: what a line of a report says, and the whole of it for whoever reads the one failure. */
const Failure = z.object({
  message: z.string(),
  detail: z.string(),
  line: z.number().int().optional(),
  n: z.number().int().optional(),
  step: z.string().optional(),
  code: z.string().optional(),
  file: z.string().optional(),
  phase: z.enum(['setup', 'teardown']).optional(),
  /** The screen at the failure, as text, its secrets hidden. */
  screen: z.string().optional(),
});

/** What a failed attempt left, each a path under the run's folder. */
const Evidence = z.object({
  shot: z.string().optional(),
  shotMarked: z.string().optional(),
  tree: z.string().optional(),
  video: z.string().optional(),
  log: z.string().optional(),
  crash: z.string().optional(),
  har: z.string().optional(),
});
export type Evidence = z.infer<typeof Evidence>;

const Case = z.object({
  /** A device's serial, as `devices` has it. */
  device: z.string(),
  /** The file as the run was given it, and its path under the folder all of the run's files share. */
  file: z.string(),
  label: z.string(),
  outcome: z.enum(['passed', 'failed', 'flaky', 'not_run']),
  ms: z.number(),
  /** Waited for a device. */
  queuedMs: z.number().optional(),
  app: z
    .object({ id: z.string(), version: z.string().optional(), build: z.string().optional() })
    .optional(),
  /** What this tool had changed on the device when the file's first step ran, and the setup files that ran before it. */
  start: z.object({
    changed: z.record(z.string(), z.string()),
    setup: z.array(z.string()).optional(),
  }),
  attempts: z.array(
    z.object({
      n: z.number().int(),
      outcome: z.enum(['passed', 'failed']),
      ms: z.number(),
      failure: Failure.optional(),
      evidence: Evidence,
    }),
  ),
  /** Of the last attempt. */
  steps: z
    .array(
      z.object({
        n: z.number().int(),
        line: z.number().int(),
        step: z.string(),
        ms: z.number(),
        settledMs: z.number().optional(),
        id: z.string().optional(),
      }),
    )
    .optional(),
  /** The last attempt's steps as a report shows them. */
  out: z.string().optional(),
  teardown: z.object({ ok: z.boolean(), failed: z.array(z.string()) }).optional(),
  measured: z.object({ scenario: z.string(), outcome: z.string() }).optional(),
  /** The command that runs this file alone on this device: never a value of a param or a secret. */
  rerun: z.string(),
  /** The names whose values `rerun` leaves out: set in the environment or an env file. */
  needs: z.array(z.string()).optional(),
});
export type RunCase = z.infer<typeof Case>;

/** What a run's folder holds, for whoever is about to send it to someone. */
const Contents = z.object({
  shots: z.number().int(),
  /** Of `shots`, those painted over somewhere. */
  painted: z.number().int(),
  videos: z.number().int(),
  trees: z.number().int(),
  logs: z.number().int(),
  crashes: z.number().int(),
  hars: z.number().int(),
  bytes: z.number().int(),
  secretsListed: z.number().int(),
  /** The kinds a copy was made without. */
  without: z.array(z.string()).optional(),
});
export type Contents = z.infer<typeof Contents>;

const Device = z.object({
  serial: z.string(),
  name: z.string(),
  platform: z.string(),
  os: z.string(),
  model: z.string().optional(),
  virtual: z.boolean(),
  pool: z.boolean().optional(),
  bootMs: z.number().optional(),
  lane: z.number().int().optional(),
  /** Read from the device once, as the run opened it. */
  conditions: z.record(z.string(), z.string()),
});

/** One test run, whole: what `run.json` holds, and what the page, the verdict, JUnit and a pull request's text are made from. */
export const RunRecord = z.object({
  schema: z.literal(1),
  id: z.string(),
  began: z.string(),
  ended: z.string(),
  verdict: z.enum(['PASS', 'FAIL']),
  /** A line a reason, when it failed. */
  why: z.array(z.string()),
  /** As it was run, a param's value left out. */
  command: z.array(z.string()),
  shard: z.object({ i: z.number().int(), n: z.number().int() }).optional(),
  tool: z.object({ version: z.string() }),
  host: z.object({ os: z.string(), arch: z.string(), load1: z.number() }),
  repo: z
    .object({
      commit: z.string(),
      branch: z.string().optional(),
      dirty: z.boolean(),
      remote: z.string().optional(),
    })
    .optional(),
  ci: z
    .object({ provider: z.string(), runUrl: z.string().optional(), pr: z.string().optional() })
    .optional(),
  devices: z.array(Device),
  cases: z.array(Case),
  contents: Contents,
});
export type RunRecord = z.infer<typeof RunRecord>;

const FLAKY_FAILS = 'failed by --fail-on-flaky';

/** How many cases ended each way. */
export const tally = (cases: RunCase[]) => {
  const of = (o: RunCase['outcome']) => cases.filter((c) => c.outcome === o).length;
  return {
    passed: of('passed'),
    flaky: of('flaky'),
    failed: of('failed'),
    notRun: of('not_run'),
    teardowns: cases.filter((c) => c.teardown && !c.teardown.ok).length,
  };
};

/**
 * A run's verdict: FAIL for a case that failed or did not run, a flaky one under `failOnFlaky`, a teardown that failed
 * (the next file started from what it left), or any of `also`, as a shard that never ran.
 */
export function verdictOf(
  cases: RunCase[],
  { failOnFlaky = false, also = [] as string[] } = {},
): Pick<RunRecord, 'verdict' | 'why'> {
  const t = tally(cases);
  const why = [
    ...(t.failed > 0 ? [`${t.failed} failed`] : []),
    ...(t.notRun > 0 ? [`${t.notRun} not run`] : []),
    ...(failOnFlaky && t.flaky > 0 ? [`${FLAKY_FAILS}: ${t.flaky} flaky`] : []),
    ...(t.teardowns > 0 ? [`${t.teardowns} teardown failed`] : []),
    ...also,
  ];
  return { verdict: why.length > 0 ? 'FAIL' : 'PASS', why };
}

export class MergeError extends Error {}

/**
 * Several runs' records as one: lanes of one run or shards of one suite, whichever they are. Two that hold the same file
 * on the same device are refused, and so are two of different commits unless `allowMixed`. A shard of the `n` that is
 * not among them fails the whole, as what never ran is no pass.
 */
export function mergeRecords(parts: RunRecord[], { allowMixed = false } = {}): RunRecord {
  const [first] = parts;
  if (!first) throw new MergeError('nothing to merge: name the folders of the runs');
  const seen = new Set<string>();
  for (const c of parts.flatMap((p) => p.cases)) {
    const key = `${c.device}/${c.label}`;
    if (seen.has(key)) throw new MergeError(`two of the runs hold ${c.label} on ${c.device}`);
    seen.add(key);
  }
  const commits = [...new Set(parts.map((p) => p.repo?.commit ?? 'no commit'))];
  if (commits.length > 1 && !allowMixed)
    throw new MergeError(
      `the runs are of different commits (${commits.map((c) => c.slice(0, 12)).join(', ')}): --allow-mixed merges them all the same`,
    );
  const shards = parts.flatMap((p) => (p.shard ? [p.shard] : []));
  const sizes = [...new Set(shards.map((s) => s.n))];
  if (sizes.length > 1)
    throw new MergeError(`the runs are shards of different splits: of ${sizes.join(' and of ')}`);
  const n = sizes[0] ?? 0;
  const twice = shards.find((s, k) => shards.findIndex((x) => x.i === s.i) !== k);
  if (twice) throw new MergeError(`two of the runs are shard ${twice.i}/${n}`);
  const missing = Array.from({ length: n }, (_, k) => k + 1).filter(
    (i) => !shards.some((s) => s.i === i),
  );
  const cases = parts.flatMap((p) => p.cases);
  const devices = parts
    .flatMap((p) => p.devices)
    .filter((d, k, all) => all.findIndex((x) => JSON.stringify(x) === JSON.stringify(d)) === k);
  const sum = (of: (c: Contents) => number) => parts.reduce((t, p) => t + of(p.contents), 0);
  const { shard: _one, ...whole } = first;
  return {
    ...whole,
    began: parts.map((p) => p.began).sort()[0] ?? first.began,
    ended:
      parts
        .map((p) => p.ended)
        .sort()
        .at(-1) ?? first.ended,
    ...verdictOf(cases, {
      failOnFlaky: parts.some((p) => p.why.some((w) => w.startsWith(FLAKY_FAILS))),
      also: missing.map((i) => `shard ${i}/${n} did not run`),
    }),
    devices,
    cases,
    contents: {
      shots: sum((c) => c.shots),
      painted: sum((c) => c.painted),
      videos: sum((c) => c.videos),
      trees: sum((c) => c.trees),
      logs: sum((c) => c.logs),
      crashes: sum((c) => c.crashes),
      hars: sum((c) => c.hars),
      bytes: sum((c) => c.bytes),
      secretsListed: Math.max(...parts.map((p) => p.contents.secretsListed)),
    },
  };
}

/** A failed attempt's files, the picture first: what a report attaches to its case. */
export const attachmentsOf = (e: Evidence) =>
  [e.shotMarked, e.shot, e.video, e.tree, e.log, e.crash, e.har].flatMap((f) => f ?? []);

/**
 * The record as JUnit takes it: a suite per device, a case per file, and one more for a teardown that failed. `pathOf`
 * turns a path under the run's folder into the one a CI system finds the file by.
 */
export function suitesOf(r: RunRecord, pathOf: (under: string) => string): TestSuite[] {
  const names = [...new Set(r.cases.map((c) => c.device))];
  return names.map((device) => ({
    name: device,
    cases: r.cases
      .filter((c) => c.device === device)
      .flatMap((c): TestCase[] => {
        const failed = c.attempts.flatMap((a) =>
          a.failure ? [{ evidence: a.evidence, failure: a.failure }] : [],
        );
        const last = c.outcome === 'failed' || c.outcome === 'not_run' ? failed.at(-1) : undefined;
        const plain = ({ message, detail }: z.infer<typeof Failure>) => ({ message, detail });
        const retried = failed.filter((a) => a !== last).map((a) => plain(a.failure));
        const left = c.teardown?.failed ?? [];
        return [
          {
            name: c.label,
            ms: c.ms,
            ...(last && { failure: plain(last.failure) }),
            ...(retried.length > 0 && { retried }),
            ...(c.out && { out: c.out }),
            properties: {
              'appdyno.device': c.device,
              ...(r.repo && { 'appdyno.commit': r.repo.commit }),
              ...(r.shard && { 'appdyno.shard': `${r.shard.i}/${r.shard.n}` }),
              'appdyno.rerun': c.rerun,
            },
            attachments: failed.flatMap((a) => attachmentsOf(a.evidence)).map(pathOf),
          },
          ...(left[0] === undefined
            ? []
            : [
                {
                  name: `${c.label} (teardown)`,
                  ms: 0,
                  failure: { message: left[0], detail: left.join('\n') },
                },
              ]),
        ];
      }),
  }));
}
