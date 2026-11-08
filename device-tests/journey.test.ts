import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, assert, describe, expect, it } from 'vitest';
import { Adb, androidProvider, iphoneProvider } from './workspace.js';
import { latestRuns, runKeys, type PerfRecord, type Comparison } from '@appdyno/perf';
import { opsOn } from './helpers.js';

/**
 * A journey measured and gated on a known cost, through the operations: a baseline of three runs, an unchanged run, then
 * one step of the flow made slower by a known amount. The gate must name that step, within a share of the cost, and
 * leave the others alone. Numbers are printed: docs/reference/perf.md quotes them. APPDYNO_ANDROID_SERIAL or APPDYNO_IPHONE_UDID
 * with APPDYNO_IPHONE_FIXTURE_APP.
 */
const APP = 'dev.appdyno.fixture';
const run = promisify(execFile);
const dir = mkdtempSync(join(tmpdir(), 'appdyno-journey-flows-'));
const INJECT_MS = 700;

type Target = {
  name: string;
  serial: string;
  provider: () => ReturnType<typeof androidProvider>;
  /** The flow, and the step of it the known cost is in. */
  flow: string;
  step: string;
  inject: (ms: number, serial: string) => Promise<void>;
  clear: (serial: string) => Promise<void>;
};

const targets: Target[] = [
  {
    name: 'android',
    serial: process.env.APPDYNO_ANDROID_SERIAL ?? '',
    provider: () => androidProvider(new Adb(), {}),
    flow: `app ${APP}\nstop\nlaunch\ntap text="Delayed"\ntap id=load\nassert text="Result 1"\n`,
    step: '04_tap_id_load',
    inject: async (ms, serial) => {
      await run('adb', [
        '-s',
        serial,
        'shell',
        `run-as ${APP} sh -c 'mkdir -p files; echo ${ms} > files/delayed_ms'`,
      ]);
    },
    clear: async (serial) => {
      await run('adb', ['-s', serial, 'shell', `run-as ${APP} rm -f files/delayed_ms`]);
    },
  },
  {
    name: 'iphone',
    serial:
      (process.env.APPDYNO_IPHONE_FIXTURE_APP ?? '') && (process.env.APPDYNO_IPHONE_UDID ?? ''),
    provider: () => iphoneProvider(),
    flow: `app ${APP}\nstop\nlaunch\ntap id=open_delayed\nassert id=loaded\n`,
    step: '03_tap_id_open_delayed',
    inject: (ms) => {
      process.env.DEVICECTL_CHILD_APPDYNO_FIXTURE_DELAYED_MS = String(ms);
      return Promise.resolve();
    },
    clear: () => {
      delete process.env.DEVICECTL_CHILD_APPDYNO_FIXTURE_DELAYED_MS;
      return Promise.resolve();
    },
  },
];

for (const t of targets)
  describe.skipIf(!t.serial)(`a journey on ${t.name}`, () => {
    const ops = opsOn(t.provider(), t.serial, APP);
    const file = join(dir, `${t.name}.flow`);
    const measure = () => ops.call('flow', { action: 'run', file, iterations: 5 });
    const newest = async (scenario: string): Promise<PerfRecord[]> => {
      const [key] = await runKeys(ops.measurements, { app: APP, scenario });
      assert(key !== undefined, scenario);
      const [latest] = await latestRuns(ops.measurements, key);
      assert(latest, scenario);
      return latest;
    };

    afterAll(async () => {
      await t.clear(t.serial).catch(() => undefined);
      ops.ctx.close();
    });

    it('is kept, baselined and gated, and the gate names the step that got slower', async () => {
      writeFileSync(file, t.flow);
      await t.clear(t.serial);
      const scenario = `journey-${t.name}`;
      const kept = (r: PerfRecord[], what: string) => r.find((x) => x.kind.endsWith(what));

      // a number under load is left out and said to be; the step that is timed on the device stays in
      for (let i = 0; i < 3; i++) {
        const m = await measure();
        expect(m.error, m.text).toBe(false);
        const [load] = loadavg();
        assert(load !== undefined);
        console.log(m.text, `\nhost load ${load.toFixed(0)} on ${cpus().length} cores`);
        const b = await ops.call('perf_compare', { action: 'baseline', scenario });
        console.log(b.text);
      }

      const same = await measure();
      expect(same.error, same.text).toBe(false);
      const unchanged = await ops.call('perf_compare', { action: 'compare', scenario });
      console.log(unchanged.text);
      const ofStep = (c: { comparisons: Comparison[] }[]) => {
        const step = c[0]?.comparisons.find((x) => x.kind === `journey.${t.step}.ms`);
        assert(step, t.step);
        return step;
      };
      const before = ofStep(unchanged.data.reports as { comparisons: Comparison[] }[]);
      expect(before.verdict).toBe('ok');

      await t.inject(INJECT_MS, t.serial);
      const slower = await measure();
      expect(slower.error, slower.text).toBe(false);
      await t.clear(t.serial);
      const called = await ops.call('perf_compare', { action: 'compare', scenario });
      console.log(called.text);
      const after = ofStep(called.data.reports as { comparisons: Comparison[] }[]);
      expect(after.verdict).toBe('regression');
      expect(called.data.exitCode).toBe(1);
      assert(after.shift !== undefined);
      expect(Math.abs(after.shift - INJECT_MS)).toBeLessThan(INJECT_MS * 0.3);
      const [report] = called.data.reports as { comparisons: Comparison[] }[];
      assert(report);
      const others = report.comparisons.filter(
        (c) => c.verdict === 'regression' && c.kind.endsWith('.ms') && !c.kind.includes(t.step),
      );
      expect(others.map((c) => c.kind).filter((k) => k !== 'journey.total_ms')).toEqual([]);

      const run = await newest(scenario);
      expect(kept(run, `${t.step}.ms`)?.samples).toHaveLength(5);
      const page = await ops.call('perf_compare', { action: 'dashboard' });
      expect(page.data.file).toBeTruthy();
    }, 1_800_000);

    it.runIf(t.name === 'android')(
      'reads a step’s memory and frames against what the step does',
      async () => {
        const f = join(dir, 'costs.flow');
        writeFileSync(
          f,
          `app ${APP}\nopen_link "appdyno-fixture://open/memory"\ntap id=memory_free\ntap id=memory_alloc\ntap id=memory_free\nopen_link "appdyno-fixture://open/frames"\ntap id=frames_light\nwait_for id=frames_light\ntap id=frames_heavy\n`,
        );
        const m = await ops.call('flow', { action: 'run', file: f, iterations: 3 });
        expect(m.error, m.text).toBe(false);
        console.log(m.text);
        assert(m.data.journey);
        const { steps } = m.data.journey;
        const [, freed, held] = steps;
        assert(held?.memoryKb !== undefined && freed?.memoryKb !== undefined);
        const heldMb = (held.memoryKb - freed.memoryKb) / 1024;
        expect(heldMb).toBeGreaterThan(50 * 0.85);
        expect(heldMb).toBeLessThan(50 * 1.15);
        expect(steps.at(-1)?.framesWorstMs).toBeGreaterThan(40);
      },
      600_000,
    );
  });
