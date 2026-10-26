import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IosSimulatorDevice, Simctl, type Screen } from 'appdyno';
import { join } from 'node:path';

/**
 * The iOS runner against the fixture app on our own simulator (APPDYNO_IOS_UDID; never a default: other
 * simulators run on this Mac). Booting and shutting down are the caller's.
 */
const udid = process.env.APPDYNO_IOS_UDID;
const APP = 'dev.appdyno.fixture';
const SETTLE = { quietMs: 200, maxMs: 3_000 };
const PRODUCTS = join(import.meta.dirname, '../ios/.derived/Build/Products/Debug-iphonesimulator');

describe.skipIf(!udid)('ios runner on a simulator', () => {
  let d: IosSimulatorDevice;
  const simctl = new Simctl();
  const labels = (s: Screen) => s.list.map((e) => e.label);
  const find = (s: Screen, label: string) => s.list.find((e) => e.label === label);
  const byId = (s: Screen, id: string) => s.list.find((e) => e.id === id);
  const home = async () => {
    await d.terminate(APP);
    await d.launch(APP);
    return d.read(APP);
  };
  const open = async (title: string) => {
    const s = await home();
    const b = find(s, title)!;
    expect(b, title).toBeDefined();
    const r = await d.tap(b, { settle: SETTLE, read: 'none', before: s.hash });
    return { ...(await d.read(APP)), settle: r.settle };
  };

  beforeAll(async () => {
    await simctl.install(udid!, join(PRODUCTS, 'Fixture.app'));
    d = new IosSimulatorDevice(udid!);
    await d.open();
  }, 240_000);
  // the runner does not stay on a shared simulator after the run
  afterAll(() => d?.stopAgent());

  it('says hello as iOS in points', () => {
    expect(d.hello).toMatchObject({ platform: 'ios', protocol: { major: 1 } });
    expect(d.hello!.screen.density).toBeGreaterThanOrEqual(2);
    expect(d.hello!.capabilities).toContain('app.target');
  });

  it('reads the fixture home with the app in front', async () => {
    const s = await home();
    expect(await d.foreground()).toBe(APP);
    expect(labels(s)).toContain('appdyno fixture');
    expect(find(s, 'Form')?.flags).toContain('clickable');
  });

  it('taps into a screen, types Turkish text and reads the result', async () => {
    const s = await open('Form');
    const name = byId(s, 'name_input')!;
    expect(name).toBeDefined();
    const r = await d.typeText('Kapı zili çalışmıyor', { at: name, replace: true });
    expect(r.verified).toBe(true);
    const send = byId(await d.read(APP), 'submit')!;
    await d.tap(send, { settle: SETTLE });
    expect(byId(await d.read(APP), 'result')?.label).toBe('Gönderildi: Kapı zili çalışmıyor');
  });

  it('answers an alert', async () => {
    const s = await open('Diyalog');
    await d.tap(byId(s, 'open_dialog')!, { settle: SETTLE });
    const alert = await d.read(APP);
    const ok = find(alert, 'Tamam')!;
    expect(ok).toBeDefined();
    await d.tap(ok, { settle: SETTLE });
    expect(labels(await d.read(APP))).toContain('Onaylandı');
  });

  it('settles on a screen whose text keeps ticking', async () => {
    const s = await open('Sayaç');
    expect(s.settle!.settled).toBe(true);
  });

  it('waits for a spinner to go', async () => {
    const s = await open('Gecikmeli');
    expect(s.settle!.settled).toBe(true);
    expect(labels(s)).toContain('Yüklendi');
  });

  it('opens a deep link into the app', async () => {
    await d.openUrl('gdfixture://open/late', APP);
    await new Promise((r) => setTimeout(r, 1_000));
    expect(labels(await d.read(APP))).toContain('Temizle');
  });

  it('types into a code entry whose hidden field XCUI does not report as focused', async () => {
    await d.terminate(APP);
    await d.launch(APP);
    await d.openUrl('gdfixture://open/code', APP);
    await new Promise((r) => setTimeout(r, 1_000));
    const r = await d.typeText('123456', { settle: SETTLE });
    expect(r.mode).toBe('keys');
    expect(byId(await d.read(APP), 'code_value')?.label).toBe('Kod: 123456');
  });

  it('takes a screenshot', async () => {
    const { meta, data } = await d.screenshot({ format: 'jpeg', maxPx: 1024 });
    expect(Math.max(meta.w, meta.h)).toBeLessThanOrEqual(1024);
    expect(data.subarray(0, 2).toString('hex')).toBe('ffd8');
  });

  it('reads the home screen when the app is gone', async () => {
    await d.terminate(APP);
    expect(await d.foreground()).toBe('com.apple.springboard');
  });
});
