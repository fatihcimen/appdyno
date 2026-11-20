import { must, pause, type ActOptions } from '@appdyno/core';
import { DeviceError, type ActParams, type Tree } from '@appdyno/protocol';
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
    const r = await call('tap_screen', { selector: { text: 'GONDER' } });
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
    await call('tap_screen', { selector: { text: 'save', role: 'button' } });
    expect(act(d).at(-1)).toMatchObject({ y: 150 });
    await call('tap_screen', { selector: { id: 'dev.app:id/title' } });
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
    const many = await call('tap_screen', { selector: { text: 'row' } });
    expect(many.error).toBe(true);
    expect(many.data.code).toBe('AMBIGUOUS');
    expect(many.text).toMatch(/2 elements match .*@\w+.* button "Row" .*@\w+/);
    expect(act(d)).toEqual([]);
    await call('tap_screen', { selector: { text: 'row', index: 1 } });
    expect(act(d).at(-1)).toMatchObject({ y: 350 });
  });

  it('types into the field of a label and the field named by it, where a tap on the words names both', async () => {
    withScreen('labelled', [
      { t: 'Password', b: [0, 100, 300, 160] },
      { c: 'android.widget.EditText', h: 'Password', b: [0, 200, 1000, 300], f: 1 | 4 | 16 | 128 },
    ]);
    const d = new FakeDevice();
    d.screen = 'labelled';
    const { call } = await connect(d);
    const typed = await call('type_text', { selector: { text: 'Password' }, text: 'x' });
    expect(typed.error).toBe(false);
    expect(d.calls.find((c) => c.name === 'typeText')?.args[0]).toMatchObject({
      at: { x: 500, y: 250 },
    });
    expect((await call('tap_screen', { selector: { text: 'Password' } })).data.code).toBe(
      'AMBIGUOUS',
    );
  });

  it('says an index past the last match names none, and how many match', async () => {
    const d = new FakeDevice();
    const { call } = await connect(d);
    const r = await call('tap_screen', { selector: { text: 'Form', index: 1 } });
    expect(r.text).toMatch(
      /^NOT_FOUND: only 1 element matches text="Form", so index 1 names none: @\w+ button "Form" 540,350 \(no touch was sent\)\n/,
    );
    expect(r.data.hint).toBe('give an index below 1, 0 for the first listed, or use a ref');
    expect(act(d)).toEqual([]);
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
    const r = await call('tap_screen', { selector: { text: 'Hagia Sophia' } });
    expect(r.error).toBe(false);
    expect(r.text).toMatch(/^tapped @\w+ "Hagia Sophia"/);
    expect(act(d).at(-1)).toEqual({ kind: 'tap', x: 495, y: 1770 });
  });

  it(
    'names a tapped ref by its words at the touch, and by those it was shown with where they changed before it',
    fakeTimed(async () => {
      withScreen('player', []);
      const d = new FakeDevice();
      d.screen = 'player';
      let label = 'Play video, duration: Play 02:37';
      const shown = d.current.bind(d);
      d.current = () => {
        const t = shown();
        t.nodes.push({
          p: 0,
          w: 0,
          c: 'android.widget.FrameLayout',
          id: 'dev.app:id/player',
          d: label,
          b: [0, 300, 1080, 600],
          f: 19,
        });
        return t;
      };
      const act = d.act.bind(d);
      d.act = (a, o) => {
        // the player starts, and its controls come over the picture
        label = 'Play video, duration: Pause 00:02';
        return act(a, o);
      };
      const { call } = await connect(d);
      const ref = must(
        /(@\w+) \w+ "Play video/.exec((await call('read_screen')).text)?.[1],
        'its ref',
      );
      expect((await call('tap_screen', { ref })).text).toMatch(
        /^tapped @\w+ "Play video, duration: Play 02:37"\n/,
      );
      // the video ended while no one looked, and a touch after a while reads the screen first: it went to the element
      // as that read had it
      label = 'Play video, duration: Replay 02:37';
      await pause(30_000);
      expect((await call('tap_screen', { ref })).text).toMatch(
        /^tapped @\w+ "Play video, duration: Replay 02:37" \(shown as "Play video, duration: Pause 00:02"\)\n/,
      );
    }),
  );

  it('names the id of each of several matches no row tells apart', async () => {
    withScreen('themes', [
      {
        c: 'android.widget.Button',
        t: 'Aa',
        id: 'dev.app:id/theme_light',
        b: [0, 100, 100, 200],
        f: 19,
      },
      {
        c: 'android.widget.Button',
        t: 'Aa',
        id: 'dev.app:id/theme_dark',
        b: [200, 100, 300, 200],
        f: 19,
      },
    ]);
    const d = new FakeDevice();
    d.screen = 'themes';
    const { call } = await connect(d);
    const many = await call('tap_screen', { selector: { text: 'Aa' } });
    expect(many.text).toMatch(
      /^AMBIGUOUS: 2 elements match text="Aa": @[\w-]+ button "Aa" 50,150 — id=theme_light; @[\w-]+ button "Aa" 250,150 — id=theme_dark \(/,
    );
    expect((await call('read_screen')).text).toContain(
      'button "Aa" 250,150 clickable — id=theme_dark',
    );
    await call('tap_screen', { selector: { id: 'theme_dark' } });
    expect(act(d).at(-1)).toMatchObject({ x: 250, y: 150 });
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
    const many = await call('tap_screen', { selector: { text: 'Add' } });
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
    const tap = await call('tap_screen', { selector: { text: 'Gönder' } });
    expect(tap.text).toMatch(
      /^NOT_FOUND: no element matches text="Gönder" after 1500 ms; dev\.app is not in front \(com\.android\.launcher\) \(no touch was sent\)\n/,
    );
    expect(tap.data.hint).toBe(
      'launch_app brings it back, and read_logs with source crashes says why if it crashed',
    );
    const wait = await call('check_element', { selector: { text: 'Gönder' }, timeoutMs: 300 });
    expect(wait.text).toMatch(
      /^CHECK_FAILED: text="Gönder" not shown after 300 ms; dev\.app is not in front/,
    );
  });

  it(
    'waits for no match, then refuses with the nearest labels',
    fakeTimed(async () => {
      const d = new FakeDevice();
      const { call } = await connect(d);
      const started = Date.now();
      const r = await call('tap_screen', { selector: { text: 'Formm' } });
      expect(Date.now() - started).toBeGreaterThanOrEqual(1_400);
      expect(r.error).toBe(true);
      expect(r.data.code).toBe('NOT_FOUND');
      expect(r.text).toMatch(/nearest: @\w+ button "Form"/);
    }),
  );

  describe('after a window came in front by itself', () => {
    /** As the agent: a touch aimed at a read whose app windows another has replaced since is refused before it goes. */
    class Windowed extends FakeDevice {
      private readonly seen = new Map<string, string>();
      private windows = (t: Tree) =>
        t.windows
          .filter((w) => w.type === 1)
          .map((w) => w.pkg)
          .join();
      override async tree() {
        const t = await super.tree();
        this.seen.set(t.hash, this.windows(t));
        return t;
      }
      override async act(action: ActParams, opts: ActOptions = {}) {
        const then = opts.before === undefined ? undefined : this.seen.get(opts.before);
        if (action.kind !== 'key' && then !== undefined && then !== this.windows(this.current()))
          throw new DeviceError(
            'STALE',
            'the screen changed since it was read: another window is in front',
          );
        const r = await super.act(action, opts);
        if (r.tree) this.seen.set(r.tree.hash, this.windows(r.tree));
        return r;
      }
    }
    const ALLOW = { text: 'Uygulamayı kullanırken' };

    it('a selector acts on the window it was found on', async () => {
      const d = new Windowed();
      const { call } = await connect(d);
      await call('read_screen');
      d.permissionUp = true;
      const r = await call('tap_screen', { selector: ALLOW });
      expect(r.text).toMatch(/^tapped @\w+ "Uygulamayı kullanırken"/);
      expect(d.permissionUp).toBe(false);
    });

    it('a selector in a sequence acts on the window it was found on', async () => {
      const d = new Windowed();
      const { call } = await connect(d);
      await call('read_screen');
      d.permissionUp = true;
      const r = await call('run_steps', { steps: [{ tool: 'tap_screen', selector: ALLOW }] });
      expect(r.error).toBe(false);
      expect(d.permissionUp).toBe(false);
    });

    /** An app that opens its own dialog again, a window of its own package, once more after a read: a second error. */
    class Reopened extends FakeDevice {
      dialog = 1;
      /** The dialogs that open again once the next touch is on its way, before it is compared. */
      reopens = 1;
      private readonly seen = new Map<string, number>();
      override current(): Tree {
        const t = super.current();
        if (this.dialog === 0) return t;
        const b: [number, number, number, number] = [0, 800, 1080, 1600];
        t.windows.push({ type: 1, pkg: 'dev.app', layer: 2, b, active: true, focused: true });
        t.nodes.push(
          { p: -1, w: 1, c: 'android.widget.FrameLayout', b, f: 17 },
          {
            p: t.nodes.length,
            w: 1,
            c: 'android.widget.Button',
            t: 'Tekrar dene',
            b: [100, 1000, 980, 1100],
            f: 19,
          },
        );
        t.hash = `${t.hash}+dialog${this.dialog}`;
        return t;
      }
      override async tree() {
        const t = await super.tree();
        this.seen.set(t.hash, this.dialog);
        return t;
      }
      override async act(action: ActParams, opts: ActOptions = {}) {
        const touch = action.kind !== 'key';
        if (touch && this.reopens > 0 && this.dialog > 0) {
          this.reopens--;
          this.dialog++;
        }
        const then = opts.before === undefined ? undefined : this.seen.get(opts.before);
        if (touch && then !== undefined && then !== this.dialog)
          throw new DeviceError(
            'STALE',
            'the screen changed since it was read: another window is in front',
          );
        const r = await super.act(action, opts);
        if (action.kind === 'tap' && action.y >= 1000 && action.y <= 1100) this.dialog = 0;
        return r;
      }
    }
    const OK = { text: 'Tekrar dene' };

    it('a selector acts on the window in front at the touch, where it matches there too', async () => {
      const d = new Reopened();
      const { call } = await connect(d);
      await call('read_screen');
      const r = await call('run_steps', {
        steps: [
          { tool: 'tap_screen', selector: OK },
          { tool: 'press_key', key: 'back' },
          { tool: 'read_screen' },
        ],
      });
      expect(r.error ? r.text : '').toBe('');
      expect(d.dialog).toBe(0);
      const one = new Reopened();
      const single = await connect(one);
      await single.call('read_screen');
      expect((await single.call('tap_screen', { selector: OK })).error).toBe(false);
      expect(one.dialog).toBe(0);
    });

    it('a ref of the dialog read before it opened again is still refused', async () => {
      const d = new Reopened();
      const { call } = await connect(d);
      const ok = must(/@\w+(?= "Tekrar dene")/.exec((await call('read_screen')).text), 'a ref')[0];
      const r = await call('tap_screen', { ref: ok });
      expect([r.data.code, r.data.dispatched]).toEqual(['STALE', false]);
      expect(d.dialog).toBe(2);
    });

    it('a ref or a point read before it is still refused, and no touch is sent', async () => {
      for (const aim of [{ ref: true }, { x: 540, y: 350 }]) {
        const d = new Windowed();
        const { call } = await connect(d);
        const form = must(
          /@\w+(?= button "Form")/.exec((await call('read_screen')).text),
          'a ref',
        )[0];
        d.permissionUp = true;
        const r = await call('tap_screen', 'ref' in aim ? { ref: form } : aim);
        expect([r.data.code, r.data.dispatched]).toEqual(['STALE', false]);
        expect(act(d)).toEqual([]);
        // the refusal shows the window that came in front, whole, as a diff names no app
        expect(r.text).toMatch(
          /\(no touch was sent\)\nforeground: com\.android\.permissioncontroller\n[^]*"Uygulamayı kullanırken"/,
        );
        // so the next touch is aimed at a screen that was shown, and is not refused for it
        expect((await call('tap_screen', { selector: ALLOW })).error).toBe(false);
      }
    });
  });

  it('swipes from an element, and types at coordinates', async () => {
    const d = new FakeDevice();
    const { call } = await connect(d);
    await call('swipe_screen', { direction: 'left', selector: { text: 'Form' }, distance: 100 });
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
    const name = await call('read_screen', { selector: { id: 'dev.app:id/name' } });
    expect(name.data.matches?.[0]).toMatchObject({
      role: 'textField',
      enabled: true,
      checked: false,
      focused: true,
      value: 'Ayşe',
      bounds: { x: 0, y: 100, w: 500, h: 100 },
    });
    expect(name.text).toContain('focused');
    const box = await call('read_screen', { selector: { text: 'Agree' } });
    expect(box.data.matches?.[0]).toMatchObject({ enabled: false, checked: true });
    expect(box.text).toContain('disabled');
    const pw = await call('read_screen', { selector: { id: 'dev.app:id/pw' } });
    expect(must(pw.data.matches?.[0], 'a match').value).toBeUndefined();
    expect(
      (await call('read_screen', { selector: { role: 'checkbox' } })).data.matches,
    ).toHaveLength(1);
  });

  it('answers a passing check, and refuses a failing one saying what it found', async () => {
    withScreen('state', [
      { c: 'android.widget.CheckBox', t: 'Agree', b: [0, 300, 500, 400], f: 1 | 2 | 16 | 32 },
    ]);
    const d = new FakeDevice();
    d.screen = 'state';
    const { call } = await connect(d);
    expect(
      (await call('check_element', { selector: { text: 'Agree' }, check: 'checked' })).error,
    ).toBe(false);
    expect(
      (await call('check_element', { selector: { text: 'Agree' }, check: 'enabled' })).error,
    ).toBe(false);
    expect(
      (await call('check_element', { selector: { text: 'Nope' }, check: 'absent' })).error,
    ).toBe(false);
    const off = await call('check_element', {
      selector: { text: 'Agree' },
      check: 'checked',
      expect: false,
    });
    expect(off.error).toBe(true);
    expect(off.data.code).toBe('CHECK_FAILED');
    const text = await call('check_element', {
      selector: { text: 'Agree' },
      check: 'text',
      equals: 'No',
    });
    expect(text.text).toContain('reads "Agree", not "No"');
    // each of the four: the text it reads or another, wanted or not
    const reads = (equals: string, want: boolean) =>
      call('check_element', { selector: { text: 'Agree' }, check: 'text', equals, expect: want });
    expect((await reads('Agree', true)).error).toBe(false);
    expect((await reads('No', true)).error).toBe(true);
    expect((await reads('No', false)).error).toBe(false);
    const must = await reads('Agree', false);
    expect(must.error).toBe(true);
    expect(must.data.code).toBe('CHECK_FAILED');
    expect(must.text).toContain('reads "Agree", which it must not');
    const gone = await call('check_element', { selector: { text: 'Agree' }, check: 'absent' });
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
