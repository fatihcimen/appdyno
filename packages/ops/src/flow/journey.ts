import { basename, resolve } from 'node:path';
import { median, must, type Capability, type Measured } from '@appdyno/core';
import type { Flow, RunResult, StepEvent } from '@appdyno/flows';
import {
  JOURNEY_TOTAL,
  JOURNEY_UNSETTLED,
  journeyKind,
  keyName,
  store,
  type Kind,
  type Metric,
  type Unit,
} from '@appdyno/perf';
import type { ServerContext } from '../context.js';
import { keepRun } from '../perf/shared.js';
import { checkApp } from '../policy.js';
import type { FlowOut } from '../schemas.js';
import type { Session } from '../session.js';
import { ToolError } from '../tool.js';
import { stepTime, type FlowRunner, type ReplayOptions } from './runner.js';

/** The gate calls nothing under 5 samples a side. */
export const JOURNEY_ITERATIONS = 5;

export type JourneyAnswer = NonNullable<import('zod').infer<typeof FlowOut>['journey']>;

/** A file's scenario, as a store's folder holds it. */
const journeyScenario = (file: string) =>
  `journey-${keyName(basename(file, '.flow'))}`.slice(0, 60);

type Held = { unit: Unit; samples: number[]; throughHost: boolean };

/** What the iterations read, by kind in the order first seen, and the raw output each came from. */
function journeyReader(s: Session) {
  const held = new Map<Kind, Held>();
  const raw: string[] = [];
  const add = (kind: Kind, unit: Unit, value: number, throughHost = false) => {
    const h = held.get(kind) ?? { unit, samples: [], throughHost };
    h.samples.push(value);
    held.set(kind, h);
  };
  const source = s.device.measure;
  /** What a device reads in a moment: a read that takes a recording of seconds has no place between two steps. */
  const quick = (k: Capability) => !source.slowReads.includes(k);
  /** A step after which the app does not run (`stop`), or a read that failed, has no reading: the run goes on. */
  const read = async <T>(k: Capability, get: () => Promise<Measured<T>>) => {
    if (!quick(k)) return undefined;
    const m = await Promise.resolve()
      .then(get)
      .catch(() => undefined);
    if (m) raw.push(`## ${m.at}\n${m.raw}`);
    return m?.value;
  };
  const onStep = async (e: StepEvent, app: string) => {
    if (e.phase === 'before') {
      if (quick('resetFrames')) await source.resetFrames(app).catch(() => undefined);
      return;
    }
    const line = e.result.step;
    const kind = (what: string) => journeyKind(e.n, line, what);
    const { ms, throughHost } = stepTime(e.step.action, e.result);
    // a step that never settled answers at the tool's own deadline: that is the cap, and no time of the app's
    if (e.result.settled === false) raw.push(`# ${line}: never settled, gave up at ${ms} ms`);
    else {
      add(kind('ms'), 'ms', ms, throughHost);
      raw.push(`# ${line}: ${ms} ms`);
    }
    const frames = await read('frames', () => source.frames(app));
    if (frames?.totalFrames) {
      // from one set of frames: the summary's p95 is of a wider span, in its buckets, and can pass the rows' worst
      const p95 = frames.frames?.p95Ms ?? frames.p95Ms;
      if (p95 !== undefined) add(kind('frames_p95_ms'), 'ms', p95);
      if (frames.frames) add(kind('frames_worst_ms'), 'ms', frames.frames.worstMs);
    }
    const memory = await read('memory', () => source.memory(app));
    if (memory) add(kind('memory_kb'), 'kb', memory.kb);
  };
  return { held, raw, add, onStep, quick };
}

const medianOf = (held: Map<Kind, Held>, kind: Kind) => {
  const samples = held.get(kind)?.samples;
  return samples?.length ? median(samples) : undefined;
};

/**
 * A flow as a performance scenario: `iterations` times after a first one left out, as a measured launch leaves out its
 * warm-up, a time and what the device reads in a moment for each step, all kept as one run the gate compares. An
 * iteration that fails ends it: what passed before it is kept, and the failure is the answer.
 */
export async function measureJourney(
  ctx: ServerContext,
  runner: FlowRunner,
  s: Session,
  flow: Flow,
  file: string,
  o: ReplayOptions & { iterations: number; scenario?: string },
): Promise<{ result: RunResult; journey?: JourneyAnswer }> {
  if (o.from !== undefined)
    throw new ToolError('a measured flow runs whole: leave out from', 'INVALID_ARGUMENT');
  if (!flow.app && !s.appId)
    throw new ToolError(
      `${file} names no app and none is selected: its numbers would have no owner`,
      'INVALID_ARGUMENT',
    );
  const { iterations, scenario, ...replay } = o;
  const warmUp = await runner.run(s, flow, file, replay);
  if (!warmUp.passed) return { result: warmUp };
  const app = checkApp(ctx.policy, s.appId ?? '');
  const reader = journeyReader(s);
  let passed = 0;
  let result = warmUp;
  /** By a step's number, in how many iterations it never settled. */
  const neverSettled = new Map<number, number>();
  for (let i = 0; i < iterations; i++) {
    result = await runner.run(s, flow, file, {
      ...replay,
      onStep: (e) => reader.onStep(e, app),
    });
    if (!result.passed) break;
    passed++;
    const unsettled = result.steps.filter((r) => r.settled === false);
    for (const r of unsettled) neverSettled.set(r.n, (neverSettled.get(r.n) ?? 0) + 1);
    reader.add(JOURNEY_UNSETTLED, 'count', unsettled.length);
    if (unsettled.length > 0) continue;
    reader.add(
      JOURNEY_TOTAL,
      'ms',
      result.steps.reduce(
        (a, r) => a + stepTime(must(flow.steps[r.n - 1], `step ${r.n}`).action, r).ms,
        0,
      ),
      result.steps.some(
        (r) => stepTime(must(flow.steps[r.n - 1], `step ${r.n}`).action, r).throughHost,
      ),
    );
  }
  if (passed === 0) return { result };
  const steps = (result.passed ? result : warmUp).steps.map((r) => {
    const of = (what: string) => medianOf(reader.held, journeyKind(r.n, r.step, what));
    const [ms, framesP95Ms, framesWorstMs, memoryKb] = [
      of('ms'),
      of('frames_p95_ms'),
      of('frames_worst_ms'),
      of('memory_kb'),
    ];
    const unsettled = neverSettled.get(r.n);
    return {
      step: r.step,
      ...(ms !== undefined && { ms }),
      ...(unsettled && { unsettled }),
      ...(framesP95Ms !== undefined && { framesP95Ms }),
      ...(framesWorstMs !== undefined && { framesWorstMs }),
      ...(memoryKb !== undefined && { memoryKb }),
    };
  });
  const name = scenario ?? journeyScenario(file);
  const saved = await store(
    ctx.measurementsDir,
    'journey',
    // its file, not its values: a value may be a secret, and a look on a regression reads the environment's
    { scenario: name, iterations: passed, steps, file: resolve(file) },
    reader.raw.join('\n\n'),
  );
  const held = [...reader.held];
  // the journey's whole leads, as a row's first record is what its cell reads, and with no whole its count of the steps
  // that kept it from one: a single step's time would read as the journey's
  const lead = (k: Kind) => (k === JOURNEY_TOTAL ? 0 : k === JOURNEY_UNSETTLED ? 1 : 2);
  const metrics: Metric[] = held
    .toSorted(([a], [b]) => lead(a) - lead(b))
    .map(([kind, h]) => ({
      kind,
      unit: h.unit,
      samples: h.samples,
      ...(h.throughHost && { throughHost: true }),
    }));
  const noise = await keepRun(ctx, s, {
    app,
    scenario: name,
    source: 'flow measure',
    raw: saved.txt,
    metrics,
  });
  const unread = (['frames', 'memory'] as const).filter((k) => !reader.quick(k));
  const notes = [
    ...(unread.length
      ? [
          `a step's time only for ${unread.join(' and ')}: this device has no quick read of it between two steps`,
        ]
      : []),
    ...(neverSettled.size
      ? [
          `${[...neverSettled].map(([n, times]) => `step ${n} never settled in ${times} of ${passed}`).join(', ')}: those iterations keep no time for it and no whole, as what ended them was the deadline`,
        ]
      : []),
  ];
  const totalMs = medianOf(reader.held, JOURNEY_TOTAL);
  return {
    result,
    journey: {
      id: saved.id,
      raw: saved.txt,
      scenario: name,
      iterations: passed,
      ...(totalMs !== undefined && { totalMs }),
      samples: reader.held.get(JOURNEY_TOTAL)?.samples ?? [],
      steps,
      ...(notes.length && { note: notes.join('; ') }),
      noise,
    },
  };
}

const shown = (v: number) => new Intl.NumberFormat('en-US').format(Math.round(v));

/** A journey in words, a line a step. */
export const journeyText = (j: JourneyAnswer) =>
  [
    `${j.scenario}: ${j.iterations} iterations, a first one left out, ${j.totalMs === undefined ? 'no whole: none settled at every step' : `${shown(j.totalMs)} ms in all`}`,
    ...j.steps.map(
      (x, i) =>
        `${i + 1}. ${x.step}: ${x.ms === undefined ? 'no time' : `${shown(x.ms)} ms`}${x.unsettled ? ` (never settled in ${x.unsettled} of ${j.iterations})` : ''}${x.framesP95Ms === undefined ? '' : `, frames p95 ${x.framesP95Ms} ms`}${x.framesWorstMs === undefined ? '' : `, worst ${x.framesWorstMs} ms`}${x.memoryKb === undefined ? '' : `, memory ${(x.memoryKb / 1024).toFixed(1)} MB`}`,
    ),
    ...(j.note ? [j.note] : []),
    ...(j.noise.length ? [`noise: ${j.noise.join(', ')}`] : []),
    `kept as ${j.scenario}: perf_compare gates it, by step`,
    `raw output: ${j.raw}`,
  ].join('\n');
