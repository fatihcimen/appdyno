import { loadavg } from 'node:os';
import { pause, type CompileMode, type CpuProfile, type LaunchMode } from '@appdyno/core';
import { stepLine, type Flow, type StepEvent } from '@appdyno/flows';
import {
  answerOf,
  deviceClass,
  journeyKind,
  journeyStep,
  latestRuns,
  loadBaseline,
  loadMeasurement,
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
  type Profile,
  type Reference,
  type RunKey,
  type Seen,
} from '@appdyno/perf';
import type { ServerContext } from '../context.js';
import { stepTime, type FlowRunner } from '../flow/runner.js';
import { loadRecording, readFlow } from '../flow/shared.js';
import { checkApp } from '../policy.js';
import type { Session } from '../session.js';
import { deviceInfo, perfTools, unlessUnsupported } from './shared.js';

/** How long a look at what has no time of its own records. */
const LOOK_SECONDS = 8;
/** The most a profile records. */
const MOST_SECONDS = 30;
/** A recorder says it has started before its first sample. */
const RECORDER_START_MS = 300;
/** A function under this cannot pass a diff's floor: what is committed beside a baseline stays small. */
const LEAST_SAMPLES = 10;
/** Of a step that stops the app: true of a slower stop, and nothing wrong with a reference that has no side for it. */
const NOT_RUNNING = 'the app does not run in this step';

type During = () => Promise<unknown>;
type Place = { name: string; looks: Look[] };
type Direction = 'up' | 'down';

/** How a run did what it measured, from the measurement it names. */
async function asMeasured(dir: string, run: PerfRecord[]) {
  const id = /(pm-[0-9a-f]{8})\.txt$/.exec(run[0]?.raw ?? '')?.[1];
  const held = id
    ? await loadMeasurement<{
        file?: string;
        mode?: LaunchMode;
        direction?: Direction;
        scroll?: Direction;
      }>(dir, id)
    : undefined;
  return held?.value ?? {};
}

const keptOf = (p: CpuProfile): Profile => {
  const big = (list: CpuProfile['top']) =>
    list
      .filter((e) => e.samples >= LEAST_SAMPLES)
      .map(({ symbol, samples }) => ({ symbol, samples }));
  return {
    durationMs: p.durationMs,
    top: big(p.top),
    ...(p.appTop && { appTop: big(p.appTop) }),
  };
};

/** Whole seconds that hold a step of this time, with what a recorder takes to start. */
const secondsFor = (ms: number) => Math.min(MOST_SECONDS, Math.ceil(ms / 1000) + 2);

const blank = (cannot: string[] = []): Seen => ({
  read: [],
  cannot,
  hostLoad: Math.round(loadavg()[0]!),
});

/**
 * What the gate runs on a regression: the measures there are, on the same device and build, keeping nothing as a run,
 * as a look must not become the newest run the gate compares. What cannot be read is said, and the rest still is.
 */
export function gateLooks(ctx: ServerContext, runner: FlowRunner) {
  const { measure, save, scroller } = perfTools(ctx);

  /** What a device or a replay refuses goes into the answer: a look never fails the gate's own word. */
  const attempt = async <T>(say: (line: string) => void, what: string, read: () => Promise<T>) => {
    try {
      return await read();
    } catch (e) {
      const { code, message } = e as { code?: string; message: string };
      if (code === 'CANCELLED') throw e;
      say(`${what}: ${message}`);
      return undefined;
    }
  };
  const into = (seen: Seen) => (line: string) => void seen.cannot.push(line);

  const profile = async (s: Session, app: string, seen: Seen, seconds: number, during?: During) => {
    const m = await attempt(into(seen), 'a CPU profile', () =>
      measure(s, 'cpuProfile')(app, seconds * 1000, during),
    );
    if (!m) return;
    const { id } = await save('cpu-profile', [m], m.value);
    seen.profile = keptOf(m.value);
    seen.read.push(`CPU profile ${id}`);
  };

  /** A hang where a device has them, by its own triage; else the frames' causes; a probe sees that it stood, not why. */
  const mainThread = async (
    s: Session,
    app: string,
    seen: Seen,
    seconds: number,
    during?: During,
  ) => {
    const hangs = await attempt(into(seen), 'hangs', () =>
      unlessUnsupported(measure(s, 'hangs', false)(app, seconds, during)),
    );
    if (hangs) {
      const { id } = await save('hangs', [hangs], hangs.value);
      seen.hangs = hangs.value.causes ?? [];
      seen.read.push(`hang trace ${id}`);
      return;
    }
    if (s.device.measure.framesByProbe) {
      seen.cannot.push(
        "why the frames were late: this device's frames come through a probe, which sees that the main thread stood and not why",
      );
      return;
    }
    const m = await attempt(into(seen), 'a frame trace', () =>
      measure(s, 'frameTrace', false)(app, seconds, during),
    );
    if (!m) return;
    const { id } = await save('frame-trace', [m], m.value);
    seen.read.push(`frame trace ${id}`);
    if (m.value.kind === 'timeline' && m.value.causes) seen.frames = m.value.causes;
    else seen.cannot.push('why the frames were late: this trace does not say');
  };

  const launch = async (
    s: Session,
    app: string,
    seen: Seen,
    mode: LaunchMode,
    compile?: string,
  ) => {
    s.appPid = undefined;
    const m = await attempt(into(seen), 'a start trace', () =>
      measure(
        s,
        'launch',
        'launch-why',
      )(app, {
        mode,
        repeats: 1,
        trace: true,
        ...(compile && { compile: compile as CompileMode }),
      }),
    );
    s.acted();
    if (!m) return;
    const { startup, medianMs } = m.value;
    if (!startup) {
      seen.cannot.push('a start trace: this device kept none');
      return;
    }
    const { id } = await save('launch', [m], m.value);
    seen.phases = startup.breakdown.map((b) => ({ phase: b.reason, ms: b.ms }));
    seen.reasons = [...startup.reasons, ...startup.findings];
    if (medianMs !== undefined) seen.againMs = medianMs;
    seen.read.push(`start trace ${id}`);
  };

  /** The flow once, with `read` recording around each of the wanted steps: it stays open until the step settles. */
  const replayAround = async (
    s: Session,
    flow: Flow,
    file: string,
    wanted: number[],
    read: (n: number, during: During) => Promise<void>,
  ) => {
    let open: { done: () => void; reading: Promise<void> } | undefined;
    const finish = async () => {
      open?.done();
      await open?.reading;
      open = undefined;
    };
    const onStep = async (e: StepEvent) => {
      if (!wanted.includes(e.n)) return;
      if (e.phase === 'after') return finish();
      let start = () => {};
      let done = () => {};
      const started = new Promise<void>((r) => (start = r));
      const ended = new Promise<void>((r) => (done = r));
      const reading = read(e.n, () => {
        start();
        return ended;
      }).finally(() => start());
      open = { done, reading };
      await started;
      await pause(RECORDER_START_MS);
    };
    const result = await runner.run(s, flow, file, { onStep });
    // a step that failed left its recording open
    await finish();
    return result;
  };

  /** Each step where it stands in the flow as the flow reads now; one that moved or changed is said, not looked at. */
  const lookAtSteps = async (
    s: Session,
    app: string,
    run: PerfRecord[],
    places: Place[],
    seen: Record<string, Seen>,
    file: string | undefined,
  ) => {
    const each = (line: string) => places.forEach((p) => seen[p.name]!.cannot.push(line));
    if (!file) return each('this run does not say which flow it came from: measure it again');
    let flow: Flow;
    try {
      flow = readFlow(file);
    } catch (e) {
      return each((e as Error).message);
    }
    const steps = places.flatMap((p) => {
      const n = Number(p.name.split('_')[0]);
      const step = flow.steps[n - 1];
      if (step && journeyKind(n, stepLine(step), 'ms') === `journey.${p.name}.ms`)
        return [{ ...p, n, action: step.action, after: flow.steps[n - 2]?.action }];
      seen[p.name]!.cannot.push(`${file} has changed: this is no longer its step ${n}`);
      return [];
    });
    for (const p of steps.filter((x) => x.action === 'stop'))
      seen[p.name]!.cannot.push(NOT_RUNNING);
    for (const p of steps.filter((x) => x.action === 'launch'))
      await launch(s, app, seen[p.name]!, p.after === 'stop' ? 'cold' : 'warm', run[0]?.compile);
    const running = steps.filter((p) => p.action !== 'stop' && p.action !== 'launch');
    if (running.length === 0) return;
    const secondsOf = (name: string) =>
      secondsFor(run.find((r) => r.kind === `journey.${name}.ms`)?.value ?? 0);
    /** The flow once, its end said of every place: one that cannot run (a value not set) throws, and is no failure. */
    const replay = async (wanted: number[], read: (n: number, d: During) => Promise<void>) => {
      const result = await attempt(each, 'the replay', () =>
        replayAround(s, flow, file, wanted, read),
      );
      if (result?.failure)
        each(`the replay stopped at step ${result.failure.n}: ${result.failure.message}`);
      return result;
    };
    const throughFlow = async (
      look: Look,
      read: (seen: Seen, seconds: number, during: During) => Promise<void>,
    ) => {
      const wanted = running.filter((p) => p.looks.includes(look));
      if (wanted.length === 0) return true;
      const at = (n: number) => wanted.find((p) => p.n === n);
      const result = await replay(
        wanted.map((p) => p.n),
        (n, during) => read(seen[at(n)!.name]!, secondsOf(at(n)!.name), during),
      );
      for (const r of result?.steps ?? []) {
        const p = at(r.n);
        if (p) seen[p.name]!.againMs = stepTime(flow.steps[r.n - 1]!.action, r).ms;
      }
      return result?.passed;
    };
    // as a measured journey leaves out its first: code run for the first time reads as the interpreter
    if (!(await replay([], async () => undefined))?.passed) return;
    const profiled = await throughFlow('profile', (x, seconds, during) =>
      profile(s, app, x, seconds, during),
    );
    if (profiled)
      await throughFlow('frames', (x, seconds, during) => mainThread(s, app, x, seconds, during));
  };

  /** A run with no steps: a start, the swipes it measured, or what the app does by itself. */
  const lookAtRun = async (
    s: Session,
    app: string,
    run: PerfRecord[],
    looks: Look[],
    seen: Seen,
    how: Awaited<ReturnType<typeof asMeasured>>,
  ) => {
    if (looks.includes('launch')) await launch(s, app, seen, how.mode ?? 'cold', run[0]?.compile);
    const way = how.direction ?? how.scroll;
    /** The run may have left the list at its end, so back the other way first, outside the recording. */
    const swipes = async () => {
      if (!way) return undefined;
      await (
        await scroller(s, way === 'up' ? 'down' : 'up', 0)
      )();
      return scroller(s, way, RECORDER_START_MS);
    };
    if (looks.includes('profile')) await profile(s, app, seen, LOOK_SECONDS, await swipes());
    if (looks.includes('frames')) await mainThread(s, app, seen, LOOK_SECONDS, await swipes());
    if (way) s.acted();
  };

  /** The session to look on, or why none can speak for this run. */
  const lookingOn = async (key: RunKey, run: PerfRecord[]) => {
    const s = await ctx.session().catch((e: Error) => e);
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
    const build = await s.device.measure.buildType(app).catch(() => 'unknown');
    const measured = run[0]?.build;
    if (measured && build !== measured)
      return `${s.device.serial} holds a ${build} build of ${app}, and the run was of a ${measured} build`;
    return { s, app };
  };

  /**
   * A look leaves the device as it found it, and what it started it stops: a look can bring up a simulator's
   * runner, and with one up the same read went another way, 11 ms to 39 ms, which the gate rightly called on the next
   * run of an unchanged app. A runner that was up before is the caller's.
   */
  const gather = async (s: Session, app: string, run: PerfRecord[], places: Place[]) => {
    const seen = Object.fromEntries(places.map((p) => [p.name, blank()]));
    const how = await asMeasured(ctx.measurementsDir, run);
    const steps = places.filter((p) => p.name !== WHOLE_RUN);
    const whole = places.find((p) => p.name === WHOLE_RUN);
    const up = s.device.agentUp;
    try {
      if (steps.length) await lookAtSteps(s, app, run, steps, seen, how.file);
      if (whole) await lookAtRun(s, app, run, whole.looks, seen[WHOLE_RUN]!, how);
    } finally {
      if (!up && s.device.agentUp) await s.device.stopAgent().catch(() => undefined);
    }
    return seen;
  };

  /** A key's report with its cause looked for where it calls a regression. Otherwise no device is touched. */
  const why = async (key: RunKey, report: KeyReport, run: PerfRecord[]): Promise<GateAnswer> => {
    const baseline = await loadBaseline(ctx.perfDir, key);
    const places = [...placesOf(report.comparisons)].map(([name, worse]) => ({
      name,
      looks: looksFor(worse.map((c) => c.kind)),
    }));
    const looking = places.some((p) => p.looks.length);
    const on = looking ? await lookingOn(key, run) : undefined;
    const reference = looking ? await loadReference(ctx.perfDir, key) : undefined;
    const fits =
      reference?.build === run[0]?.build && (reference?.compile ?? '') === (run[0]?.compile ?? '');
    const seen =
      typeof on === 'object'
        ? await gather(on.s, on.app, run, places)
        : Object.fromEntries(places.map((p) => [p.name, blank(on ? [on] : [])]));
    if (reference && !fits)
      for (const x of Object.values(seen))
        x.cannot.push(
          `the reference is of a ${reference.build} build${reference.compile ? `, compile ${reference.compile}` : ''}, and does not compare with this run: it was not used`,
        );
    const answer = answerOf(report, run, baseline, seen, fits ? reference : undefined);
    await saveAnswer(ctx.measurementsDir, answer);
    return answer;
  };

  /** The other side of a later diff: the profile and phases of each place of the newest run, on the build installed. */
  const reference = async (key: RunKey) => {
    const [run = []] = await latestRuns(ctx.measurementsDir, key);
    const steps = run.flatMap((r) => {
      const step = journeyStep(r.kind);
      return step?.what === 'ms' ? [{ name: step.step, looks: ['profile'] as Look[] }] : [];
    });
    const looks = looksFor(run.map((r) => r.kind)).filter((l) => l !== 'frames');
    const places = steps.length ? steps : looks.length ? [{ name: WHOLE_RUN, looks }] : [];
    if (places.length === 0)
      return { line: `${key.scenario}: no number of it has a side to keep`, ok: true };
    const on = await lookingOn(key, run);
    if (typeof on === 'string') return { line: `${key.scenario}: ${on}`, ok: false };
    const seen = await gather(on.s, on.app, run, places);
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
      build: run[0]!.build,
      ...(run[0]?.compile && { compile: run[0].compile }),
      places: held,
    });
    return { line: [`reference: ${file}`, ...missed].join('\n'), ok: true, file };
  };

  return { why, reference };
}
