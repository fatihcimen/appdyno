import { must } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pinchPaths, swipeLine } from '../../src/gesture-paths.js';
import { fakeTimed } from '@appdyno/testing/fake-time.js';
import { tree } from '@appdyno/testing/fake-screens.js';
import { connect, refOf } from './shared.js';

// a virtual device's numbers are noisy under host load: these answers must not depend on this Mac's
vi.mock('node:os', async (original) => ({
  ...(await original<typeof import('node:os')>()),
  loadavg: () => [0, 0, 0],
}));

describe('act and read', () => {
  let t: Awaited<ReturnType<typeof connect>>;
  beforeEach(async () => {
    t = await connect();
  });

  it('a tap by ref acts on the element centre with a settle, and answers with the diff', async () => {
    const screen = (await t.textOf('screen')).text;
    expect(screen).toContain('foreground: dev.app');
    const form = refOf(screen, 'Form');
    const r = await t.textOf('tap', { ref: form });
    expect(r.error).toBe(false);
    const act = must(
      t.device.calls.find((c) => c.name === 'act'),
      'a touch',
    );
    expect(act.args[0]).toEqual({ kind: 'tap', x: 540, y: 350 });
    expect(act.args[1]).toMatchObject({ settle: { quietMs: 200, maxMs: 3000 }, read: 'tree' });
    expect((act.args[1] as { before?: string }).before).toBeDefined();
    expect(r.text).toMatch(/^tapped @\w+ "Form"/);
    // another screen: the full view comes back
    expect(r.text).toContain('"Gönder"');
  });

  it('refuses a ref that is not on the current screen', async () => {
    await t.textOf('screen');
    const r = await t.textOf('tap', { ref: '@zzzz' });
    expect(r).toMatchObject({ error: true });
    expect(r.text).toContain('stale ref');
    expect(r.text).toMatch(/\nhint: \S/);
  });

  it('taps a ref that only screen raw gives, at its middle', async () => {
    const r = await t.call('screen', { raw: true });
    const nodes = (r.structuredContent?.nodes ?? []) as { ref?: string; type: string }[];
    const root = must(
      nodes.find((n) => n.type === 'android.widget.FrameLayout')?.ref,
      'the root ref',
    );
    expect(r.content[0]?.text).not.toContain(root);
    const tap = await t.textOf('tap', { ref: root });
    expect(tap.error).toBe(false);
    expect(tap.text).toMatch(new RegExp(`^tapped ${root} `));
    expect(t.device.calls.find((c) => c.name === 'act')?.args[0]).toEqual({
      kind: 'tap',
      x: 540,
      y: 1200,
    });
  });

  it('says a text it tapped held the words asked for only as a part of a paragraph', async () => {
    const paragraph =
      'Istanbul is the largest city in Turkey. With a population of over 15 million, it is home to 18% of the people of the country.';
    t.device.fixture = tree([
      { t: paragraph, b: [0, 300, 1080, 600] },
      { c: 'android.widget.Button', t: 'Form', b: [0, 700, 1080, 800], f: 19 },
    ]);
    const home = await t.textOf('tap', { selector: { text: 'Home' } });
    expect(home.text).toMatch(
      /^tapped @\w+ "Istanbul is the largest city in Turkey\. With a population o…" \(only a part of its words: nothing here reads "Home" alone\)/,
    );
    const form = await t.textOf('tap', { selector: { text: 'Form' } });
    expect(form.text).toMatch(/^tapped @\w+ "Form"(\n|$)/);
    const scrolled = await t.textOf('scroll_to', { selector: { text: 'population' } });
    expect(scrolled.text).toMatch(
      /^found @\w+ text ".*" 540,450 after 0 swipes \(only a part of its words: nothing here reads "population" alone\)/,
    );
  });

  it('says what a ref that went away was, and what is there in its place', async () => {
    const home = (await t.textOf('screen')).text;
    const form = refOf(home, 'Form');
    // the screen changed under the agent: another one is in front by the time it taps
    await t.textOf('tap', { ref: form });
    const r = await t.textOf('tap', { ref: form });
    expect(r).toMatchObject({ error: true });
    expect(r.text).toMatch(
      new RegExp(
        `^STALE: stale ref, read the screen again: ${form} "Form" is not on this screen; nearest: `,
      ),
    );
  });

  it('answers a small change as a diff and an unchanged screen in one line', async () => {
    const home = (await t.textOf('screen')).text;
    const form = (await t.textOf('tap', { ref: refOf(home, 'Form') })).text;
    const sent = await t.textOf('tap', { ref: refOf(form, 'Gönder') });
    expect(sent.text).toContain('screen changed: +1 -0 ~0');
    expect(sent.text).toContain('+ @');
    expect(sent.text).toContain('"Gönderildi"');
    const again = await t.textOf('tap', { ref: refOf(form, 'Gönder') });
    expect(again.text).toContain('screen unchanged');
  });

  it('read none acts without a settle or a read', async () => {
    await t.textOf('screen');
    const r = await t.textOf('tap', { x: 10, y: 10, read: 'none' });
    expect(r.text).toBe('tapped 10,10');
    expect(t.device.calls.at(-1)?.args[1]).toEqual({ settle: false, read: 'none' });
  });

  it('types into a field by ref without echoing the text', async () => {
    const home = (await t.textOf('screen')).text;
    const form = (await t.textOf('tap', { ref: refOf(home, 'Form') })).text;
    const r = await t.textOf('type_text', {
      ref: refOf(form, 'Adınız'),
      text: 'İş Gören 5551234',
      replace: true,
    });
    expect(r.text).toMatch(/^typed \(16 characters\)/);
    expect(r.text).not.toContain('5551234');
    expect(t.device.typed).toEqual(['İş Gören 5551234']);
    expect(t.device.calls.find((c) => c.name === 'typeText')?.args[0]).toMatchObject({
      at: { x: 540, y: 350 },
      replace: true,
    });
  });

  it('says text the field read back wrong was not submitted, where the device pressed no Enter', async () => {
    const home = (await t.textOf('screen')).text;
    const form = (await t.textOf('tap', { ref: refOf(home, 'Form') })).text;
    const typed = t.device.typeText.bind(t.device);
    t.device.typeText = async (text, o) => ({
      ...(await typed(text, o)),
      verified: false,
      submitted: false,
    });
    const r = await t.textOf('type_text', {
      ref: refOf(form, 'Adınız'),
      text: 'quick',
      submit: true,
    });
    expect(r.text).toMatch(
      /^typed \(5 characters, the field read back holds other text, so it was not submitted\)/,
    );
  });

  it(
    'runs steps with one read at the end, and stops at a stale ref before doing anything',
    fakeTimed(async () => {
      const home = (await t.textOf('screen')).text;
      const bad = await t.textOf('steps', { steps: [{ action: 'tap', ref: '@zz99' }] });
      expect(bad.error).toBe(true);
      expect(t.device.calls.filter((c) => c.name === 'act')).toHaveLength(0);
      const r = await t.textOf('steps', {
        steps: [
          { action: 'tap', ref: refOf(home, 'Form') },
          { action: 'type_text', text: 'Ali' },
          { action: 'press_key', key: 'enter' },
        ],
      });
      expect(r.text.split('\n').slice(0, 3)).toEqual([
        '1. tapped ' + refOf(home, 'Form') + ' "Form"',
        '2. typed (3 characters)',
        '3. pressed enter',
      ]);
      const reads = t.device.calls
        .filter((c) => c.name === 'act')
        .map((c) => (c.args[1] as { read?: string }).read);
      // tap, the fake's typing, then the key with the one read
      expect(reads).toEqual(['none', 'none', 'tree']);
    }),
  );

  it('answers only a system permission prompt', async () => {
    const home = (await t.textOf('screen')).text;
    const none = await t.textOf('alert', { answer: 'allow' });
    expect(none.text).toContain('no system alert is open');
    const asked = await t.textOf('tap', { ref: refOf(home, 'İzin') });
    expect(asked.text).toContain('answer it with alert');
    const r = await t.textOf('alert', { answer: 'allow' });
    expect(r.text).toContain('"Uygulamayı kullanırken"');
    expect(t.device.permissionUp).toBe(false);
  });

  it('sends a screenshot once per screen', async () => {
    await t.textOf('screen');
    const r = await t.call('screenshot');
    expect(r.content.map((c) => c.type)).toEqual(['text', 'image']);
    expect(r.content[0]?.text).toContain('its pixel x,y is tapped at x × 2.348, y × 2.348');
    const again = await t.textOf('screenshot');
    expect(again).toMatchObject({ error: true });
  });

  it('turns a device failure into an error that says what to do', async () => {
    await t.textOf('screen');
    t.device.fail = new DeviceError('TIMEOUT', 'act did not answer');
    const r = await t.textOf('tap', { x: 1, y: 1 });
    expect(r.error).toBe(true);
    expect(r.text).toMatch(
      /^TIMEOUT: act did not answer \(the touch may have been sent: .*\)\nhint: .*try again$/,
    );
  });
});

describe('policy', () => {
  it('refuses file, intent and script links, opens app and web links in the app', async () => {
    const t = await connect();
    for (const url of [
      'file:///sdcard/x',
      'intent://x#Intent;end',
      'javascript:alert(1)',
      'content://x',
      'nolink',
    ])
      expect((await t.textOf('open_link', { url, read: 'none' })).error, url).toBe(true);
    expect((await t.textOf('open_link', { url: 'demo://home', read: 'none' })).error).toBe(false);
    expect(t.device.calls.find((c) => c.name === 'openUrl')?.args).toEqual([
      'demo://home',
      'dev.app',
    ]);
  });

  it('keeps launches to the allowed apps and the home key off when asked', async () => {
    const t = await connect({ apps: ['dev.app'], allowHome: false });
    expect((await t.textOf('launch_app', { app: 'com.other', read: 'none' })).error).toBe(true);
    expect((await t.textOf('launch_app', { read: 'none' })).error).toBe(false);
    expect((await t.textOf('press_key', { key: 'home' })).text).toContain(
      'home is off on this server',
    );
  });

  it('drives only the allowed devices', async () => {
    const t = await connect({ devices: /^emulator-55\d\d$/ });
    expect((await t.textOf('use_device', { device: 'EXAMPLE0SERIAL00' })).error).toBe(true);
    expect((await t.textOf('use_device', { device: 'emulator-5580' })).text).toContain(
      'selected emulator-5580',
    );
    expect((await t.textOf('list_devices')).text).toContain('← selected');
  });

  it('hides secrets in what it shows and keeps them off the clipboard', async () => {
    const t = await connect({ secrets: ['Gönderildi'] });
    expect((await t.textOf('clipboard', { text: 'xGönderildix' })).error).toBe(true);
    const home = (await t.textOf('screen')).text;
    const form = (await t.textOf('tap', { ref: refOf(home, 'Form') })).text;
    const sent = (await t.textOf('tap', { ref: refOf(form, 'Gönder'), read: 'full' })).text;
    expect(sent).not.toContain('Gönderildi');
    expect(sent).toContain('•••');
  });

  it('logs tool outcomes without arguments', async () => {
    const t = await connect();
    await t.textOf('screen');
    const home = (await t.textOf('screen')).text;
    await t.textOf('type_text', { text: 'gizli-123', ref: refOf(home, 'Form') });
    expect(JSON.stringify(t.logs)).not.toContain('gizli-123');
    expect(t.logs.at(-1)).toMatchObject({ tool: 'type_text', outcome: 'ok' });
  });
});

describe('gesture geometry', () => {
  it('keeps a swipe inside the screen, `up` moving the finger up', () => {
    expect(swipeLine({ w: 1080, h: 2400 }, { direction: 'up' })).toEqual({
      from: { x: 540, y: 1200 },
      to: { x: 540, y: 240 },
    });
    expect(
      swipeLine({ w: 1080, h: 2400 }, { direction: 'right', x: 1000, distance: 500 }).to.x,
    ).toBe(1079);
  });

  it('spreads two fingers apart to zoom in and together to zoom out', () => {
    const [a, b] = pinchPaths({ x: 540, y: 1200 }, 3, 400, { w: 1080, h: 2400 });
    expect(a?.[0]?.x).toBeGreaterThan(must(a?.[1], 'its second point').x);
    expect(b?.[1]?.x).toBeGreaterThan(must(b?.[0], 'its first point').x);
    const [c] = pinchPaths({ x: 540, y: 1200 }, 0.3, 400, { w: 1080, h: 2400 });
    expect(c?.[1]?.x).toBeGreaterThan(must(c?.[0], 'its first point').x);
  });
});
