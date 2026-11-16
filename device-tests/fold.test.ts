import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Adb,
  AndroidDevice,
  androidProvider,
  IosSimulatorDevice,
  MirrorSession,
  simDisplays,
  Simctl,
  simulatorProvider,
  viewerBinary,
  ViewerProcess,
} from './workspace.js';
import { untilWithin } from './until.js';
import { opsOn, SIM_FIXTURE, type Answer, type Call } from './helpers.js';

/**
 * A fold as the device and an app see it, on the fixture's fold screen, which shows its own window, size class and
 * posture: after each change, after the app starts again, after `restore` and after the session's end. On the foldable
 * emulator APPDYNO_ANDROID_SERIAL names (a Pixel Fold profile, API 31+) and the foldable simulator APPDYNO_IOS_UDID
 * names (an iPhone Duo, booted closed, with an Xcode that has its runtime): any other device is skipped.
 */
const APP = 'dev.appdyno.fixture';
const FOLD = 'appdyno-fixture://open/fold';
const FOLD_KEPT = 'appdyno-fixture://open/fold_kept';
const ANDROID = process.env.APPDYNO_ANDROID_SERIAL ?? '';
const SIMULATOR = process.env.APPDYNO_IOS_UDID ?? '';
/** A simulator with two built-in displays: only such a one folds. */
const DUO = SIMULATOR && (await simDisplays(SIMULATOR)).length > 1 ? SIMULATOR : '';

const adb = (command: string) =>
  execFileSync('adb', ['-s', ANDROID, 'shell', command], { encoding: 'utf8' }).trim();
const FOLDABLE =
  ANDROID.startsWith('emulator-') &&
  adb('cmd device_state print-states 2>&1 || true').includes("name='CLOSED'");

const ok = <A extends Answer>(r: A) => {
  expect(r.error ? r.text : '').toBe('');
  return r;
};
const shows = async (call: Call, id: string, text: string) =>
  ok(await call('wait_for', { selector: { id, text }, timeoutMs: 8_000 })).data.met;
const labelOf = async (call: Call, id: string) =>
  ok(await call('find', { selector: { id } })).data.matches[0]?.label;
const fold = (call: Call, value?: string) =>
  call('device_setting', { name: 'fold', ...(value && { value }) });
/** The request the device holds, as it says it itself. */
const override = () => /mOverrideState=(.*)/.exec(adb('dumpsys device_state'))?.[1];

describe.skipIf(!FOLDABLE)('a fold on a foldable emulator', () => {
  let o: ReturnType<typeof opsOn>;
  let call: Call;
  beforeAll(async () => {
    o = opsOn(androidProvider(new Adb()), ANDROID, APP);
    call = o.call;
    ok(await call('launch_app', { read: 'none' }));
  }, 300_000);
  afterAll(async () => {
    await call('device_setting', { name: 'restore' });
    o.ctx.close();
  });

  it('reads where the device is, with every pose it lists', async () => {
    const read = ok(await fold(call));
    expect(read.data.value).toBe('default (now open)');
    const poses = /; of (.*)$/.exec(read.text)?.[1] ?? '';
    expect(read.text).toBe(`fold: default (now open); of ${poses}`);
    expect(poses.split(', ')).toEqual(expect.arrayContaining(['closed', 'half_opened', 'open']));
    expect((await fold(call, 'flat')).text).toContain(`fold: ${poses}, not flat`);
  });

  it('answers each change with the display and what became of the activity, and the app sees it', async () => {
    ok(await call('open_link', { url: FOLD, read: 'none' }));
    expect(await shows(call, 'fold_posture', 'Posture: flat')).toBe(true);
    const open = await labelOf(call, 'fold_window');

    const closed = ok(await fold(call, 'closed'));
    expect(closed.text).toMatch(
      /^fold: closed; display \d+x\d+ at \d+ dpi; dev\.appdyno\.fixture\/\.FoldActivity was recreated; put back/,
    );
    expect(closed.data.reads).toEqual({ fold: 'closed' });
    expect(override()).toContain("name='CLOSED'");
    expect(await shows(call, 'fold_posture', 'Posture: no fold in this window')).toBe(true);
    expect(await shows(call, 'fold_size_class', 'Size class: compact wide')).toBe(true);
    const cover = await labelOf(call, 'fold_window');
    expect(cover).not.toBe(open);
    // the display the answer names is the window the app has
    expect(cover).toContain(`Window ${String(/display (\d+x\d+)/.exec(closed.text)?.[1])} px`);
    // and the picture of the screen is of that display, whole
    const file = join(mkdtempSync(join(tmpdir(), 'appdyno-fold-')), 'cover.png');
    ok(await call('take_screenshot', { file, inline: false }));
    const png = readFileSync(file);
    expect(`${String(png.readUInt32BE(16))}x${String(png.readUInt32BE(20))}`).toBe(
      /display (\d+x\d+)/.exec(closed.text)?.[1],
    );

    // half open by a person's word for it: the inner display again, and the hinge half way
    const half = ok(await fold(call, 'half'));
    expect(half.text).toContain('FoldActivity was recreated');
    expect(half.data.reads).toEqual({ fold: 'half_opened' });
    expect(await shows(call, 'fold_posture', 'Posture: half opened')).toBe(true);
    expect(await labelOf(call, 'fold_window')).toBe(open);

    // the same display, so nothing is made anew
    const flat = ok(await fold(call, 'open'));
    expect(flat.text).toContain('FoldActivity was kept');
    expect(await shows(call, 'fold_posture', 'Posture: flat')).toBe(true);
    expect((await fold(call)).data.value).toBe('open');
  });

  it('says an activity that takes the change itself was kept', async () => {
    ok(await fold(call, 'open'));
    ok(await call('open_link', { url: FOLD_KEPT, read: 'none' }));
    expect(await shows(call, 'fold_size_class', 'Size class: expanded wide')).toBe(true);
    const made = await labelOf(call, 'fold_created');
    expect(ok(await fold(call, 'closed')).text).toContain('FoldKeptActivity was kept');
    expect(await shows(call, 'fold_size_class', 'Size class: compact wide')).toBe(true);
    expect(await labelOf(call, 'fold_created')).toBe(made);
  });

  it('holds the pose over a restart of the app, and restore puts the device back where its hinge is', async () => {
    ok(await fold(call, 'closed'));
    ok(await call('manage_app', { action: 'stop' }));
    ok(await call('launch_app', { read: 'none' }));
    ok(await call('open_link', { url: FOLD, read: 'none' }));
    expect(await shows(call, 'fold_size_class', 'Size class: compact wide')).toBe(true);
    expect((await fold(call)).data.value).toBe('closed');

    const back = ok(await call('device_setting', { name: 'restore' }));
    expect(back.text).toContain('fold: default (now open)');
    expect(override()).toBe('Optional.empty');
    expect((await fold(call)).data.value).toBe('default (now open)');
    expect(await shows(call, 'fold_posture', 'Posture: flat')).toBe(true);
  });

  it("shows a person's window the display in use at its size, and takes their touch on it", async () => {
    const until = untilWithin(60_000);
    const device = new AndroidDevice(ANDROID, new Adb());
    const session = new MirrorSession({
      mirror: device.mirror,
      viewer: async () => new ViewerProcess(await viewerBinary(), ['--headless']),
      options: { quality: 'auto' },
      title: 'a fold',
    });
    const size = () => adb('wm size').replace(/.*: /s, '');
    const picture = () =>
      `${String(session.status.picture?.w)}x${String(session.status.picture?.h)}`;
    /** A person's tap on the fixture's home, at its Dialog button, as a fraction of the picture. */
    const tapDialog = async () => {
      ok(await call('manage_app', { action: 'stop' }));
      ok(await call('launch_app', { read: 'none' }));
      const at = ok(await call('find', { selector: { text: 'DIALOG' } })).data.matches[0];
      const [w, h] = size().split('x').map(Number);
      expect(at && w && h && true).toBe(true);
      const [x, y] = [Number(at?.x) / Number(w), Number(at?.y) / Number(h)];
      session.send({ kind: 'touch', p: 0, x, y });
      await new Promise((r) => setTimeout(r, 80));
      session.send({ kind: 'touch', p: 2, x, y });
      return ok(await call('wait_for', { selector: { text: 'OPEN DIALOG' }, timeoutMs: 8_000 }))
        .data.met;
    };
    ok(await fold(call, 'open'));
    await session.start();
    try {
      await until('the inner display', () => session.status.state === 'live');
      const open = size();
      await until('its size', () => picture() === open);
      expect(await tapDialog()).toBe(true);
      // closed by the agent's call while the person's window is up: the window follows to the cover's size
      ok(await fold(call, 'closed'));
      const cover = size();
      expect(cover).not.toBe(open);
      // the emulator draws the cover stretched into the inner display's frame, so the guest's own picture is taken:
      // smaller, and of the cover's shape
      await until('the cover', () => {
        const [w, h] = cover.split('x').map(Number);
        const p = session.status.picture;
        return !!p && Math.abs(p.w / p.h - Number(w) / Number(h)) < 0.02;
      });
      expect(session.status.state).toBe('live');
      expect(await tapDialog()).toBe(true);
      ok(await fold(call, 'half'));
      await until('the inner display again', () => picture() === open);
      expect(await tapDialog()).toBe(true);
    } finally {
      await session.stop('the test ended');
      device.close();
    }
  }, 240_000);

  it('puts the pose back when the session ends', async () => {
    ok(await fold(call, 'half_opened'));
    expect(override()).toContain("name='HALF_OPENED'");
    expect(await o.ctx.end()).toEqual([]);
    expect(override()).toBe('Optional.empty');
    expect(adb('cmd device_state print-state')).toBe(
      /mBaseState=Optional\[DeviceState\{identifier=(\d+)/.exec(adb('dumpsys device_state'))?.[1],
    );
  });
});

describe.skipIf(!DUO)('a fold on a foldable simulator', () => {
  let o: ReturnType<typeof opsOn>;
  let call: Call;
  const shots = mkdtempSync(join(tmpdir(), 'appdyno-fold-'));
  /** Which built-in display is the active one, as devicectl says it: 1 is the cover, 3 the inner one. */
  const active = async () => (await simDisplays(DUO)).find((d) => d.active)?.id;
  /** The size of a full picture of the screen, from the PNG's own header. */
  const pictured = async (name: string) => {
    const file = join(shots, `${name}.png`);
    ok(await call('take_screenshot', { file, inline: false, overwrite: true }));
    const png = readFileSync(file);
    return `${String(png.readUInt32BE(16))}x${String(png.readUInt32BE(20))}`;
  };
  /** A tap on the fixture's home that opens its Dialog screen: proof that a touch lands on the display shown. */
  const tapOpensDialog = async () => {
    ok(await call('manage_app', { action: 'stop' }));
    ok(await call('launch_app', { read: 'none' }));
    ok(await call('tap', { selector: { text: 'Dialog' } }));
    return ok(await call('wait_for', { selector: { text: 'Open dialog' }, timeoutMs: 8_000 })).data
      .met;
  };

  beforeAll(async () => {
    await new Simctl().install(DUO, SIM_FIXTURE);
    o = opsOn(simulatorProvider(), DUO, APP);
    call = o.call;
    ok(await call('launch_app', { read: 'none' }));
  }, 300_000);
  afterAll(async () => {
    await call('device_setting', { name: 'restore' });
    o.ctx.close();
  });

  it('reads closed as it boots, with the three poses it takes, and reads, taps and pictures the cover', async () => {
    const read = ok(await fold(call));
    expect(read.text).toBe('fold: closed; of closed, half, open');
    expect(await active()).toBe(1);
    ok(await call('open_link', { url: FOLD, read: 'none' }));
    expect(await shows(call, 'fold_window', 'Window 466x678 points')).toBe(true);
    expect(await shows(call, 'fold_size_class', 'Size class: compact wide, regular high')).toBe(
      true,
    );
    expect(await shows(call, 'fold_posture', 'Posture: closed')).toBe(true);
    expect(await pictured('closed')).toBe('1398x2034');
    expect(await tapOpensDialog()).toBe(true);
  });

  it('opens: the inner display, a regular width in the same process, and a read, a tap and a picture of it', async () => {
    ok(await call('open_link', { url: FOLD, read: 'none' }));
    const process = await labelOf(call, 'fold_created');
    const open = ok(await fold(call, 'open'));
    expect(open.text).toMatch(
      /^fold: open; display 2007x2853 at 3x; an app keeps its process, and its scene moves to this display; put back/,
    );
    expect(open.data.reads).toEqual({ fold: 'open' });
    expect(await active()).toBe(3);
    // at once, with no look between: the screen is the inner display's, and so is the small picture an answer shows
    expect(ok(await call('list_devices', { selected: true })).text).toContain(
      'screen 951x669, density 3',
    );
    expect(ok(await call('take_screenshot', { inline: false })).text).toMatch(/^image 800x56\d px/);
    expect(await shows(call, 'fold_window', 'Window 951x669 points')).toBe(true);
    expect(await shows(call, 'fold_size_class', 'Size class: regular wide, regular high')).toBe(
      true,
    );
    expect(await shows(call, 'fold_posture', 'Posture: fully open')).toBe(true);
    expect(await labelOf(call, 'fold_created')).toBe(process);
    expect(await pictured('open')).toBe('2853x2007');
    expect(await tapOpensDialog()).toBe(true);
  });

  it('stands half open on the inner display, read as half, and closes again', async () => {
    ok(await call('open_link', { url: FOLD, read: 'none' }));
    const half = ok(await fold(call, 'half'));
    expect(half.data.reads).toEqual({ fold: 'half' });
    expect(await active()).toBe(3);
    expect(await shows(call, 'fold_posture', 'Posture: partially open')).toBe(true);
    expect(await shows(call, 'fold_window', 'Window 951x669 points')).toBe(true);
    const closed = ok(await fold(call, 'closed'));
    expect(closed.text).toContain('display 1398x2034 at 3x');
    expect(await active()).toBe(1);
    expect(await shows(call, 'fold_window', 'Window 466x678 points')).toBe(true);
    expect(await shows(call, 'fold_posture', 'Posture: closed')).toBe(true);
    // a touch goes to the cover again, with no word to this session that the display changed
    expect(await tapOpensDialog()).toBe(true);
  });

  it('holds the pose over a restart of the app, and restore closes it as it was found', async () => {
    ok(await fold(call, 'open'));
    ok(await call('manage_app', { action: 'stop' }));
    ok(await call('launch_app', { read: 'none' }));
    ok(await call('open_link', { url: FOLD, read: 'none' }));
    expect(await shows(call, 'fold_window', 'Window 951x669 points')).toBe(true);
    expect((await fold(call)).data.value).toBe('open');
    const back = ok(await call('device_setting', { name: 'restore' }));
    expect(back.text).toContain('fold: closed');
    expect(await active()).toBe(1);
    expect((await fold(call)).data.value).toBe('closed');
    expect(await shows(call, 'fold_window', 'Window 466x678 points')).toBe(true);
  });

  it("shows a person's window the display that is shown, stood up, and takes their touch on it", async () => {
    const until = untilWithin(30_000);
    const device = new IosSimulatorDevice(DUO);
    const session = new MirrorSession({
      mirror: device.mirror,
      viewer: async () => new ViewerProcess(await viewerBinary(), ['--headless']),
      options: { quality: 'auto' },
      title: 'a fold',
    });
    const picture = () =>
      `${String(session.status.picture?.w)}x${String(session.status.picture?.h)}`;
    /** A person's tap on the fixture's home, at the Dialog row, as a fraction of the picture. */
    const tapDialog = async () => {
      ok(await call('manage_app', { action: 'stop' }));
      const home = ok(await call('launch_app'));
      const at = ok(await call('find', { selector: { text: 'Dialog' } })).data.matches[0];
      const size = /screen (\d+)x(\d+)/.exec(
        ok(await call('list_devices', { selected: true })).text,
      );
      expect([home.error, at && size && true]).toEqual([false, true]);
      const [x, y] = [Number(at?.x) / Number(size?.[1]), Number(at?.y) / Number(size?.[2])];
      session.send({ kind: 'touch', p: 0, x, y });
      await new Promise((r) => setTimeout(r, 80));
      session.send({ kind: 'touch', p: 2, x, y });
      return ok(await call('wait_for', { selector: { text: 'Open dialog' }, timeoutMs: 8_000 }))
        .data.met;
    };
    await session.start();
    try {
      await until('the cover', () => session.status.state === 'live' && picture() === '1398x2034');
      expect(await tapDialog()).toBe(true);
      // opened by the agent's call while the person's window is up: the window follows, with no reconnect
      ok(await fold(call, 'open'));
      await until('the inner display, stood up', () => picture() === '2853x2007');
      expect(session.status.state).toBe('live');
      expect(await tapDialog()).toBe(true);
      ok(await fold(call, 'closed'));
      await until('the cover again', () => picture() === '1398x2034');
      expect(await tapDialog()).toBe(true);
      expect(session.status.inputFailed).toBe(0);
      // a window opened on the device already open, its screen still: no frame comes to find the display by
      ok(await fold(call, 'open'));
      await session.stop('to open another');
      await new Promise((r) => setTimeout(r, 3_000));
      await session.start();
      await until('the inner display from the start', () => picture() === '2853x2007');
    } finally {
      await session.stop('the test ended');
      device.close();
    }
  }, 240_000);

  it('puts the pose back when the session ends', async () => {
    ok(await fold(call, 'half'));
    expect(await active()).toBe(3);
    expect(await o.ctx.end()).toEqual([]);
    expect(await active()).toBe(1);
  });
});
