import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Devicectl, IosPhoneDevice, buildScreen, sleep as pause, type Screen } from 'appdyno';
import { DeviceError } from '@appdyno/protocol';

/**
 * The runner on a real iPhone (APPDYNO_IPHONE_UDID; signing from APPDYNO_IOS_*), on the Settings
 * app: it is read, opened into General and searched, nothing is changed.
 */
const udid = process.env.APPDYNO_IPHONE_UDID;
const SETTINGS = 'com.apple.Preferences';
const APP = 'dev.appdyno.fixture';
const FIXTURE_APP = process.env.APPDYNO_IPHONE_FIXTURE_APP;
const SETTLE = { quietMs: 200, maxMs: 3_000 };

describe.skipIf(!udid)('ios runner on an iPhone', () => {
  let d: IosPhoneDevice;
  const screen = async (): Promise<Screen> =>
    buildScreen(await d.tree(), { platform: 'ios', appId: SETTINGS });
  const settings = async () => {
    await d.terminate(SETTINGS);
    await d.launch(SETTINGS);
    await pause(800);
    return screen();
  };

  beforeAll(async () => {
    d = new IosPhoneDevice(udid!);
    await d.open();
  }, 240_000);
  // the runner does not stay on a shared phone after the run
  afterAll(async () => {
    await d?.terminate(SETTINGS).catch(() => undefined);
    await d?.stopAgent();
  });

  it('says hello as iOS from the phone', () => {
    expect(d.hello).toMatchObject({ platform: 'ios', protocol: { major: 1 } });
    expect(d.hello!.screen.density).toBe(3);
  });

  it('launches an app and reads it in front', async () => {
    const s = await settings();
    expect(await d.foreground()).toBe(SETTINGS);
    expect(s.list.some((e) => /^(General|Genel)$/.test(e.label))).toBe(true);
  });

  it('taps into a screen and settles there', async () => {
    const s = await settings();
    const general = s.list.find((e) => /^(General|Genel)$/.test(e.label))!;
    const r = await d.tap(general, { settle: SETTLE, read: 'tree', before: s.hash });
    expect(r.settle!.settled).toBe(true);
    expect(
      buildScreen(r.tree!, { platform: 'ios' }).list.some((e) =>
        /^(About|Hakkında)$/.test(e.label),
      ),
    ).toBe(true);
  });

  // on a phone the runner cannot reach the clipboard: the text goes in as keys
  it('types Turkish text into a search field', async () => {
    await settings();
    const { w, h } = d.hello!.screen;
    await d.swipe({ x: w / 2, y: h * 0.3 }, { x: w / 2, y: h * 0.6 }, 300, { settle: SETTLE });
    const field = (await screen()).elements.find((e) => e.editable && e.visible)!;
    expect(field).toBeDefined();
    const at = {
      x: field.rect!.x + field.rect!.width / 2,
      y: field.rect!.y + field.rect!.height / 2,
    };
    // reports say iOS 27 delivers a few characters of a typed text and reports success: read back apart
    const text = 'Kapı zili çalışmıyor';
    const r = await d.typeText(text, { at, replace: true });
    expect(r.verified).toBe(true);
    expect(r.mode).toBe('keys');
    expect((await d.tree()).nodes.some((n) => n.t === text)).toBe(true);
  });

  it('brings a running app forward as it is', async () => {
    await settings();
    const ctl = new Devicectl(udid!);
    const pid = await ctl.pid(SETTINGS);
    const t0 = performance.now();
    await d.launch(SETTINGS);
    expect(performance.now() - t0).toBeLessThan(10_000);
    expect(await ctl.pid(SETTINGS)).toBe(pid);
  });

  describe('measures', () => {
    it('reads memory and CPU through Activity Monitor', async () => {
      await settings();
      const m = await d.measure.memory!(SETTINGS);
      expect(m.value.kind).toBe('footprint');
      expect(m.value.kb).toBeGreaterThan(5_000);
      const c = await d.measure.cpu!(SETTINGS, 3_000);
      expect(c.value.percent).toBeGreaterThanOrEqual(0);
      expect(c.value.windowMs).toBeGreaterThan(500);
    }, 180_000);

    it('profiles the CPU while the list scrolls, and counts its hangs', async () => {
      await settings();
      const { w, h } = d.hello!.screen;
      const scroll = async () => {
        for (let i = 0; i < 3; i++)
          await d.swipe({ x: w / 2, y: h * 0.75 }, { x: w / 2, y: h * 0.25 }, 250, {
            settle: false,
          });
      };
      const p = await d.measure.cpuProfile!(SETTINGS, 4_000, scroll);
      expect(p.value.samples).toBeGreaterThan(0);
      expect(p.value.top.length).toBeGreaterThan(0);
      const hangs = await d.hangs(SETTINGS, 3, scroll);
      expect(hangs.hangs).toBeGreaterThanOrEqual(0);
      expect(hangs.tracePath).toMatch(/\.trace$/);
    }, 240_000);

    it('times a launch until its first screen reads', async () => {
      const l = await d.measure.launch!(SETTINGS, { mode: 'cold', repeats: 1 });
      expect(l.value.medianMs).toBeGreaterThan(100);
      expect(l.value.until).toBe('the first screen is read');
    }, 120_000);

    it('is not a virtual device', () => {
      expect(d.virtual).toBe(false);
    });
  });

  it('records animation hitches while the list scrolls', async () => {
    await settings();
    const { w, h } = d.hello!.screen;
    // a recording without displayed surfaces must say so, never "no hitches"
    const v = await d
      .hitches(SETTINGS, 5, async () => {
        for (let i = 0; i < 4; i++)
          await d.swipe({ x: w / 2, y: h * 0.75 }, { x: w / 2, y: h * 0.25 }, 250, {
            settle: false,
          });
      })
      .catch((e: DeviceError) => e);
    if (v instanceof DeviceError) {
      expect(v.code).toBe('CHECK_FAILED');
      expect(v.message).toMatch(/no frames/);
    } else {
      expect(v.frames).toBeGreaterThan(0);
      expect(v.tracePath).toMatch(/\.trace$/);
    }
  }, 120_000);

  it('opens a link in the running app, its state kept (no new launch)', async () => {
    await settings();
    const pid = await new Devicectl(udid!).pid(SETTINGS);
    await d.openUrl('prefs:root=General', SETTINGS);
    await pause(1_500);
    expect(await new Devicectl(udid!).pid(SETTINGS)).toBe(pid);
    expect((await screen()).list.some((e) => /^(About|Hakkında)$/.test(e.label))).toBe(true);
  });

  it('sets a simulated location and clears it', async () => {
    await d.setLocation(41.0082, 28.9784);
    await d.clearLocation();
  });

  it('takes a screenshot', async () => {
    const { meta, data } = await d.screenshot({ format: 'jpeg', maxPx: 1024 });
    expect(Math.max(meta.w, meta.h)).toBeLessThanOrEqual(1024);
    expect(data.subarray(0, 2).toString('hex')).toBe('ffd8');
  });

  it('reconnects to the running runner without starting it again', async () => {
    d.close();
    d = new IosPhoneDevice(udid!);
    await d.tree();
    expect(d.lastStartWasCold).toBe(false);
  });

  /**
   * On the fixture's screens of known cost, each reading against what the screen does.
   * APPDYNO_IPHONE_FIXTURE_APP: a Release build of the Fixture target signed for the phone.
   */
  describe.skipIf(!FIXTURE_APP)('measures on the fixture', () => {
    const open = async (screen: string, env?: Record<string, string>) => {
      await d.terminate(APP);
      if (env) await new Devicectl(udid!).launch(APP, undefined, env);
      else await d.launch(APP);
      await d.openUrl(`appdyno-fixture://open/${screen}`, APP);
      await pause(1_000);
      return buildScreen(await d.tree(), { platform: 'ios', appId: APP });
    };
    const byId = (s: Screen, id: string) => {
      const e = s.list.find((x) => x.id === id);
      if (!e) throw new Error(`no ${id}`);
      return e;
    };

    beforeAll(async () => {
      await new Devicectl(udid!).install(FIXTURE_APP!);
    }, 240_000);
    afterAll(async () => {
      await d?.terminate(APP).catch(() => undefined);
    });

    it('memory: 50 MB held shows in the footprint (within 15 %)', async () => {
      const s = await open('memory');
      const before = (await d.measure.memory!(APP)).value.kb;
      // a recording can outlast a phone's auto-lock, and a tap on the lock screen goes to the system
      await d.inFront(APP);
      await d.tap(byId(s, 'memory_alloc'), { settle: false });
      await pause(1_500);
      const after = (await d.measure.memory!(APP)).value.kb;
      console.log('memory', before, after);
      await d.tap(byId(s, 'memory_free'), { settle: false });
      expect((after - before) / 1024).toBeGreaterThan(50 * 0.85);
      expect((after - before) / 1024).toBeLessThan(50 * 1.15);
    }, 180_000);

    it('CPU profile: the busy loop is the top function', async () => {
      const s = await open('cpu');
      const p = (
        await d.measure.cpuProfile!(APP, 3_000, async () => {
          await pause(200);
          await d.tap(byId(s, 'cpu_load'), { settle: false });
        })
      ).value;
      console.log(
        'profile',
        JSON.stringify(p.appTop?.slice(0, 3)),
        JSON.stringify(p.top.slice(0, 3)),
      );
      expect(p.samples).toBeGreaterThan(100);
      // a Release build without its symbols here: an address, on nearly all of the samples
      expect(p.appTop?.[0]?.percent).toBeGreaterThan(50);
      await pause(1_000);
    }, 120_000);

    it('hangs: a 500 ms stall counts, a light tap does not', async () => {
      const s = await open('stall');
      const h = await d.hangs(APP, 5, async () => {
        await pause(1_000);
        await d.tap(byId(s, 'stall_500'), { settle: false });
      });
      console.log('hangs', JSON.stringify(h));
      expect(h.hangs).toBeGreaterThanOrEqual(1);
      expect(h.worstMs).toBeGreaterThan(500 * 0.9);
      expect(h.worstMs).toBeLessThan(500 * 1.25);
    }, 180_000);

    it('hitches: a real scroll of the list', async () => {
      const s = await open('list');
      const { w, h } = d.hello!.screen;
      const v = await d
        .hitches(APP, 6, async () => {
          for (let i = 0; i < 4; i++)
            await d.swipe({ x: w / 2, y: h * 0.8 }, { x: w / 2, y: h * 0.2 }, 150, {
              settle: false,
            });
        })
        .catch((e: DeviceError) => e);
      console.log('hitches', v instanceof Error ? v.message : JSON.stringify(v));
      expect(s.list.length).toBeGreaterThan(0);
      if (v instanceof DeviceError) expect(v.code).toBe('CHECK_FAILED');
      else expect(v.frames).toBeGreaterThan(0);
    }, 180_000);

    it('launch: a 500 ms slow start raises it by that (within 25 %)', async () => {
      await d.terminate(APP);
      const base = (await d.measure.launch!(APP, { mode: 'cold', repeats: 5 })).value;
      const slow = (
        await d.measure.launch!(APP, {
          mode: 'cold',
          repeats: 5,
          env: { APPDYNO_FIXTURE_STARTUP_MS: '500' },
        })
      ).value;
      console.log('launch', JSON.stringify(base.samples), JSON.stringify(slow.samples));
      const delta = slow.medianMs! - base.medianMs!;
      expect(delta).toBeGreaterThan(500 * 0.75);
      expect(delta).toBeLessThan(500 * 1.25);
    }, 240_000);

    it('build type and size say what a phone can tell', async () => {
      expect(await d.measure.buildType!(APP)).toBe('unknown');
      await expect(d.measure.size!(APP)).rejects.toMatchObject({ code: 'UNSUPPORTED' });
      expect(await d.measure.buildType!(SETTINGS)).toBe('release');
    });

    // the runner gives way to the test and the next command starts it again
    it("XCTest's metrics: launch and hitches", async () => {
      const launch = await d.measure.xctMetrics!(APP, 'launch').catch((e: DeviceError) => e);
      console.log(
        'xct launch',
        launch instanceof Error ? launch.message : JSON.stringify(launch.value.metrics),
      );
      await open('list');
      const hitches = await d.measure.xctMetrics!(APP, 'hitches').catch((e: DeviceError) => e);
      console.log(
        'xct hitches',
        hitches instanceof Error ? hitches.message : JSON.stringify(hitches.value.metrics),
      );
      await d.tree();
      for (const m of [launch, hitches]) {
        if (m instanceof DeviceError) expect(m.code).toBe('UNSUPPORTED');
        else expect(Object.keys(m.value.metrics).length).toBeGreaterThan(0);
      }
    }, 600_000);
  });
});
