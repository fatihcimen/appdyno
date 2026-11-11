import { execFile } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, assert, describe, expect, it } from 'vitest';
import { Adb, androidProvider, iphoneProvider, simulatorProvider, Simctl } from './workspace.js';
import { latestRuns, rankTest, runKeys, type Comparison } from '@appdyno/perf';
import { DEFAULT_POLICY, ServerContext } from '@appdyno/ops';
import { checkedOps } from '@appdyno/testing/calls.js';

/**
 * The gate's two acceptance tests on a device, through the operations: no false alarm across repeated runs
 * of an unchanged app, and a known slow start (the fixture sleeps as told) caught. Numbers are printed: they
 * are what docs/reference/perf.md quotes. APPDYNO_ANDROID_SERIAL, APPDYNO_IOS_UDID or APPDYNO_IPHONE_UDID picks it.
 */
const APP = 'dev.appdyno.fixture';
const REPEATS = Number(process.env.APPDYNO_GATE_REPEATS ?? 6);
const UNCHANGED_RUNS = Number(process.env.APPDYNO_GATE_RUNS ?? 6);
const run = promisify(execFile);
/** Printed and kept: a passing test's output is not shown. */
const note = (line: string) => {
  mkdirSync('.ci', { recursive: true });
  appendFileSync('.ci/perf-gate.txt', `${line}\n`);
};

type Target = {
  name: string;
  serial: string;
  kind: string;
  /** Past what this device's runs move by themselves. */
  injectMs: number;
  provider: () => ReturnType<typeof androidProvider>;
  inject: (ms: number, serial: string) => Promise<void>;
  clear: (serial: string) => Promise<void>;
};

const targets: Target[] = [
  {
    name: 'android',
    serial: process.env.APPDYNO_ANDROID_SERIAL ?? '',
    kind: 'launch.ttid_ms',
    // a start this fast hides part of a shorter sleep behind the system's own start work
    injectMs: 800,
    provider: () => androidProvider(new Adb(), {}),
    inject: async (ms, serial) => {
      await run('adb', [
        '-s',
        serial,
        'shell',
        `run-as ${APP} sh -c 'mkdir -p files; echo ${ms} > files/startup_ms'`,
      ]);
    },
    clear: async (serial) => {
      await run('adb', ['-s', serial, 'shell', `run-as ${APP} rm -f files/startup_ms`]);
    },
  },
  {
    name: 'ios simulator',
    serial: process.env.APPDYNO_IOS_UDID ?? '',
    kind: 'launch.until_ms',
    injectMs: 1_000,
    provider: () => simulatorProvider(),
    inject: (ms) => {
      process.env.SIMCTL_CHILD_APPDYNO_FIXTURE_STARTUP_MS = String(ms);
      return Promise.resolve();
    },
    clear: () => {
      delete process.env.SIMCTL_CHILD_APPDYNO_FIXTURE_STARTUP_MS;
      return Promise.resolve();
    },
  },
  {
    name: 'iphone',
    serial: process.env.APPDYNO_IPHONE_UDID ?? '',
    kind: 'launch.until_ms',
    injectMs: 400,
    provider: () => iphoneProvider(),
    inject: (ms) => {
      process.env.DEVICECTL_CHILD_APPDYNO_FIXTURE_STARTUP_MS = String(ms);
      return Promise.resolve();
    },
    clear: () => {
      delete process.env.DEVICECTL_CHILD_APPDYNO_FIXTURE_STARTUP_MS;
      return Promise.resolve();
    },
  },
];

/** The Mac's load over the last minute. */
const lastMinute = () => {
  const [one] = loadavg();
  assert(one !== undefined);
  return one;
};

/** Waits out other agents' builds: under high load the gate is right to say "noisy", and proves nothing. */
const quiet = async () => {
  const end = Date.now() + 15 * 60_000;
  while (lastMinute() > cpus().length * 0.7 && Date.now() < end)
    await new Promise((r) => setTimeout(r, 15_000));
};

for (const t of targets)
  describe.skipIf(!t.serial)(`the gate on ${t.name}`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'appdyno-gate-runs-'));
    const project = mkdtempSync(join(tmpdir(), 'appdyno-gate-project-'));
    const ctx = new ServerContext(DEFAULT_POLICY, [t.provider()], {
      device: t.serial,
      app: APP,
      measurements: dir,
      perf: project,
    });
    const ops = checkedOps(ctx);
    const op = (name: string) => {
      const found = ops[name];
      assert(found, name);
      return found;
    };
    // what goes through this Mac waits out its load: a read on an iPhone does too, while what an Android phone's
    // `am start -W` reports is its own
    const ownNumbers = t.name === 'android' && !t.serial.startsWith('emulator-');
    const launch = async () => {
      if (!ownNumbers) await quiet();
      await op('perf_launch').handler({ mode: 'cold', repeats: REPEATS });
    };
    const compare = async () => {
      const r = await op('perf_compare').handler({ action: 'compare', format: 'text', last: 1 });
      const reports = r.data.reports as { comparisons: Comparison[] }[];
      const c = reports[0]?.comparisons.find((x) => x.kind === t.kind);
      assert(c, t.kind);
      return { c, code: r.data.exitCode, text: (r.blocks[0] as { text: string }).text };
    };

    afterAll(async () => {
      await t.clear(t.serial).catch(() => undefined);
      ctx.close();
    });

    it('no false alarm across repeated runs, and an injected slow start is caught', async () => {
      if (t.name === 'ios simulator')
        await new Simctl().launch(t.serial, APP).catch(() => undefined);
      await t.clear(t.serial);
      // a run measured under load is refused; another is measured in its place
      for (let tries = 0; tries < 12; tries++) {
        await launch();
        const b = await op('perf_compare').handler({ action: 'baseline', format: 'text', last: 1 });
        if (b.data.exitCode === 0) break;
      }
      const verdicts: Comparison[] = [];
      for (let i = 0; i < UNCHANGED_RUNS; i++) {
        await launch();
        const { c, code } = await compare();
        verdicts.push(c);
        note(
          `${t.name} unchanged ${i + 1}: ${c.verdict} ${c.current} ms against ${String(c.baseline)}, shift ${String(c.shift)}, floor ${String(c.floor)}, load ${lastMinute().toFixed(1)}`,
        );
        // a run the gate could not judge is no pass, and no false alarm
        expect(code).toBe(c.verdict === 'noisy' ? 1 : 0);
      }

      const [key] = await runKeys(dir, { app: APP });
      assert(key !== undefined);
      const runs = (await latestRuns(dir, key, 100)).filter((r) => {
        const [first] = r;
        assert(first);
        return !first.noise.some((n) => n !== 'debuggable-build');
      });
      const samples = runs.map((r) => {
        const record = r.find((x) => x.kind === t.kind);
        assert(record, t.kind);
        return record.samples;
      });
      const median = (x: number[]) => {
        const m = [...x].sort((a, b) => a - b)[x.length >> 1];
        assert(m !== undefined);
        return m;
      };
      const medians = samples.map(median);
      let pairs = 0;
      let rankAlarms = 0;
      let percentAlarms = 0;
      for (const [i, a] of samples.entries())
        for (const [j, b] of samples.entries()) {
          if (i === j) continue;
          pairs++;
          if (rankTest(a, b) < 0.01) rankAlarms++;
          if (Math.abs(median(b) - median(a)) > 0.1 * median(a)) percentAlarms++;
        }
      note(
        `${t.name} run medians: ${medians.join(' ')}; across ${pairs} ordered pairs of unchanged runs: rank test alone alarms ${rankAlarms}, a 10 % difference of medians alone ${percentAlarms}`,
      );

      await t.inject(t.injectMs, t.serial);
      let caught = await (async () => {
        await launch();
        return compare();
      })();
      // a loud moment says "noisy": measure again, as the answer asks
      for (let i = 0; i < 2 && caught.c.verdict === 'noisy'; i++) {
        await launch();
        caught = await compare();
      }
      await t.clear(t.serial);
      note(
        `${t.name} injected ${t.injectMs} ms: ${caught.c.verdict} ${caught.c.current} ms against ${String(caught.c.baseline)}, shift ${String(caught.c.shift)}, p ${String(caught.c.p)}`,
      );
      note(caught.text);

      const alarms = verdicts.filter(
        (c) => c.verdict === 'regression' || c.verdict === 'improvement',
      );
      expect(alarms).toEqual([]);
      expect(caught.c.verdict).toBe('regression');
      expect(caught.code).toBe(1);
      assert(caught.c.shift !== undefined);
      expect(Math.abs(caught.c.shift - t.injectMs)).toBeLessThan(t.injectMs * 0.5);
    }, 3_600_000);
  });
