import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Adb, androidProvider } from './workspace.js';
import { opsOn, type Answer, type Call } from './helpers.js';

/**
 * A fold as the device and an app see it, on the fixture's fold screen, which shows its own window, size class and
 * posture: after each change, after the app starts again, after `restore` and after the session's end. On the foldable
 * emulator APPDYNO_ANDROID_SERIAL names (a Pixel Fold profile, API 31+): any other device is skipped.
 */
const APP = 'dev.appdyno.fixture';
const FOLD = 'appdyno-fixture://open/fold';
const FOLD_KEPT = 'appdyno-fixture://open/fold_kept';
const ANDROID = process.env.APPDYNO_ANDROID_SERIAL ?? '';

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
    ok(await call('terminate_app'));
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
