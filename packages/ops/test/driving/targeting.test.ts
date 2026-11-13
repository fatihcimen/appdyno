import { must } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { describe, expect, it } from 'vitest';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { fakeTimed } from '@appdyno/testing/fake-time.js';
import { connect, act, withScreen } from './shared.js';
import { landing } from '../../src/targets.js';

describe('targeting', () => {
  it('taps by a selector, folding Turkish and accents, on a fresh read', async () => {
    const d = new FakeDevice();
    d.screen = 'form';
    const { call } = await connect(d);
    const r = await call('tap', { selector: { text: 'GONDER' } });
    expect(r.error).toBe(false);
    expect(d.screen).toBe('sent');
    expect(act(d).at(-1)).toEqual({ kind: 'tap', x: 540, y: 550 });
  });

  it('prefers an exact text and selects by role and id', async () => {
    withScreen('two', [
      { c: 'android.widget.Button', t: 'Save', b: [0, 100, 100, 200], f: 19 },
      { c: 'android.widget.Button', t: 'Save as', b: [0, 300, 100, 400], f: 19 },
      { t: 'Save', id: 'dev.app:id/title', b: [0, 500, 100, 600] },
    ]);
    const d = new FakeDevice();
    d.screen = 'two';
    const { call } = await connect(d);
    await call('tap', { selector: { text: 'save', role: 'button' } });
    expect(act(d).at(-1)).toMatchObject({ y: 150 });
    await call('tap', { selector: { id: 'dev.app:id/title' } });
    expect(act(d).at(-1)).toMatchObject({ y: 550 });
  });

  it('refuses several matches, listing them with refs, and index picks one', async () => {
    withScreen('rows', [
      { c: 'android.widget.Button', t: 'Row', b: [0, 100, 100, 200], f: 19 },
      { c: 'android.widget.Button', t: 'Row', b: [0, 300, 100, 400], f: 19 },
    ]);
    const d = new FakeDevice();
    d.screen = 'rows';
    const { call } = await connect(d);
    const many = await call('tap', { selector: { text: 'row' } });
    expect(many.error).toBe(true);
    expect(many.data.code).toBe('AMBIGUOUS');
    expect(many.text).toMatch(/2 elements match .*@\w+.* button "Row" .*@\w+/);
    expect(act(d)).toEqual([]);
    await call('tap', { selector: { text: 'row', index: 1 } });
    expect(act(d).at(-1)).toMatchObject({ y: 350 });
  });

  it('takes a link and its own text in the same box as one target, the link', async () => {
    withScreen('article', [
      { c: 'android.webkit.WebView', b: [0, 0, 1080, 2000] },
      { c: 'android.widget.TextView', t: 'Hagia Sophia', p: 0, b: [400, 1740, 590, 1800] },
      { c: 'android.view.View', t: 'Hagia Sophia', p: 0, f: 19, b: [400, 1740, 590, 1800] },
    ]);
    const d = new FakeDevice();
    d.screen = 'article';
    const { call } = await connect(d);
    const r = await call('tap', { selector: { text: 'Hagia Sophia' } });
    expect(r.error).toBe(false);
    expect(r.text).toMatch(/^tapped @\w+ "Hagia Sophia"/);
    expect(act(d).at(-1)).toEqual({ kind: 'tap', x: 495, y: 1770 });
  });

  it('names the row each of many matches is in, ten of them, and how many more', async () => {
    withScreen(
      'products',
      Array.from({ length: 12 }, (_, i) => [
        { c: 'android.widget.LinearLayout', b: [0, i * 150, 1080, i * 150 + 140] as const },
        {
          c: 'android.widget.TextView',
          t: `Product ${i + 1}`,
          p: 1 + i * 3,
          b: [0, i * 150, 600, i * 150 + 140] as const,
        },
        {
          c: 'android.widget.Button',
          t: 'Add',
          p: 1 + i * 3,
          f: 19,
          b: [800, i * 150, 1080, i * 150 + 140] as const,
        },
      ])
        .flat()
        .map((n) => ({ ...n, b: [...n.b] as [number, number, number, number] })),
    );
    const d = new FakeDevice();
    d.screen = 'products';
    const { call } = await connect(d);
    const many = await call('tap', { selector: { text: 'Add' } });
    expect(many.text).toMatch(
      /^AMBIGUOUS: 12 elements match text="Add": @[\w-]+ button "Add" 940,70 — Product 1; /,
    );
    expect(many.text).toContain('— Product 10; and 2 more (no touch was sent)');
    expect(many.data.hint).toBe('give the selector an index, 0 for the first listed, or use a ref');
  });

  it('says the app is not in front where nothing matches and another app is, in place of its labels', async () => {
    class Away extends FakeDevice {
      override current() {
        const t = super.current();
        return { ...t, windows: t.windows.map((w) => ({ ...w, pkg: 'com.android.launcher' })) };
      }
    }
    const { call } = await connect(new Away());
    const tap = await call('tap', { selector: { text: 'Gönder' } });
    expect(tap.text).toMatch(
      /^NOT_FOUND: no element matches text="Gönder" after 1500 ms; dev\.app is not in front \(com\.android\.launcher\) \(no touch was sent\)\n/,
    );
    expect(tap.data.hint).toBe('launch_app brings it back, and crashes says why if it crashed');
    const wait = await call('wait_for', { selector: { text: 'Gönder' }, timeoutMs: 300 });
    expect(wait.text).toMatch(/^TIMEOUT: not shown after 300 ms; dev\.app is not in front/);
  });

  it(
    'waits for no match, then refuses with the nearest labels',
    fakeTimed(async () => {
      const d = new FakeDevice();
      const { call } = await connect(d);
      const started = Date.now();
      const r = await call('tap', { selector: { text: 'Formm' } });
      expect(Date.now() - started).toBeGreaterThanOrEqual(1_400);
      expect(r.error).toBe(true);
      expect(r.data.code).toBe('NOT_FOUND');
      expect(r.text).toMatch(/nearest: @\w+ button "Form"/);
    }),
  );

  it('swipes from an element, and types at coordinates', async () => {
    const d = new FakeDevice();
    const { call } = await connect(d);
    await call('swipe', { direction: 'left', selector: { text: 'Form' }, distance: 100 });
    expect(act(d).at(-1)).toMatchObject({
      kind: 'swipe',
      from: { x: 540, y: 350 },
      to: { x: 440, y: 350 },
    });
    await call('type_text', { text: 'x', x: 5, y: 6 });
    expect(d.typed).toEqual(['x']);
  });

  it('types into a field a selector names', async () => {
    const d = new FakeDevice();
    d.screen = 'form';
    const { call } = await connect(d);
    await call('type_text', { text: 'Ayşe', selector: { role: 'textField' } });
    expect(d.typed).toEqual(['Ayşe']);
  });

  it('says a typing that may have gone may have gone in part, as keys typed one by one do', async () => {
    const d = new FakeDevice();
    d.screen = 'form';
    d.typeText = () => {
      const e = new DeviceError(
        'TIMEOUT',
        'the key went to the input helper, which did not say it was sent',
      );
      e.sent = true;
      return Promise.reject(e);
    };
    const { call } = await connect(d);
    const r = await call('type_text', { text: 'Ayşe', selector: { role: 'textField' } });
    expect([r.data.code, r.data.dispatched]).toEqual(['TIMEOUT', 'unknown']);
    expect(r.text).toMatch(
      /^TIMEOUT: the key went to the input helper, which did not say it was sent; part of the text may be in the field: read it, and type with replace: true/,
    );
  });
});

describe('find and assert', () => {
  it('reports role, enabled, checked, focused, value and bounds', async () => {
    withScreen('attrs', [
      {
        c: 'android.widget.EditText',
        t: 'Ayşe',
        id: 'dev.app:id/name',
        b: [0, 100, 500, 200],
        f: 1 | 4 | 8 | 16 | 128,
      },
      { c: 'android.widget.CheckBox', t: 'Agree', b: [0, 300, 500, 400], f: 1 | 2 | 32 },
      {
        c: 'android.widget.EditText',
        t: 'hunter2',
        id: 'dev.app:id/pw',
        b: [0, 500, 500, 600],
        f: 1 | 16 | 128 | 512,
      },
    ]);
    const d = new FakeDevice();
    d.screen = 'attrs';
    const { call } = await connect(d);
    const name = await call('find', { selector: { id: 'dev.app:id/name' } });
    expect(name.data.matches?.[0]).toMatchObject({
      role: 'textField',
      enabled: true,
      checked: false,
      focused: true,
      value: 'Ayşe',
      bounds: { x: 0, y: 100, w: 500, h: 100 },
    });
    expect(name.text).toContain('focused');
    const box = await call('find', { selector: { text: 'Agree' } });
    expect(box.data.matches?.[0]).toMatchObject({ enabled: false, checked: true });
    expect(box.text).toContain('disabled');
    const pw = await call('find', { selector: { id: 'dev.app:id/pw' } });
    expect(must(pw.data.matches?.[0], 'a match').value).toBeUndefined();
    expect((await call('find', { selector: { role: 'checkbox' } })).data.matches).toHaveLength(1);
  });

  it('answers a passing check, and refuses a failing one saying what it found', async () => {
    withScreen('state', [
      { c: 'android.widget.CheckBox', t: 'Agree', b: [0, 300, 500, 400], f: 1 | 2 | 16 | 32 },
    ]);
    const d = new FakeDevice();
    d.screen = 'state';
    const { call } = await connect(d);
    expect((await call('assert', { selector: { text: 'Agree' }, check: 'checked' })).error).toBe(
      false,
    );
    expect((await call('assert', { selector: { text: 'Agree' }, check: 'enabled' })).error).toBe(
      false,
    );
    expect((await call('assert', { selector: { text: 'Nope' }, check: 'absent' })).error).toBe(
      false,
    );
    const off = await call('assert', {
      selector: { text: 'Agree' },
      check: 'checked',
      expect: false,
    });
    expect(off.error).toBe(true);
    expect(off.data.code).toBe('CHECK_FAILED');
    const text = await call('assert', { selector: { text: 'Agree' }, check: 'text', equals: 'No' });
    expect(text.text).toContain('reads "Agree", not "No"');
    // each of the four: the text it reads or another, wanted or not
    const reads = (equals: string, want: boolean) =>
      call('assert', { selector: { text: 'Agree' }, check: 'text', equals, expect: want });
    expect((await reads('Agree', true)).error).toBe(false);
    expect((await reads('No', true)).error).toBe(true);
    expect((await reads('No', false)).error).toBe(false);
    const must = await reads('Agree', false);
    expect(must.error).toBe(true);
    expect(must.data.code).toBe('CHECK_FAILED');
    expect(must.text).toContain('reads "Agree", which it must not');
    const gone = await call('assert', { selector: { text: 'Agree' }, check: 'absent' });
    expect(gone.text).toContain('is on the screen');
  });
});

describe('where a touch lands', () => {
  const web = (label: string, x: number, y: number, width: number, height: number) => ({
    ref: `@${label.length}`,
    role: 'text',
    label,
    name: label,
    nameKind: 'label' as const,
    rect: { x, y, width, height },
    x: Math.round(x + width / 2),
    y: Math.round(y + height / 2),
    flags: ['web' as const, 'clickable' as const],
  });
  // the article's own boxes: lines of 50, a link that wraps over two lines of 903 by 115
  const page = [
    web('which was built during the reign of', 162, 1776, 630, 50),
    web('Justinian I', 788, 1776, 189, 50),
    web('Nika riots', 451, 2238, 176, 50),
    web('Byzantine Empire', 43, 1275, 879, 118),
  ];

  it('is the middle of an element on one line', () => {
    const one = must(page[1], 'a link');
    expect(landing(one, page)).toEqual({ x: one.x, y: one.y });
  });

  it("is the first line's end of a web link that wraps over two, as the middle of its box is the text between", () => {
    const link = web('Hagia Sophia', 43, 1712, 903, 115);
    // "Hagia" ends the first line at 840 to 945, 1712 to 1762: the middle (494, 1769) is plain text
    expect(landing(link, [...page, link])).toEqual({ x: 934, y: 1737 });
  });

  it('is the middle of a native element whatever its height', () => {
    const tall = { ...web('Card', 0, 0, 1000, 115), flags: ['clickable' as const] };
    expect(landing(tall, page)).toEqual({ x: tall.x, y: tall.y });
  });
});
