import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { must, type ActOptions, type MeasureSource } from '@appdyno/core';
import { latestRuns, runKeys, type PerfRecord } from '@appdyno/perf';
import { DeviceError, type ActParams } from '@appdyno/protocol';
import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_POLICY, flowsFor, ServerContext, ToolError } from '../src/index.js';
import { FakeDevice } from './fake-device.js';
import { callerOf } from './helpers.js';

// the Mac's load is this test's to set: what the gate says under it is part of what is tested
const host = vi.hoisted(() => ({ load: 1 }));
vi.mock('node:os', async (original) => ({
  ...(await original<typeof import('node:os')>()),
  loadavg: () => [host.load, host.load, host.load],
}));

const fresh = () => mkdtempSync(join(tmpdir(), 'appdyno-journey-'));

beforeEach(() => {
  host.load = 1;
  vi.stubEnv('APPDYNO_STATE_DIR', fresh());
});
afterEach(() => vi.unstubAllEnvs());

/**
 * A phone whose tap on "Form" takes `formMs` and any other touch 200 ms, a little apart from one to the next. Its tap on
 * "Form" stops settling for as many times as `formNeverSettles` says, and answers at the tool's 3 s.
 */
class TimedPhone extends FakeDevice {
  formMs = 400;
  formNeverSettles = 0;
  private tick = 0;
  override async act(action: ActParams, opts: ActOptions = {}) {
    const onForm = action.kind === 'tap' && action.y >= 300 && action.y <= 400;
    const moving = onForm && this.formNeverSettles > 0;
    if (moving) this.formNeverSettles--;
    const r = await super.act(action, opts);
    const ms = moving ? 3_000 : (onForm ? this.formMs : 200) + (this.tick++ % 3);
    return { ...r, ...(r.settle && { settle: { ...r.settle, ms, settled: !moving } }) };
  }
}

function phone(overrides: Partial<MeasureSource> = {}) {
  const device = new TimedPhone();
  device.virtual = false;
  Object.defineProperty(device, 'measure', {
    value: {
      ...device.measure,
      buildType: () => Promise.resolve('release'),
      vitals: () => Promise.resolve({ value: {}, raw: '', at: new Date().toISOString() }),
      ...overrides,
    } satisfies MeasureSource,
  });
  const measurements = fresh();
  const perf = fresh();
  const ctx = new ServerContext(
    DEFAULT_POLICY,
    [
      {
        list: () => Promise.resolve([{ serial: device.serial, state: 'device', ready: true }]),
        handles: () => true,
        open: () => device,
      },
    ],
    { device: device.serial, app: 'dev.app', measurements, perf },
  );
  return { device, ctx, measurements, perf, call: callerOf(ctx) };
}

const JOURNEY = 'launch\ntap text="Form"\nassert text="Bilgiler"\n';

const flowFile = (text = JOURNEY, name = 'checkout.flow') => {
  const file = join(fresh(), name);
  writeFileSync(file, text);
  return file;
};

const newestRun = async (measurements: string) => {
  const [key] = await runKeys(measurements);
  assert(key);
  return must((await latestRuns(measurements, key))[0], 'the newest run');
};

const named = (run: PerfRecord[], part: string) => run.find((r) => r.kind.includes(part));

describe('a journey as a performance scenario', () => {
  it('keeps a time and what the device reads for each step, the first iteration left out', async () => {
    const { call, measurements, device } = phone();
    const file = flowFile();
    const r = await call('flow', { action: 'run', file, iterations: 5 });
    expect(r.data.journey?.scenario).toBe('journey-checkout');
    expect(r.data.journey?.iterations).toBe(5);
    expect(r.text).toContain('tap text="Form": 40');
    const run = await newestRun(measurements);
    expect(run[0]?.kind).toBe('journey.total_ms');
    expect(run[0]?.samples).toHaveLength(5);
    expect(named(run, '02_tap_text_Form.ms')?.samples).toHaveLength(5);
    expect(named(run, '02_tap_text_Form.ms')?.value).toBeCloseTo(401, 0);
    // what a device times itself is its own; what is timed on the Mac says so through the load it takes
    expect(named(run, '02_tap_text_Form.frames_p95_ms')?.samples).toEqual([18, 18, 18, 18, 18]);
    expect(named(run, '02_tap_text_Form.memory_kb')?.unit).toBe('kb');
    // the frames of a step are those of the step: reset before its action
    const names = device.calls.map((c) => c.name);
    expect(names.filter((n) => n === 'perf.reset')).toHaveLength(15);
    expect(names.filter((n) => n === 'launch')).toHaveLength(6);
  });

  it('names the step that got slower through the gate, and leaves the others alone', async () => {
    const { device, call, measurements } = phone();
    const file = flowFile();
    for (let i = 0; i < 3; i++) {
      await call('flow', { action: 'run', file, iterations: 5 });
      await call('perf_compare', { action: 'baseline', scenario: 'journey-checkout' });
    }
    await call('flow', { action: 'run', file, iterations: 5 });
    const same = await call('perf_compare', { action: 'compare' });
    expect(same.data.exitCode).toBe(0);

    device.formMs = 1_100;
    await call('flow', { action: 'run', file, iterations: 5 });
    const worse = await call('perf_compare', { action: 'compare' });
    expect(worse.data.exitCode).toBe(1);
    expect(worse.text).toMatch(/regression\s+journey\.02_tap_text_Form\.ms: 110\d ms against 40/);
    expect(worse.text).toMatch(/regression\s+journey\.total_ms/);
    expect(worse.text).not.toMatch(/regression\s+journey\.03_/);

    const dashboard = await call('perf_compare', { action: 'dashboard' });
    const page = readFileSync(must(dashboard.data.file, 'the dashboard'), 'utf8');
    const text = page.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text).toContain('Journeys');
    expect(text).toContain('3 steps, slowest 02 tap text Form');
    expect(text).toContain('02 tap text Form slower +');
    expect(page).toContain('class="split"');
    expect(page).toContain('Against the baseline');
    expect(await newestRun(measurements)).toBeDefined();
  });

  it('keeps no time for a step that never settled, and no whole for its iteration', async () => {
    const { device, call, measurements } = phone();
    const r0 = call('flow', { action: 'run', file: flowFile(), iterations: 5 });
    // the warm-up settles, and the first two iterations do not
    const left = device.act.bind(device);
    let forms = 0;
    device.act = async (action, opts) => {
      if (action.kind === 'tap' && ++forms === 2) device.formNeverSettles = 2;
      return left(action, opts);
    };
    const r = await r0;
    const run = await newestRun(measurements);
    const form = must(named(run, '02_tap_text_Form.ms'), 'the step');
    expect(form.samples).toHaveLength(3);
    expect(Math.max(...form.samples)).toBeLessThan(500);
    expect(named(run, 'journey.total_ms')?.samples).toHaveLength(3);
    expect(named(run, 'journey.unsettled')?.samples).toEqual([1, 1, 0, 0, 0]);
    expect(r.data.journey?.steps[1]).toMatchObject({ unsettled: 2 });
    expect(r.data.journey?.steps[1]?.ms).toBeLessThan(500);
    expect(r.data.journey?.note).toContain('step 2 never settled in 2 of 5');
    expect(r.text).toContain('(never settled in 2 of 5)');
    expect(r.text).toContain('as what ended them was the deadline');
  });

  it('says a step that never settled at all as no time, with no number to mistake for one', async () => {
    const { device, call, measurements } = phone();
    device.formNeverSettles = Infinity;
    const r = await call('flow', { action: 'run', file: flowFile(), iterations: 5 });
    const run = await newestRun(measurements);
    expect(named(run, '02_tap_text_Form.ms')).toBeUndefined();
    expect(named(run, 'journey.total_ms')).toBeUndefined();
    expect(run[0]?.kind).toBe('journey.unsettled');
    const j = must(r.data.journey, 'the journey');
    expect(j.totalMs).toBeUndefined();
    expect(j.samples).toEqual([]);
    expect(must(j.steps[1], 'its second step').ms).toBeUndefined();
    expect(r.text).toContain('no whole: none settled at every step');
    expect(r.text).toMatch(/2\. tap text="Form": no time \(never settled in 5 of 5\)/);
  });

  it('calls a step that stopped settling a regression, though it left no time to compare', async () => {
    const { device, call } = phone();
    const file = flowFile();
    for (let i = 0; i < 3; i++) {
      await call('flow', { action: 'run', file, iterations: 5 });
      await call('perf_compare', { action: 'baseline', scenario: 'journey-checkout' });
    }
    device.formNeverSettles = Infinity;
    await call('flow', { action: 'run', file, iterations: 5 });
    const worse = await call('perf_compare', { action: 'compare' });
    expect(worse.data.exitCode).toBe(1);
    expect(worse.text).toMatch(/regression\s+journey\.unsettled: 1 count against 0/);
  });

  it('on a loaded Mac a phone gates what it timed itself, and leaves out what went through the Mac', async () => {
    host.load = 10_000;
    const { device, call } = phone();
    const file = flowFile();
    for (let i = 0; i < 3; i++) {
      await call('flow', { action: 'run', file, iterations: 5 });
      const b = await call('perf_compare', { action: 'baseline', scenario: 'journey-checkout' });
      expect(b.data.exitCode).toBe(i < 2 ? 1 : 0);
      expect(b.text).toMatch(/left out, high-host-load: journey\.total_ms, journey\.01_launch\.ms/);
    }
    device.formMs = 1_100;
    await call('flow', { action: 'run', file, iterations: 5 });
    const worse = await call('perf_compare', { action: 'compare' });
    expect(worse.text).toMatch(/regression\s+journey\.02_tap_text_Form\.ms/);
    expect(worse.text).toMatch(/new\s+journey\.01_launch\.ms/);
    expect(worse.data.exitCode).toBe(1);
  });

  it("takes a step's p95 and worst frame from the same frames, so that one cannot pass the other", async () => {
    const { frames } = phone().device.measure;
    const { call, measurements } = phone({
      frames: async () => {
        const read = await frames();
        return {
          ...read,
          value: {
            ...read.value,
            p95Ms: 61,
            frames: { count: 50, slow: 1, slowPercent: 2, p50Ms: 9, p95Ms: 30, worstMs: 38.4 },
          },
        };
      },
    });
    await call('flow', { action: 'run', file: flowFile(), iterations: 2 });
    const run = await newestRun(measurements);
    expect(named(run, '02_tap_text_Form.frames_p95_ms')?.samples).toEqual([30, 30]);
    expect(named(run, '02_tap_text_Form.frames_worst_ms')?.samples).toEqual([38.4, 38.4]);
  });

  it('a step after which the app does not run has no reading, and the run goes on', async () => {
    const gone = () => Promise.reject(new DeviceError('APP_NOT_RUNNING', 'dev.app is not running'));
    let up = true;
    const base = phone();
    const { frames, memory } = base.device.measure;
    const { call, measurements, device } = phone({
      frames: async () => (up ? frames() : gone()),
      memory: async () => (up ? memory() : gone()),
    });
    const terminate = device.terminate.bind(device);
    device.terminate = async (pkg: string) => {
      up = false;
      await terminate(pkg);
    };
    const launch = device.launch.bind(device);
    device.launch = async (pkg: string) => {
      up = true;
      return launch(pkg);
    };
    const r = await call('flow', {
      action: 'run',
      file: flowFile('stop\nlaunch\n'),
      iterations: 2,
    });
    expect(r.data.done).toBe('passed');
    const run = await newestRun(measurements);
    expect(named(run, '01_stop.ms')?.samples).toHaveLength(2);
    expect(named(run, '01_stop.memory_kb')).toBeUndefined();
    expect(named(run, '02_launch.memory_kb')?.samples).toHaveLength(2);
  });

  it('a read that takes a recording of seconds is not made between two steps, and the answer says so', async () => {
    const { device, call, measurements } = phone({
      slowReads: ['memory', 'frames', 'resetFrames'],
    });
    const r = await call('flow', { action: 'run', file: flowFile(), iterations: 1 });
    expect(r.data.journey?.note).toMatch(/time only for frames and memory/);
    expect(device.calls.some((c) => c.name === 'perf.memory')).toBe(false);
    const run = await newestRun(measurements);
    expect(named(run, 'memory_kb')).toBeUndefined();
    expect(named(run, '02_tap_text_Form.ms')).toBeDefined();
  });

  it('keeps what passed before an iteration failed, and the failure is the answer', async () => {
    const { device, call, measurements } = phone();
    let launches = 0;
    const launch = device.launch.bind(device);
    device.launch = async (pkg: string) => {
      if (++launches === 4) device.fail = new DeviceError('TIMEOUT', 'the phone went away');
      return launch(pkg);
    };
    const e = await call('flow', { action: 'run', file: flowFile(), iterations: 5 }).then(
      () => undefined,
      (x: unknown) => x as ToolError,
    );
    expect(e).toBeInstanceOf(ToolError);
    expect(e?.message).toContain('the phone went away');
    expect(e?.message).toContain('what passed before it is kept');
    device.fail = undefined;
    // the warm-up, then two that passed, then the one that failed
    expect((await newestRun(measurements))[0]?.samples).toHaveLength(2);
  });

  it('a warm-up that fails keeps nothing', async () => {
    const { device, call, measurements } = phone();
    device.fail = new DeviceError('TIMEOUT', 'the phone went away');
    await expect(
      call('flow', { action: 'run', file: flowFile(), iterations: 5 }),
    ).rejects.toBeInstanceOf(ToolError);
    device.fail = undefined;
    expect(await runKeys(measurements)).toEqual([]);
  });

  it('refuses a start half way and a flow with no owner, by name', async () => {
    const { call } = phone();
    await expect(
      call('flow', { action: 'run', file: flowFile(), iterations: 2, from: 2 }),
    ).rejects.toThrow(/runs whole/);
    const { device } = phone();
    const ctx = new ServerContext(DEFAULT_POLICY, [
      {
        list: () => Promise.resolve([{ serial: device.serial, state: 'device', ready: true }]),
        handles: () => true,
        open: () => device,
      },
    ]);
    await expect(
      callerOf(ctx)('flow', { action: 'run', file: flowFile(), iterations: 2 }),
    ).rejects.toThrow(/names no app/);
  });

  it('a value given for a step does not change its key', async () => {
    const { call, measurements } = phone();
    const file = flowFile('param WHERE\nlaunch\ntap text="${WHERE}"\n');
    await call('flow', { action: 'run', file, iterations: 1, params: ['WHERE=Form'] });
    expect(named(await newestRun(measurements), '02_tap_text_WHERE.ms')).toBeDefined();
  });

  it('runs as a test, a case per file, with what it read in the case', async () => {
    const { ctx, measurements } = phone();
    const artifacts = fresh();
    const junit = join(artifacts, 'junit.xml');
    const logged: string[] = [];
    const r = await flowsFor(ctx).test({
      files: [flowFile(JOURNEY, 'a.flow')],
      devices: [],
      artifacts,
      junit,
      iterations: 2,
      log: (l) => logged.push(l),
    });
    expect(r.passed).toBe(true);
    expect(logged.join('\n')).toContain('journey-a: 2 iterations');
    expect(readFileSync(junit, 'utf8')).toContain('journey-a: 2 iterations');
    expect((await newestRun(measurements))[0]?.scenario).toBe('journey-a');
  });
});

describe('a measure during a recording', () => {
  const recorded = async (
    call: ReturnType<typeof phone>['call'],
    actions: () => Promise<unknown>,
  ) => {
    const file = join(must(process.env.APPDYNO_STATE_DIR, 'the state folder'), 'a.flow');
    await call('flow', { action: 'start' });
    await actions();
    await call('flow', { action: 'stop' });
    await call('flow', { action: 'save', file });
    return readFileSync(file, 'utf8');
  };
  const stepsOf = (text: string) =>
    text.split('\n').filter((l) => l && !l.startsWith('app ') && !l.startsWith('param '));

  describe('a scroll of a list that ends', () => {
    const noFrames = () =>
      new DeviceError(
        'CHECK_FAILED',
        'the trace tool recorded no frames: nothing moved on the screen',
      );
    const frames = {
      totalFrames: 185,
      jankyFrames: 0,
      jankyPercent: 0,
      frozenFrames: 0,
      fewFrames: false,
    };
    /** A phone whose trace refuses these rounds, by the count of rounds asked for so far. */
    const refusing = (rounds: number[]) => {
      let asked = 0;
      return phone({
        framesDuring: async (_app, _seconds, during) => {
          await during();
          if (rounds.includes(++asked)) throw noFrames();
          return { value: frames, raw: 'frames', at: new Date().toISOString() };
        },
      });
    };
    const swipesOf = (text: string) => stepsOf(text).filter((s) => s.startsWith('swipe'));
    const rewound = (r: { data: { rounds: { rewound?: boolean }[] } }) =>
      r.data.rounds.map((x) => x.rewound === true);

    it('goes on past no frames: a list at its end draws them still, and they are of nothing', async () => {
      const { call, device } = phone();
      device.listEnd = 2;
      const r = await call('perf_scroll', { swipes: 2, repeats: 3 });
      expect(rewound(r)).toEqual([false, true, true]);
      expect(r.text).toContain('round 2 ran after the list was brought back');
      expect(r.text).toContain('round 3 ran after the list was brought back');
    });

    it('brings a list back only once it has ended, and a recording does the same', async () => {
      const { call, device } = phone();
      device.listEnd = 4;
      let r!: Awaited<ReturnType<typeof call<'perf_scroll'>>>;
      const text = await recorded(call, async () => {
        r = await call('perf_scroll', { swipes: 2, repeats: 4 });
      });
      expect(rewound(r)).toEqual([false, false, true, true]);
      expect(swipesOf(text)).toEqual([
        ...Array<string>(4).fill('swipe up'),
        ...Array<string>(2).fill('swipe down'),
        ...Array<string>(2).fill('swipe up'),
        ...Array<string>(2).fill('swipe down'),
        ...Array<string>(2).fill('swipe up'),
      ]);
    });

    it('takes a phone that refuses a round with no frames as a list that did not move', async () => {
      const { call } = refusing([2]);
      const r = await call('perf_scroll', { swipes: 2, repeats: 3 });
      expect(rewound(r)).toEqual([false, true, true]);
    });

    it('keeps its good rounds when the list does not move even then', async () => {
      const { call } = refusing([2, 3]);
      const r = await call('perf_scroll', { swipes: 2, repeats: 3 });
      expect(r.data.rounds).toHaveLength(1);
      expect(r.text).toContain('1 of 3 rounds');
    });

    it('still refuses a first round that moves nothing: that screen does not scroll', async () => {
      const { call } = refusing([1]);
      await expect(call('perf_scroll', { swipes: 2, repeats: 3 })).rejects.toThrow('nothing moved');
    });
  });

  it('leaves what it did to the screen as plain steps, so a replay does not stop there', async () => {
    const { call } = phone();
    const text = await recorded(call, async () => {
      await call('perf_launch', { repeats: 1 });
      await call('perf_scroll', { swipes: 2, repeats: 2 });
      await call('perf_trace', { scroll: 'down', seconds: 1 });
      await call('perf_profile', { scroll: 'up', seconds: 1 });
      await call('perf_launch', { mode: 'warm', repeats: 1 });
    });
    expect(stepsOf(text)).toEqual([
      'stop',
      'launch',
      ...Array<string>(4).fill('swipe up'),
      ...Array<string>(4).fill('swipe down'),
      ...Array<string>(4).fill('swipe up'),
      'launch',
    ]);
    const file = flowFile(text, 'b.flow');
    const r = await call('flow', { action: 'run', file });
    expect(r.data.done).toBe('passed');
  });

  it('writes nothing for what leaves the screen as it found it', async () => {
    const { call } = phone();
    const text = await recorded(call, async () => {
      await call('perf_snapshot');
      await call('perf_trace', { seconds: 1 });
      await call('perf_profile', { seconds: 1 });
      await call('launch_app');
    });
    expect(stepsOf(text)).toEqual(['launch !running']);
  });
});
