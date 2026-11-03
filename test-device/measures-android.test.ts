import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Adb, androidProvider, sleep as pause, type AndroidDevice, type Screen } from 'appdyno';
import { latestRuns, runKeys } from '@appdyno/perf';
import { opsOn } from './helpers.js';

/**
 * What the table's rows read on an Android device through the operations, against a known cost
 * (APPDYNO_ANDROID_SERIAL): one frozen frame, the start's phases kept, energy of a busy core against an idle app, with
 * the battery and its count put back.
 */
const serial = process.env.APPDYNO_ANDROID_SERIAL;
const APP = 'dev.appdyno.fixture';

describe.skipIf(!serial)('measures on Android, through the operations', () => {
  const t = opsOn(androidProvider(new Adb(), {}), serial!, APP);
  let d: AndroidDevice;
  const open = async (screen: string, id: string): Promise<Screen> => {
    await d.shell(
      `am start -W -a android.intent.action.VIEW -d 'appdyno-fixture://open/${screen}?n=${Date.now()}' ${APP}`,
    );
    // on a loaded Mac it comes when it comes, and a moment has no window at all
    for (let i = 0; i < 50; i++) {
      const s = await d.read(APP).catch(() => undefined);
      if (s?.list.some((e) => e.id === id)) break;
      await pause(200);
    }
    await pause(1_200);
    return d.read(APP);
  };
  const onBattery = async () =>
    Number(
      /Time on battery: (?:(\d+)h )?(?:(\d+)m )?(?:(\d+)s )?/
        .exec(await d.shell('dumpsys batterystats --charged | head -20'))
        ?.slice(1, 4)
        .reduce((a, b, i) => a + Number(b ?? 0) * [3600, 60, 1][i]!, 0) ?? 0,
    );

  beforeAll(async () => {
    d = (await t.ctx.session()).device as AndroidDevice;
    await d.open();
  });
  beforeEach(() => d.ensureAwake());
  afterAll(() => t.ctx.close());

  it('frozen: a 1 s stall during a scroll reads as one, a plain list as none', async () => {
    await open('list', 'list');
    const light = await t.call('perf_scroll');
    await open('list_stall', 'list_stall');
    const stalled = await t.call('perf_scroll');
    console.log('frozen', light.data.frozen, stalled.data.frozen, stalled.text);
    expect(light.data.frozen).toBe(0);
    expect(stalled.data.frozen).toBe(1);
  }, 180_000);

  it('frozen: the frame timeline says it too, in perf_trace', async () => {
    await open('list_stall', 'list_stall');
    const r = await t.call('perf_trace', { scroll: 'up', seconds: 6 });
    console.log(r.text);
    expect(r.error).toBe(false);
    expect(r.data.frozen).toBe(1);
    expect(r.data.worstMs as number).toBeGreaterThan(800);
  }, 180_000);

  it('why slow: an operation keeps the phases for the dashboard', async () => {
    const r = await t.call('perf_launch', { repeats: 1, trace: true, scenario: 'why' });
    console.log(r.text);
    expect(r.error).toBe(false);
    const keys = await runKeys(t.measurements, { app: APP });
    const runs = await latestRuns(
      t.measurements,
      keys.find((k) => k.scenario === 'why')!,
      1,
    );
    expect(runs[0]!.some((x) => x.kind.startsWith('launch.phase.'))).toBe(true);
  }, 240_000);

  it('energy: a busy core reads clearly above an idle app; the answer says what it is; all goes back', async () => {
    const s = await open('cpu', 'cpu_load');
    const cpuLoad = s.list.find((e) => e.id === 'cpu_load')!;
    const counted = await onBattery();
    await pause(1_000);
    const idle = await t.call('perf_snapshot', { also: ['energy'], cpuWindowMs: 3_000 });
    // its loop lasts 3 s, and the snapshot reads the CPU before the energy
    let on = true;
    const loop = (async () => {
      while (on) {
        await d.tap(cpuLoad, { settle: false }).catch(() => undefined);
        await pause(1_500);
      }
    })();
    await pause(500);
    const busy = await t.call('perf_snapshot', { also: ['energy'], cpuWindowMs: 3_000 });
    on = false;
    await loop;
    console.log('energy', idle.text, '\n', busy.text);
    expect(busy.data.energyModelled).toBe(true);
    if (serial!.startsWith('emulator-')) {
      expect(busy.text).toMatch(/A model, not a reading/);
      expect(busy.data.energyMj as number).toBeGreaterThan(
        (idle.data.energyMj as number) * 2 + 100,
      );
    } else {
      expect(busy.text).toMatch(/model-based/);
      expect(busy.data.energyMah as number).toBeGreaterThan(idle.data.energyMah as number);
      expect(busy.text).toMatch(/energy \(a model\)/);
    }
    expect(await d.shell('dumpsys battery')).not.toMatch(/UPDATES STOPPED/);
    // the count since the last charge goes on, whatever the level
    expect(await onBattery()).toBeGreaterThanOrEqual(counted);
  }, 180_000);
});
