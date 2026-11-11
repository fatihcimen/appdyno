import { must } from '@appdyno/core';
import {
  answerOf,
  buildWords,
  deviceClass,
  journeyStep,
  latestRuns,
  loadBaseline,
  loadReference,
  looksFor,
  placesOf,
  saveAnswer,
  saveReference,
  WHOLE_RUN,
  type GateAnswer,
  type KeyReport,
  type Look,
  type PerfRecord,
  type Reference,
  type RunKey,
} from '@appdyno/perf';
import type { ServerContext } from '../context.js';
import type { FlowRunner } from '../flow/runner.js';
import { loadRecording } from '../flow/shared.js';
import { checkApp } from '../policy.js';
import type { Session } from '../session.js';
import {
  asMeasured,
  blank,
  lookAtRun,
  lookAtSteps,
  NOT_RUNNING,
  type Looking,
  type Place,
} from './looks.js';
import { deviceInfo, perfTools } from './shared.js';

/** The session to look on, or why none can speak for this run. */
async function lookingOn(ctx: ServerContext, key: RunKey, run: PerfRecord[]) {
  const s = await ctx
    .session()
    .catch((e: unknown) => (e instanceof Error ? e : new Error(String(e))));
  if (s instanceof Error) return `no device to look on: ${s.message}`;
  const here = deviceClass(deviceInfo(s));
  if (here !== key.deviceClass)
    return `${s.device.serial} is ${here}, and the run was on ${key.deviceClass}`;
  if (loadRecording(ctx, s.device.serial)?.state.running)
    return 'a flow is being recorded on this device: stop it first';
  let app: string;
  try {
    app = checkApp(ctx.policy, key.app);
  } catch (e) {
    return (e as Error).message;
  }
  const build = await s.device.measure.buildType(app).catch(() => 'unknown' as const);
  const measured = run[0]?.build;
  if (measured && build !== measured)
    return `${s.device.serial} holds ${buildWords(build)} of ${app}, and the run was of ${buildWords(measured)}`;
  return { s, app };
}

/**
 * A look leaves the device as it found it, and what it started it stops: a look can bring up a simulator's
 * runner, and with one up the same read went another way, 11 ms to 39 ms, which the gate rightly called on the next
 * run of an unchanged app. A runner that was up before is the caller's.
 */
async function gather(l: Looking, s: Session, app: string, run: PerfRecord[], places: Place[]) {
  const seen = Object.fromEntries(places.map((p) => [p.name, blank()]));
  const how = await asMeasured(l.ctx.measurementsDir, run);
  const steps = places.filter((p) => p.name !== WHOLE_RUN);
  const whole = places.find((p) => p.name === WHOLE_RUN);
  const up = s.device.agentUp;
  try {
    if (steps.length) await lookAtSteps(l, s, app, run, steps, seen, how.file);
    if (whole)
      await lookAtRun(l, s, app, run, whole.looks, must(seen[WHOLE_RUN], 'what the run saw'), how);
  } finally {
    // the looks may have started it, which the compiler does not follow
    if (!up && (s.device.agentUp as boolean)) await s.device.stopAgent().catch(() => undefined);
  }
  return seen;
}

/** A key's report with its cause looked for where it calls a regression. Otherwise no device is touched. */
async function why(
  l: Looking,
  key: RunKey,
  report: KeyReport,
  run: PerfRecord[],
): Promise<GateAnswer> {
  const { ctx } = l;
  const baseline = await loadBaseline(ctx.perfDir, key);
  const places = [...placesOf(report.comparisons)].map(([name, worse]) => ({
    name,
    looks: looksFor(worse.map((c) => c.kind)),
  }));
  const looking = places.some((p) => p.looks.length);
  const on = looking ? await lookingOn(ctx, key, run) : undefined;
  const reference = looking ? await loadReference(ctx.perfDir, key) : undefined;
  const fits =
    reference?.build === run[0]?.build && (reference?.compile ?? '') === (run[0]?.compile ?? '');
  const seen =
    typeof on === 'object'
      ? await gather(l, on.s, on.app, run, places)
      : Object.fromEntries(places.map((p) => [p.name, blank(on ? [on] : [])]));
  if (reference && !fits)
    for (const x of Object.values(seen))
      x.cannot.push(
        `the reference is of ${buildWords(reference.build)}${reference.compile ? `, compile ${reference.compile}` : ''}, and does not compare with this run: it was not used`,
      );
  const answer = answerOf(report, run, baseline, seen, fits ? reference : undefined);
  await saveAnswer(ctx.measurementsDir, answer);
  return answer;
}

/** The other side of a later diff: the profile and phases of each place of the newest run, on the build installed. */
async function reference(l: Looking, key: RunKey) {
  const { ctx } = l;
  const [run = []] = await latestRuns(ctx.measurementsDir, key);
  const steps = run.flatMap((r) => {
    const step = journeyStep(r.kind);
    return step?.what === 'ms' ? [{ name: step.step, looks: ['profile'] as Look[] }] : [];
  });
  const looks = looksFor(run.map((r) => r.kind)).filter((x) => x !== 'frames');
  const places = steps.length ? steps : looks.length ? [{ name: WHOLE_RUN, looks }] : [];
  if (places.length === 0)
    return { line: `${key.scenario}: no number of it has a side to keep`, ok: true };
  const on = await lookingOn(ctx, key, run);
  if (typeof on === 'string') return { line: `${key.scenario}: ${on}`, ok: false };
  const seen = await gather(l, on.s, on.app, run, places);
  const held: Reference['places'] = {};
  for (const [name, x] of Object.entries(seen))
    if (x.profile || x.phases)
      held[name] = {
        ...(x.profile && { profile: x.profile }),
        ...(x.phases && { phases: x.phases }),
      };
  const missed = Object.entries(seen).flatMap(([name, x]) =>
    x.cannot.filter((c) => c !== NOT_RUNNING).map((c) => `${key.scenario} ${name}: ${c}`),
  );
  if (Object.keys(held).length === 0)
    return { line: [`${key.scenario}: nothing was read`, ...missed].join('\n'), ok: false };
  const file = await saveReference(ctx.perfDir, {
    schema: 1,
    ...key,
    at: new Date().toISOString(),
    build: must(run[0], 'the newest run').build,
    ...(run[0]?.compile && { compile: run[0].compile }),
    places: held,
  });
  return { line: [`reference: ${file}`, ...missed].join('\n'), ok: true, file };
}

/**
 * What the gate runs on a regression: the measures there are, on the same device and build, keeping nothing as a run,
 * as a look must not become the newest run the gate compares. What cannot be read is said, and the rest still is.
 */
export function gateLooks(ctx: ServerContext, runner: FlowRunner, dsym?: string) {
  const l: Looking = { ...perfTools(ctx), ctx, runner, dsym };
  return {
    why: (key: RunKey, report: KeyReport, run: PerfRecord[]) => why(l, key, report, run),
    reference: (key: RunKey) => reference(l, key),
  };
}
