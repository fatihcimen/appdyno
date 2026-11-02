import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Devicectl, IosPhoneDevice, buildScreen, type Screen } from 'appdyno';
import { DeviceError } from '@appdyno/protocol';

/**
 * The runner on a real iPhone (APPDYNO_IPHONE_UDID; signing from APPDYNO_IOS_*), on the Settings
 * app: it is read, opened into General and searched, nothing is changed.
 */
const udid = process.env.APPDYNO_IPHONE_UDID;
const SETTINGS = 'com.apple.Preferences';
const SETTLE = { quietMs: 200, maxMs: 3_000 };
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
      const hangs = await d.measure.hangs(SETTINGS, 3, scroll);
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
    // Xcode 27.1 on iOS 27.0.1 records 0 to 26 displayed surfaces of a scroll: none must say so, never "no hitches"
    const v = await d
      .hitches(SETTINGS, 5, async () => {
        for (let i = 0; i < 4; i++)
          await d.swipe({ x: w / 2, y: h * 0.75 }, { x: w / 2, y: h * 0.25 }, 250, {
            settle: false,
          });
      })
      .catch((e: DeviceError) => e);
    if (v instanceof DeviceError) {
      expect(v.code).toBe('UNSUPPORTED');
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
});
