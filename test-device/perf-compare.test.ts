import { execFile } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { Adb, androidProvider, appleProvider, Simctl } from './workspace.js';
import { latestRuns, rankTest, runKeys, type Comparison } from '@appdyno/perf';
import { DEFAULT_POLICY, ServerContext } from '@appdyno/ops';
import { checkedOps } from '../packages/ops/test/helpers.js';

/**
 * The gate's two acceptance tests on a device, through the operations: no false alarm across repeated runs
 * of an unchanged app, and a known slow start (the fixture sleeps as told) caught. Numbers are printed: they
 * are what docs/perf.md quotes. APPDYNO_ANDROID_SERIAL, APPDYNO_IOS_UDID or APPDYNO_IPHONE_UDID picks it.
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
  serial: string | undefined;
  kind: string;
  /** Past what this device's runs move by themselves. */
  injectMs: number;
  provider: () => ReturnType<typeof androidProvider>;
  inject: (ms: number, serial: string) => Promise<void>;
  clear: (serial: string) => Promise<void>;
};

const ENV_SIM = 'SIMCTL_CHILD_APPDYNO_FIXTURE_STARTUP_MS';
const ENV_PHONE = 'DEVICECTL_CHILD_APPDYNO_FIXTURE_STARTUP_MS';

const targets: Target[] = [
  {
    name: 'android',
    serial: process.env.APPDYNO_ANDROID_SERIAL,
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
    serial: process.env.APPDYNO_IOS_UDID,
    kind: 'launch.until_ms',
    injectMs: 1_000,
    provider: () => appleProvider() as ReturnType<typeof androidProvider>,
    inject: async (ms) => {
      process.env[ENV_SIM] = String(ms);
    },
    clear: async () => {
      delete process.env[ENV_SIM];
    },
  },
  {
    name: 'iphone',
    serial: process.env.APPDYNO_IPHONE_UDID,
    kind: 'launch.until_ms',
    injectMs: 400,
    provider: () => appleProvider() as ReturnType<typeof androidProvider>,
    inject: async (ms) => {
      process.env[ENV_PHONE] = String(ms);
    },
    clear: async () => {
      delete process.env[ENV_PHONE];
    },
  },
];

/** Waits out other agents' builds: under high load the gate is right to say "noisy", and proves nothing. */
const quiet = async () => {
  const end = Date.now() + 15 * 60_000;
  while (loadavg()[0]! > cpus().length * 0.7 && Date.now() < end)
    await new Promise((r) => setTimeout(r, 15_000));
};

for (const t of targets)
  describe.skipIf(!t.serial)(`the gate on ${t.name}`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'appdyno-gate-runs-'));
    const project = mkdtempSync(join(tmpdir(), 'appdyno-gate-project-'));
    const ctx = new ServerContext(DEFAULT_POLICY, [t.provider()], {
      device: t.serial!,
      app: APP,
      measurements: dir,
      perf: project,
    });
    const ops = checkedOps(ctx);
    // what goes through this Mac waits out its load: a read on an iPhone does too, while what an Android phone's
    // `am start -W` reports is its own
    const ownNumbers = t.name === 'android' && !t.serial?.startsWith('emulator-');
    const launch = async () => {
      if (!ownNumbers) await quiet();
      await ops.perf_launch!.handler({ mode: 'cold', repeats: REPEATS });
    };
    const compare = async () => {
      const r = await ops.perf_compare!.handler({ action: 'compare', format: 'text', last: 1 });
      const reports = r.data.reports as { comparisons: Comparison[] }[];
      const c = reports[0]!.comparisons.find((x) => x.kind === t.kind)!;
      return { c, code: r.data.exitCode, text: (r.blocks[0] as { text: string }).text };
    };

    afterAll(async () => {
      await t.clear(t.serial!).catch(() => undefined);
      ctx.close();
    });

    it('no false alarm across repeated runs, and an injected slow start is caught', async () => {
      if (t.name === 'ios simulator')
        await new Simctl().launch(t.serial!, APP).catch(() => undefined);
      await t.clear(t.serial!);
      // a run measured under load is refused; another is measured in its place
      for (let tries = 0; tries < 12; tries++) {
        await launch();
        const b = await ops.perf_compare!.handler({ action: 'baseline', format: 'text', last: 1 });
        if (b.data.exitCode === 0) break;
      }
      const verdicts: Comparison[] = [];
      for (let i = 0; i < UNCHANGED_RUNS; i++) {
        await launch();
        const { c, code } = await compare();
        verdicts.push(c);
        note(
          `${t.name} unchanged ${i + 1}: ${c.verdict} ${c.current} ms against ${c.baseline}, shift ${c.shift}, floor ${c.floor}, load ${loadavg()[0]!.toFixed(1)}`,
        );
        expect(code).toBe(0);
      }

      const [key] = await runKeys(dir, { app: APP });
      const runs = (await latestRuns(dir, key!, 100)).filter(
        (r) => !r[0]!.noise.some((n) => n !== 'debuggable-build'),
      );
      const samples = runs.map((r) => r.find((x) => x.kind === t.kind)!.samples);
      const medians = samples.map((x) => [...x].sort((a, b) => a - b)[x.length >> 1]!);
      let pairs = 0;
      let rankAlarms = 0;
      let percentAlarms = 0;
      for (let i = 0; i < samples.length; i++)
        for (let j = 0; j < samples.length; j++) {
          if (i === j) continue;
          pairs++;
          if (rankTest(samples[i]!, samples[j]!) < 0.01) rankAlarms++;
          if (Math.abs(medians[j]! - medians[i]!) > 0.1 * medians[i]!) percentAlarms++;
        }
      note(
        `${t.name} run medians: ${medians.join(' ')}; across ${pairs} ordered pairs of unchanged runs: rank test alone alarms ${rankAlarms}, a 10 % difference of medians alone ${percentAlarms}`,
      );

      await t.inject(t.injectMs, t.serial!);
      let caught = await (async () => {
        await launch();
        return compare();
      })();
      // a loud moment says "noisy": measure again, as the answer asks
      for (let i = 0; i < 2 && caught.c.verdict === 'noisy'; i++) {
        await launch();
        caught = await compare();
      }
      await t.clear(t.serial!);
      note(
        `${t.name} injected ${t.injectMs} ms: ${caught.c.verdict} ${caught.c.current} ms against ${caught.c.baseline}, shift ${caught.c.shift}, p ${caught.c.p}`,
      );
      note(caught.text);

      const alarms = verdicts.filter(
        (c) => c.verdict === 'regression' || c.verdict === 'improvement',
      );
      expect(alarms).toEqual([]);
      expect(caught.c.verdict).toBe('regression');
      expect(caught.code).toBe(1);
      expect(Math.abs(caught.c.shift! - t.injectMs)).toBeLessThan(t.injectMs * 0.5);
    }, 3_600_000);
  });
