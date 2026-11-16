import { describe, expect, it } from 'vitest';
import { WithKeyboard } from '@appdyno/testing/fake-device.js';
import { fakeTimed } from '@appdyno/testing/fake-time.js';
import { connect, act, withScreen } from './shared.js';

describe('keyboard', () => {
  it('says whether it is open and closes it', async () => {
    const d = new WithKeyboard();
    const { call } = await connect(d);
    expect((await call('read_screen')).text).toContain('@keyboard');
    const dismissed = await call('press_key', { key: 'hide_keyboard' });
    expect(dismissed.error).toBe(false);
    expect(dismissed.data.closed).toBe(true);
    expect((await call('read_screen')).text).not.toContain('@keyboard');
    const none = await call('press_key', { key: 'hide_keyboard' });
    expect(none.text).toContain('no keyboard');
    expect(none.data).not.toHaveProperty('closed');
    await call('press_key', { key: 'enter' });
    expect(act(d).at(-1)).toEqual({ kind: 'key', key: 'enter' });
  });

  it('says what closing it changed against the screen before, not its own read after', async () => {
    const d = new WithKeyboard();
    d.hides = 'Gönder';
    d.screen = 'form';
    const { call } = await connect(d);
    const r = await call('press_key', { key: 'hide_keyboard' });
    expect(r.error).toBe(false);
    expect(r.data.changed).toBe(true);
    expect(r.text).not.toContain('no change seen');
  });

  // Android lists no keyboard key, so an app whose window the keyboard did not shrink shows the same list either way
  it('says closing it changed the screen though the app beneath it did not move', async () => {
    const d = new WithKeyboard();
    const { call } = await connect(d);
    const r = await call('press_key', { key: 'hide_keyboard' });
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
      const r = await call('press_key', { key: 'hide_keyboard' });
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
    const r = await call('tap_screen', { selector: { text: 'Send' } });
    expect(r.error).toBe(false);
    expect(d.up).toBe(false);
    expect(act(d).at(-1)).toEqual({ kind: 'tap', x: 540, y: 1750 });
    expect(d.screen).toBe('sent');
    d.screen = 'low';
    d.up = true;
    const ref = /(@\w+) button "Send"/.exec((await call('read_screen')).text)?.[1];
    expect((await call('tap_screen', { ref })).error).toBe(false);
    expect(d.up).toBe(false);
  });

  it(
    'refuses a touch on an element under a keyboard the app keeps open, which would type a key',
    fakeTimed(async () => {
      withScreen('low', [
        { c: 'android.widget.Button', t: 'Send', b: [0, 1700, 1080, 1800], f: 19, go: 'sent' },
      ]);
      const d = new WithKeyboard();
      d.screen = 'low';
      d.closes = false;
      const { call } = await connect(d);
      const r = await call('tap_screen', { selector: { text: 'Send' } });
      expect(r.data.code).toBe('UNSUPPORTED');
      expect(r.text).toContain('"Send" is under the on-screen keyboard, which stayed open');
      expect(r.text).toContain('no touch was sent');
      expect(act(d).some((a) => a.kind === 'tap')).toBe(false);
    }),
  );

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
      await call('read_screen');
      d.up = false;
      // older than a read a touch aims by
      await new Promise((r) => setTimeout(r, 200));
      expect((await call('tap_screen', { selector: { text: 'Gönder' } })).error).toBe(false);
      expect(closes).toBe(0);
      expect(d.screen).toBe('sent');
    }),
  );

  it(
    'closes it when the window it shrank leaves the element out, and finds it then',
    fakeTimed(async () => {
      const d = new WithKeyboard();
      d.hides = 'Gönder';
      d.screen = 'form';
      const { call } = await connect(d);
      const r = await call('tap_screen', { selector: { text: 'Gönder' } });
      expect(r.error).toBe(false);
      expect(d.screen).toBe('sent');
      d.screen = 'form';
      d.up = true;
      const missing = await call('tap_screen', { selector: { text: 'Nowhere' } });
      expect(missing.data.code).toBe('NOT_FOUND');
    }),
  );
});
