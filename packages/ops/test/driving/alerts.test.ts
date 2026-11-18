import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeviceError, type ActParams, type Tree } from '@appdyno/protocol';
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
    const read = await call('answer_alert');
    expect(read.text).toContain('Pixel keeps stopping');
    expect(read.text).toContain('"Close app"');
    expect(read.data).not.toHaveProperty('answered');
    const wrong = await call('answer_alert', { answer: 'Reboot' });
    expect(wrong.error).toBe(true);
    expect(wrong.text).toContain('"Close app"');
    expect(act(d)).toEqual([]);
    const r = await call('answer_alert', { answer: 'close APP' });
    expect(r.error).toBe(false);
    expect(r.data.answered).toBe('Close app');
    expect(act(d).at(-1)).toMatchObject({ kind: 'tap', x: 250, y: 1050 });
    expect((await call('answer_alert')).text).toContain('no system alert');
  });

  it("says in the screen's answer that an app's crash dialog asks, by its words and buttons", async () => {
    const d = new WithDialog();
    // as an API 34 emulator reads it: the system's window, the app's own gone from behind it
    d.add = dialog('android', 3);
    const { call } = await connect(d);
    const r = await call('read_screen');
    expect(r.text).toContain(
      '\nthe system asks: Pixel keeps stopping (Close app, App info): answer it with answer_alert',
    );
    // said once: the structured content holds the text, and no warning the text says
    expect(r.data.warnings).toBeUndefined();
  });

  it("says with the app's native views that a system alert is in front of them", async () => {
    const d = Object.assign(new WithDialog(), {
      views: () => Promise.resolve({ views: [], truncated: false }),
    });
    const { call } = await connect(d);
    expect((await call('read_screen', { views: true })).text).toBe('no view is drawn');
    d.add = dialog('android', 3);
    const r = await call('read_screen', { views: true });
    const said =
      "a system alert is in front of these views, which are the app's: the system asks: Pixel keeps stopping (Close app, App info): answer it with answer_alert";
    expect(r.text).toBe(`no view is drawn\n${said}`);
    expect(r.data.warnings).toBeUndefined();
  });

  it('says of a link the system asks about first that nothing opened yet, and how to answer', async () => {
    const d = new WithDialog();
    const { call } = await connect(d);
    // a link that leaves the screen as it was is not said opened: it may never have reached the app
    const same = await call('open_link', { url: 'app://screen' });
    expect(same.done).toBe('sent app://screen');
    expect(same.text).toMatch(/^sent app:\/\/screen\nno change seen in \d+ ms/);
    Object.assign(d, { openUrl: () => Promise.resolve(void (d.screen = 'form')) });
    expect((await call('open_link', { url: 'app://screen' })).done).toBe('opened app://screen');
    d.add = dialog('android', 3);
    expect((await call('open_link', { url: 'app://screen' })).done).toBe(
      'sent app://screen, and the system asks: Pixel keeps stopping (Close app, App info): answer it with answer_alert',
    );
    expect((await call('open_link', { url: 'app://screen', read: 'none' })).done).toBe(
      'opened app://screen',
    );
  });

  it('says that it answered the "Open in …?" a link to the selected app asked on the way', async () => {
    const d = new FakeDevice();
    const answered = `answering the system's "Open in …?" for appdyno fixture on the way`;
    // an answer whose screen never came is no link opened
    Object.assign(d, { openUrl: () => Promise.resolve({ answered: 'appdyno fixture' }) });
    const { call } = await connect(d);
    expect((await call('open_link', { url: 'app://screen' })).done).toBe(
      `sent app://screen, ${answered}`,
    );
    Object.assign(d, {
      openUrl: () => Promise.resolve(((d.screen = 'form'), { answered: 'appdyno fixture' })),
    });
    for (const read of ['diff', 'none'])
      expect((await call('open_link', { url: 'app://screen', read })).done).toBe(
        `opened app://screen, ${answered}`,
      );
  });

  it('passes a flow’s alert step only where no alert is open: a button not on it, or no screen read, fails it', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'appdyno-alert-')), 'a.flow');
    const run = async (d: FakeDevice, body: string) => {
      writeFileSync(file, `app dev.app\n${body}\n`);
      return (await connect(d)).call('run_flow', { action: 'run', file });
    };
    expect((await run(new WithDialog(), 'alert allow')).error).toBe(false);
    const d = new WithDialog();
    d.add = dialog('android', 3);
    const wrong = await run(d, 'alert "Reboot"');
    expect(wrong.error).toBe(true);
    expect(wrong.text).toContain('no button "Reboot" on the alert');
    const unread = new WithDialog();
    unread.current = () => {
      throw new DeviceError('NOT_FOUND', 'no window to read');
    };
    const blind = await run(unread, 'alert allow');
    expect(blind.error).toBe(true);
    expect(blind.text).toContain('no window to read');
  });

  it('answers a localized permission prompt by allow, and leaves the app’s dialog alone', async () => {
    const d = new FakeDevice();
    d.permissionUp = true;
    const { call } = await connect(d);
    expect((await call('answer_alert', { answer: 'allow' })).text).toContain(
      '"Uygulamayı kullanırken"',
    );
    const own = new WithDialog();
    own.add = dialog('dev.app', 1);
    const { call: call2 } = await connect(own);
    expect((await call2('answer_alert', { answer: 'Close app' })).text).toContain(
      'no system alert',
    );
    expect(act(own)).toEqual([]);
  });
});
