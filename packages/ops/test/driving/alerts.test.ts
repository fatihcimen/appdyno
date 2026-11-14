import { type ActParams, type Tree } from '@appdyno/protocol';
import { describe, expect, it } from 'vitest';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { connect, act } from './shared.js';

describe('system alerts', () => {
  const dialog = (pkg: string, type: number) => (t: Tree) => {
    t.windows.push({ type, pkg, layer: 2, b: [0, 800, 1080, 1600], active: true, focused: true });
    const w = t.windows.length - 1;
    const root = t.nodes.length;
    t.nodes.push(
      { p: -1, w, c: 'android.widget.FrameLayout', b: [0, 800, 1080, 1600], f: 17 },
      {
        p: root,
        w,
        c: 'android.widget.TextView',
        t: 'Pixel keeps stopping',
        b: [0, 850, 1080, 950],
        f: 17,
      },
      { p: root, w, c: 'android.widget.Button', t: 'Close app', b: [0, 1000, 500, 1100], f: 19 },
      { p: root, w, c: 'android.widget.Button', t: 'App info', b: [500, 1000, 1080, 1100], f: 19 },
    );
  };
  class WithDialog extends FakeDevice {
    add: ((t: Tree) => void) | undefined;
    override current(): Tree {
      const t = super.current();
      this.add?.(t);
      return t;
    }
    override async act(action: ActParams, opts = {}) {
      if (action.kind === 'tap' && action.y >= 1000 && action.y <= 1100) this.add = undefined;
      return super.act(action, opts);
    }
  }

  it('reads any system alert and answers it by label', async () => {
    const d = new WithDialog();
    d.add = dialog('android', 3);
    const { call } = await connect(d);
    const read = await call('alert');
    expect(read.text).toContain('Pixel keeps stopping');
    expect(read.text).toContain('"Close app"');
    expect(read.data).not.toHaveProperty('answered');
    const wrong = await call('alert', { answer: 'Reboot' });
    expect(wrong.error).toBe(true);
    expect(wrong.text).toContain('"Close app"');
    expect(act(d)).toEqual([]);
    const r = await call('alert', { answer: 'close APP' });
    expect(r.error).toBe(false);
    expect(r.data.answered).toBe('Close app');
    expect(act(d).at(-1)).toMatchObject({ kind: 'tap', x: 250, y: 1050 });
    expect((await call('alert')).text).toContain('no system alert');
  });

  it("says in the screen's answer that an app's crash dialog asks, by its words and buttons", async () => {
    const d = new WithDialog();
    // as an API 34 emulator reads it: the system's window, the app's own gone from behind it
    d.add = dialog('android', 3);
    const { call } = await connect(d);
    const r = await call('screen');
    expect(r.text).toContain(
      '\nthe system asks: Pixel keeps stopping (Close app, App info): answer it with alert',
    );
    expect(r.data.warnings).toEqual([
      'the system asks: Pixel keeps stopping (Close app, App info): answer it with alert',
    ]);
  });

  it('says of a link the system asks about first that nothing opened yet, and how to answer', async () => {
    const d = new WithDialog();
    const { call } = await connect(d);
    expect((await call('open_link', { url: 'app://screen' })).done).toBe('opened app://screen');
    d.add = dialog('android', 3);
    expect((await call('open_link', { url: 'app://screen' })).done).toBe(
      'sent app://screen, and the system asks: Pixel keeps stopping (Close app, App info): answer it with alert',
    );
    expect((await call('open_link', { url: 'app://screen', read: 'none' })).done).toBe(
      'opened app://screen',
    );
  });

  it('says that it answered the "Open in …?" a link to the selected app asked on the way', async () => {
    const d = new FakeDevice();
    Object.assign(d, { openUrl: () => Promise.resolve({ answered: 'appdyno fixture' }) });
    const { call } = await connect(d);
    for (const read of ['diff', 'none'])
      expect((await call('open_link', { url: 'app://screen', read })).done).toBe(
        `opened app://screen, answering the system's "Open in …?" for appdyno fixture on the way`,
      );
  });

  it('answers a localized permission prompt by allow, and leaves the app’s dialog alone', async () => {
    const d = new FakeDevice();
    d.permissionUp = true;
    const { call } = await connect(d);
    expect((await call('alert', { answer: 'allow' })).text).toContain('"Uygulamayı kullanırken"');
    const own = new WithDialog();
    own.add = dialog('dev.app', 1);
    const { call: call2 } = await connect(own);
    expect((await call2('alert', { answer: 'Close app' })).text).toContain('no system alert');
    expect(act(own)).toEqual([]);
  });
});
