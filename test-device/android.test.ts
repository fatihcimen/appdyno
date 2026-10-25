import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Adb, alertButton, AndroidDevice, DeviceError, type Screen } from 'appdyno';

/**
 * The Android agent against the fixture app on a real emulator or device (APPDYNO_ANDROID_SERIAL; never a
 * default). Each test starts from a known screen; the app is reinstalled by the caller (scripts/).
 */
const serial = process.env.APPDYNO_ANDROID_SERIAL;
const APP = 'dev.appdyno.fixture';
const SETTLE = { quietMs: 200, maxMs: 3_000 };

describe.skipIf(!serial)('android agent on a device', () => {
  let d: AndroidDevice;
  const screen = (appId = APP) => d.read(appId);
  const find = (s: Screen, label: string | RegExp) =>
    s.list.find((e) => (typeof label === 'string' ? e.label === label : label.test(e.label)));
  const labels = (s: Screen) => s.list.map((e) => e.label);
  /** The fixture's home, its task cleared, settled (two equal reads). */
  const home = async () => {
    await d.shell(`am start -W -n ${APP}/.MainActivity -f 0x10008000`);
    let last: Screen | undefined;
    let same = 0;
    for (let i = 0; i < 40; i++) {
      const s = await screen();
      same = find(s, 'appdyno fixture') && last?.hash === s.hash ? same + 1 : 0;
      // the same layout for 600 ms: the activity transition is over
      if (same >= 3) return s;
      last = s;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('fixture home did not show');
  };
  const open = async (button: string) => {
    const s = await home();
    const b = find(s, button)!;
    expect(b, button).toBeDefined();
    const r = await d.tap(b, { settle: SETTLE, read: 'tree', before: s.hash });
    return d.read(APP).then((x) => ({ ...x, settle: r.settle }));
  };

  beforeAll(async () => {
    d = new AndroidDevice(serial!);
    await d.open();
    await d.shell(
      'settings put global window_animation_scale 1; settings put global transition_animation_scale 1',
    );
  });
  afterAll(() => d?.close());

  it('says hello with the device and the protocol', () => {
    expect(d.hello).toMatchObject({ platform: 'android', protocol: { major: 1 } });
    expect(d.hello!.screen.w).toBeGreaterThan(0);
    expect(d.hello!.capabilities).toContain('settle');
  });

  it('reads the home screen with the app in front', async () => {
    const s = await home();
    expect(s.foreground).toBe(APP);
    expect(labels(s)).toEqual(
      expect.arrayContaining(['appdyno fixture', 'FORM', 'LISTE', 'COMPOSE']),
    );
    expect(s.tree.truncated).toBe(false);
    expect(s.window).toEqual({ w: d.hello!.screen.w, h: d.hello!.screen.h });
  });

  it('taps into another screen and settles there in one call', async () => {
    const s = await open('FORM');
    expect(s.settle!.settled).toBe(true);
    expect(labels(s)).toContain('Bilgilerinizi girin');
  });

  it('an unchanged screen settles after one quiet window', async () => {
    const s = await home();
    const title = find(s, 'appdyno fixture')!;
    const r = await d.tap(title, { settle: SETTLE, read: 'hash', before: s.hash });
    expect(r.settle!.settled).toBe(true);
    expect(r.settle!.ms).toBeGreaterThanOrEqual(SETTLE.quietMs);
    expect(r.settle!.ms).toBeLessThan(SETTLE.quietMs + 250);
    expect(r.hash).toBe(s.hash);
  });

  it('types Turkish text into a field and reads it back, replacing and appending', async () => {
    const s = await open('FORM');
    const name = s.list.find((e) => e.id === 'name_input')!;
    const r = await d.typeText('Çağrı İşgüzar', {
      at: name,
      replace: true,
      read: 'tree',
      settle: SETTLE,
    });
    expect(r).toMatchObject({ mode: 'setText', verified: true });
    await d.typeText(' öğün', { replace: false });
    const after = await screen();
    expect(after.list.find((e) => e.id === 'name_input')!.label).toBe('Çağrı İşgüzar öğün');
    const phone = after.list.find((e) => e.id === 'phone_input')!;
    expect((await d.typeText('+90 555 123 45 67', { at: phone, replace: true })).verified).toBe(
      true,
    );
    const pw = after.list.find((e) => e.id === 'password_input')!;
    // a password field reports no readable text: typed, not verified
    expect(await d.typeText('Gizli123!', { at: pw, replace: true })).toMatchObject({
      verified: false,
    });
    const submit = (await screen()).list.find((e) => e.label === 'GÖNDER')!;
    const done = await d.tap(submit, { settle: SETTLE, read: 'tree' });
    expect(done.tree!.nodes.some((n) => n.t === 'Gönderildi: Çağrı İşgüzar öğün')).toBe(true);
  });

  it('refuses typing when no field has focus', async () => {
    await home();
    const e = await d.typeText('x', { settle: false }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(DeviceError);
    expect((e as DeviceError).code).toBe('NO_FOCUS');
  });

  it('waits for a field that takes focus late (a slow phone)', async () => {
    const s = await open('YAVAŞ ODAK');
    const field = s.list.find((e) => e.id === 'slow_input')!;
    const r = await d.typeText('482913', { at: field, replace: true, settle: false });
    expect(r.verified).toBe(true);
    expect(r.focusMs).toBeGreaterThanOrEqual(500);
  });

  it('gives identical buttons their row and keeps the ref on the same row after a scroll', async () => {
    const s = await open('LISTE');
    const add = s.list.filter((e) => e.label === 'EKLE');
    expect(add.length).toBeGreaterThan(5);
    const third = add.find((e) => e.refContext === 'Ürün 3')!;
    expect(third).toBeDefined();
    const fifth = add.find((e) => e.refContext === 'Ürün 5')!;
    const r = await d.tap(third, { settle: SETTLE, read: 'tree' });
    expect(r.tree!.nodes.filter((n) => n.t === 'Sepette: 1')).toHaveLength(1);
    const w = d.hello!.screen;
    await d.swipe({ x: w.w / 2, y: w.h * 0.6 }, { x: w.w / 2, y: w.h * 0.45 }, 400, {
      settle: SETTLE,
      read: 'none',
    });
    const moved = await screen();
    const fifthAfter = moved.list.find((e) => e.label === 'EKLE' && e.refContext === 'Ürün 5');
    expect(fifthAfter?.ref).toBe(fifth.ref);
    expect(fifthAfter!.y).toBeLessThan(fifth.y);
  });

  it('reads a dialog and answers it', async () => {
    const s = await open('DIYALOG');
    const r = await d.tap(find(s, 'DİYALOĞU AÇ') ?? find(s, /DIYALO/)!, {
      settle: SETTLE,
      read: 'tree',
    });
    expect(r.settle!.settled).toBe(true);
    const dlg = await screen();
    expect(labels(dlg)).toEqual(expect.arrayContaining(['Emin misiniz?', 'Sepet boşaltılacak.']));
    const ok = find(dlg, /^TAMAM$/i)!;
    await d.tap(ok, { settle: SETTLE, read: 'none' });
    expect(labels(await screen())).toContain('Onaylandı');
  });

  it('reads Compose test tags as ids and types into a Compose field', async () => {
    const s = await open('COMPOSE');
    expect(s.list.find((e) => e.id === 'compose_title')?.label).toBe('Compose ekranı');
    const input = s.list.find((e) => e.id === 'compose_input')!;
    expect(input).toBeDefined();
    expect((await d.typeText('Kapı zili çalışmıyor', { at: input, replace: true })).verified).toBe(
      true,
    );
    const save = (await screen()).list.find((e) => e.id === 'compose_save')!;
    await d.tap(save, { settle: SETTLE, read: 'none' });
    expect((await screen()).list.find((e) => e.id === 'compose_result')?.label).toBe(
      'Kaydedildi: Kapı zili çalışmıyor',
    );
  });

  it('settles on a screen whose text keeps ticking', async () => {
    const s = await open('SAYAÇ');
    expect(s.settle!.settled).toBe(true);
    const stop = s.list.find((e) => e.label === 'DUR')!;
    const t = Date.now();
    const r = await d.tap(stop, { settle: SETTLE, read: 'none', before: s.hash });
    expect(r.settle!.settled).toBe(true);
    expect(Date.now() - t).toBeLessThan(1_500);
  });

  it('waits for content that arrives after a spinner', async () => {
    const s = await open('GECIKMELI');
    const load = s.list.find((e) => e.label === 'YÜKLE')!;
    const r = await d.tap(load, { settle: SETTLE, read: 'tree', before: s.hash });
    expect(r.settle!.settled).toBe(true);
    expect(r.tree!.nodes.some((n) => n.t === 'SONUÇ 1' || n.t === 'Sonuç 1')).toBe(true);
  });

  it('finds the system permission prompt and answers it', async () => {
    await d.shell(
      `pm revoke ${APP} android.permission.ACCESS_FINE_LOCATION; pm revoke ${APP} android.permission.ACCESS_COARSE_LOCATION`,
    );
    const s = await open('İZIN');
    await d.tap(find(s, 'KONUM İZNİ İSTE') ?? find(s, /KONUM/)!, { settle: SETTLE, read: 'none' });
    let prompt: Screen | undefined;
    for (let i = 0; i < 20 && !prompt; i++) {
      const now = await screen();
      if (alertButton(now.elements, 'android', 'allow')) prompt = now;
      else await new Promise((r) => setTimeout(r, 200));
    }
    expect(prompt, 'permission prompt').toBeDefined();
    expect(prompt!.foreground).toMatch(/permissioncontroller/);
    const allow = alertButton(prompt!.elements, 'android', 'allow')!;
    await d.tap(allow, { settle: SETTLE, read: 'none' });
    expect(alertButton((await screen()).elements, 'android', 'allow')).toBeUndefined();
    expect(await d.shell(`dumpsys package ${APP} | grep ACCESS_FINE_LOCATION`)).toMatch(
      /granted=true/,
    );
  });

  it('reads the text of a web view', async () => {
    await open('WEB');
    let found = false;
    for (let i = 0; i < 25 && !found; i++) {
      const s = await screen();
      found = s.tree.nodes.some((n) => n.t === 'Web içerik' || n.d === 'Web içerik');
      if (!found) await new Promise((r) => setTimeout(r, 200));
    }
    expect(found).toBe(true);
  });

  it('takes screenshots scaled and full size', async () => {
    await home();
    const small = await d.screenshot({ format: 'jpeg', maxPx: 1024 });
    expect(Math.max(small.meta.w, small.meta.h)).toBe(1024);
    expect(small.data.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    const full = await d.screenshot({ format: 'png' });
    expect({ w: full.meta.w, h: full.meta.h }).toEqual({
      w: d.hello!.screen.w,
      h: d.hello!.screen.h,
    });
    expect(full.data.subarray(1, 4).toString('ascii')).toBe('PNG');
  });

  it('round-trips Turkish text through the clipboard', async () => {
    await d.setClipboard('Kargo şubesi: Üsküdar');
    expect(await d.getClipboard()).toBe('Kargo şubesi: Üsküdar');
  });

  it('rotates and comes back to portrait', async () => {
    await home();
    const wide = async (want: boolean) => {
      for (let i = 0; i < 20; i++) {
        const w = (await screen()).window;
        if (w && w.w > w.h === want) return true;
        await new Promise((r) => setTimeout(r, 200));
      }
      return false;
    };
    try {
      await d.setOrientation(1);
      expect(await wide(true)).toBe(true);
    } finally {
      await d.setOrientation(0);
    }
    expect(await wide(false)).toBe(true);
  });

  it('opens a deep link in the app', async () => {
    await d.openUrl('gdfixture://open/form', APP);
    let ok = false;
    for (let i = 0; i < 15 && !ok; i++) {
      ok = labels(await screen()).includes('Bilgilerinizi girin');
      if (!ok) await new Promise((r) => setTimeout(r, 200));
    }
    expect(ok).toBe(true);
  });

  it('sets a test location', async () => {
    await d.setLocation(41.0082, 28.9784);
    expect(await d.shell('dumpsys location | grep -c "41.008"')).not.toMatch(/^0/);
  });

  it('sees the app leave the foreground when it crashes, and starts it again', async () => {
    const s = await home();
    await d.tap(find(s, 'ÇÖKERT')!, { settle: SETTLE, read: 'none' });
    let fg: string | undefined = APP;
    for (let i = 0; i < 20 && fg === APP; i++) {
      await new Promise((r) => setTimeout(r, 200));
      fg = (await screen()).foreground;
    }
    expect(fg).not.toBe(APP);
    await d.shell('input keyevent KEYCODE_BACK');
    await d.launch(APP);
    let back: string | undefined;
    for (let i = 0; i < 20 && back !== APP; i++) {
      back = (await screen()).foreground;
      if (back !== APP) await new Promise((r) => setTimeout(r, 200));
    }
    expect(back).toBe(APP);
  });

  it('a dark screen is woken and read', async () => {
    await home();
    await d.shell('input keyevent KEYCODE_SLEEP');
    await new Promise((r) => setTimeout(r, 1_500));
    const s = await d.read(APP);
    expect(s.foreground).toBe(APP);
    expect(find(s, 'appdyno fixture')).toBeDefined();
  });

  it('a dropped adb connection: a read waits for the device and finds the running agent again', async () => {
    const back = new AndroidDevice(serial!, new Adb(), 30_000);
    await back.open();
    const pid = back.hello!.pid;
    await new Adb().run(['-s', serial!, 'reconnect'], 30_000);
    const s = await back.read(APP);
    expect(s.list.length).toBeGreaterThan(0);
    expect(back.hello!.pid).toBe(pid); // the same agent, reconnected, not restarted
    back.close();
  });

  it('a second host connects to the running agent without starting another', async () => {
    const other = new AndroidDevice(serial!);
    await other.open();
    expect(other.lastStartWasCold).toBe(false);
    expect(other.hello!.pid).toBe(d.hello!.pid);
    const [a, b] = await Promise.all([d.read(APP), other.read(APP)]);
    expect(a.hash).toBe(b.hash);
    other.close();
  });

  it('a killed agent fails the call in flight and comes back on the next read', async () => {
    await home();
    const pid = d.hello!.pid!;
    const pending = d.longPress({ x: 10, y: 10 }, 3_000, { settle: false });
    await new Promise((r) => setTimeout(r, 300));
    // not through the device's queue: it waits for the long press
    await new Adb().exec(serial!, `kill ${pid}`);
    const e = await pending.catch((x: unknown) => x);
    expect((e as DeviceError).code).toBe('AGENT_UNAVAILABLE');
    const s = await d.read(APP);
    expect(s.list.length).toBeGreaterThan(0);
    expect(d.lastStartWasCold).toBe(true);
    expect(d.hello!.pid).not.toBe(pid);
  });

  it('a second automation server on the device is refused with a typed reason', async () => {
    await d.read(APP); // ours holds the connection
    const out = await d.shell(
      'cd /data/local/tmp/appdyno && CLASSPATH=$(ls agent-*.apk | head -1) app_process / dev.appdyno.agent.Main ' +
        '--socket appdyno_conflict --token 0123456789abcdef0123 2>&1; echo exit=$?',
      20_000,
    );
    expect(out).toMatch(/AGENT_CONFLICT/);
    expect(out).toMatch(/exit=3/);
  });

  it('stays answerable while the app hangs its main thread', async () => {
    const s = await home();
    await d.tap(find(s, 'DONMUŞ')!, { settle: false });
    const t = Date.now();
    const r = await d.tree().then(
      (x) => ({ ok: true as const, truncated: x.truncated }),
      (e: unknown) => ({ ok: false as const, code: (e as DeviceError).code }),
    );
    const ms = Date.now() - t;
    // a hung app cannot answer accessibility calls: the read either still comes back (the other
    // windows, maybe cut short) or fails with TIMEOUT inside its deadline, never hangs
    expect(ms).toBeLessThan(17_000);
    if (!r.ok) expect(r.code).toBe('TIMEOUT');
    // the app answers again after its 12 s hang
    for (let i = 0; i < 30; i++) {
      const ok = await d
        .read(APP)
        .then((x) => x.foreground === APP && x.list.length > 3)
        .catch(() => false);
      if (ok) break;
      await new Promise((r) => setTimeout(r, 1_000));
    }
    await d.shell('input keyevent KEYCODE_BACK');
    await home();
  }, 90_000);
});
