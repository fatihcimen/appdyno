import { execFile, execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { Adb, androidProvider, appleProvider } from './workspace.js';
import { gateAnswers, writeComment, type GateAnswer } from '@appdyno/perf';
import { opsOn } from './helpers.js';

/**
 * The gate finding the cause by itself, against what was put there on purpose: a baseline of three runs, a reference,
 * an unchanged run that must give no alarm, then a known cost on the main thread in one step, and at the start. The
 * answer must name the function or phase the cost is in. A sleep must be called and named as no function, as a CPU
 * profile does not see one. Numbers are printed and kept: docs/perf.md quotes them. APPDYNO_ANDROID_SERIAL or
 * APPDYNO_IOS_UDID picks the device.
 */
const APP = 'dev.appdyno.fixture';
const run = promisify(execFile);
const COST_MS = 800;
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
  cost: (name: string, ms: number | undefined, serial: string) => Promise<void>;
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
};
const SIM_COSTS: Record<string, string> = {
  busy: 'SIMCTL_CHILD_APPDYNO_FIXTURE_STALL_MS',
  sleep: 'SIMCTL_CHILD_APPDYNO_FIXTURE_SLEEP_MS',
  start: 'SIMCTL_CHILD_APPDYNO_FIXTURE_STARTUP_MS',
};

const targets: Target[] = [
  {
    name: 'emulator',
    serial: process.env.APPDYNO_ANDROID_SERIAL,
    provider: () => androidProvider(new Adb(), {}),
    flow: `app ${APP}\nstop\nlaunch\nopen_link "appdyno-fixture://open/cpu"\ntap id=cpu_stall\nassert id=cpu_taps\n`,
    step: '04_tap_id_cpu_stall',
    phase: 'bind_application',
    cost: async (name, ms, serial) => ANDROID_COSTS[name]!(ms, serial),
  },
  {
    name: 'simulator',
    serial: process.env.APPDYNO_IOS_UDID,
    provider: () => appleProvider() as ReturnType<typeof androidProvider>,
    flow: `app ${APP}\nstop\nlaunch\nopen_link "appdyno-fixture://open/stall"\ntap id=stall_light\nassert id=stall_taps\n`,
    step: '04_tap_id_stall_light',
    phase: 'main',
    cost: async (name, ms) => {
      if (ms === undefined) delete process.env[SIM_COSTS[name]!];
      else process.env[SIM_COSTS[name]!] = String(ms);
    },
  },
];

const dir = mkdtempSync(join(tmpdir(), 'appdyno-why-flows-'));

for (const t of targets)
  describe.skipIf(!t.serial)(`the gate's own answer on the ${t.name}`, () => {
    const ops = opsOn(t.provider(), t.serial!, APP);
    const project = ops.ctx.perfDir;
    const clear = async () => {
      for (const name of ['busy', 'sleep', 'start']) await t.cost(name, undefined, t.serial!);
    };
    const load = () => `host load ${loadavg()[0]!.toFixed(0)} on ${cpus().length} cores`;
    const asked = async (scenario: string) => {
      const r = await ops.call('perf_compare', { action: 'why', scenario });
      expect(r.error, r.text).toBe(false);
      note(`${t.name} ${scenario}, ${load()}\n${r.text}\nexit ${r.data.exitCode}`);
      console.log(r.text);
      return { r, answer: (r.data.answers as GateAnswer[])[0]! };
    };
    /** A run the gate can read: under noise it says so, and this measures again, as its answer asks. */
    const measured = async (measure: () => Promise<unknown>, scenario: string) => {
      for (let i = 0; i < 12; i++) {
        await quiet();
        await measure();
        const c = await ops.call('perf_compare', { action: 'compare', scenario });
        const noisy = JSON.stringify(c.data.reports).includes('"verdict":"noisy"');
        if (!noisy) return;
        note(`${t.name} ${scenario}: noisy, measured again, ${load()}`);
      }
      throw new Error(`no run of ${scenario} the gate could read: re-run on a quieter Mac`);
    };
    const baselined = async (measure: () => Promise<unknown>, scenario: string) => {
      for (let added = 0, tries = 0; added < 3 && tries < 12; tries++) {
        await quiet();
        await measure();
        const b = await ops.call('perf_compare', { action: 'baseline', scenario });
        if (b.data.exitCode === 0) added++;
      }
      await quiet();
      const r = await ops.call('perf_compare', { action: 'reference', scenario });
      note(`${t.name} ${scenario} reference, ${load()}\n${r.text}`);
      expect(r.data.exitCode, r.text).toBe(0);
    };

    afterAll(async () => {
      await clear().catch(() => undefined);
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

      await t.cost('busy', COST_MS, t.serial!);
      await measured(measure, scenario);
      const busy = await asked(scenario);
      expect(busy.r.data.exitCode).toBe(1);
      const found = busy.answer.findings.find((f) => f.place === t.step)!;
      expect(found.causes[0]!.name).toContain('knownCost');
      await t.cost('busy', undefined, t.serial!);

      // what no profile can see is called, and is not given a function
      await t.cost('sleep', COST_MS, t.serial!);
      await measured(measure, scenario);
      const asleep = await asked(scenario);
      await t.cost('sleep', undefined, t.serial!);
      expect(asleep.r.data.exitCode).toBe(1);
      const slept = asleep.answer.findings.find((f) => f.place === t.step)!;
      expect(slept.causes.filter((c) => c.kind === 'function')).toEqual([]);
      if (t.name === 'simulator') expect(slept.cannot.join()).toContain('no cause was found');

      const out = join(dir, `${t.name}.md`);
      await writeComment(ops.measurements, project, out, { scenario });
      note(readFileSync(out, 'utf8'));
      const page = await ops.call('perf_compare', { action: 'dashboard' });
      expect(readFileSync(page.data.file!, 'utf8')).toContain('Why it got worse');
    }, 3_600_000);

    it('calls a slow start by its phase', async () => {
      await clear();
      const scenario = `launch-${t.name}`;
      const measure = () =>
        ops.call('perf_launch', { mode: 'cold', repeats: 6, scenario }).then((m) => {
          expect(m.error, m.text).toBe(false);
        });
      await baselined(measure, scenario);
      await t.cost('start', COST_MS, t.serial!);
      await measured(measure, scenario);
      const { r, answer } = await asked(scenario);
      await t.cost('start', undefined, t.serial!);
      expect(r.data.exitCode).toBe(1);
      expect(answer.findings[0]!.causes[0]).toMatchObject({ kind: 'phase', name: t.phase });
      expect(await gateAnswers(ops.measurements, project, { scenario })).toHaveLength(1);
    }, 3_600_000);
  });
