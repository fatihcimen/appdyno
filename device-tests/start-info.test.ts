import { afterAll, assert, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Adb, androidProvider, sleep as pause, type AndroidDevice } from './workspace.js';
import { latestRuns, loadRefusals, runKeys } from '@appdyno/perf';
import { opsOn } from './helpers.js';

/**
 * Why an app started and where the start went, against a known cost, with no trace (APPDYNO_ANDROID_SERIAL). On API 35
 * and later; before that a refusal by name is what is proven.
 */
const serial = process.env.APPDYNO_ANDROID_SERIAL ?? '';
const APP = 'dev.appdyno.fixture';
const COST_MS = 500;

describe.skipIf(!serial)('start info', () => {
  const t = opsOn(androidProvider(new Adb(), {}), serial, APP);
  let d: AndroidDevice;
  let sdk = 0;
  const costs = (ms?: number) =>
    d.shell(
      ms === undefined
        ? `run-as ${APP} rm -f files/startup_ms`
        : `run-as ${APP} sh -c 'mkdir -p files; echo ${ms} > files/startup_ms'`,
    );
  const started = async (how: string) => {
    await d.shell(`am force-stop ${APP}`);
    await pause(500);
    await d.shell(how);
    await pause(3_000);
    const r = await t.call('perf_snapshot', { also: ['startInfo'], cpuWindowMs: 500 });
    console.log(r.text.split('\n').filter((l) => l.includes('start')));
    expect(r.error, r.text).toBe(false);
    return r;
  };
  const launcher = `am start -W -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n ${APP}/.MainActivity`;

  beforeAll(async () => {
    d = (await t.ctx.session()).device as AndroidDevice;
    await d.open();
    sdk = Number((await d.shell('getprop ro.build.version.sdk')).trim());
  });
  beforeEach(() => d.ensureAwake());
  afterAll(async () => {
    await costs().catch(() => undefined);
    t.ctx.close();
  });

  it('a known 500 ms in Application.onCreate shows in its phase within 10 %', async (ctx) => {
    if (sdk < 35) return ctx.skip();
    const onCreate = async () => {
      const seen: number[] = [];
      for (let i = 0; i < 3; i++) {
        const phase = (await started(launcher)).data.startPhases?.oncreate_to_first_frame;
        assert(phase !== undefined, 'oncreate_to_first_frame');
        seen.push(phase);
      }
      const median = seen.sort((a, b) => a - b)[1];
      assert(median !== undefined);
      return median;
    };
    await costs();
    const plain = await onCreate();
    await costs(COST_MS);
    const slow = await onCreate();
    await costs();
    console.log('oncreate_to_first_frame', plain, slow);
    // an emulator's own start work runs alongside a sleep, which shows only in part there (docs/reference/perf.md)
    if (serial.startsWith('emulator-')) expect(slow).toBeGreaterThan(plain + COST_MS * 0.3);
    else expect(Math.abs(slow - plain - COST_MS)).toBeLessThan(COST_MS * 0.1);
  }, 180_000);

  it('a launcher start and a service start give different reasons', async (ctx) => {
    if (sdk < 35) return ctx.skip();
    const shown = await started(launcher);
    expect(shown.data.startReason).toBe('LAUNCHER');
    expect(shown.text).toContain('after a force stop');
    // the screen binds a service in a process of its own, which starts for it
    const service = await started(
      `am start -W -a android.intent.action.VIEW -d 'appdyno-fixture://open/frozen?cause=binder' ${APP}`,
    );
    expect(service.data.startReason).toBe('SERVICE');
  }, 120_000);

  it('keeps the phases of a start since the last run, and not the same start again', async (ctx) => {
    if (sdk < 35) return ctx.skip();
    const scenario = 'a-start-of-its-own';
    const start = async () => {
      await d.shell(`am force-stop ${APP}`);
      await pause(500);
      await d.shell(launcher);
      await pause(3_000);
    };
    const phasesKept = async () => {
      const r = await t.call('perf_snapshot', { also: ['startInfo'], cpuWindowMs: 500, scenario });
      expect(r.error, r.text).toBe(false);
      const [key] = await runKeys(t.measurements, { app: APP, scenario });
      assert(key);
      const [run] = await latestRuns(t.measurements, key, 1);
      assert(run);
      return run.filter((r) => r.kind.startsWith('launch.phase.')).length;
    };
    await start();
    expect(await phasesKept()).toBe(0);
    await start();
    expect(await phasesKept()).toBeGreaterThan(0);
    expect(await phasesKept()).toBe(0);
  }, 120_000);

  it('a broadcast start reads as one, where the device lets a stopped app start', async (ctx) => {
    if (sdk < 35) return ctx.skip();
    await d.shell(`am force-stop ${APP}`);
    await d.shell(`am broadcast --include-stopped-packages -n ${APP}/.FixtureReceiver`);
    await pause(500);
    // HyperOS completes the broadcast and starts nothing, which leaves no record to read
    if (!(await d.shell(`pidof ${APP}`).catch(() => '')).trim()) return ctx.skip();
    const r = await t.call('perf_snapshot', { also: ['startInfo'], cpuWindowMs: 500 });
    console.log(r.text.split('\n').filter((l) => l.includes('start')));
    expect(r.data.startReason).toBe('BROADCAST');
  }, 60_000);

  it('before Android 15 it is refused by name, and the rest of the answer stands', async (ctx) => {
    if (sdk >= 35) return ctx.skip();
    await d.shell(launcher);
    await pause(1_500);
    const r = await t.call('perf_snapshot', { also: ['startInfo'], cpuWindowMs: 500 });
    console.log(r.text);
    expect(r.error, r.text).toBe(false);
    expect(r.text).toContain('not measurable here: startInfo');
    const [refused] = (await loadRefusals(t.measurements)).filter(
      (x) => x.measure === 'launch-why',
    );
    expect(refused?.reason).toContain('start info needs Android 15');
  }, 60_000);
});
