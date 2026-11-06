import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { PROTOCOL } from '@appdyno/protocol';
import { agentMayGo } from './one-agent.js';
import {
  Adb,
  androidScreen,
  AndroidDevice,
  androidProvider,
  DeviceError,
  elementsOf,
  FOCUS_READ,
  NODE_FLAGS,
  TEST_LOCATION,
  type Screen,
} from './workspace.js';

/**
 * The Android agent against the fixture app on a real emulator or device (APPDYNO_ANDROID_SERIAL; never a
 * default). Each test starts from a known screen; the app is reinstalled by the caller (scripts/).
 */
const serial = process.env.APPDYNO_ANDROID_SERIAL;
const APP = 'dev.appdyno.fixture';
const SETTLE = { quietMs: 200, maxMs: 3_000 };
/** At most this many reads in one quiet window (the agent reads far less than this bound allows). */
const oneWindow = (quietMs: number) => Math.ceil(quietMs / 40) + 1;

describe.skipIf(!serial)('android agent on a device', () => {
  let d: AndroidDevice;
  const screen = (appId = APP) => d.read(appId);
  // a Turkish phone capitalizes a button's "List" to "LİST"
  const dotless = (label: string) => label.replace(/İ/g, 'I');
  const find = (s: Screen, label: string | RegExp) =>
    s.list.find((e) =>
      typeof label === 'string' ? dotless(e.label) === label : label.test(dotless(e.label)),
    );
  const labels = (s: Screen) => s.list.map((e) => dotless(e.label));
  /** The screen showing `label`, settled: the same layout for 600 ms (its activity transition is over). */
  const settledOn = async (label: string | RegExp, reads = 40) => {
    let last: Screen | undefined;
    let same = 0;
    for (let i = 0; i < reads; i++) {
      const s = await screen();
      // the system's own dialog over the fixture (see answerSystemDialog), on a loaded emulator as well
      const close = find(s, /^(Tamam|Close app|Iptal)$/i);
      if (close) {
        await d.tap(close, { settle: false });
        await d.shell(`am start -W -n ${APP}/.MainActivity -f 0x10008000`);
      }
      same = find(s, label) && last?.hash === s.hash ? same + 1 : 0;
      if (same >= 3) return s;
      last = s;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(
      `the screen with ${String(label)} did not settle: ${last && labels(last).slice(0, 12).join(' | ')}, windows ${last?.tree.windows.map((w) => `${w.type}:${w.pkg}`).join(' ')}`,
    );
  };
  /** The fixture's home, its task cleared, settled. */
  const home = async () => {
    await d.shell(`am start -W -n ${APP}/.MainActivity -f 0x10008000`);
    return settledOn('appdyno fixture');
  };
  const open = async (button: string) => {
    const s = await home();
    const b = find(s, button)!;
    expect(b, button).toBeDefined();
    const r = await d.tap(b, { settle: SETTLE, read: 'tree', before: s.hash });
    return d.read(APP).then((x) => ({ ...x, settle: r.settle }));
  };

  /**
   * The system answers the fixture's stalls and crashes with a dialog ("not responding", "keeps stopping"), some seconds
   * later, which a force-stop does not close on a phone and which takes the touches of whatever runs next. Waits up
   * to `waitMs` for it and closes it ("wait" brings it back on a phone).
   */
  const answerSystemDialog = async (waitMs = 0) => {
    const end = Date.now() + waitMs;
    for (;;) {
      if (/Not Responding|Application Error/.test(await d.shell(FOCUS_READ))) {
        const close = find(await d.read(), /^(Tamam|OK|Close app|Iptal|Cancel)$/i);
        if (close) await d.tap(close, { settle: false });
        return;
      }
      if (Date.now() >= end) return;
      await new Promise((r) => setTimeout(r, 500));
    }
  };

  beforeEach(() => answerSystemDialog());

  beforeAll(async () => {
    d = new AndroidDevice(serial!);
    await d.open();
    await d.shell(
      'settings put global window_animation_scale 1; settings put global transition_animation_scale 1',
    );
  });
  afterAll(() => d?.close());

  it('says hello with the device and the protocol', () => {
    expect(d.hello).toMatchObject({ platform: 'android', protocol: PROTOCOL });
    expect(d.hello!.screen.w).toBeGreaterThan(0);
  });

  it('reads the home screen with the app in front', async () => {
    const s = await home();
    expect(s.foreground).toBe(APP);
    expect(labels(s)).toEqual(
      expect.arrayContaining(['appdyno fixture', 'FORM', 'LIST', 'COMPOSE']),
    );
    expect(s.tree.truncated).toBe(false);
    expect(s.window).toEqual({ w: d.hello!.screen.w, h: d.hello!.screen.h });
  });

  it('taps into another screen and settles there in one call', async () => {
    const s = await open('FORM');
    expect(s.settle!.settled).toBe(true);
    expect(labels(s), JSON.stringify(s.settle)).toContain('Enter your details');
  });

  it('an answer between two screens is never an empty screen, and every place in it is final', async () => {
    const shown = (t: { nodes: { f: number; b: number[]; c: string; id?: string }[] }) =>
      t.nodes.filter((n) => n.f & 1 && n.b[2]! > n.b[0]! && n.b[3]! > n.b[1]!);
    const app = (t: Parameters<typeof shown>[0] & { windows: { type: number }[] }) =>
      shown({
        nodes: (t.nodes as ((typeof t.nodes)[0] & { w: number })[]).filter(
          (n) => t.windows[n.w]?.type === 1,
        ),
      });
    let moving = 0;
    for (let i = 0; i < 6; i++) {
      const s = await home();
      const r = await d.tap(find(s, 'FORM')!, { settle: SETTLE, read: 'tree', before: s.hash });
      expect(app(r.tree!).length, JSON.stringify(r.settle)).toBeGreaterThan(0);
      if (r.settle!.moving) moving++;
      await new Promise((x) => setTimeout(x, 1_500));
      const later = await d.tree();
      expect(app(r.tree!).map((n) => [n.c, n.id, n.b])).toEqual(
        app(later).map((n) => [n.c, n.id, n.b]),
      );
      const back = await d.key('back', { settle: SETTLE, read: 'tree', before: later.hash });
      expect(app(back.tree!).length, JSON.stringify(back.settle)).toBeGreaterThan(0);
      if (back.settle!.moving) moving++;
      await new Promise((x) => setTimeout(x, 1_500));
      expect(app(back.tree!).map((n) => [n.c, n.id, n.b])).toEqual(
        app(await d.tree()).map((n) => [n.c, n.id, n.b]),
      );
    }
    console.log(`answered during a slide: ${moving} of 12`);
  });

  it('an action right after an answer given during a slide waits for its end and lands', async () => {
    for (let i = 0; i < 3; i++) {
      const s = await home();
      const r = await d.tap(find(s, 'DIALOG')!, { settle: SETTLE, read: 'tree', before: s.hash });
      expect(r.settle!.settled, JSON.stringify(r.settle)).toBe(true);
      const shot = await d.screenshot({ maxPx: 256 });
      expect(shot.data.length).toBeGreaterThan(0);
      const on = await screen();
      expect(find(on, 'OPEN DIALOG'), JSON.stringify({ s: r.settle, l: labels(on) })).toBeDefined();
      const t = await d.tap(find(on, 'OPEN DIALOG')!, { settle: SETTLE, read: 'tree' });
      expect(t.settle!.settled).toBe(true);
      expect(labels(await screen())).toContain('Emin misiniz?');
    }
  });

  it('turns the animations off for a session, and they come back when it ends or its agent dies', async () => {
    const scales = async () =>
      (
        await d.shell(
          'settings get global window_animation_scale; settings get global transition_animation_scale; settings get global animator_duration_scale',
        )
      )
        .trim()
        .split(/\s+/);
    const before = await scales();
    const off = new AndroidDevice(serial!, undefined, { animations: 'off' });
    await off.open();
    expect(await scales()).toEqual(['0', '0', '0']);
    expect((await off.tree()).nodes.length).toBeGreaterThan(0);
    // nothing slides with animations off: a question to the system that is not back yet is no slide
    const before2 = await off.read(APP);
    const form = before2.list.find((e) => /^form$/i.test(e.label));
    if (form) {
      const r = await off.tap(form, { settle: SETTLE, read: 'none', before: before2.hash });
      expect(r.settle!.moving).toBeUndefined();
      await off.key('back', { settle: SETTLE, read: 'none' });
    }
    // a measurement sees what a user sees
    await off.measure.frames(APP, { reset: true });
    expect(await scales()).toEqual(before);
    off.close();

    const crash = new AndroidDevice(serial!, undefined, { animations: 'off' });
    await crash.open();
    expect(await scales()).toEqual(['0', '0', '0']);
    const checks = await androidProvider().doctor!(serial!);
    expect(checks.find((c) => c.name === 'animations')?.warn).toBe(true);
    agentMayGo();
    await d.shell(`kill -9 ${crash.hello!.pid}`);
    crash.close();
    await expect.poll(scales, { timeout: 15_000, interval: 500 }).toEqual(before);

    const graceful = new AndroidDevice(serial!, undefined, { animations: 'off' });
    await graceful.open();
    expect(await scales()).toEqual(['0', '0', '0']);
    graceful.close();
    await expect.poll(scales, { timeout: 15_000, interval: 500 }).toEqual(before);
    await d.open();
  });

  it('an unchanged screen settles after one quiet window', async () => {
    const s = await home();
    const title = find(s, 'appdyno fixture')!;
    const r = await d.tap(title, { settle: SETTLE, read: 'hash', before: s.hash });
    expect(r.settle!.settled).toBe(true);
    // the agent's own clock: the window it used (short after a tap on plain text, stretched on a loaded
    // device) was waited out
    expect(r.settle!.ms).toBeGreaterThanOrEqual(r.settle!.quietMs!);
    // one window, no second one
    expect(r.settle!.reads).toBeLessThanOrEqual(oneWindow(r.settle!.quietMs!));
    expect(r.hash).toBe(s.hash);
  });

  it('types into a text-input layout tapped on its middle, which is not on its field', async () => {
    await open('FORM');
    const nodes = (await d.tree()).nodes;
    const box = (id: string) => nodes.find((n) => n.id?.endsWith(`:id/${id}`))!.b;
    const [l, t, r, b] = box('gsm_layout');
    const at = { x: (l + r) / 2, y: (t + b) / 2 };
    const [fl, ft, fr, fb] = box('gsm_input');
    // the layout's middle is on its helper text, not on its field: a tap there focuses nothing
    expect(at.x >= fl && at.x < fr && at.y >= ft && at.y < fb).toBe(false);
    const res = await d.typeText('5321234567', { at, replace: true });
    expect(res.verified).toBe(true);
    const field = (await d.tree()).nodes.find((n) => n.id?.endsWith(':id/gsm_input'));
    expect(field?.t?.replace(/\D/g, '')).toBe('5321234567');
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
    // a password field reports no readable text: typed, no verdict
    expect((await d.typeText('Gizli123!', { at: pw, replace: true })).verified).toBeUndefined();
    const submit = (await screen()).list.find((e) => e.label === 'SEND')!;
    const done = await d.tap(submit, { settle: SETTLE, read: 'tree' });
    expect(done.tree!.nodes.some((n) => n.t === 'Sent: Çağrı İşgüzar öğün')).toBe(true);
  });

  // a loaded Mac starves the emulator: an A/B run's device stopped for 3.5 s while a phone number was
  // typed, its clock going on, and the field stayed empty. The emulator's process is stopped here as the
  // Mac's load stopped it (the guest's time goes on: its timeouts run out meanwhile)
  it.skipIf(!serial?.startsWith('emulator-'))(
    'types the text in although the device stops for 3.5 s mid-typing (4 of 4)',
    async () => {
      const port = serial!.slice('emulator-'.length);
      const pids = spawnSync('pgrep', ['-f', `qemu.*-port ${port}( |$)`])
        .stdout.toString()
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(Number);
      expect(pids.length, 'the emulator process').toBeGreaterThan(0);
      const stall = async () => {
        for (const pid of pids) process.kill(pid, 'SIGSTOP');
        await new Promise((r) => setTimeout(r, 3_500));
        for (const pid of pids) process.kill(pid, 'SIGCONT');
      };
      await open('FORM');
      const [l, t, r, b] = (await d.tree()).nodes.find((n) => n.id?.endsWith(':id/phone_input'))!.b;
      const phone = { x: (l + r) / 2, y: (t + b) / 2 };
      for (const [i, offsetMs] of [0, 60, 150, 300].entries()) {
        await d.tap(phone, { settle: SETTLE });
        const text = `53212345${60 + i}`;
        const typing = d.typeText(text, { replace: true, settle: false });
        await new Promise((res) => setTimeout(res, offsetMs));
        await stall();
        const res = await typing;
        const field = (await d.tree()).nodes.find((n) => n.id?.endsWith(':id/phone_input'));
        expect({ offsetMs, text: field?.t, verified: res.verified }).toEqual({
          offsetMs,
          text,
          verified: true,
        });
      }
    },
    120_000,
  );

  // a login sheet: its own window, the field focused as it opens, typed into at once without a tap (A/B
  // runs 3b9df4d5 and 64985b2a: the focus was not found there and the number was typed into nothing)
  it('types into the field a sheet focuses as it opens, without a tap (3 of 3)', async () => {
    for (const n of ['5321234561', '5321234562', '5321234563']) {
      const s = await open('DIALOG');
      await d.tap(find(s, /DIALOG WITH FIELD|Dialog with field/)!, { settle: SETTLE });
      const r = await d.typeText(n, { replace: true, settle: false });
      const field = (await d.tree()).nodes.find((x) => x.id?.endsWith(':id/sheet_input'));
      expect({ text: field?.t, verified: r.verified }).toEqual({ text: n, verified: true });
    }
  });

  // the app (or a starved emulator) answers nothing for 6 s before its sheet's field takes the focus: the
  // wait for the focus must not run out meanwhile (A/B runs 3b9df4d5, 64985b2a: a 4 s stall ended it)
  it('types into a sheet whose field takes the focus after the app stalled for 6 s', async () => {
    const s = await open('DIALOG');
    await d.tap(find(s, /BUSY DIALOG|Busy dialog/)!, { settle: false });
    const r = await d.typeText('5321234569', { replace: true, settle: false });
    // the stall can bring the system's dialog up already: "wait" keeps the sheet
    const wait = find(await d.read(), /^(Wait|Bekle)$/);
    if (wait) await d.tap(wait, { settle: SETTLE });
    const field = (await d.tree()).nodes.find((x) => x.id?.endsWith(':id/busy_input'));
    expect({ text: field?.t, verified: r.verified }).toEqual({
      text: '5321234569',
      verified: true,
    });
    // the stall is an ANR to the system: its dialog would cover the next tests
    await answerSystemDialog(serial?.startsWith('emulator-') ? 8_000 : 15_000);
    await d.shell(`am force-stop ${APP}`);
  }, 60_000);

  // the app replaced its screen (a new activity) between the read and the tap: the tap is refused as stale,
  // never sent to the new screen (A/B run 8559e13f: a tap meant for the landing went to a splash)
  it('refuses a tap aimed at a screen another window has replaced since it was read', async () => {
    const s = await home();
    const form = find(s, 'FORM')!;
    await d.openUrl('appdyno-fixture://open/list', APP);
    await new Promise((r) => setTimeout(r, 1_500));
    const e = await d.tap(form, { settle: SETTLE, before: s.hash }).catch((x: unknown) => x);
    expect((e as DeviceError).code).toBe('STALE');
    // nothing was tapped: still the list
    expect(labels(await screen())).not.toContain('Enter your details');
    await home();
  });

  it('refuses typing when no field has focus', async () => {
    await home();
    const e = await d.typeText('x', { settle: false }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(DeviceError);
    expect((e as DeviceError).code).toBe('NO_FOCUS');
  });

  it('waits for a field that takes focus late (a slow phone)', async () => {
    const s = await open('SLOW FOCUS');
    const field = s.list.find((e) => e.id === 'slow_input')!;
    const r = await d.typeText('482913', { at: field, replace: true, settle: false });
    expect(r.verified).toBe(true);
    expect(r.focusMs).toBeGreaterThanOrEqual(500);
  });

  it('gives identical buttons their row and keeps the ref on the same row after a scroll', async () => {
    const s = await open('LIST');
    const add = s.list.filter((e) => e.label === 'ADD');
    expect(add.length).toBeGreaterThan(5);
    const third = add.find((e) => e.refContext === 'Product 3')!;
    expect(third).toBeDefined();
    const fifth = add.find((e) => e.refContext === 'Product 5')!;
    const r = await d.tap(third, { settle: SETTLE, read: 'tree' });
    expect(r.tree!.nodes.filter((n) => n.t === 'In basket: 1')).toHaveLength(1);
    const w = d.hello!.screen;
    await d.swipe({ x: w.w / 2, y: w.h * 0.6 }, { x: w.w / 2, y: w.h * 0.45 }, 400, {
      settle: SETTLE,
      read: 'none',
    });
    const moved = await screen();
    const fifthAfter = moved.list.find((e) => e.label === 'ADD' && e.refContext === 'Product 5');
    expect(fifthAfter?.ref).toBe(fifth.ref);
    expect(fifthAfter!.y).toBeLessThan(fifth.y);
  });

  it('sends a node off the screen with an empty box, never a negative one', async () => {
    await open('LIST');
    const nodes = (await d.tree()).nodes;
    // the list runs on below the screen: its rows there come clipped to the screen's edge
    expect(nodes.length).toBeGreaterThan(20);
    expect(nodes.filter((n) => n.b[2] < n.b[0] || n.b[3] < n.b[1])).toEqual([]);
  });

  it('reads a dialog and answers it', async () => {
    const s = await open('DIALOG');
    const r = await d.tap(find(s, 'OPEN DIALOG')!, {
      settle: SETTLE,
      read: 'tree',
    });
    expect(r.settle!.settled).toBe(true);
    const dlg = await screen();
    expect(labels(dlg)).toEqual(
      expect.arrayContaining(['Emin misiniz?', 'The basket will be emptied.']),
    );
    const ok = find(dlg, /^OK$/i)!;
    await d.tap(ok, { settle: SETTLE, read: 'none' });
    expect(labels(await screen())).toContain('Confirmed');
  });

  it('types a code into one-character fields key by key (the app moves from box to box)', async () => {
    await d.shell(
      'am start -W -a android.intent.action.VIEW -d appdyno-fixture://open/code dev.appdyno.fixture',
    );
    await new Promise((r) => setTimeout(r, 1_000));
    const first = (await screen()).list.find((e) => e.label === 'Code')!;
    const r = await d.typeText('9643', { at: first });
    expect(r.mode).toBe('keys');
    expect(labels(await screen())).toContain('Code: 9643');
  });

  it('reads Compose test tags as ids and types into a Compose field', async () => {
    const s = await open('COMPOSE');
    expect(
      s.list.find((e) => e.id === 'compose_title')?.label,
      JSON.stringify({ settle: s.settle, labels: labels(s).slice(0, 8) }),
    ).toBe('Compose screen');
    const input = s.list.find((e) => e.id === 'compose_input')!;
    expect(input).toBeDefined();
    expect((await d.typeText('Kapı zili çalışmıyor', { at: input, replace: true })).verified).toBe(
      true,
    );
    const save = (await screen()).list.find((e) => e.id === 'compose_save')!;
    await d.tap(save, { settle: SETTLE, read: 'none' });
    expect((await screen()).list.find((e) => e.id === 'compose_result')?.label).toBe(
      'Saved: Kapı zili çalışmıyor',
    );
  });

  it('settles on a screen whose text keeps ticking', async () => {
    const opened = await open('TICKER');
    expect(opened.settle!.settled).toBe(true);
    // the tap below is measured once the activity is in: a loaded emulator ends its slide-in after the open
    // tap's settle, and a tap during it counts that motion (seen: DUR not there yet, 10 reads). The ticking
    // text moves its own box, so the screen is never the same twice: DUR in three reads 200 ms apart
    let s: Screen = opened;
    for (let seen = 0, i = 0; seen < 3 && i < 40; i++) {
      await new Promise((r) => setTimeout(r, 200));
      s = await screen();
      seen = find(s, 'STOP') ? seen + 1 : 0;
    }
    const stop = s.list.find((e) => e.label === 'STOP')!;
    const r = await d.tap(stop, { settle: SETTLE, read: 'none', before: s.hash });
    // the ticking text never held it to the cap: settled within one window of reads
    expect(r.settle!.settled).toBe(true);
    expect(r.settle!.reads).toBeLessThanOrEqual(oneWindow(r.settle!.quietMs!));
  });

  it('waits for content that arrives after a spinner', async () => {
    const s = await open('DELAYED');
    const load = s.list.find((e) => e.label === 'LOAD')!;
    const r = await d.tap(load, { settle: SETTLE, read: 'tree', before: s.hash });
    expect(r.settle!.settled).toBe(true);
    expect(r.tree!.nodes.some((n) => n.t === 'RESULT 1' || n.t === 'Result 1')).toBe(true);
  });

  it('finds the system permission prompt and answers it', async () => {
    await d.shell(
      `pm revoke ${APP} android.permission.ACCESS_FINE_LOCATION; pm revoke ${APP} android.permission.ACCESS_COARSE_LOCATION`,
    );
    const s = await open('PERMISSION');
    await d.tap(find(s, 'REQUEST LOCATION')!, { settle: SETTLE, read: 'none' });
    let prompt: Screen | undefined;
    for (let i = 0; i < 20 && !prompt; i++) {
      const now = await screen();
      if (androidScreen.alertButton(now.elements, 'allow')) prompt = now;
      else await new Promise((r) => setTimeout(r, 200));
    }
    expect(prompt, 'permission prompt').toBeDefined();
    expect(prompt!.foreground).toMatch(/permissioncontroller/);
    const allow = androidScreen.alertButton(prompt!.elements, 'allow')!;
    await d.tap(allow, { settle: SETTLE, read: 'none' });
    expect(androidScreen.alertButton((await screen()).elements, 'allow')).toBeUndefined();
    expect(await d.shell(`dumpsys package ${APP} | grep ACCESS_FINE_LOCATION`)).toMatch(
      /granted=true/,
    );
  });

  it('reads the text of a web view', async () => {
    await open('WEB');
    let found = false;
    for (let i = 0; i < 25 && !found; i++) {
      const s = await screen();
      found = s.tree.nodes.some((n) => n.t === 'Web content' || n.d === 'Web content');
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
    await d.openUrl('appdyno-fixture://open/form', APP);
    let ok = false;
    for (let i = 0; i < 15 && !ok; i++) {
      ok = labels(await screen()).includes('Enter your details');
      if (!ok) await new Promise((r) => setTimeout(r, 200));
    }
    expect(ok).toBe(true);
  });

  it('audits the accessibility fixture: each known problem, nothing on the clean button', async () => {
    await home();
    await d.openUrl('appdyno-fixture://open/a11y', APP);
    // the audit samples a still screen: the tree shows the screen while its window still slides in
    // (an earlier test's screen changes when that ends), and a screenshot taken a moment after the
    // read has the icons elsewhere than the read's boxes. Its Compose view starts the first time on
    // this screen: up to 10 s on a slow emulator.
    await settledOn(/^continue$/i, 60);
    const r = await d.audit();
    const of = (id: string) =>
      r.issues.filter((i) => i.element?.id === `${APP}:id/${id}`).map((i) => i.type);
    expect(r.engine).toBe('rules');
    expect(of('a11y_faint')).toContain('contrast');
    expect(of('a11y_small')).toContain('hitRegion');
    expect(of('a11y_icon')).toContain('sufficientElementDescription');
    expect(of('a11y_faint_icon')).toContain('imageContrast');
    expect(of('a11y_add_1')).toContain('duplicateLabel');
    expect(of('a11y_cut')).toContain('textClipped');
    expect(of('a11y_ellipsized')).toContain('textClipped');
    for (const id of ['a11y_ok', 'a11y_name', 'a11y_price', 'title'])
      expect(of(id), id).toEqual([]);
    expect(r.elapsedMs).toBeLessThan(5_000);
    // the read the checks ran on carries the traversal hints: the price is read before the name above it
    const els = elementsOf(r.read!.tree, r.read!.traversal);
    const at = (id: string) => els.findIndex((e) => e.identifier === `${APP}:id/${id}`);
    expect(els[at('a11y_price')]!.traversalBefore).toBe(at('a11y_name'));
    // the tree says what a screen reader skips or reads as one unit: Compose's text is read, as one unit
    // (its ellipsis is not found: Compose reports its characters' places at another scale, a known gap)
    const t = await d.tree();
    const compose = t.nodes.find((n) => n.t?.startsWith('A very long product name in Compose'))!;
    expect(compose.f & NODE_FLAGS.notImportant).toBe(0);
    expect(compose.f & NODE_FLAGS.screenReaderFocusable).toBe(NODE_FLAGS.screenReaderFocusable);
  });

  const mocks = async () =>
    [...(await d.shell('dumpsys location')).matchAll(/^\s*(\w+) provider \[mock\]/gm)]
      .map((m) => m[1]!)
      .sort();

  it('sets a test location and removes only the providers it added', async () => {
    // a mock provider the device already had (another tool's): used, never removed
    // (setLocation allows the shell's mock locations for itself; an add before that would fail silently)
    await d.shell(
      'appops set com.android.shell android:mock_location allow; cmd location providers add-test-provider network',
    );
    await d.setLocation(41.0082, 28.9784);
    expect(await d.shell('dumpsys location | grep -c "41.008"')).not.toMatch(/^0/);
    expect(await mocks()).toEqual(['fused', 'gps', 'network']);
    await d.clearLocation();
    expect(await mocks()).toEqual(['network']);
    await d.shell('cmd location providers remove-test-provider network');
    expect(await mocks()).toEqual([]);
  });

  it('a host that died without clearing: the next agent start removes its test providers', async () => {
    await d.setLocation(41.0082, 28.9784);
    expect(await mocks()).toEqual(['fused', 'gps', 'network']);
    // the host that set them is gone (a process that ran and exited), and its agent with it
    const dead = spawnSync('true').pid!;
    await d.shell(`sed -i 's/^[0-9]*/${dead}/' ${TEST_LOCATION}`);
    agentMayGo();
    await new Adb().exec(serial!, `kill ${d.hello!.pid}`);
    const next = new AndroidDevice(serial!);
    try {
      await next.open();
      expect(next.lastStartWasCold).toBe(true);
      expect(await mocks()).toEqual([]);
    } finally {
      next.close();
    }
  });

  it('sees the app leave the foreground when it crashes, and starts it again', async () => {
    const s = await home();
    await d.tap(find(s, 'CRASH')!, { settle: SETTLE, read: 'none' });
    let fg: string | undefined = APP;
    for (let i = 0; i < 20 && fg === APP; i++) {
      await new Promise((r) => setTimeout(r, 200));
      fg = (await screen()).foreground;
    }
    expect(fg).not.toBe(APP);
    await answerSystemDialog(8_000);
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

  it('a touch on a dark screen is refused by its code, and lands once the host has woken it', async () => {
    const s = await home();
    await d.shell('input keyevent KEYCODE_SLEEP');
    await new Promise((r) => setTimeout(r, 1_500));
    await d.tap(find(s, 'FORM')!, { settle: SETTLE, read: 'none' });
    expect(labels(await d.read(APP))).toContain('Enter your details');
  });

  it('a dropped adb connection: a read waits for the device and finds the running agent again', async () => {
    const back = new AndroidDevice(serial!, new Adb(), { reconnectWaitMs: 30_000 });
    await back.open();
    const pid = back.hello!.pid;
    await new Adb().run(['-s', serial!, 'reconnect'], 30_000);
    const s = await back.read(APP);
    expect(s.list.length).toBeGreaterThan(0);
    expect(back.hello!.pid).toBe(pid); // the same agent, reconnected, not restarted
    back.close();
  });

  it('lets its UI automation go while no host is connected and takes it again on the next request', async () => {
    const bound = async () => (await d.shell('dumpsys accessibility')).includes('Ui Automation[');
    await d.tree();
    expect(await bound()).toBe(true);
    d.close();
    // no host: after the grace, accessibility is off in the apps (an app starting meanwhile pays nothing)
    let off = false;
    for (let i = 0; i < 20 && !off; i++) {
      await new Promise((r) => setTimeout(r, 500));
      off = !(await bound());
    }
    expect(off).toBe(true);
    // the next request opens it again: the same agent, the screen read as before
    const pid = d.hello!.pid;
    const t = await d.tree();
    expect(t.nodes.length).toBeGreaterThan(3);
    expect(await bound()).toBe(true);
    expect(d.hello!.pid).toBe(pid);
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
    agentMayGo();
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

  it('takes UI automation over from an agent killed a moment ago, which the system keeps for about 2 s', async () => {
    await d.read(APP);
    agentMayGo();
    await d.shell(`kill -9 ${d.hello!.pid}`);
    expect(labels(await d.read(APP)).length).toBeGreaterThan(0);
  });

  it('stays answerable while the app hangs its main thread', async () => {
    const s = await home();
    await d.tap(find(s, 'FREEZE')!, { settle: false });
    const t = Date.now();
    const r = await d.tree().then(
      (x) => ({ ok: true as const, truncated: x.truncated }),
      (e: unknown) => ({ ok: false as const, code: (e as DeviceError).code }),
    );
    const ms = Date.now() - t;
    // a hung app cannot answer accessibility calls: the read comes back, or fails with a typed reason
    // inside its deadline (nothing to read: NOT_FOUND, never an empty screen), never hangs
    expect(ms).toBeLessThan(17_000);
    if (!r.ok) expect(['TIMEOUT', 'NOT_FOUND']).toContain(r.code);
    // the app answers again after its 12 s hang
    for (let i = 0; i < 30; i++) {
      const ok = await d
        .read(APP)
        .then((x) => x.foreground === APP && x.list.length > 3)
        .catch(() => false);
      if (ok) break;
      await new Promise((r) => setTimeout(r, 1_000));
    }
    await answerSystemDialog(serial?.startsWith('emulator-') ? 8_000 : 15_000);
    await d.shell('input keyevent KEYCODE_BACK');
    await home();
  }, 90_000);
});
