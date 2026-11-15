import { NoViewProbe, type ViewTree } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { describe, expect, it } from 'vitest';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { connect } from './shared.js';

const SCREEN = { x: 0, y: 0, width: 1080, height: 2400 };

const TREE: ViewTree = {
  truncated: false,
  views: [
    { class: 'com.android.internal.policy.DecorView', rect: SCREEN },
    { class: 'androidx.compose.ui.platform.ComposeView', rect: SCREEN, parent: 0 },
    {
      class: 'android.view.View',
      rect: { x: 40, y: 600, width: 1000, height: 120 },
      label: 'Pay',
      text: 'card hunter2',
      id: 'pay-hunter2',
      parent: 1,
    },
  ],
};

describe('the native views of a screen', () => {
  it('are refused where the device gives none, with what reads the screen there', async () => {
    const { call } = await connect(new FakeDevice());
    expect((await call('screen', { views: true })).text).toBe(
      'UNSUPPORTED: this device gives no native view hierarchy\nhint: screen without views reads its accessibility tree',
    );
  });

  it('are refused, with what puts the probe in, where the app has none that its views need', async () => {
    const d = Object.assign(new FakeDevice(), {
      views: () => Promise.reject(new NoViewProbe('dev.app runs without the view probe')),
    });
    const { call } = await connect(d);
    expect((await call('screen', { views: true })).text).toBe(
      'UNSUPPORTED: dev.app runs without the view probe\nhint: launch_app restart:true probe:true puts it in',
    );
  });

  it('say a main thread that did not answer, and an app behind another, as the device said them', async () => {
    const refusing = (e: DeviceError) =>
      Object.assign(new FakeDevice(), { views: () => Promise.reject(e) });
    const said = async (e: DeviceError) =>
      (await (await connect(refusing(e))).call('screen', { views: true })).text;
    expect(
      await said(
        new DeviceError(
          'TIMEOUT',
          'the main thread of dev.app did not answer the view probe within 2 s',
          'the app is busy or hung: ask again once it answers',
        ),
      ),
    ).toBe(
      'TIMEOUT: the main thread of dev.app did not answer the view probe within 2 s\nhint: the app is busy or hung: ask again once it answers',
    );
    expect(
      await said(
        new DeviceError(
          'APP_NOT_RUNNING',
          'dev.app does not run: iOS suspends an app behind another, and its view probe with it',
          'bring it to the front, then ask again',
        ),
      ),
    ).toBe(
      'APP_NOT_RUNNING: dev.app does not run: iOS suspends an app behind another, and its view probe with it\nhint: bring it to the front, then ask again',
    );
  });

  it('come folded under the framework that draws them, and with raw as data, a secret kept off both', async () => {
    const d = Object.assign(new FakeDevice(), { views: () => Promise.resolve(TREE) });
    const { call } = await connect(d, { policy: { secrets: ['hunter2'] } });
    const lines = await call('screen', { views: true });
    expect(lines.text).toBe(
      'framework: Compose\ncom.android.internal.policy.DecorView > androidx.compose.ui.platform.ComposeView > android.view.View #pay-••• "Pay" text "card •••" 40,600 1000x120',
    );
    expect(lines.data).toMatchObject({ elements: 3, framework: 'Compose' });
    expect(lines.data.views).toBeUndefined();
    const raw = await call('screen', { views: true, raw: true });
    expect(raw.data.views?.map((v) => v.class)).toEqual(TREE.views.map((v) => v.class));
    expect(raw.data.views?.[2]).toMatchObject({ label: 'Pay', id: 'pay-•••', parent: 1 });
    expect(JSON.stringify([lines, raw])).not.toContain('hunter2');
  });

  it("adds what the device says of how to read them, once, and each view's flags as data", async () => {
    const note =
      "places inside android.widget.ScrollView at 0,0 are its layout's, before its scroll";
    const tree: ViewTree = {
      truncated: false,
      notes: [note],
      views: [
        { class: 'android.widget.ScrollView', rect: SCREEN },
        { class: 'android.widget.Button', rect: SCREEN, parent: 0, flags: ['clickable'] },
      ],
    };
    const d = Object.assign(new FakeDevice(), { views: () => Promise.resolve(tree) });
    const { call } = await connect(d);
    const r = await call('screen', { views: true, raw: true });
    expect(r.text).toBe(
      `framework: Android views\nandroid.widget.ScrollView > android.widget.Button 0,0 1080x2400 clickable\n${note}`,
    );
    expect(r.data.warnings).toBeUndefined();
    expect(r.data.views?.[1]?.flags).toEqual(['clickable']);
  });

  it('read the screen first, which opens a lock that asks for nothing, and say a lock that does', async () => {
    const asked: string[] = [];
    const d = new FakeDevice();
    const tree = d.tree.bind(d);
    const reading = (read: () => ReturnType<FakeDevice['tree']>) =>
      Object.assign(d, {
        tree: () => (asked.push('screen'), read()),
        views: () => (asked.push('views'), Promise.resolve(TREE)),
      });
    const { call } = await connect(reading(tree));
    asked.length = 0;
    expect((await call('screen', { views: true })).data.framework).toBe('Compose');
    expect(asked).toEqual(['screen', 'views']);
    // as an Android phone refuses a read behind its PIN: under the lock its activity draws no view
    const locked = new DeviceError(
      'DEVICE_LOCKED',
      'emulator-5554 is locked behind its PIN, pattern or password',
      'unlock it by hand: no tool can answer it',
    );
    reading(() => Promise.reject(locked));
    asked.length = 0;
    expect((await call('screen', { views: true })).text).toBe(
      'DEVICE_LOCKED: emulator-5554 is locked behind its PIN, pattern or password\nhint: unlock it by hand: no tool can answer it',
    );
    expect(asked).toEqual(['screen']);
    // any other read that fails leaves the views to answer, as under a sheet of the system's that gives no window
    reading(() => Promise.reject(new DeviceError('NOT_FOUND', 'no window to read')));
    expect((await call('screen', { views: true })).data.framework).toBe('Compose');
  });
});
