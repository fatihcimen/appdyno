import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IosPhoneDevice, buildScreen, type Screen } from 'appdyno';

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
    const r = await d.typeText('Kapı zili çalışmıyor', { at, replace: true });
    expect(r.verified).toBe(true);
    expect(r.mode).toBe('keys');
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
