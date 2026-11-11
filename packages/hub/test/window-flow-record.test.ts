import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MirrorSession, must } from '@appdyno/core';
import { parseFlow } from '@appdyno/flows';
import { type Adb, AndroidMirror, EmulatorMirror } from '@appdyno/driver-android';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeMirror, FakeViewer, flush } from '@appdyno/testing/mirror-fakes.js';
import { WithKeyboard } from '@appdyno/testing/fake-device.js';
import { flowRecordings, flowsFor } from '@appdyno/ops';
import { PASSWORD, nextSerial, setup, FORM_BUTTON, SEND } from './window-setup.js';

const home = mkdtempSync(join(tmpdir(), 'appdyno-window-flow-'));

vi.mock('node:os', async (real) => ({
  ...(await real<typeof import('node:os')>()),
  homedir: () => home,
}));

afterAll(() => rmSync(home, { recursive: true, force: true }));

describe('a flow recorded in a window', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    for (const f of readdirSync(join(home, 'Desktop'), { withFileTypes: true }))
      rmSync(join(f.parentPath, f.name));
  });

  it('names each click by the element on the screen it landed on, not the next one', async () => {
    const t = setup();
    await t.toggle();
    await t.click(FORM_BUTTON.x, FORM_BUTTON.y);
    await t.click(SEND.x, SEND.y);
    expect(t.lines()).toEqual([
      'launch',
      'tap role=button text="Form"',
      'tap role=button text="Gönder"',
    ]);
    await t.toggle();
    const { text } = t.saved();
    expect(text).toContain('app dev.app');
    expect(parseFlow(text).steps).toHaveLength(3);
  });

  it('replays what it wrote, through flow', async () => {
    const t = setup();
    await t.toggle();
    await t.click(FORM_BUTTON.x, FORM_BUTTON.y);
    await t.click(SEND.x, SEND.y);
    await t.toggle();
    const { file } = t.saved();
    vi.useRealTimers();
    t.device.screen = 'home';
    const r = await flowsFor(t.ctx).replay(file);
    expect(r.failure).toBeUndefined();
    expect(t.device.screen).toBe('sent');
  }, 30_000);

  it('writes the first step on the device with no read of the screen after the touch', async () => {
    const t = setup();
    await t.toggle();
    const reads = () => t.device.calls.filter((c) => c.name === 'tree').length;
    t.touch(0, FORM_BUTTON.x, FORM_BUTTON.y);
    const before = reads();
    t.touch(2, FORM_BUTTON.x, FORM_BUTTON.y);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.lines().at(-1)).toBe('tap role=button text="Form"');
    expect(reads()).toBe(before);
  });

  it('holds no touch behind a read that does not end', async () => {
    const t = setup();
    await t.toggle();
    t.device.tree = () => new Promise(() => undefined);
    const mirror = new FakeMirror();
    const viewer = new FakeViewer();
    const session = new MirrorSession({
      mirror,
      viewer: () => Promise.resolve(viewer),
      options: { quality: 'auto' },
      title: 'a device',
      onInput: t.flow.input,
    });
    vi.useRealTimers();
    await session.start();
    await flush();
    viewer.say('first', { w: 1080, h: 2400, codec: 'h264' });
    viewer.say('touch', { p: 0, x: 0.5, y: 0.2 });
    viewer.say('touch', { p: 2, x: 0.5, y: 0.2 });
    await flush();
    expect(mirror.inputs.map((e) => (e as { p: number }).p)).toEqual([0, 2]);
    await session.stop('done');
  });

  it('never writes a password, into a field it was told is one or one it only saw focused', async () => {
    const t = setup();
    t.device.screen = 'login';
    await t.toggle();
    await t.click(540, 350);
    await t.type(PASSWORD);
    await t.click(250, 550);
    await t.toggle();
    const { text } = t.saved();
    expect(text).not.toContain(PASSWORD);
    expect(text).toContain('secret PASS');
    expect(text).toContain('type "${PASS}" replace');
    expect(JSON.stringify(flowRecordings.read(t.device.serial))).not.toContain(PASSWORD);
  });

  it('keeps text out of the file when no read says what it went into', async () => {
    const t = setup();
    await t.toggle();
    await t.type('whoever knows');
    await t.press('home');
    await t.toggle();
    expect(t.saved().text).toContain('type "${TYPED}"');
    expect(t.saved().text).not.toContain('whoever');
    expect(t.notes().join()).toContain('Typed into nothing the screen names');
  });

  it('types one step of a word, with what a person took back and what submitted it', async () => {
    const t = setup();
    t.device.screen = 'login';
    await t.toggle();
    await t.click(540, 150);
    await t.type('adaa');
    t.key(0x2a);
    t.key(0x28);
    await t.settle();
    expect(t.lines().at(-1)).toBe('type "ada" replace submit');
  });

  it('writes what is still being typed when the recording stops', async () => {
    const t = setup();
    t.device.screen = 'login';
    await t.toggle();
    await t.click(540, 150);
    await t.type('ada');
    await t.toggle();
    expect(t.saved().text).toContain('type "ada" replace');
  });

  it('adds to what a field held, as a person did', async () => {
    const t = setup();
    t.device.screen = 'login';
    const was = t.device.current.bind(t.device);
    t.device.current = () => {
      const tree = was();
      must(
        tree.nodes.find((n) => n.id === 'dev.app:id/user'),
        'the user field',
      ).t = 'ad';
      return tree;
    };
    await t.toggle();
    await t.click(540, 150);
    await t.type('a');
    await t.press('home');
    expect(t.lines().at(-2)).toBe('type "a"');
  });

  it('writes a hold as a long press, and a double click as one double tap', async () => {
    const t = setup();
    await t.toggle();
    await t.click(540, 150, 1_300);
    expect(t.lines().at(-1)).toBe('long_press text="Ana sayfa" durationMs=1300');
    t.touch(0, 540, 550);
    t.touch(2, 540, 550);
    await vi.advanceTimersByTimeAsync(100);
    t.touch(0, 540, 550);
    t.touch(2, 540, 550);
    await t.settle();
    expect(t.lines().at(-1)).toBe('double_tap role=button text="İzin"');
    expect(t.lines().filter((l) => l.includes('İzin'))).toHaveLength(1);
    // the file is what is replayed, not what the pane was told
    await t.toggle();
    expect(t.saved().text).toContain('double_tap role=button text="İzin"');
    expect(t.saved().text).not.toContain('\ntap role=button text="İzin"');
  });

  it('writes a swipe with no target where one from the middle does the same', async () => {
    const t = setup();
    await t.toggle();
    await t.drag(540, 1500, 540, 900);
    expect(t.lines().at(-1)).toBe('swipe up');
  });

  it('takes a wheel for one swipe, however many notches it sent', async () => {
    const t = setup();
    await t.toggle();
    for (let i = 0; i < 6; i++) {
      t.touch(0, 540, 1500, { wheel: true });
      t.touch(1, 540, 1480, { wheel: true });
      t.touch(2, 540, 1480, { wheel: true });
      await vi.advanceTimersByTimeAsync(100);
    }
    await t.settle();
    expect(t.lines().filter((l) => l.startsWith('swipe'))).toEqual(['swipe up']);
  });

  it('writes swipes that reached what was tapped next as a scroll to it: that holds on any screen', async () => {
    const t = setup();
    await t.toggle();
    t.device.screen = 'settings';
    await t.settle();
    await t.drag(540, 1500, 540, 900);
    await t.drag(540, 1500, 540, 900);
    t.device.screen = 'home';
    await t.settle();
    await t.click(FORM_BUTTON.x, FORM_BUTTON.y);
    expect(t.lines()).toEqual([
      'launch',
      'scroll_to role=button text="Form"',
      'tap role=button text="Form"',
    ]);
    await t.toggle();
    expect(t.saved().text).toContain('scroll_to role=button text="Form"');
    expect(t.saved().text).not.toContain('swipe');
  });

  it('keeps a swipe when what came next was on the screen all along', async () => {
    const t = setup();
    await t.toggle();
    await t.drag(540, 1500, 540, 900);
    await t.click(FORM_BUTTON.x, FORM_BUTTON.y);
    expect(t.lines().slice(1)).toEqual(['swipe up', 'tap role=button text="Form"']);
  });

  it('gives a swipe from the edge as coordinates, and says so', async () => {
    const t = setup();
    await t.toggle();
    await t.drag(540, 2395, 540, 1600);
    expect(t.lines().at(-1)).toBe('swipe up x=540 y=2395 screen=1080x2400 !coordinates');
    expect(t.notes().at(-1)).toContain('Written as coordinates');
  });

  it('marks and tells a click that nothing names', async () => {
    const t = setup();
    await t.toggle();
    await t.click(540, 2000);
    expect(t.lines().at(-1)).toBe('tap x=540 y=2000 screen=1080x2400 !coordinates');
    expect(t.notes().at(-1)).toContain('Written as coordinates');
  });

  it('writes Home, Back and a key as steps', async () => {
    const t = setup();
    await t.toggle();
    await t.press('home');
    await t.press('back');
    await t.press('volumeUp');
    await t.press('controlCenter');
    t.key(0x4f);
    t.key(0x4f);
    await t.settle();
    expect(t.lines().slice(1)).toEqual([
      'press_key home',
      'press_key back',
      'press_key volume_up',
      'press_key control_center',
      'press_key arrow_right count=2',
    ]);
    await t.toggle();
    expect(t.saved().text).toContain('press_key arrow_right count=2');
  });

  it('writes the key an Android window was sent: Esc is Back, as a replay must be', async () => {
    const t = setup();
    t.device.mirror = new EmulatorMirror(
      'emulator-1',
      new AndroidMirror({} as Adb, 'x', {} as never),
    );
    await t.toggle();
    t.key(0x29);
    await t.settle();
    t.key(0x52);
    t.key(0x4a);
    await t.settle();
    expect(t.lines().slice(1)).toEqual([
      'press_key back',
      'press_key arrow_up',
      'unrecorded "a key with no step"',
    ]);
  });

  it.each([
    ['rotateLeft', 'rotate left'],
    ['quickSettings', 'quick settings'],
  ])('says %s has no step at that moment, and stops a replay there', async (name, words) => {
    const t = setup();
    await t.toggle();
    await t.press(name);
    expect(t.lines().at(-1)).toBe(`unrecorded "${words}"`);
    expect(t.notes().at(-1)).toBe(`Not a step: ${words}. A replay stops there.`);
  });

  it('says a pinch has no step', async () => {
    const t = setup();
    await t.toggle();
    t.touch(0, 400, 1000, { x2: 0.6, y2: 0.4 });
    t.touch(1, 300, 1000, { x2: 0.7, y2: 0.4 });
    t.touch(2, 300, 1000, { x2: 0.7, y2: 0.4 });
    await t.settle();
    expect(t.lines().at(-1)).toBe('unrecorded "pinch"');
  });

  describe('on the on-screen keyboard', () => {
    const open = () => {
      const device = new WithKeyboard(nextSerial());
      device.screen = 'login';
      return setup(device);
    };

    it('writes what a field came to, and no tap of any key', async () => {
      const t = open();
      await t.toggle();
      await t.click(540, 150);
      await t.click(100, 1700);
      await t.click(200, 1700);
      t.device.current = ((was) => () => {
        const tree = was();
        must(
          tree.nodes.find((n) => n.id === 'dev.app:id/user'),
          'the user field',
        ).t = 'hi';
        return tree;
      })(t.device.current.bind(t.device));
      await t.settle();
      await t.click(250, 550);
      expect(t.lines()).toEqual([
        'tap id=user',
        'type "hi" replace',
        expect.stringContaining('tap role=button text="Add"'),
      ]);
      expect(t.notes().join()).toContain("Typed on the device's keyboard");
    });

    it('writes a password typed on it as a name, with no key of it in the file', async () => {
      const t = open();
      await t.toggle();
      await t.click(540, 350);
      await t.click(100, 1700);
      await t.click(200, 1700);
      await t.toggle();
      const { text } = t.saved();
      expect(text).toContain('secret PASS');
      expect(text).toContain('type "${PASS}" replace');
      expect(text).not.toContain('x=100');
    });
  });

  it('writes an app launched or quit from the Apps pane, and says what it cannot', async () => {
    const t = setup();
    await t.toggle();
    expect(t.flow.onWindow({ op: 'app', action: 'launch', id: 'dev.other' })).toBe(false);
    expect(t.flow.onWindow({ op: 'app', action: 'quit', id: 'dev.app' })).toBe(false);
    expect(t.flow.onWindow({ op: 'app', action: 'list' })).toBe(false);
    await t.settle();
    expect(t.lines().slice(1)).toEqual(['launch "dev.other"', 'stop']);
  });

  it('refuses a measure while it records, by name', async () => {
    const t = setup();
    expect(t.flow.onWindow({ op: 'control', name: 'measureLaunch' })).toBe(false);
    await t.toggle();
    expect(t.flow.onWindow({ op: 'control', name: 'measureLaunch' })).toBe(true);
    expect(t.notes().at(-1)).toContain('stop the recording first');
  });

  it('reads nothing with nothing in use, while the stream is down, or while a measure runs', async () => {
    const t = setup();
    const reads = () => t.device.calls.filter((c) => c.name === 'tree').length;
    await t.settle();
    expect(reads()).toBe(0);
    t.flow.onWindow({ op: 'inspect', on: true });
    await t.settle();
    expect(reads()).toBeGreaterThan(0);
    t.status.state = 'waiting';
    await t.settle();
    const down = reads();
    await t.settle();
    expect(reads()).toBe(down);
    t.status.state = 'live';
    t.measure(true);
    await t.settle();
    expect(reads()).toBe(down);
    t.measure(false);
    t.flow.onWindow({ op: 'inspect', on: false });
    await t.settle();
    const off = reads();
    await t.settle();
    expect(reads()).toBe(off);
  });

  it('reads only as a look, which wakes nothing and unlocks nothing', async () => {
    const t = setup();
    const asked: unknown[] = [];
    const tree = t.device.tree.bind(t.device);
    t.device.tree = async (opts?: unknown) => {
      asked.push(opts);
      return tree();
    };
    await t.toggle();
    t.flow.onWindow({ op: 'inspect', on: true });
    await t.settle();
    await t.toggle();
    expect(asked.length).toBeGreaterThan(1);
    expect(new Set(asked.map((o) => JSON.stringify(o)))).toEqual(
      new Set([JSON.stringify({ asItIs: true })]),
    );
  });

  it('takes one press of Stop, however many a person gave', async () => {
    const t = setup();
    await t.toggle();
    await t.click(FORM_BUTTON.x, FORM_BUTTON.y);
    t.flow.onWindow({ op: 'control', name: 'recordFlow' });
    t.flow.onWindow({ op: 'control', name: 'recordFlow' });
    await t.settle();
    expect(t.notes().filter((n) => n.startsWith('Saved'))).toHaveLength(1);
  });

  it('takes a recording that an agent started, and lets go when it stops', async () => {
    const t = setup();
    flowRecordings.write(t.device.serial, {
      serial: t.device.serial,
      running: true,
      steps: [],
      known: [],
    });
    t.flow.follow();
    await t.settle();
    await t.click(FORM_BUTTON.x, FORM_BUTTON.y);
    expect(flowRecordings.read(t.device.serial)?.steps.map((s) => s.action)).toEqual(['tap']);
    flowRecordings.write(t.device.serial, {
      ...must(flowRecordings.read(t.device.serial), 'the recording'),
      running: false,
    });
    t.flow.follow();
    await t.click(SEND.x, SEND.y);
    expect(flowRecordings.read(t.device.serial)?.steps).toHaveLength(1);
  });

  it('keeps what was recorded when the window closes', async () => {
    const t = setup();
    await t.toggle();
    await t.click(FORM_BUTTON.x, FORM_BUTTON.y);
    await t.flow.end();
    expect(readdirSync(join(home, 'Desktop')).filter((f) => f.endsWith('.flow'))).toHaveLength(1);
    expect(flowRecordings.read(t.device.serial)?.running).toBe(false);
  });

  it('says nothing was recorded, and leaves no file, where nothing was', async () => {
    const t = setup();
    await t.toggle();
    await t.toggle();
    expect(t.notes().at(-1)).toBe('Nothing was recorded');
    expect(readdirSync(join(home, 'Desktop')).filter((f) => f.endsWith('.flow'))).toEqual([]);
  });

  it('says why a recording could not start', async () => {
    const t = setup();
    t.device.tree = () => Promise.reject(new Error('no window to read'));
    await t.toggle();
    expect(t.notes().at(-1)).toBe('No recording: no window to read');
    expect(t.device.serial && flowRecordings.read(t.device.serial)).toBeUndefined();
  });
});
