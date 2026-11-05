import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ActOptions, MeasureSource, SlowFrameCauses } from '@appdyno/core';
import {
  addToBaseline,
  loadAnswer,
  loadReference,
  recordsOf,
  runFiles,
  runKeys,
  saveBaseline,
  saveReference,
  saveRun,
  store,
  type Baseline,
  type GateAnswer,
  type Metric,
} from '@appdyno/perf';
import { DeviceError, type ActParams } from '@appdyno/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_POLICY, ServerContext } from '../src/index.js';
import { FakeDevice } from './fake-device.js';
import { callerOf } from './helpers.js';

// the Mac's load is this test's to set: under load the gate calls no regression, and nothing is looked at
const host = vi.hoisted(() => ({ load: 1 }));
vi.mock('node:os', async (original) => ({
  ...(await original<typeof import('node:os')>()),
  loadavg: () => [host.load, host.load, host.load],
}));

const fresh = () => mkdtempSync(join(tmpdir(), 'appdyno-why-'));

beforeEach(() => {
  host.load = 1;
  vi.stubEnv('APPDYNO_STATE_DIR', fresh());
});
afterEach(() => vi.unstubAllEnvs());

const measured = <T>(value: T) => ({ value, raw: 'raw', at: new Date().toISOString() });

/** A frame trace that runs what it records around, with what the frames say of why. */
const traceOf =
  (causes?: SlowFrameCauses): MeasureSource['frameTrace'] =>
  async (_app, _seconds, during) => {
    await during?.();
    return measured({
      kind: 'timeline',
      frames: 10,
      janky: 1,
      jankyPercent: 10,
      appDeadlineMissed: 1,
      appJankPercent: 10,
      bufferStuffing: 0,
      surfaceFlinger: 0,
      frozen: 0,
      p50Ms: 9,
      p95Ms: 30,
      worstMs: 40,
      ...(causes && { causes }),
    });
  };

/** A phone whose tap on "Form" takes `formMs`, and whose profile holds what a test put in it. */
class TimedPhone extends FakeDevice {
  formMs = 400;
  private tick = 0;
  override async act(action: ActParams, opts: ActOptions = {}) {
    const onForm = action.kind === 'tap' && action.y >= 300 && action.y <= 400;
    const r = await super.act(action, opts);
    const ms = (onForm ? this.formMs : 200) + (this.tick++ % 3);
    return { ...r, ...(r.settle && { settle: { ...r.settle, ms } }) };
  }
}

function phone(overrides: Partial<MeasureSource> = {}, policy = DEFAULT_POLICY) {
  const device = new TimedPhone();
  device.virtual = false;
  const looks: string[] = [];
  const costs: Record<string, number> = { steady: 200 };
  Object.defineProperty(device, 'measure', {
    value: {
      ...device.measure,
      buildType: async () => 'release',
      vitals: async () => measured({}),
      cpuProfile: async (_app: string, ms: number, during?: () => Promise<unknown>) => {
        looks.push('profile');
        await during?.();
        const top = Object.entries(costs).map(([symbol, samples]) => ({
          symbol,
          samples,
          percent: 1,
        }));
        return measured({ durationMs: ms, samples: 1, top });
      },
      ...overrides,
    } satisfies MeasureSource,
  });
  const [measurements, perf] = [fresh(), fresh()];
  const ctx = new ServerContext(
    policy,
    [
      {
        list: async () => [{ serial: device.serial, state: 'device', ready: true }],
        handles: () => true,
        open: () => device,
      },
    ],
    { device: device.serial, app: 'dev.app', measurements, perf },
  );
  return { device, ctx, measurements, perf, looks, costs, call: callerOf(ctx) };
}

type Phone = ReturnType<typeof phone>;

const SCENARIO = 'journey-checkout';
const STEP = '02_tap_text_Form';
const STEPS = ['01_launch', STEP, '03_assert_text_Bilgiler'];

const flowFile = () => {
  const file = join(fresh(), 'checkout.flow');
  writeFileSync(file, 'launch\ntap text="Form"\nassert text="Bilgiler"\n');
  return file;
};

const kept = (t: Phone, n: number, raw: string, metrics: Metric[]) =>
  recordsOf(
    {
      run: `run-${n}`,
      app: 'dev.app',
      scenario: SCENARIO,
      source: 'flow measure',
      raw,
      device: {
        serial: t.device.serial,
        platform: 'android',
        model: 'Fake Phone',
        os: '15',
        virtual: t.device.virtual,
      },
      build: 'release',
      load: { host: [1, 1, 1], hostCpus: 10 },
      tool: '',
      at: `2026-11-04T10:00:0${n}.000Z`,
    },
    metrics,
  );

const five = (ms: number) => [0, 1, 2, 3, 4].map((i) => ms + i);

/**
 * A journey with a baseline of three runs and a newest run 700 ms slower in one step, as a measured flow keeps them: what
 * is tested here is what happens after the gate calls it, and a test that replayed all that took 14 s.
 */
async function regressed(t: Phone, o: { reference?: boolean } = {}) {
  const file = flowFile();
  const { txt } = await store(t.measurements, 'journey', { file }, '');
  const run = (n: number, formMs: number) =>
    kept(t, n, txt, [
      { kind: 'journey.total_ms', unit: 'ms', samples: five(400 + formMs) },
      ...STEPS.map((step): Metric => ({
        kind: `journey.${step}.ms`,
        unit: 'ms',
        samples: five(step === STEP ? formMs : 200),
      })),
    ]);
  const key = { app: 'dev.app', scenario: SCENARIO, deviceClass: run(1, 400)[0]!.deviceClass };
  let baseline: Baseline | undefined;
  for (const n of [1, 2, 3]) baseline = addToBaseline(key, baseline, run(n, 400));
  await saveBaseline(t.perf, baseline!);
  await saveRun(t.measurements, run(3, 400));
  if (o.reference) await t.call('perf_compare', { action: 'reference', scenario: SCENARIO });
  await saveRun(t.measurements, run(4, 1_100));
  t.device.formMs = 1_100;
  return file;
}

const why = (t: Phone) => t.call('perf_compare', { action: 'why', scenario: SCENARIO });
const answers = (d: { answers?: unknown[] }) => d.answers as GateAnswer[];
const finding = (d: { answers?: unknown[] }) => answers(d)[0]!.findings[0]!;

describe('the gate, asked why', () => {
  it('finds nothing to look at on an unchanged build, then names the function of a known cost', async () => {
    const t = phone();
    const file = flowFile();
    const measure = () => t.call('flow', { action: 'run', file, iterations: 5 });
    for (let i = 0; i < 3; i++) {
      await measure();
      await t.call('perf_compare', { action: 'baseline', scenario: SCENARIO });
    }
    await t.call('perf_compare', { action: 'reference', scenario: SCENARIO });
    await measure();
    t.looks.length = 0;
    const same = await why(t);
    expect(same.data.exitCode).toBe(0);
    expect(answers(same.data)[0]!.status).toBe('clear');
    expect(same.text).toContain('no regression');
    expect(t.looks).toEqual([]);

    t.device.formMs = 1_100;
    t.costs.knownCost = 700;
    await measure();
    const r = await why(t);
    expect(r.data.exitCode).toBe(1);
    expect(r.data.failed).toBe(true);
    const f = finding(r.data);
    expect(f.place).toBe(STEP);
    expect(f.causes[0]).toMatchObject({ kind: 'function', name: 'knownCost' });
    expect(f.causes[0]!.says).toContain('+700 ms of CPU in the step (0 to 700)');
    expect(r.text).toContain('likeliest cause: knownCost');
    expect(f.evidence.join()).toContain('it showed again');
  });

  it('keeps what it looked at apart from the runs the gate compares', async () => {
    const t = phone();
    await regressed(t);
    const [key] = await runKeys(t.measurements);
    const before = await runFiles(t.measurements, key!);
    await why(t);
    expect(await runFiles(t.measurements, key!)).toEqual(before);
    expect((await loadAnswer(t.measurements, key!))!.status).toBe('regression');
    const again = await t.call('perf_compare', { action: 'compare', scenario: SCENARIO });
    expect(again.data.exitCode).toBe(1);
  });

  it('with no reference, names no function and says what would', async () => {
    const t = phone();
    await regressed(t);
    t.costs.knownCost = 700;
    const f = finding((await why(t)).data);
    expect(f.causes).toEqual([]);
    expect(f.evidence.join()).toContain('knownCost 700 ms');
    expect(f.cannot.join()).toContain('appdyno perf reference');
  });

  it('says no cause was found for a change nothing it reads can see', async () => {
    const t = phone();
    await regressed(t, { reference: true });
    const f = finding((await why(t)).data);
    expect(f.causes).toEqual([]);
    expect(f.cannot.join()).toContain('no cause was found');
  });

  it('reads a frame cause around the step, which needs no reference', async () => {
    const t = phone({
      frameTrace: traceOf({
        slowFrames: 3,
        causes: [{ cause: 'busy', msPerFrame: 101, share: 99, frames: 3 }],
        top: 'busy',
      }),
    });
    await regressed(t);
    const f = finding((await why(t)).data);
    expect(f.causes[0]).toMatchObject({ kind: 'frames', name: 'busy' });
  });

  it('uses a hang where a device has them, with its function', async () => {
    const t = phone({
      hangs: async (_a, _s, during) => {
        await during?.();
        return measured({
          hangs: 1,
          worstMs: 700,
          totalMs: 700,
          tracePath: 't',
          causes: [{ ms: 700, kind: 'busy', cpuPercent: 99, function: 'busyMainThread()' }],
        });
      },
    });
    await regressed(t);
    const f = finding((await why(t)).data);
    expect(f.causes[0]).toMatchObject({ kind: 'hang', name: 'busyMainThread()' });
  });

  it('says what a device refused, and still answers as the gate does', async () => {
    const t = phone({
      cpuProfile: async () => {
        throw new DeviceError('UNSUPPORTED', 'simpleperf could not record dev.app');
      },
    });
    await regressed(t);
    const r = await why(t);
    expect(r.data.exitCode).toBe(1);
    expect(finding(r.data).cannot.join()).toContain('simpleperf could not record dev.app');
  });

  it('looks on no device but the kind the run was on', async () => {
    const t = phone();
    await regressed(t);
    t.device.hello.model = 'Other Phone';
    const r = await why(t);
    expect(r.data.exitCode).toBe(1);
    expect(finding(r.data).cannot.join()).toContain('and the run was on android-physical-Fake');
    expect(t.looks).toEqual([]);
  });

  it('looks at no other build than the run was of', async () => {
    const t = phone({ buildType: async () => 'debug' });
    await regressed(t);
    const r = await why(t);
    expect(finding(r.data).cannot.join()).toContain('and the run was of a release build');
    expect(t.looks).toEqual([]);
  });

  it('says a flow that changed under its step, rather than time the wrong one', async () => {
    const t = phone();
    const file = await regressed(t);
    writeFileSync(file, 'launch\nassert text="Bilgiler"\n');
    expect(finding((await why(t)).data).cannot.join()).toContain('has changed');
    expect(t.looks).toEqual([]);
  });

  it('reads a phone’s names from the dSYM it is given, and says so where a device takes none', async () => {
    const asked: unknown[] = [];
    const named = phone({
      symbolFiles: true,
      cpuProfile: async (_app, _ms, _during, symbols) => {
        asked.push(symbols);
        return measured({ durationMs: 3_000, samples: 1, top: [] });
      },
    });
    await regressed(named);
    const dsym = '/builds/App.app.dSYM';
    await named.call('perf_compare', { action: 'why', scenario: SCENARIO, dsym });
    expect(asked).toEqual([{ dsym }]);

    const none = phone();
    await regressed(none);
    const r = await none.call('perf_compare', { action: 'why', scenario: SCENARIO, dsym });
    expect(answers(r.data)[0]!.findings[0]!.cannot.join()).toContain('dsym is for iOS');
  });

  it('stops the agent a look started, as it changes what the next run measures', async () => {
    const t = phone({
      cpuProfile: async () => {
        t.device.agentUp = true;
        return measured({ durationMs: 3_000, samples: 1, top: [] });
      },
    });
    await regressed(t);
    await why(t);
    expect(t.device.agentUp).toBe(false);
  });

  it('leaves up an agent that was up before it looked', async () => {
    const t = phone();
    await regressed(t);
    t.device.agentUp = true;
    await why(t);
    expect(t.device.agentUp).toBe(true);
  });

  it('answers in the gate’s formats, with its exit code', async () => {
    const t = phone();
    await regressed(t);
    const asked = (format: string) =>
      t.call('perf_compare', { action: 'why', scenario: SCENARIO, format });
    const json = await asked('json');
    expect(json.data.exitCode).toBe(1);
    const held = JSON.parse(json.text) as { failed: boolean; answers: GateAnswer[] };
    expect(held.failed).toBe(true);
    expect(held.answers[0]!.findings[0]!.place).toBe(STEP);
    const junit = await asked('junit');
    expect(junit.data.exitCode).toBe(1);
    expect(junit.text).toContain('<failure message=');
  });

  it('says why a reference of another build was not used, and names nothing by it', async () => {
    const t = phone();
    await regressed(t, { reference: true });
    const [key] = await runKeys(t.measurements);
    await saveReference(t.perf, { ...(await loadReference(t.perf, key!))!, build: 'debug' });
    t.costs.knownCost = 700;
    const f = finding((await why(t)).data);
    expect(f.causes).toEqual([]);
    expect(f.cannot.join()).toContain('the reference is of a debug build');
    expect(f.cannot.join()).toContain('it was not used');
  });

  it('keeps to an allowlist, and says so in the answer', async () => {
    const t = phone({}, { ...DEFAULT_POLICY, apps: ['some.other.app'] });
    await regressed(t);
    const r = await why(t);
    expect(r.data.exitCode).toBe(1);
    expect(finding(r.data).cannot).toHaveLength(1);
    expect(t.looks).toEqual([]);
  });

  it('says a flow that is gone, and keeps the answer it has', async () => {
    const t = phone();
    const file = await regressed(t);
    rmSync(file);
    const r = await why(t);
    expect(r.data.exitCode).toBe(1);
    expect(finding(r.data).cannot.join()).toContain(file);
  });

  it('says a value the replay has none of, and answers all the same', async () => {
    const t = phone();
    const file = await regressed(t);
    writeFileSync(
      file,
      'param NOT_SET_ANYWHERE\nlaunch\ntap text="Form"\nassert text="${NOT_SET_ANYWHERE}"\n',
    );
    const r = await why(t);
    expect(r.data.exitCode).toBe(1);
    expect(finding(r.data).cannot.join()).toContain('no value for NOT_SET_ANYWHERE');
    expect(t.looks).toEqual([]);
  });

  it('reads a start by its phases, against the reference, and keeps no run of it', async () => {
    const start = { bind: 300, total: 400 };
    const t = phone({
      launch: async () =>
        measured({
          mode: 'cold',
          samples: [0, 1, 2, 3, 4, 5].map((i) => ({ totalMs: start.total + i, state: 'COLD' })),
          medianMs: start.total,
          startup: {
            tracePath: 't',
            reasons: ['Main Thread - Time spent in Running'],
            breakdown: [
              { reason: 'bindApplication', ms: start.bind },
              { reason: 'activityStart', ms: 90 },
            ],
            findings: [],
          },
        }),
    });
    const scenario = 'launch-cold';
    const measure = () => t.call('perf_launch', { mode: 'cold', repeats: 6, scenario });
    for (let i = 0; i < 3; i++) {
      await measure();
      await t.call('perf_compare', { action: 'baseline', scenario });
    }
    await t.call('perf_compare', { action: 'reference', scenario });
    start.bind = 1_000;
    start.total = 1_100;
    await measure();
    const [key] = await runKeys(t.measurements);
    const before = await runFiles(t.measurements, key!);
    const r = await t.call('perf_compare', { action: 'why', scenario });
    expect(r.data.exitCode).toBe(1);
    const f = finding(r.data);
    expect(f.place).toBe('run');
    expect(f.causes[0]).toMatchObject({ kind: 'phase', name: 'bindApplication' });
    expect(f.causes[0]!.says).toContain('+700 ms (300 to 1000)');
    expect(f.evidence.join()).toContain('Main Thread - Time spent in Running');
    expect(await runFiles(t.measurements, key!)).toEqual(before);
  });

  it('does the swipes a scroll was measured with, the other way first', async () => {
    const t = phone({ frameTrace: traceOf() });
    const { txt } = await store(t.measurements, 'scroll', { direction: 'up' }, '');
    const records = (n: number, ms: number) =>
      kept(t, n, txt, [{ kind: 'frames.p95_ms', unit: 'ms', samples: five(ms) }]);
    const key = {
      app: 'dev.app',
      scenario: SCENARIO,
      deviceClass: records(1, 1)[0]!.deviceClass,
    };
    let baseline: Baseline | undefined;
    for (const n of [1, 2, 3]) baseline = addToBaseline(key, baseline, records(n, 20));
    await saveBaseline(t.perf, baseline!);
    await saveRun(t.measurements, records(3, 20));
    await t.call('perf_compare', { action: 'reference', scenario: SCENARIO });
    t.costs.scrollCost = 3_000;
    await saveRun(t.measurements, records(4, 90));
    t.device.calls.length = 0;
    const f = finding((await why(t)).data);
    expect(f.place).toBe('run');
    expect(f.causes[0]).toMatchObject({ kind: 'function', name: 'scrollCost' });
    expect(f.causes[0]!.says).toContain('ms of CPU a second');
    // back, then the four it measured, once for the profile and once for the frames
    expect(t.device.calls.filter((c) => c.name === 'act')).toHaveLength(16);
  });

  it('under load calls no regression, and looks at nothing', async () => {
    const t = phone();
    t.device.virtual = true;
    const file = flowFile();
    const measure = () => t.call('flow', { action: 'run', file, iterations: 5 });
    for (let i = 0; i < 3; i++) {
      await measure();
      await t.call('perf_compare', { action: 'baseline', scenario: SCENARIO });
    }
    t.device.formMs = 1_100;
    host.load = 1_000;
    await measure();
    t.looks.length = 0;
    const r = await why(t);
    expect(r.data.exitCode).toBe(1);
    expect(answers(r.data)[0]!.status).toBe('noisy');
    expect(answers(r.data)[0]!.notes.join()).toContain('a change under noise, not called');
    expect(t.looks).toEqual([]);
  });

  it('runs nothing for a number no measure can explain, and says so', async () => {
    const t = phone();
    const records = (n: number, bytes: number) =>
      kept(t, n, '', [{ kind: 'network.rx_bytes', unit: 'bytes', samples: five(bytes) }]);
    const key = {
      app: 'dev.app',
      scenario: SCENARIO,
      deviceClass: records(1, 1)[0]!.deviceClass,
    };
    let baseline: Baseline | undefined;
    for (const n of [1, 2, 3]) baseline = addToBaseline(key, baseline, records(n, 100_000_000));
    await saveBaseline(t.perf, baseline!);
    await saveRun(t.measurements, records(4, 200_000_000));
    const r = await why(t);
    expect(r.data.exitCode).toBe(1);
    expect(finding(r.data).cannot).toEqual(['no measure here explains network.rx_bytes']);
    expect(t.looks).toEqual([]);
  });
});

describe('a reference', () => {
  it('keeps each step of a journey beside the baseline, and no run', async () => {
    const t = phone();
    await regressed(t);
    const [key] = await runKeys(t.measurements);
    const before = await runFiles(t.measurements, key!);
    t.device.calls.length = 0;
    const r = await t.call('perf_compare', { action: 'reference', scenario: SCENARIO });
    expect(r.data.exitCode).toBe(0);
    expect(await runFiles(t.measurements, key!)).toEqual(before);
    // the flow twice, a first time left out: no more, as a replay costs a recording on a phone
    expect(t.device.calls.filter((c) => c.name === 'act')).toHaveLength(2);
    const held = JSON.parse(readFileSync(r.data.references![0]!, 'utf8')) as {
      places: Record<string, { profile?: unknown }>;
    };
    expect(held.places[STEP]!.profile).toBeDefined();
    // the step that starts the app has no running app to profile, and a start of its own
    expect(held.places['01_launch']?.profile).toBeUndefined();
  });

  it('is refused on a device that cannot speak for the run', async () => {
    const t = phone();
    await regressed(t);
    t.device.hello.model = 'Other Phone';
    const r = await t.call('perf_compare', { action: 'reference', scenario: SCENARIO });
    expect(r.data.exitCode).toBe(1);
    expect(r.text).toContain('and the run was on');
  });
});
