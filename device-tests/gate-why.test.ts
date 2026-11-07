import { execFile, execFileSync } from 'node:child_process';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Adb, androidProvider, iphoneProvider, simulatorProvider, Devicectl } from './workspace.js';
import { gateAnswers, writeComment, type Comparison, type GateAnswer } from '@appdyno/perf';
import { IPHONE_FIXTURE, opsOn } from './helpers.js';

/**
 * The gate finding the cause by itself, against what was put there on purpose: a baseline of three runs, a reference,
 * an unchanged run that must give no alarm, then a known cost on the main thread in one step, and at the start. The
 * answer must name the function or phase the cost is in. A sleep must be called and named as no function, as a CPU
 * profile does not see one. Numbers are printed and kept: docs/reference/perf.md quotes them. APPDYNO_ANDROID_SERIAL,
 * APPDYNO_IOS_UDID or APPDYNO_IPHONE_UDID with APPDYNO_IPHONE_FIXTURE_APP and its APPDYNO_IPHONE_FIXTURE_DSYM picks the
 * device. On a phone nothing it read stays: its temporary folders go at the end.
 */
const APP = 'dev.appdyno.fixture';
const run = promisify(execFile);
const COST_MS = 800;
/** Of each second, off the main thread. */
const CPU_MS = 500;
const SETTLE_MS = 5_000;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
// as scripts/ci.sh does: without it the simulator's tools keep a copy of the environment, and a cost set here is not seen
process.env.DEVELOPER_DIR ??= execFileSync('xcode-select', ['-p'], { encoding: 'utf8' }).trim();
const note = (line: string) => {
  mkdirSync('.ci', { recursive: true });
  appendFileSync('.ci/gate-why.txt', `${line}\n`);
};

/** Under high load the gate is right to say "noisy", which proves nothing: this waits, and says what it waited at. */
const quiet = async () => {
  const end = Date.now() + 15 * 60_000;
  while (loadavg()[0]! > cpus().length * 0.7 && Date.now() < end)
    await new Promise((r) => setTimeout(r, 15_000));
};

type Target = {
  name: string;
  serial: string | undefined;
  provider: () => ReturnType<typeof androidProvider>;
  flow: string;
  step: string;
  /** What the start's cost lands in: where a start is timed by phases. */
  phase: string;
  cost: (
    name: string,
    ms: number | undefined,
    serial: string,
    link: (url: string) => Promise<unknown>,
  ) => Promise<unknown>;
  /** A phone's own numbers do not wait for the Mac: the Mac's load is only in what is timed through it. */
  phone?: boolean;
  /** A phone's build keeps its names here. */
  dsym?: string;
};

const fileCost = (file: string) => async (ms: number | undefined, serial: string) => {
  const shell = (line: string) => run('adb', ['-s', serial, 'shell', line]);
  await (ms === undefined
    ? shell(`run-as ${APP} rm -f files/${file}`)
    : shell(`run-as ${APP} sh -c 'mkdir -p files; echo ${ms} > files/${file}'`));
};
const ANDROID_COSTS: Record<string, (ms: number | undefined, serial: string) => Promise<void>> = {
  busy: fileCost('stall_ms'),
  sleep: fileCost('sleep_ms'),
  start: fileCost('startup_ms'),
  cpu: fileCost('cpu_ms'),
};
const SIM_COSTS: Record<string, string> = {
  busy: 'SIMCTL_CHILD_APPDYNO_FIXTURE_STALL_MS',
  sleep: 'SIMCTL_CHILD_APPDYNO_FIXTURE_SLEEP_MS',
  start: 'SIMCTL_CHILD_APPDYNO_FIXTURE_STARTUP_MS',
  cpu: 'SIMCTL_CHILD_APPDYNO_FIXTURE_CPU_MS',
};

const IOS_FLOW = `app ${APP}\nstop\nlaunch\nopen_link "appdyno-fixture://open/stall"\ntap id=stall_light\nassert id=stall_taps\n`;
const IPHONE_COSTS: Record<string, string> = { busy: 'stall', sleep: 'sleep', start: 'startup' };

const targets: Target[] = [
  {
    name: 'android',
    serial: process.env.APPDYNO_ANDROID_SERIAL,
    provider: () => androidProvider(new Adb(), {}),
    flow: `app ${APP}\nstop\nlaunch\nopen_link "appdyno-fixture://open/cpu"\ntap id=cpu_stall\nassert id=cpu_taps\n`,
    step: '04_tap_id_cpu_stall',
    phase: 'bind_application',
    cost: async (name, ms, serial) => ANDROID_COSTS[name]!(ms, serial),
    phone: !process.env.APPDYNO_ANDROID_SERIAL?.startsWith('emulator-'),
  },
  {
    name: 'simulator',
    serial: process.env.APPDYNO_IOS_UDID,
    provider: () => simulatorProvider() as ReturnType<typeof androidProvider>,
    flow: IOS_FLOW,
    step: '04_tap_id_stall_light',
    phase: 'main',
    cost: async (name, ms) => {
      if (ms === undefined) delete process.env[SIM_COSTS[name]!];
      else process.env[SIM_COSTS[name]!] = String(ms);
    },
  },
  {
    name: 'iphone',
    serial: process.env.APPDYNO_IPHONE_FIXTURE_APP && process.env.APPDYNO_IPHONE_UDID,
    provider: () => iphoneProvider() as ReturnType<typeof androidProvider>,
    flow: IOS_FLOW,
    step: '04_tap_id_stall_light',
    phase: 'main',
    // a phone's flow launches the app with no environment, so the fixture keeps a cost it is sent
    cost: (name, ms, _serial, link) =>
      link(`appdyno-fixture://cost/${IPHONE_COSTS[name] ?? name}/${ms ?? 0}`),
    phone: true,
    ...(process.env.APPDYNO_IPHONE_FIXTURE_DSYM && {
      dsym: process.env.APPDYNO_IPHONE_FIXTURE_DSYM,
    }),
  },
];

const dir = mkdtempSync(join(tmpdir(), 'appdyno-why-flows-'));

for (const t of targets)
  describe.skipIf(!t.serial)(`the gate's own answer on the ${t.name}`, () => {
    const ops = opsOn(t.provider(), t.serial!, APP);
    const project = ops.ctx.perfDir;
    const named = t.dsym ? { dsym: t.dsym } : {};
    const link = (url: string) => ops.call('open_link', { url });
    const cost = (name: string, ms?: number) => t.cost(name, ms, t.serial!, link);
    const clear = async () => {
      for (const name of ['busy', 'sleep', 'start', 'cpu']) await cost(name);
    };
    const restart = async () => {
      const { device } = await ops.ctx.session();
      await device.terminate(APP);
      await device.launch(APP);
    };
    const open = async (screen: string) => {
      await restart();
      await link(`appdyno-fixture://open/${screen}`);
    };
    const settled = () => (t.phone ? undefined : quiet());
    const load = () => `host load ${loadavg()[0]!.toFixed(0)} on ${cpus().length} cores`;
    const asked = async (scenario: string, last = 1) => {
      const r = await ops.call('perf_compare', { action: 'why', scenario, last, ...named });
      expect(r.error, r.text).toBe(false);
      note(`${t.name} ${scenario}, ${load()}\n${r.text}\nexit ${r.data.exitCode}`);
      console.log(r.text);
      return { r, answer: (r.data.answers as GateAnswer[])[0]! };
    };
    /** A run the gate can read: under noise it says so, and this measures again, as its answer asks. */
    const measured = async (measure: () => Promise<unknown>, scenario: string) => {
      for (let i = 0; i < 12; i++) {
        await settled();
        await measure();
        const c = await ops.call('perf_compare', { action: 'compare', scenario });
        const said = (c.data.reports as { comparisons: Comparison[] }[]).flatMap(
          (r) => r.comparisons,
        );
        if (!said.some((x) => x.verdict === 'noisy' && !(t.phone && x.throughHost))) return;
        note(`${t.name} ${scenario}: noisy, measured again, ${load()}`);
      }
      throw new Error(`no run of ${scenario} the gate could read: re-run on a quieter Mac`);
    };
    const reference = async (scenario: string) => {
      await settled();
      const r = await ops.call('perf_compare', { action: 'reference', scenario, ...named });
      note(`${t.name} ${scenario} reference, ${load()}\n${r.text}`);
      expect(r.data.exitCode, r.text).toBe(0);
    };
    /** `baseline` exits 0 once what it holds can call a regression. */
    const baselined = async (measure: () => Promise<unknown>, scenario: string) => {
      for (let tries = 0; tries < 24; tries++) {
        await settled();
        await measure();
        const b = await ops.call('perf_compare', { action: 'baseline', scenario });
        note(`${t.name} ${scenario} baseline, ${load()}\n${b.text}`);
        if (b.data.exitCode === 0) break;
      }
      await reference(scenario);
    };

    beforeAll(async () => {
      if (t.name === 'iphone') await new Devicectl(t.serial!).install(IPHONE_FIXTURE!);
    }, 240_000);
    afterAll(async () => {
      await clear().catch(() => undefined);
      if (t.phone) {
        const { device } = await ops.ctx.session();
        await device.terminate(APP).catch(() => undefined);
        await device.stopAgent().catch(() => undefined);
        // nothing read from a phone stays
        for (const held of [ops.measurements, project])
          rmSync(held, { recursive: true, force: true });
      }
      ops.ctx.close();
    });

    it('calls a stall by the function it is in, and no alarm on an unchanged build', async () => {
      const file = join(dir, `${t.name}.flow`);
      writeFileSync(file, t.flow);
      await clear();
      // a simulator asks once whether a link may open the app: a flow would stop at it
      if (t.name === 'simulator') {
        await ops.call('open_link', { url: 'appdyno-fixture://open/stall' });
        await ops.call('tap', { selector: { text: 'Open' } });
      }
      const scenario = `journey-${t.name}`;
      const measure = async () => {
        const m = await ops.call('flow', { action: 'run', file, iterations: 5 });
        expect(m.error, m.text).toBe(false);
      };
      await baselined(measure, scenario);

      await measured(measure, scenario);
      const same = await asked(scenario);
      expect(same.r.data.exitCode).toBe(0);
      expect(same.answer.status).toBe('clear');

      await cost('busy', COST_MS);
      await measured(measure, scenario);
      const busy = await asked(scenario);
      expect(busy.r.data.exitCode).toBe(1);
      const found = busy.answer.findings.find((f) => f.place === t.step)!;
      expect(found.causes[0]!.name).toContain('knownCost');
      if (t.name === 'iphone')
        expect(found.causes.find((c) => c.kind === 'hang')?.says).toContain('busy');
      await cost('busy');

      // what no profile can see is called, and is not given a function; an iPhone's hang trace sees it blocked
      await cost('sleep', COST_MS);
      await measured(measure, scenario);
      const asleep = await asked(scenario);
      await cost('sleep');
      expect(asleep.r.data.exitCode).toBe(1);
      const slept = asleep.answer.findings.find((f) => f.place === t.step)!;
      expect(slept.causes.filter((c) => c.kind === 'function')).toEqual([]);
      if (t.name === 'simulator') expect(slept.cannot.join()).toContain('no cause was found');
      if (t.name === 'iphone')
        expect(slept.causes.find((c) => c.kind === 'hang')?.says).toContain('blocked');

      const out = join(dir, `${t.name}.md`);
      await writeComment(ops.measurements, project, out, { scenario });
      note(readFileSync(out, 'utf8'));
      const page = await ops.call('perf_compare', { action: 'dashboard' });
      expect(readFileSync(page.data.file!, 'utf8')).toContain('Why it got worse');
    }, 3_600_000);

    it('calls a slow start by its phase', async () => {
      await clear();
      const scenario = `launch-${t.name}`;
      // an iPhone's own time of a start is its trace, one a run: `repeats` is timed through the Mac, whose load refuses it
      const traced = t.name === 'iphone';
      const how = traced ? { repeats: 1, trace: true } : { repeats: 6 };
      const measure = () =>
        ops.call('perf_launch', { mode: 'cold', ...how, scenario }).then((m) => {
          expect(m.error, m.text).toBe(false);
        });
      await baselined(measure, scenario);
      await cost('start', COST_MS);
      for (let i = 1; traced && i < 5; i++) await measure();
      await measured(measure, scenario);
      const { r, answer } = await asked(scenario, traced ? 5 : 1);
      await cost('start');
      expect(r.data.exitCode).toBe(1);
      expect(answer.findings[0]!.causes[0]).toMatchObject({ kind: 'phase', name: t.phase });
      expect(await gateAnswers(ops.measurements, project, { scenario })).toHaveLength(1);
    }, 3_600_000);

    it('looks at a scroll of a list whose frames cost more', async () => {
      await clear();
      const scenario = `scroll-${t.name}`;
      const measure = () =>
        ops.call('perf_scroll', { repeats: 5, scenario }).then((m) => {
          expect(m.error, m.text).toBe(false);
        });
      await open('list');
      await baselined(measure, scenario);
      await open('list_heavy');
      await measured(measure, scenario);
      const { r, answer } = await asked(scenario);
      expect(r.data.exitCode).toBe(1);
      expect(answer.findings[0]!.causes.length).toBeGreaterThan(0);
    }, 3_600_000);

    it('looks at a core at work off the main thread', async () => {
      await clear();
      const scenario = `cpu-${t.name}`;
      // a snapshot is one sample, and the gate takes five; five outlast a phone's screen, and a dark app is another app
      const measure = async () => {
        const { device } = await ops.ctx.session();
        const d = device as {
          ensureAwake?: () => Promise<unknown>;
          inFront?: (app: string) => Promise<unknown>;
        };
        await d.ensureAwake?.();
        // what `ensureAwake` is to an Android: a locked iPhone stops the app, which then reads 0
        await d.inFront?.(APP);
        const m = await ops.call('perf_snapshot', { scenario });
        expect(m.error, m.text).toBe(false);
        note(`${t.name} ${scenario}: ${/CPU: .*/.exec(m.text)?.[0]}`);
      };
      // a first sample in the app's own start read 46.7 %, and one such run widens the gate's limit past the change
      const settled = async () => {
        await open('cpu');
        await pause(SETTLE_MS);
      };
      await settled();
      await baselined(measure, scenario);
      await cost('cpu', CPU_MS);
      await settled();
      for (let i = 0; i < 5; i++) await measure();
      const { r, answer } = await asked(scenario, 5);
      await cost('cpu');
      expect(r.data.exitCode).toBe(1);
      expect(answer.findings[0]!.causes[0]!.name).toMatch(/known(Cpu)?Cost/);
    }, 3_600_000);
  });
