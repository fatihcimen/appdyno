import { loadavg } from 'node:os';
import { must, pause, type CompileMode, type CpuProfile, type LaunchMode } from '@appdyno/core';
import { stepLine, type Flow, type StepEvent } from '@appdyno/flows';
import {
  journeyKind,
  loadMeasurement,
  type Look,
  type PerfRecord,
  type Profile,
  type Seen,
} from '@appdyno/perf';
import type { ServerContext } from '../context.js';
import { stepTime, type FlowRunner } from '../flow/runner.js';
import { readFlow } from '../flow/shared.js';
import type { Session } from '../session.js';
import { symbolsOf, unlessUnsupported, type perfTools } from './shared.js';

/** How long a look at what has no time of its own records. */
const LOOK_SECONDS = 8;
/** The most a profile records. */
const MOST_SECONDS = 30;
/** A recorder says it has started before its first sample. */
const RECORDER_START_MS = 300;
/** A function under this cannot pass a diff's floor: what is committed beside a baseline stays small. */
const LEAST_SAMPLES = 10;
/** Of a step that stops the app: true of a slower stop, and nothing wrong with a reference that has no side for it. */
export const NOT_RUNNING = 'the app does not run in this step';

type During = () => Promise<unknown>;
export type Place = { name: string; looks: Look[] };
type Direction = 'up' | 'down';

/** What every look is made with: the context's measures, the runner a flow is replayed by, the symbols given. */
export type Looking = ReturnType<typeof perfTools> & {
  ctx: ServerContext;
  runner: FlowRunner;
  dsym: string | undefined;
};

/** How a run did what it measured, from the measurement it names. */
export async function asMeasured(dir: string, run: PerfRecord[]) {
  const id = /(pm-[0-9a-f]{8})\.txt$/.exec(run[0]?.raw ?? '')?.[1];
  const held = id ? await loadMeasurement(dir, id) : undefined;
  return (held?.value ?? {}) as {
    file?: string;
    mode?: LaunchMode;
    direction?: Direction;
    scroll?: Direction;
  };
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

export const blank = (cannot: string[] = []): Seen => ({
  read: [],
  cannot,
  hostLoad: Math.round(must(loadavg()[0], 'the load average')),
});

/** What a device or a replay refuses goes into the answer: a look never fails the gate's own word. */
async function attempt<T>(say: (line: string) => void, what: string, read: () => Promise<T>) {
  try {
    return await read();
  } catch (e) {
    const { code, message } = e as { code?: string; message: string };
    if (code === 'CANCELLED') throw e;
    say(`${what}: ${message}`);
    return undefined;
  }
}

const into = (seen: Seen) => (line: string) => void seen.cannot.push(line);

async function profile(
  l: Looking,
  s: Session,
  app: string,
  seen: Seen,
  seconds: number,
  during?: During,
) {
  const m = await attempt(into(seen), 'a CPU profile', () =>
    l.measure(s, 'cpuProfile')(app, seconds * 1000, during, symbolsOf(s, l.dsym)),
  );
  if (!m) return;
  const { id } = await l.save('cpu-profile', [m], m.value);
  seen.profile = keptOf(m.value);
  seen.read.push(`CPU profile ${id}`);
}

/** A hang where a device has them, by its own triage; else the frames' causes; a probe sees that it stood, not why. */
async function mainThread(
  l: Looking,
  s: Session,
  app: string,
  seen: Seen,
  seconds: number,
  during?: During,
) {
  const hangs = await attempt(into(seen), 'hangs', () =>
    unlessUnsupported(l.measure(s, 'hangs', false)(app, seconds, during, symbolsOf(s, l.dsym))),
  );
  if (hangs) {
    const { id } = await l.save('hangs', [hangs], hangs.value);
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
    l.measure(s, 'frameTrace', false)(app, seconds, during),
  );
  if (!m) return;
  const { id } = await l.save('frame-trace', [m], m.value);
  seen.read.push(`frame trace ${id}`);
  if (m.value.kind === 'timeline' && m.value.causes) seen.frames = m.value.causes;
  else seen.cannot.push('why the frames were late: this trace does not say');
}

async function launch(
  l: Looking,
  s: Session,
  app: string,
  seen: Seen,
  mode: LaunchMode,
  compile?: CompileMode,
) {
  s.forgetProcess();
  const m = await attempt(into(seen), 'a start trace', () =>
    l.measure(
      s,
      'launch',
      'launch-why',
    )(app, {
      mode,
      repeats: 1,
      trace: true,
      ...(compile && { compile }),
    }),
  );
  s.acted();
  if (!m) return;
  const { startup, medianMs } = m.value;
  if (!startup) {
    seen.cannot.push('a start trace: this device kept none');
    return;
  }
  const { id } = await l.save('launch', [m], m.value);
  seen.phases = startup.breakdown.map((b) => ({ phase: b.reason, ms: b.ms }));
  seen.reasons = [...startup.reasons, ...startup.findings];
  if (medianMs !== undefined) seen.againMs = medianMs;
  seen.read.push(`start trace ${id}`);
}

/** The flow once, with `read` recording around each of the wanted steps: it stays open until the step settles. */
async function replayAround(
  l: Looking,
  s: Session,
  flow: Flow,
  file: string,
  wanted: number[],
  read: (n: number, during: During) => Promise<void>,
) {
  let open: { done: () => void; reading: Promise<void> } | undefined;
  const finish = async () => {
    open?.done();
    await open?.reading;
    open = undefined;
  };
  const onStep = async (e: StepEvent) => {
    if (!wanted.includes(e.n)) return;
    if (e.phase === 'after') return finish();
    let start: () => void = () => undefined;
    let done: () => void = () => undefined;
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
  const result = await l.runner.run(s, flow, file, { onStep });
  // a step that failed left its recording open
  await finish();
  return result;
}

/** Each step where it stands in the flow as the flow reads now; one that moved or changed is said, not looked at. */
export async function lookAtSteps(
  l: Looking,
  s: Session,
  app: string,
  run: PerfRecord[],
  places: Place[],
  seen: Record<string, Seen>,
  file: string | undefined,
) {
  const seenAt = (name: string) => must(seen[name], `what ${name} saw`);
  const each = (line: string) => {
    for (const p of places) seenAt(p.name).cannot.push(line);
  };
  if (!file) {
    each('this run does not say which flow it came from: measure it again');
    return;
  }
  let flow: Flow;
  try {
    flow = readFlow(file);
  } catch (e) {
    each((e as Error).message);
    return;
  }
  const steps = places.flatMap((p) => {
    const n = Number(p.name.split('_')[0]);
    const step = flow.steps[n - 1];
    if (step && journeyKind(n, stepLine(step), 'ms') === `journey.${p.name}.ms`)
      return [{ ...p, n, action: step.action, after: flow.steps[n - 2]?.action }];
    seenAt(p.name).cannot.push(`${file} has changed: this is no longer its step ${n}`);
    return [];
  });
  for (const p of steps.filter((x) => x.action === 'stop')) seenAt(p.name).cannot.push(NOT_RUNNING);
  for (const p of steps.filter((x) => x.action === 'launch'))
    await launch(l, s, app, seenAt(p.name), p.after === 'stop' ? 'cold' : 'warm', run[0]?.compile);
  const running = steps.filter((p) => p.action !== 'stop' && p.action !== 'launch');
  if (running.length === 0) return;
  const secondsOf = (name: string) =>
    secondsFor(run.find((r) => r.kind === `journey.${name}.ms`)?.value ?? 0);
  /** The flow once, its end said of every place: one that cannot run (a value not set) throws, and is no failure. */
  const replay = async (wanted: number[], read: (n: number, d: During) => Promise<void>) => {
    const result = await attempt(each, 'the replay', () =>
      replayAround(l, s, flow, file, wanted, read),
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
      (n, during) => {
        const p = must(at(n), `step ${n}`);
        return read(seenAt(p.name), secondsOf(p.name), during);
      },
    );
    for (const r of result?.steps ?? []) {
      const p = at(r.n);
      if (p)
        seenAt(p.name).againMs = stepTime(must(flow.steps[r.n - 1], `step ${r.n}`).action, r).ms;
    }
    return result?.passed;
  };
  // as a measured journey leaves out its first: code run for the first time reads as the interpreter
  if (!(await replay([], () => Promise.resolve()))?.passed) return;
  const profiled = await throughFlow('profile', (x, seconds, during) =>
    profile(l, s, app, x, seconds, during),
  );
  if (profiled)
    await throughFlow('frames', (x, seconds, during) => mainThread(l, s, app, x, seconds, during));
}

/** A run with no steps: a start, the swipes it measured, or what the app does by itself. */
export async function lookAtRun(
  l: Looking,
  s: Session,
  app: string,
  run: PerfRecord[],
  looks: Look[],
  seen: Seen,
  how: Awaited<ReturnType<typeof asMeasured>>,
) {
  if (looks.includes('launch')) await launch(l, s, app, seen, how.mode ?? 'cold', run[0]?.compile);
  const way = how.direction ?? how.scroll;
  /** The run may have left the list at its end, so back the other way first, outside the recording. */
  const swipes = async () => {
    if (!way) return undefined;
    await (
      await l.scroller(s, way === 'up' ? 'down' : 'up', 0)
    )();
    return l.scroller(s, way, RECORDER_START_MS);
  };
  if (looks.includes('profile')) await profile(l, s, app, seen, LOOK_SECONDS, await swipes());
  if (looks.includes('frames')) await mainThread(l, s, app, seen, LOOK_SECONDS, await swipes());
  if (way) s.acted();
}
