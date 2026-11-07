import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  simulatorProvider,
  buildScreen,
  IosSimulatorDevice,
  Simctl,
  sleep as pause,
  type Screen,
} from './workspace.js';
import { latestRuns, loadRefusals, runKeys } from '@appdyno/perf';
import { opsOn, SIM_FIXTURE } from './helpers.js';

/**
 * Every measure a simulator has, with no argument, against a known cost (APPDYNO_IOS_UDID): a slow start named in its
 * phase, the frames of a 40 ms draw, a stall read to 10 %, one frozen frame, energy of a busy core against an idle app.
 */
const udid = process.env.APPDYNO_IOS_UDID;
const APP = 'dev.appdyno.fixture';
const within = (read: number, known: number, share: number) => {
  expect(read).toBeGreaterThan(known * (1 - share));
  expect(read).toBeLessThan(known * (1 + share));
};

describe.skipIf(!udid)('measures on a simulator, with no argument', () => {
  const t = opsOn(simulatorProvider(), udid!, APP);
  let d: IosSimulatorDevice;
  const open = async (screen: string): Promise<Screen> => {
    await d.openUrl(`appdyno-fixture://open/${screen}`, APP);
    await pause(800);
    return buildScreen(await d.tree(), { port: d.platformScreen, appId: APP });
  };
  const byId = (s: Screen, id: string) => {
    const e = s.list.find((x) => x.id === id);
    if (!e) throw new Error(`no ${id}`);
    return e;
  };

  beforeAll(async () => {
    await new Simctl().install(udid!, SIM_FIXTURE);
    d = (await t.ctx.session()).device as IosSimulatorDevice;
    await d.terminate(APP);
    await d.launch(APP);
  }, 240_000);
  afterAll(async () => {
    await d?.stopAgent();
    t.ctx.close();
  });

  it('frames: the probe attaches itself, says so, and tells a 40 ms draw from a plain list', async () => {
    const first = await t.call('perf_scroll', { repeats: 1 });
    console.log(first.text);
    expect(first.error).toBe(false);
    expect(first.text).toMatch(/relaunched with the frame probe/);
    expect(first.text).toMatch(/main-thread pacing/);

    await open('list');
    const light = await t.call('perf_scroll');
    await open('list_heavy');
    const heavy = await t.call('perf_scroll');
    console.log('light', light.text, '\nheavy', heavy.text);
    expect(heavy.text).not.toMatch(/relaunched/);
    const of = (a: typeof light) => a.data.rounds;
    expect(a95(of(heavy))).toBeGreaterThan(40);
    expect(a95(of(heavy))).toBeGreaterThan(a95(of(light)));
    expect(heavy.data.jankMedianPercent!).toBeGreaterThan(light.data.jankMedianPercent!);
  }, 240_000);

  it('probe: false turns it off, and its refusal is not kept as what the device cannot do', async () => {
    await d.terminate(APP);
    await d.launch(APP);
    const off = await t.call('perf_scroll', { probe: false, repeats: 1 });
    console.log(off.text);
    expect(off.error).toBe(true);
    expect(off.data.code).toBe('UNSUPPORTED');
    expect((await loadRefusals(t.measurements)).map((r) => r.measure)).not.toContain('frames');
  }, 120_000);

  it('stalls: a 500 ms stall reads within 10 %', async () => {
    await t.call('perf_trace', { seconds: 1 });
    const s = await open('stall');
    const [r] = await Promise.all([
      // the window has room for its start and for a tap slowed by a loaded Mac
      t.call('perf_trace', { seconds: 8 }),
      pause(3_000).then(() => d.tap(byId(s, 'stall_500'), { settle: false })),
    ]);
    console.log(r.text);
    within(r.data.worstMs!, 500, 0.1);
    expect(r.data.stalls).toBe(1);
  }, 120_000);

  it('frozen: a 1 s stall during a scroll reads as one, a plain list as none', async () => {
    await t.call('perf_trace', { seconds: 1 });
    await open('list');
    const light = await t.call('perf_scroll');
    await d.terminate(APP);
    await t.call('perf_trace', { seconds: 1 });
    await open('list_stall');
    const stalled = await t.call('perf_scroll');
    console.log('frozen', light.data.frozen, stalled.data.frozen, stalled.text);
    expect(light.data.frozen).toBe(0);
    expect(stalled.data.frozen).toBe(1);
  }, 480_000);

  it('why slow: a 500 ms slow start is named in `main`, within 15 %', async () => {
    const phases = async (env?: Record<string, string>) => {
      const { startup } = (
        await d.measure.launch(APP, { mode: 'cold', repeats: 1, trace: true, ...(env && { env }) })
      ).value;
      console.log(JSON.stringify(startup));
      return startup!.breakdown;
    };
    const ms = (b: Awaited<ReturnType<typeof phases>>, name: string) =>
      b.find((p) => p.reason === name)!.ms;
    const base = await phases();
    const slow = await phases({ APPDYNO_FIXTURE_STARTUP_MS: '500' });
    within(ms(slow, 'main') - ms(base, 'main'), 500, 0.15);
    // what rose is `main`; on a loaded Mac another phase can be longer, and rise by a little
    const rises = slow.map((p) => ({ name: p.reason, by: p.ms - ms(base, p.reason) }));
    expect(rises.toSorted((a, b) => b.by - a.by)[0]!.name).toBe('main');
  }, 600_000);

  it('why slow: an operation keeps the phases for the dashboard', async () => {
    const r = await t.call('perf_launch', { repeats: 1, trace: true, scenario: 'why' });
    expect(r.error).toBe(false);
    expect(r.text).toMatch(/where the time went: .*main/);
    const keys = await runKeys(t.measurements, { app: APP });
    const runs = await latestRuns(
      t.measurements,
      keys.find((k) => k.scenario === 'why')!,
      1,
    );
    expect(runs[0]!.map((x) => x.kind)).toContain('launch.phase.main_ms');
  }, 180_000);

  it("energy: a busy core reads clearly above an idle app, and says it is this Mac's", async () => {
    await d.terminate(APP);
    await d.launch(APP);
    const s = await open('cpu');
    await pause(3_000);
    const idle = await t.call('perf_snapshot', { also: ['energy'], cpuWindowMs: 2_000 });
    // its loop lasts 3 s, and the snapshot reads the CPU before the energy
    let on = true;
    const loop = (async () => {
      while (on) {
        await d.tap(byId(s, 'cpu_load'), { settle: false }).catch(() => undefined);
        await pause(1_000);
      }
    })();
    await pause(500);
    const busy = await t.call('perf_snapshot', { also: ['energy'], cpuWindowMs: 2_000 });
    on = false;
    await loop;
    console.log('energy', idle.data.energyMj, busy.data.energyMj, busy.text);
    expect(busy.data.energyModelled).toBe(false);
    expect(busy.text).toMatch(/This Mac's energy/);
    expect(busy.data.energyMj!).toBeGreaterThan(idle.data.energyMj! * 3);
    expect(execFileSync('xcrun', ['simctl', 'list', 'devices', udid!]).toString()).toMatch(
      /Booted/,
    );
  }, 120_000);
});

const a95 = (rounds: { p95Ms?: number | undefined }[]) => Math.max(...rounds.map((r) => r.p95Ms!));
