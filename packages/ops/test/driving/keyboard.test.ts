import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { iosScreen } from '@appdyno/driver-apple';
import { type Tree } from '@appdyno/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDevice, WithKeyboard } from '@appdyno/testing/fake-device.js';
import { fakeTimed } from '@appdyno/testing/fake-time.js';
import { connect, act, withScreen } from './shared.js';

beforeEach(() => {
  vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-driving-')));
});

describe('keyboard', () => {
  it('says whether it is open and closes it', async () => {
    const d = new WithKeyboard();
    const { call } = await connect(d);
    expect((await call('keyboard', { action: 'status' })).data.open).toBe(true);
    const dismissed = await call('keyboard', { action: 'dismiss' });
    expect(dismissed.error).toBe(false);
    expect(dismissed.data.closed).toBe(true);
    expect((await call('keyboard', { action: 'status' })).data.open).toBe(false);
    const none = await call('keyboard', { action: 'dismiss' });
    expect(none.text).toContain('no keyboard');
    expect(none.data).not.toHaveProperty('closed');
    await call('keyboard', { action: 'enter' });
    expect(act(d).at(-1)).toEqual({ kind: 'key', key: 'enter' });
  });

  it('says what closing it changed against the screen before, not its own read after', async () => {
    const d = new WithKeyboard();
    d.hides = 'Gönder';
    d.screen = 'form';
    const { call } = await connect(d);
    const r = await call('keyboard', { action: 'dismiss' });
    expect(r.error).toBe(false);
    expect(r.data.changed).toBe(true);
    expect(r.text).not.toContain('no change seen');
  });

  // Android lists no keyboard key, so an app whose window the keyboard did not shrink shows the same list either way
  it('says closing it changed the screen though the app beneath it did not move', async () => {
    const d = new WithKeyboard();
    const { call } = await connect(d);
    const r = await call('keyboard', { action: 'dismiss' });
    expect(r.error).toBe(false);
    expect(r.data.changed).toBe(true);
    expect(r.text).not.toContain('no change seen');
  });

  it(
    'refuses when the app keeps it open',
    fakeTimed(async () => {
      const d = new WithKeyboard();
      d.closes = false;
      const { call } = await connect(d);
      const r = await call('keyboard', { action: 'dismiss' });
      expect(r.error).toBe(true);
      expect(r.text).toContain('stayed open');
    }),
  );

  // as a landscape phone's full-screen keyboard, or a pan, leaves the app's window: whole, under the keyboard
  it('closes it before a touch on an element under it, which would type, by selector or ref', async () => {
    withScreen('low', [
      { c: 'android.widget.Button', t: 'Send', b: [0, 1700, 1080, 1800], f: 19, go: 'sent' },
    ]);
    const d = new WithKeyboard();
    d.screen = 'low';
    const { call } = await connect(d);
    const r = await call('tap', { selector: { text: 'Send' } });
    expect(r.error).toBe(false);
    expect(d.up).toBe(false);
    expect(act(d).at(-1)).toEqual({ kind: 'tap', x: 540, y: 1750 });
    expect(d.screen).toBe('sent');
    d.screen = 'low';
    d.up = true;
    const ref = /(@\w+) button "Send"/.exec((await call('screen')).text)?.[1];
    expect((await call('tap', { ref })).error).toBe(false);
    expect(d.up).toBe(false);
  });

  it(
    'closes no keyboard the app has closed since the last read, as the back key would leave the screen',
    fakeTimed(async () => {
      const d = new WithKeyboard();
      d.hides = 'Gönder';
      d.screen = 'form';
      let closes = 0;
      const close = d.dismissKeyboard;
      d.dismissKeyboard = () => {
        closes++;
        return close();
      };
      const { call } = await connect(d);
      await call('screen');
      d.up = false;
      // older than a read a touch aims by
      await new Promise((r) => setTimeout(r, 200));
      expect((await call('tap', { selector: { text: 'Gönder' } })).error).toBe(false);
      expect(closes).toBe(0);
      expect(d.screen).toBe('sent');
    }),
  );

  it('touches a key of the keyboard itself, as iOS lists its keys, with no closing first', async () => {
    class IosKeyboard extends FakeDevice {
      closed = 0;
      constructor() {
        super();
        Object.defineProperty(this, 'platformScreen', { value: iosScreen });
      }
      override current(): Tree {
        const t = super.current();
        const keyboard = t.nodes.length;
        t.nodes.push(
          { p: 0, w: 0, c: 'Keyboard', b: [0, 1500, 1080, 2400], f: 17 },
          { p: keyboard, w: 0, c: 'Button', d: 'Return', b: [800, 2200, 1080, 2400], f: 19 },
        );
        return t;
      }
      dismissKeyboard = () => {
        this.closed++;
        return Promise.resolve();
      };
    }
    const d = new IosKeyboard();
    const { call } = await connect(d);
    expect((await call('tap', { selector: { text: 'Return' } })).error).toBe(false);
    expect(d.closed).toBe(0);
    expect(act(d).at(-1)).toEqual({ kind: 'tap', x: 940, y: 2300 });
  });

  it(
    'closes it when the window it shrank leaves the element out, and finds it then',
    fakeTimed(async () => {
      const d = new WithKeyboard();
      d.hides = 'Gönder';
      d.screen = 'form';
      const { call } = await connect(d);
      const r = await call('tap', { selector: { text: 'Gönder' } });
      expect(r.error).toBe(false);
      expect(d.screen).toBe('sent');
      d.screen = 'form';
      d.up = true;
      const missing = await call('tap', { selector: { text: 'Nowhere' } });
      expect(missing.data.code).toBe('NOT_FOUND');
    }),
  );
});
