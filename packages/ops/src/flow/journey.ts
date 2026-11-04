import { basename } from 'node:path';
import { median, type Capability, type Measured } from '@appdyno/core';
import type { Flow, RunResult, StepEvent } from '@appdyno/flows';
import {
  JOURNEY_TOTAL,
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
export const journeyScenario = (file: string) =>
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
    add(kind('ms'), 'ms', ms, throughHost);
    raw.push(`# ${line}: ${ms} ms`);
    const frames = await read('frames', () => source.frames(app));
    if (frames?.totalFrames) {
      if (frames.p95Ms !== undefined) add(kind('frames_p95_ms'), 'ms', frames.p95Ms);
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
  for (let i = 0; i < iterations; i++) {
    result = await runner.run(s, flow, file, {
      ...replay,
      onStep: (e) => reader.onStep(e, app),
    });
    if (!result.passed) break;
    passed++;
    reader.add(
      JOURNEY_TOTAL,
      'ms',
      result.steps.reduce((a, r) => a + stepTime(flow.steps[r.n - 1]!.action, r).ms, 0),
      result.steps.some((r) => stepTime(flow.steps[r.n - 1]!.action, r).throughHost),
    );
  }
  if (passed === 0) return { result };
  const steps = (result.passed ? result : warmUp).steps.map((r) => {
    const of = (what: string) => medianOf(reader.held, journeyKind(r.n, r.step, what));
    const [framesP95Ms, framesWorstMs, memoryKb] = [
      of('frames_p95_ms'),
      of('frames_worst_ms'),
      of('memory_kb'),
    ];
    return {
      step: r.step,
      ms: of('ms') ?? 0,
      ...(framesP95Ms !== undefined && { framesP95Ms }),
      ...(framesWorstMs !== undefined && { framesWorstMs }),
      ...(memoryKb !== undefined && { memoryKb }),
    };
  });
  const name = scenario ?? journeyScenario(file);
  const saved = await store(
    ctx.measurementsDir,
    'journey',
    { scenario: name, iterations: passed, steps },
    reader.raw.join('\n\n'),
  );
  const held = [...reader.held];
  // the journey's whole leads, as a row's first record is what its cell reads
  const metrics: Metric[] = [
    ...held.filter(([k]) => k === JOURNEY_TOTAL),
    ...held.filter(([k]) => k !== JOURNEY_TOTAL),
  ].map(([kind, h]) => ({
    kind,
    unit: h.unit,
    samples: h.samples,
    ...(h.throughHost && { throughHost: true }),
  }));
  const noise = await keepRun(ctx, s, app, name, 'flow measure', saved.txt, metrics);
  const unread = (['frames', 'memory'] as const).filter((k) => !reader.quick(k));
  return {
    result,
    journey: {
      id: saved.id,
      raw: saved.txt,
      scenario: name,
      iterations: passed,
      totalMs: medianOf(reader.held, JOURNEY_TOTAL)!,
      steps,
      ...(unread.length && {
        note: `a step's time only for ${unread.join(' and ')}: this device has no quick read of it between two steps`,
      }),
      noise,
    },
  };
}

const shown = (v: number) => new Intl.NumberFormat('en-US').format(Math.round(v));

/** A journey in words, a line a step. */
export const journeyText = (j: JourneyAnswer) =>
  [
    `${j.scenario}: ${j.iterations} iterations, a first one left out, ${shown(j.totalMs)} ms in all`,
    ...j.steps.map(
      (x, i) =>
        `${i + 1}. ${x.step}: ${shown(x.ms)} ms${x.framesP95Ms === undefined ? '' : `, frames p95 ${x.framesP95Ms} ms`}${x.framesWorstMs === undefined ? '' : `, worst ${x.framesWorstMs} ms`}${x.memoryKb === undefined ? '' : `, memory ${(x.memoryKb / 1024).toFixed(1)} MB`}`,
    ),
    ...(j.note ? [j.note] : []),
    ...(j.noise.length ? [`noise: ${j.noise.join(', ')}`] : []),
    `kept as ${j.scenario}: perf_compare gates it, by step`,
    `raw output: ${j.raw}`,
  ].join('\n');
