import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AppManager,
  Device,
  DeviceProvider,
  DeviceSettings,
  SettingName,
  Startable,
  VirtualDevices,
} from '@appdyno/core';
import { DeviceError, KEYS, type ActParams, type Tree } from '@appdyno/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_POLICY, ServerContext, type Policy } from '../src/index.js';
import { Keys } from '../src/step-schemas.js';
import { FakeDevice, SCREENS, WithKeyboard } from './fake-device.js';
import { linkedClient } from './helpers.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each test knows its tool's answer
type Result = { isError?: boolean; content: { text?: string }[]; structuredContent?: any };

async function connect(
  device: Device,
  o: {
    policy?: Partial<Policy>;
    virtual?: VirtualDevices;
    defaults?: ConstructorParameters<typeof ServerContext>[2];
  } = {},
) {
  const provider: DeviceProvider = {
    list: async () => [{ serial: device.serial, state: 'device', ready: true, model: 'Fake' }],
    handles: () => true,
    open: () => device,
    ...(o.virtual && { virtual: o.virtual }),
  };
  const ctx = new ServerContext({ ...DEFAULT_POLICY, ...o.policy }, [provider], {
    app: 'dev.app',
    ...o.defaults,
  });
  const client = await linkedClient(ctx);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as Result;
    return {
      error: r.isError === true,
      text: r.content.map((c) => c.text ?? '').join('\n'),
      data: r.structuredContent,
    };
  };
  return { call, ctx };
}

const act = (d: FakeDevice) =>
  d.calls.filter((c) => c.name === 'act').map((c) => c.args[0] as ActParams);

/** Adds screens to the fake's list for a test. */
function withScreen(name: string, nodes: (typeof SCREENS)[string]) {
  SCREENS[name] = nodes;
}

beforeEach(() => {
  vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-driving-')));
});

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

  it('waits for no match, then refuses with the nearest labels', async () => {
    const d = new FakeDevice();
    const { call } = await connect(d);
    const started = Date.now();
    const r = await call('tap', { selector: { text: 'Formm' } });
    expect(Date.now() - started).toBeGreaterThanOrEqual(1_400);
    expect(r.error).toBe(true);
    expect(r.data.code).toBe('NOT_FOUND');
    expect(r.text).toMatch(/nearest: @\w+ button "Form"/);
  });

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
});

describe('steps across screens', () => {
  it('runs selectors, wait_for and assert across screens with one read at the end', async () => {
    const d = new FakeDevice();
    const { call } = await connect(d);
    const r = await call('steps', {
      steps: [
        { action: 'tap', selector: { text: 'Form' } },
        { action: 'wait_for', text: 'Bilgiler' },
        { action: 'type_text', text: 'x', selector: { role: 'textField' } },
        { action: 'tap', selector: { text: 'Gönder' } },
        { action: 'assert', id: 'dev.app:id/result', check: 'text', equals: 'Gönderildi' },
      ],
    });
    expect(r.error).toBe(false);
    expect(r.text).toContain('5. check passed');
    expect(d.screen).toBe('sent');
    expect(d.calls.filter((c) => c.name === 'act').every((c) => c.args[1] !== undefined)).toBe(
      true,
    );
  });

  it('lets a ref wait for its own step: it need not exist at the start', async () => {
    const d = new FakeDevice();
    const { call } = await connect(d);
    d.screen = 'form';
    const send = /(@\w+) button "Gönder"/.exec((await call('screen')).text)![1]!;
    d.screen = 'home';
    await call('screen');
    const r = await call('steps', {
      steps: [
        { action: 'tap', selector: { text: 'Form' } },
        { action: 'tap', ref: send },
      ],
    });
    expect(r.error).toBe(false);
    expect(d.screen).toBe('sent');
  });

  it('settles after a step that may change the screen, not between typing', async () => {
    const d = new FakeDevice();
    const { call } = await connect(d);
    await call('steps', {
      steps: [
        { action: 'type_text', text: 'a' },
        { action: 'tap', x: 2, y: 2 },
        { action: 'tap', selector: { text: 'Form' } },
      ],
    });
    const opts = d.calls
      .filter((c) => c.name === 'act')
      .map((c) => c.args[1] as { settle: unknown });
    expect(opts.at(-3)!.settle).toBe(false);
    expect(opts.at(-2)!.settle).toBeTruthy();
  });

  it('stops at a failure, saying which step and why, with the screen', async () => {
    const d = new FakeDevice();
    const { call } = await connect(d);
    const r = await call('steps', {
      steps: [
        { action: 'tap', selector: { text: 'Form' } },
        { action: 'assert', text: 'Nope' },
        { action: 'tap', selector: { text: 'Gönder' } },
      ],
    });
    expect(r.error).toBe(true);
    expect(r.data.code).toBe('CHECK_FAILED');
    expect(r.text).toContain('1. tapped');
    expect(r.text).toContain('2. assert failed, the rest were not run');
    expect(r.text).toMatch(/textField "Adınız"/);
    expect(d.screen).toBe('form');
  });

  it('checks every step before the first runs, and holds a limit', async () => {
    const d = new FakeDevice();
    const { call } = await connect(d);
    const bad = await call('steps', {
      steps: [{ action: 'tap', x: 1, y: 1 }, { action: 'fly' }],
    });
    expect(bad.error).toBe(true);
    expect(bad.text).toContain('step 2');
    expect(act(d)).toEqual([]);
    const long = await call('steps', {
      steps: Array(21).fill({ action: 'press_key', key: 'tab' }),
    });
    expect(long.error).toBe(true);
  });
});

describe('waiting on the device', () => {
  class Waiting extends FakeDevice {
    waits: (string | undefined)[] = [];
    next: Tree | undefined;
    waitChange = async (since: string | undefined) => {
      this.waits.push(since);
      if (since === undefined) return { sig: 'a', tree: this.current() };
      const t = this.next;
      this.next = undefined;
      return t ? { sig: 'b', tree: t } : { sig: since };
    };
  }

  it('crosses the wire only for a changed screen, and reads no tree itself', async () => {
    const d = new Waiting();
    const { call } = await connect(d);
    await call('screen');
    d.screen = 'form';
    d.next = d.current();
    d.screen = 'home';
    const r = await call('wait_for', { text: 'Bilgiler', timeoutMs: 5_000 });
    expect(r.data.met).toBe(true);
    expect(d.waits).toEqual([undefined, 'a']);
    expect(d.calls.filter((c) => c.name === 'tree')).toHaveLength(1);
  });

  it('polls where the agent has no wait, or its wait fails', async () => {
    const d = new FakeDevice();
    const { call } = await connect(d);
    const r = await call('wait_for', { text: 'Form', timeoutMs: 1_000 });
    expect(r.data.met).toBe(true);
    const f = new Waiting();
    f.waitChange = async () => {
      throw new DeviceError('INTERNAL', 'no');
    };
    const { call: call2 } = await connect(f);
    expect((await call2('wait_for', { text: 'Form', timeoutMs: 1_000 })).data.met).toBe(true);
    expect(f.calls.filter((c) => c.name === 'tree').length).toBeGreaterThan(0);
  });
});

describe('a ref on a screen an app moved by itself', () => {
  it('is touched where the element is now, not where the last answer had it', async () => {
    const d = new FakeDevice();
    d.screen = 'settings';
    const { call } = await connect(d);
    const line = /(@\w+) "Wi-Fi On" (\d+)/.exec((await call('screen')).text)!;
    expect(line[2]).toBe('350');
    // the app adds a row above it, with no action of ours
    withScreen('settingsMoved', [
      { b: [0, 200, 1080, 300], c: 'android.widget.LinearLayout', d: 'Added', f: 19 },
      ...SCREENS.settings!.map((n) => ({
        ...n,
        b: [n.b[0], n.b[1] + 100, n.b[2], n.b[3] + 100] as typeof n.b,
      })),
    ]);
    d.screen = 'settingsMoved';
    await new Promise((r) => setTimeout(r, 200));
    expect((await call('tap', { ref: line[1] })).error).toBe(false);
    expect(act(d)).toMatchObject([{ kind: 'tap', x: 540, y: 450 }]);
  });

  it('costs no second read when the client acts at once on what it just read', async () => {
    const d = new FakeDevice();
    d.screen = 'settings';
    const { call } = await connect(d);
    const line = /(@\w+) "Wi-Fi On"/.exec((await call('screen')).text)!;
    const reads = d.calls.filter((c) => c.name === 'tree').length;
    await call('tap', { ref: line[1], read: 'none' });
    expect(d.calls.filter((c) => c.name === 'tree').length).toBe(reads);
  });
});

describe('a first call that launches', () => {
  it('names the app before the device opens, and only then', async () => {
    const d = new FakeDevice();
    const began: string[] = [];
    (d as { launchAlongside?: (pkg: string) => void }).launchAlongside = (pkg) => {
      began.push(`${pkg} with hello ${d.calls.some((c) => c.name === 'open')}`);
    };
    const { call } = await connect(d);
    expect((await call('launch_app', { app: 'dev.app' })).error).toBe(false);
    await call('launch_app', { app: 'dev.app' });
    expect(began).toEqual(['dev.app with hello false']);
  });
});

describe('a folded answer', () => {
  const folded = async () => {
    const d = new FakeDevice();
    d.screen = 'settings';
    return { d, ...(await connect(d)) };
  };

  it('puts rows under one header and counts what they hold', async () => {
    const { call } = await folded();
    const r = await call('screen');
    expect(r.data.elements).toBe(10);
    expect(r.text.split('\n').slice(1)).toEqual([
      '10 elements: ref role "label" x,y flags; 6 inside rows, by find',
      expect.stringMatching(/^@\w+ text "Ayarlar" 540,150$/),
      'tappable x=540 clickable: ref "label" y',
      expect.stringMatching(/^@\w+ "Wi-Fi On" 350$/),
      expect.stringMatching(/^@\w+ "Bluetooth Off" 450$/),
      expect.stringMatching(/^@\w+ "Hotspot Off" 550$/),
    ]);
  });

  it('leaves what a row holds to find, a selector and the ref find gives', async () => {
    const { d, call } = await folded();
    await call('screen');
    const { matches } = (await call('find', { text: 'Bluetooth' })).data;
    expect(matches).toMatchObject([{ role: 'text', label: 'Bluetooth', x: 300, y: 430 }]);
    expect((await call('tap', { selector: { text: 'Hotspot' } })).error).toBe(false);
    expect((await call('tap', { ref: matches[0].ref })).error).toBe(false);
    expect(act(d)).toMatchObject([
      { kind: 'tap', x: 300, y: 530 },
      { kind: 'tap', x: 300, y: 430 },
    ]);
  });

  it('acts on a folded row by the ref its line gives', async () => {
    const { d, call } = await folded();
    const line = /(@\w+) "Wi-Fi On"/.exec((await call('screen')).text)!;
    await call('tap', { ref: line[1] });
    expect(act(d)).toMatchObject([{ kind: 'tap', x: 540, y: 350 }]);
    expect(d.screen).toBe('settingsOff');
  });

  it('says a row once when a control of its name stands at its place, which find still gives and which acts', async () => {
    const d = new FakeDevice();
    d.screen = 'doubled';
    const { call } = await connect(d);
    const { text } = await call('screen');
    expect(text.match(/General/g)).toHaveLength(1);
    expect(text).toContain('; 3 inside rows, by find');
    const { matches } = (await call('find', { role: 'button', text: 'General' })).data;
    expect(matches).toMatchObject([{ role: 'button', label: 'General', y: 350 }]);
    await call('tap', { ref: matches[0].ref });
    expect(act(d)).toMatchObject([{ kind: 'tap', x: 540, y: 350 }]);
    expect(d.screen).toBe('home');
  });

  it('names in the diff what changed inside a row', async () => {
    const { call } = await folded();
    await call('screen');
    const r = await call('tap', { selector: { text: 'Wi-Fi' } });
    expect(r.data.screen).toBe('diff');
    expect(r.text).toContain('"Wi-Fi Off"');
    expect(r.text).toMatch(/text "Off" 300,370/);
  });
});

describe('scroll_to', () => {
  /** A list of 30 rows: a swipe up moves it by the finger's way, down to its end. */
  class ListDevice extends FakeDevice {
    offset = 0;
    swipes = 0;
    override current(): Tree {
      const rows = Array.from({ length: 30 }, (_, i) => ({
        t: `Row ${i}`,
        b: [0, 200 * i - this.offset, 1080, 200 * i - this.offset + 180] as [
          number,
          number,
          number,
          number,
        ],
      })).filter((r) => r.b[3] > 0 && r.b[1] < 2400);
      SCREENS.scroll = rows;
      this.screen = 'scroll';
      return super.current();
    }
    override async act(action: ActParams, opts = {}) {
      if (action.kind === 'gesture') {
        this.swipes++;
        const p = action.pointers[0]!;
        const by = p[0]!.y - p.at(-1)!.y;
        this.offset = Math.min(Math.max(this.offset + by, 0), 200 * 30 - 2400);
      }
      return super.act(action, opts);
    }
  }

  it('finds a row further down by scrolling, with no flick', async () => {
    const d = new ListDevice();
    const { call } = await connect(d);
    const r = await call('scroll_to', { selector: { text: 'Row 20' } });
    expect(r.error).toBe(false);
    expect(r.text).toMatch(/found .*"Row 20"/);
    expect(r.data.found).toBe(true);
    // it compares with its own last swipe, so it says nothing of whether the call changed the screen
    expect(r.data).not.toHaveProperty('changed');
    expect(r.text).not.toContain('no change seen');
    expect(d.swipes).toBeGreaterThan(0);
    const g = act(d).at(-1) as Extract<ActParams, { kind: 'gesture' }>;
    expect(g.pointers[0]!.at(-1)!.t).toBeGreaterThan(g.pointers[0]!.at(-2)!.t);
    expect(g.pointers[0]!.at(-1)!.y).toBe(g.pointers[0]!.at(-2)!.y);
  });

  it('answers once a list still coasting has stopped, with where the row ended', async () => {
    class Coasting extends ListDevice {
      coast = 0;
      override async act(action: ActParams, opts = {}) {
        const r = await super.act(action, opts);
        if (action.kind === 'gesture') this.coast = 4;
        return r;
      }
      override async tree() {
        if (this.coast > 0) {
          this.coast--;
          this.offset += 20;
        }
        return super.tree();
      }
    }
    const d = new Coasting();
    const { call } = await connect(d);
    const r = await call('scroll_to', { selector: { text: 'Row 20' }, read: 'full' });
    expect(r.error).toBe(false);
    expect(d.coast).toBe(0);
    const y = 200 * 20 - d.offset + 90;
    expect(r.text).toContain(`found`);
    expect(r.text).toMatch(new RegExp(`"Row 20" 540,${y}`));
  });

  it('stops at the list’s end when nothing moved', async () => {
    const d = new ListDevice();
    const { call } = await connect(d);
    const r = await call('scroll_to', { selector: { text: 'Row 99' }, maxSwipes: 40 });
    expect(r.error).toBe(true);
    expect(r.text).toContain('the list did not move');
    expect(r.text).toContain('nearest');
    expect(d.swipes).toBeLessThan(40);
  });

  it('stops at the bound, and says it could go on', async () => {
    const d = new ListDevice();
    const { call } = await connect(d);
    const r = await call('scroll_to', { selector: { text: 'Row 29' }, maxSwipes: 1 });
    expect(r.error).toBe(true);
    expect(r.text).toContain('can still move');
    expect(d.swipes).toBe(1);
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
    const name = await call('find', { id: 'dev.app:id/name' });
    expect(name.data.matches[0]).toMatchObject({
      role: 'textField',
      enabled: true,
      checked: false,
      focused: true,
      value: 'Ayşe',
      bounds: { x: 0, y: 100, w: 500, h: 100 },
    });
    expect(name.text).toContain('focused');
    const box = await call('find', { text: 'Agree' });
    expect(box.data.matches[0]).toMatchObject({ enabled: false, checked: true });
    expect(box.text).toContain('disabled');
    const pw = await call('find', { id: 'dev.app:id/pw' });
    expect(pw.data.matches[0].value).toBeUndefined();
    expect((await call('find', { role: 'checkbox' })).data.matches).toHaveLength(1);
  });

  it('answers a passing check, and refuses a failing one saying what it found', async () => {
    withScreen('state', [
      { c: 'android.widget.CheckBox', t: 'Agree', b: [0, 300, 500, 400], f: 1 | 2 | 16 | 32 },
    ]);
    const d = new FakeDevice();
    d.screen = 'state';
    const { call } = await connect(d);
    expect((await call('assert', { text: 'Agree', check: 'checked' })).error).toBe(false);
    expect((await call('assert', { text: 'Agree', check: 'enabled' })).error).toBe(false);
    expect((await call('assert', { text: 'Nope', check: 'absent' })).error).toBe(false);
    const off = await call('assert', { text: 'Agree', check: 'checked', expect: false });
    expect(off.error).toBe(true);
    expect(off.data.code).toBe('CHECK_FAILED');
    const text = await call('assert', { text: 'Agree', check: 'text', equals: 'No' });
    expect(text.text).toContain('reads "Agree", not "No"');
    const gone = await call('assert', { text: 'Agree', check: 'absent' });
    expect(gone.text).toContain('is on the screen');
  });
});

describe('gestures, keys, clipboard', () => {
  it('sends double tap, drag, pinch and a free plan', async () => {
    const d = new FakeDevice();
    const { call } = await connect(d);
    await call('gesture', { kind: 'double_tap', x: 10, y: 20 });
    expect(act(d).at(-1)).toEqual({ kind: 'doubleTap', x: 10, y: 20 });
    await call('gesture', { kind: 'drag', x: 10, y: 20, to: { x: 500, y: 600 }, durationMs: 900 });
    const drag = act(d).at(-1) as Extract<ActParams, { kind: 'gesture' }>;
    expect(drag.pointers[0]!.map((p) => [p.x, p.y])).toEqual([
      [10, 20],
      [10, 20],
      [500, 600],
      [500, 600],
    ]);
    expect(drag.pointers[0]![2]!.t - drag.pointers[0]![1]!.t).toBe(900);
    const plan = [
      [
        { x: 1, y: 1, t: 0 },
        { x: 2, y: 2, t: 100 },
      ],
      [
        { x: 3, y: 3, t: 0 },
        { x: 4, y: 4, t: 100 },
      ],
    ];
    await call('gesture', { kind: 'plan', pointers: plan });
    expect(act(d).at(-1)).toEqual({ kind: 'gesture', pointers: plan });
    await call('gesture', { kind: 'pinch', scale: 2 });
    expect((act(d).at(-1) as { pointers: unknown[] }).pointers).toHaveLength(2);
    await call('gesture', { kind: 'long_press', x: 1, y: 1, durationMs: 500 });
    expect(act(d).at(-1)).toEqual({ kind: 'longPress', x: 1, y: 1, durationMs: 500 });
    expect((await call('gesture', { kind: 'plan', pointers: [] })).error).toBe(true);
  });

  it('takes every key of the wire, under the name a tool gives it', async () => {
    const d = new FakeDevice();
    const { call } = await connect(d);
    for (const key of Keys.options) expect((await call('press_key', { key })).error).toBe(false);
    const sent = act(d).map((a) => (a as Extract<ActParams, { kind: 'key' }>).key);
    expect([...sent].sort()).toEqual([...KEYS].sort());
    expect(Keys.options).toContain('app_switch');
  });

  it('presses hardware buttons, and a server without home refuses what leaves the app', async () => {
    const d = new FakeDevice();
    const { call } = await connect(d);
    await call('press_key', { key: 'volume_up' });
    expect(act(d).at(-1)).toEqual({ kind: 'key', key: 'volumeUp' });
    await call('press_key', { key: 'lock' });
    expect(act(d).at(-1)).toEqual({ kind: 'key', key: 'lock' });
    const locked = await connect(new FakeDevice(), { policy: { allowHome: false } });
    for (const key of ['home', 'app_switch', 'power', 'lock'])
      expect((await locked.call('press_key', { key })).error).toBe(true);
    expect((await locked.call('press_key', { key: 'volume_down' })).error).toBe(false);
  });

  it('reads the clipboard and keeps a secret off it', async () => {
    const d = new FakeDevice();
    const { call } = await connect(d, { policy: { secrets: ['hunter2'] } });
    expect((await call('clipboard', { text: 'hi' })).error).toBe(false);
    Object.assign(d, { getClipboard: async () => 'pw hunter2' });
    expect((await call('clipboard')).text).not.toContain('hunter2');
    expect((await call('clipboard', { text: 'hunter2' })).error).toBe(true);
  });
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

  it('refuses when the app keeps it open', async () => {
    const d = new WithKeyboard();
    d.closes = false;
    const { call } = await connect(d);
    const r = await call('keyboard', { action: 'dismiss' });
    expect(r.error).toBe(true);
    expect(r.text).toContain('stayed open');
  });
});

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

describe('app management', () => {
  const manager = (over: Partial<AppManager> = {}): AppManager & { log: unknown[][] } => {
    const log: unknown[][] = [];
    const rec =
      (name: string) =>
      async (...a: unknown[]) => {
        log.push([name, ...a]);
      };
    return {
      log,
      install: async (...a: unknown[]) => {
        log.push(['install', ...a]);
        return [];
      },
      uninstall: rec('uninstall'),
      clearData: rec('clear'),
      listApps: async () => [{ id: 'dev.app', name: 'App', version: '1' }],
      appState: async () => 'running',
      permission: rec('permission'),
      launchWith: rec('launch'),
      ...over,
    } as AppManager & { log: unknown[][] };
  };

  it('does each action, with the selected app by default', async () => {
    const apps = manager();
    const d = Object.assign(new FakeDevice(), { apps });
    const { call } = await connect(d);
    expect((await call('app', { action: 'list' })).data.apps[0].id).toBe('dev.app');
    expect((await call('app', { action: 'state' })).data.state).toBe('foreground');
    expect((await call('app', { action: 'state', app: 'dev.other' })).data.state).toBe('running');
    await call('app', { action: 'install', path: '/tmp/a.apk' });
    await call('app', { action: 'clear' });
    await call('app', { action: 'uninstall', app: 'dev.other' });
    await call('app', { action: 'grant', service: 'camera' });
    await call('app', { action: 'revoke', service: 'camera' });
    await call('app', { action: 'launch', args: ['a=1'], env: { B: '2' } });
    expect(apps.log).toEqual([
      ['install', '/tmp/a.apk'],
      ['clear', 'dev.app'],
      ['uninstall', 'dev.other'],
      ['permission', 'dev.app', true, 'camera'],
      ['permission', 'dev.app', false, 'camera'],
      ['launch', 'dev.app', { args: ['a=1'], env: { B: '2' } }],
    ]);
  });

  it('keeps what an install answered on the phone in its answer, whatever the read mode', async () => {
    const apps = manager({
      install: async () => ['passed a Play Protect warning for dev.app: "Unsafe app blocked"'],
    });
    const { call } = await connect(Object.assign(new FakeDevice(), { apps }));
    for (const read of ['none', 'diff', 'full', undefined]) {
      const r = await call('app', {
        action: 'install',
        path: '/tmp/a.apk',
        ...(read && { read }),
      });
      expect(r.text).toContain('passed a Play Protect warning for dev.app: "Unsafe app blocked"');
      expect(r.data.done).toContain('Unsafe app blocked');
    }
  });

  it('takes no tool argument that could accept a warning', async () => {
    const apps = manager();
    const { call } = await connect(Object.assign(new FakeDevice(), { apps }));
    const r = await call('app', {
      action: 'install',
      path: '/tmp/a.apk',
      accept_install_warnings: true,
    });
    expect(r.error).toBe(true);
    expect(apps.log).toEqual([]);
  });

  it('refuses what the policy forbids and passes on a driver’s reason', async () => {
    const apps = manager({
      clearData: async () => {
        throw new DeviceError('UNSUPPORTED', 'an iPhone cannot');
      },
    });
    const d = Object.assign(new FakeDevice(), { apps });
    const { call } = await connect(d, { policy: { apps: ['dev.app'] } });
    const off = await call('app', { action: 'install', path: '/tmp/a.apk' });
    expect(off.data.code).toBe('POLICY_DENIED');
    expect((await call('app', { action: 'uninstall', app: 'dev.other' })).error).toBe(true);
    const r = await call('app', { action: 'clear' });
    expect(r.data.code).toBe('UNSUPPORTED');
    expect(r.text).toContain('an iPhone cannot');
    const none = await connect(new FakeDevice());
    expect((await none.call('app', { action: 'list' })).data.code).toBe('UNSUPPORTED');
  });
});

describe('simulators and emulators', () => {
  class Fleet implements VirtualDevices {
    log: string[] = [];
    all: Startable[] = [
      { id: 'A', name: 'one', state: 'stopped' },
      { id: 'B', name: 'two', state: 'running', serial: 'B' },
    ];
    startable = async () => this.all;
    boot = async (id: string) => {
      this.log.push(`boot ${id}`);
      this.all.find((d) => d.id === id)!.state = 'running';
      return id;
    };
    shutdown = async (id: string) => {
      this.log.push(`shutdown ${id}`);
      this.all.find((d) => d.id === id)!.state = 'stopped';
    };
  }

  it('boots only on request, and shuts down only what it started unless named', async () => {
    const fleet = new Fleet();
    const { call } = await connect(new FakeDevice(), { virtual: fleet });
    expect((await call('simulator', { action: 'list' })).text).toContain('A "one" stopped');
    expect((await call('simulator', { action: 'boot' })).error).toBe(true);
    expect((await call('simulator', { action: 'shutdown' })).text).toContain('none to shut down');
    expect(fleet.log).toEqual([]);
    expect((await call('simulator', { action: 'boot', name: 'one' })).data.serial).toBe('A');
    expect((await call('simulator', { action: 'list' })).text).toContain('started by this tool');
    await call('simulator', { action: 'shutdown' });
    expect(fleet.log).toEqual(['boot A', 'shutdown A']);
    await call('simulator', { action: 'shutdown', name: 'B' });
    expect(fleet.log.at(-1)).toBe('shutdown B');
    expect((await call('simulator', { action: 'boot', name: 'nope' })).data.code).toBe('NOT_FOUND');
  });
});

describe('device conditions', () => {
  class Settings implements DeviceSettings {
    values: Record<string, string> = { dark_mode: 'no', text_size: '1.0' };
    failing = false;
    pushed: unknown[] = [];
    get = async (name: SettingName) => {
      if (name === 'network')
        throw new DeviceError('UNSUPPORTED', 'a phone has no network shaping');
      return this.values[name]!;
    };
    set = async (name: SettingName, value: string) => {
      if (this.failing) throw new DeviceError('INTERNAL', 'broke');
      this.values[name] = value;
    };
    push = async (app: string | undefined, title: string, body: string) => {
      this.pushed.push([app, title, body]);
    };
    biometric = async () => {
      throw new DeviceError('UNSUPPORTED', 'simulator only');
    };
    resetKeychain = async () => 3;
    events: unknown[] = [];
    fold = async (closed: boolean) => void this.events.push(['fold', closed]);
    call = async (number: string, end: boolean) => void this.events.push(['call', number, end]);
    sms = async (from: string, text: string) => void this.events.push(['sms', from, text]);
  }

  it('takes one-shot events, and refuses what is not one', async () => {
    const settings = new Settings();
    const { call } = await connect(Object.assign(new FakeDevice(), { settings }));
    await call('device_setting', { name: 'fold', value: 'closed' });
    await call('device_setting', { name: 'call', value: '+905551112233' });
    await call('device_setting', { name: 'call', value: 'end +905551112233' });
    await call('device_setting', { name: 'sms', title: '5553434', value: 'Merhaba' });
    expect(settings.events).toEqual([
      ['fold', true],
      ['call', '+905551112233', false],
      ['call', '+905551112233', true],
      ['sms', '5553434', 'Merhaba'],
    ]);
    expect((await call('device_setting', { name: 'fold', value: 'half' })).text).toMatch(
      /open or closed/,
    );
    expect((await call('device_setting', { name: 'call', value: 'someone' })).text).toMatch(
      /phone number/,
    );
    expect((await call('device_setting', { name: 'sms', title: 'x', value: 'y' })).text).toMatch(
      /phone number/,
    );
  });

  it('changes a condition and puts it back at the end of the session', async () => {
    const settings = new Settings();
    const d = Object.assign(new FakeDevice(), { settings });
    const { call, ctx } = await connect(d);
    expect((await call('device_setting', { name: 'dark_mode' })).data.value).toBe('no');
    await call('device_setting', { name: 'dark_mode', value: 'on' });
    await call('device_setting', { name: 'dark_mode', value: 'off' });
    await call('device_setting', { name: 'text_size', value: '1.3' });
    expect(settings.values).toEqual({ dark_mode: 'off', text_size: '1.3' });
    expect(await ctx.end()).toEqual([]);
    expect(settings.values).toEqual({ dark_mode: 'no', text_size: '1.0' });
  });

  it('restores on request, and reports what it cannot', async () => {
    const settings = new Settings();
    const d = Object.assign(new FakeDevice(), { settings });
    const { call, ctx } = await connect(d);
    await call('device_setting', { name: 'dark_mode', value: 'on' });
    settings.failing = true;
    const r = await call('device_setting', { name: 'restore' });
    expect(r.text).toContain('could not restore dark_mode');
    expect(r.data.notRestored).toHaveLength(1);
    expect((await ctx.end())[0]).toContain('dark_mode');
    settings.failing = false;
    expect((await call('device_setting', { name: 'restore' })).text).toContain(
      'restored dark_mode',
    );
    expect(settings.values.dark_mode).toBe('no');
    expect((await call('device_setting', { name: 'restore' })).text).toContain(
      'nothing was changed',
    );
  });

  it('passes on a refusal, posts a push, and says biometrics are not here', async () => {
    const settings = new Settings();
    const d = Object.assign(new FakeDevice(), { settings });
    const { call } = await connect(d);
    const net = await call('device_setting', { name: 'network', value: 'slow' });
    expect(net.data.code).toBe('UNSUPPORTED');
    expect(net.text).toContain('a phone has no network shaping');
    await call('device_setting', { name: 'push', value: 'hello', title: 'T' });
    expect(settings.pushed).toEqual([['dev.app', 'T', 'hello']]);
    const b = await call('device_setting', { name: 'biometric', value: 'match' });
    expect(b.data.code).toBe('UNSUPPORTED');
    expect((await call('device_setting', { name: 'biometric', value: 'x' })).error).toBe(true);
    const keychain = await call('device_setting', { name: 'keychain', value: 'reset' });
    expect(keychain.text).toBe('the keychain is empty: it held 3 items');
    expect((await call('device_setting', { name: 'keychain' })).text).toMatch(/needs value: reset/);
  });
});

describe('device claims', () => {
  const claimOf = (pid: number) => {
    const started = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
    }).trim();
    const dir = join(process.env.APPDYNO_STATE_DIR!, 'claims');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'emulator-5580.json'),
      JSON.stringify({ pid, started, tool: 'other agent', since: '2026-11-03T00:00:00Z' }),
    );
  };

  it('refuses a device a live process holds, naming it, unless asked to share', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']);
    try {
      claimOf(child.pid!);
      const d = new FakeDevice();
      const { call, ctx } = await connect(d, { defaults: { claims: true } });
      const r = await call('use_device', { device: d.serial });
      expect(r.error).toBe(true);
      expect(r.data.code).toBe('DEVICE_CLAIMED');
      expect(r.text).toContain(`pid ${child.pid}`);
      expect(r.text).toContain('other agent');
      expect((await call('list_devices')).data.devices[0].heldBy.pid).toBe(child.pid);
      expect((await call('use_device', { device: d.serial, share: true })).error).toBe(false);
      ctx.close();
    } finally {
      child.kill('SIGKILL');
    }
  });

  it('frees a dead owner’s claim, a pid reused by another process, and its own at the end', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']);
    claimOf(child.pid!);
    child.kill('SIGKILL');
    await new Promise((r) => child.once('exit', r));
    const d = new FakeDevice();
    const first = await connect(d, { defaults: { claims: true, tool: 'one' } });
    expect((await first.call('use_device', { device: d.serial })).error).toBe(false);
    expect((await first.call('list_devices')).data.devices[0].heldBy).toMatchObject({
      pid: process.pid,
      tool: 'one',
    });
    first.ctx.close();
    expect((await first.call('list_devices')).data.devices[0].heldBy).toBeUndefined();
    const dir = join(process.env.APPDYNO_STATE_DIR!, 'claims');
    writeFileSync(
      join(dir, 'emulator-5580.json'),
      JSON.stringify({ pid: process.pid, started: 'long ago', tool: 'x', since: 'y' }),
    );
    const second = await connect(new FakeDevice(), { defaults: { claims: true } });
    expect((await second.call('list_devices')).data.devices[0].heldBy).toBeUndefined();
  });
});
