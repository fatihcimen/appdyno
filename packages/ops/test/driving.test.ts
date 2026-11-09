import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  must,
  type AppManager,
  type Device,
  type DeviceProvider,
  type DeviceSettings,
  type SettingName,
  type Push,
  type PushRoute,
  type Startable,
  type VirtualDevices,
} from '@appdyno/core';
import { DeviceError, KEYS, type ActParams, type ErrorCode, type Tree } from '@appdyno/protocol';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import {
  DEFAULT_POLICY,
  ServerContext,
  type OpData,
  type OpName,
  type Policy,
} from '../src/index.js';
import { keyName, keyPress } from '../src/step-schemas.js';
import { FakeDevice, SCREENS, WithKeyboard } from './fake-device.js';
import { linkedClient } from './helpers.js';

type Result = {
  isError?: boolean;
  content: { type?: string; text?: string }[];
  structuredContent?: unknown;
};

/** What a tool answered, as this server writes it: its output, or a refusal's code and hint; any of it may be missing. */
type Answer<N extends OpName> = Partial<OpData<N>> & { code?: ErrorCode; hint?: string };

async function connect(
  device: Device,
  o: {
    policy?: Partial<Policy>;
    virtual?: VirtualDevices;
    defaults?: ConstructorParameters<typeof ServerContext>[2];
  } = {},
) {
  const provider: DeviceProvider = {
    list: () =>
      Promise.resolve([{ serial: device.serial, state: 'device', ready: true, model: 'Fake' }]),
    handles: () => true,
    open: () => device,
    ...(o.virtual && { virtual: o.virtual }),
  };
  const ctx = new ServerContext({ ...DEFAULT_POLICY, ...o.policy }, [provider], {
    app: 'dev.app',
    ...o.defaults,
  });
  const client = await linkedClient(ctx);
  const call = async <N extends OpName>(name: N, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as Result;
    return {
      error: r.isError === true,
      text: r.content.map((c) => c.text ?? '').join('\n'),
      data: r.structuredContent as Answer<N>,
      images: r.content.filter((c) => c.type === 'image').length,
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
    const send = must(/(@\w+) button "Gönder"/.exec((await call('screen')).text)?.[1], 'its ref');
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
    expect(opts.at(-3)?.settle).toBe(false);
    expect(must(opts.at(-2), 'the touch before').settle).toBeTruthy();
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
      steps: Array(31).fill({ action: 'press_key', key: 'tab' }),
    });
    expect(long.error).toBe(true);
    const most = await call('steps', {
      steps: Array(30).fill({ action: 'press_key', key: 'tab' }),
    });
    expect(most.error).toBe(false);
    expect(most.text.split('\n')).toContain('30. pressed tab');
  });

  it('takes any tool, with what each answers, images too', async () => {
    const d = new FakeDevice();
    const { call } = await connect(d);
    const r = await call('steps', {
      steps: [
        { action: 'find', text: 'Form' },
        { action: 'screenshot' },
        { action: 'tap', selector: { text: 'Form' } },
        { action: 'screenshot' },
        { action: 'device_info' },
      ],
    });
    expect(r.error).toBe(false);
    const lines = r.text.split('\n');
    expect(lines[0]).toMatch(/^1\. @\w+ \w+ "Form"/);
    expect(lines[1]).toMatch(/^2\. image 460x1024 px/);
    expect(lines[2]).toMatch(/^3\. tapped @\w+ "Form"/);
    expect(lines[3]).toMatch(/^4\. image /);
    expect(lines.join('\n')).toContain('5. ');
    expect(r.images).toBe(2);
  });

  it('gives an image at every step that asks, unchanged or not', async () => {
    const { call } = await connect(new FakeDevice());
    const r = await call('steps', {
      steps: [{ action: 'screenshot' }, { action: 'screenshot' }],
    });
    expect(r.error).toBe(false);
    expect(r.text).toContain('2. image');
  });

  it('reads a touch at its own step when the step says so, and refuses what is no step', async () => {
    const d = new FakeDevice();
    const { call } = await connect(d);
    const r = await call('steps', {
      steps: [
        { action: 'tap', selector: { text: 'Form' }, read: 'full' },
        { action: 'press_key', key: 'tab' },
      ],
    });
    expect(r.text.split('\n')[1]).toContain('foreground: dev.app');
    for (const action of ['steps', 'flow', 'nothing']) {
      const no = await call('steps', { steps: [{ action }] });
      expect(no.error).toBe(true);
      expect(no.text).toContain(`no step ${action}`);
    }
    const wrong = await call('steps', { steps: [{ action: 'find', nope: 1 }] });
    expect(wrong.error).toBe(true);
    expect(wrong.text).toContain('step 1');
    const read = await call('steps', { steps: [{ action: 'tap', x: 1, y: 1, read: 'much' }] });
    expect(read.text).toContain('step 1');
  });

  it('says which step failed, with what the others answered', async () => {
    const { call } = await connect(new FakeDevice());
    const r = await call('steps', {
      steps: [{ action: 'device_info' }, { action: 'app', action2: 1 }],
    });
    expect(r.error).toBe(true);
    expect(r.text).toContain('step 2');
  });
});

describe('waiting on the device', () => {
  class Waiting extends FakeDevice {
    waits: (string | undefined)[] = [];
    next: Tree | undefined;
    waitChange = (since: string | undefined) => {
      this.waits.push(since);
      if (since === undefined) return Promise.resolve({ sig: 'a', tree: this.current() });
      const t = this.next;
      this.next = undefined;
      return Promise.resolve(t ? { sig: 'b', tree: t } : { sig: since });
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
    f.waitChange = () => Promise.reject(new DeviceError('INTERNAL', 'no'));
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
    const line = must(/(@\w+) "Wi-Fi On" (\d+)/.exec((await call('screen')).text), 'its line');
    expect(line[2]).toBe('350');
    // the app adds a row above it, with no action of ours
    withScreen('settingsMoved', [
      { b: [0, 200, 1080, 300], c: 'android.widget.LinearLayout', d: 'Added', f: 19 },
      ...must(SCREENS.settings, 'the settings').map((n) => ({
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
    const line = must(/(@\w+) "Wi-Fi On"/.exec((await call('screen')).text), 'its line');
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
      began.push(`${pkg} with hello ${String(d.calls.some((c) => c.name === 'open'))}`);
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
    expect((await call('tap', { ref: matches?.[0]?.ref })).error).toBe(false);
    expect(act(d)).toMatchObject([
      { kind: 'tap', x: 300, y: 530 },
      { kind: 'tap', x: 300, y: 430 },
    ]);
  });

  it('acts on a folded row by the ref its line gives', async () => {
    const { d, call } = await folded();
    const line = must(/(@\w+) "Wi-Fi On"/.exec((await call('screen')).text), 'its line');
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
    await call('tap', { ref: must(matches?.[0], 'a match').ref });
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

type Bounds = [number, number, number, number];

/** A list of 30 rows: a swipe up moves it by the finger's way, down to its end. */
class ScrollingList extends FakeDevice {
  offset = 0;
  swipes = 0;
  /** What the list takes of a finger's way. */
  taken(by: number) {
    return by;
  }
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
      const p = must(action.pointers[0], 'a path');
      const by = this.taken(must(p[0], 'its start').y - must(p.at(-1), 'its end').y);
      this.offset = Math.min(Math.max(this.offset + by, 0), 200 * 30 - 2400);
    }
    return super.act(action, opts);
  }
}

/** A page with a row across it that only a finger on it moves, and a banner above that changes by itself. */
class SidewaysRow extends FakeDevice {
  offset = 0;
  ticks = 0;
  strokes = 0;
  override current(): Tree {
    SCREENS.row = [
      { t: `Banner ${this.ticks++}`, b: [0, 100, 1080, 300] },
      ...Array.from({ length: 10 }, (_, i) => ({
        t: `Fruit ${i + 1}`,
        b: [300 * i - this.offset, 800, 300 * i - this.offset + 280, 1000] as Bounds,
      })).filter((r) => r.b[2] > 0 && r.b[0] < 1080),
    ];
    this.screen = 'row';
    return super.current();
  }
  override async act(action: ActParams, opts = {}) {
    if (action.kind === 'gesture') {
      this.strokes++;
      const p = must(action.pointers[0], 'a path');
      const [start] = p;
      const end = p.at(-1);
      if (start && end && start.y >= 800 && start.y <= 1000)
        this.offset = Math.max(this.offset + start.x - end.x, 0);
    }
    return super.act(action, opts);
  }
}

describe('scroll_to', () => {
  const ListDevice = ScrollingList;

  it('moves a row across the page with a finger on the row', async () => {
    const d = new SidewaysRow();
    const { call } = await connect(d);
    const r = await call('scroll_to', {
      selector: { text: 'Fruit 9' },
      direction: 'left',
      x: 540,
      y: 900,
    });
    expect(r.text).toMatch(/found .*"Fruit 9"/);
  });

  it('says of a row it did not move that it did not, whatever else changes on the screen', async () => {
    const d = new SidewaysRow();
    const { call } = await connect(d);
    const r = await call('scroll_to', {
      selector: { text: 'Fruit 9' },
      direction: 'left',
      maxSwipes: 8,
    });
    expect(r.error).toBe(true);
    expect(r.text).toContain('the list did not move');
    expect(d.strokes).toBeLessThan(8);
  });

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
    const before = must(g.pointers[0]?.at(-2), 'the point before its end');
    expect(g.pointers[0]?.at(-1)?.t).toBeGreaterThan(before.t);
    expect(g.pointers[0]?.at(-1)?.y).toBe(before.y);
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

  it('takes one stroke that moved nothing for a screen still arriving, not for the list’s end', async () => {
    class Arriving extends ListDevice {
      lost = 1;
      override taken(by: number) {
        return this.lost-- > 0 ? 0 : by;
      }
    }
    const d = new Arriving();
    const { call } = await connect(d);
    const r = await call('scroll_to', { selector: { text: 'Row 20' } });
    expect(r.error).toBe(false);
    expect(r.data.found).toBe(true);
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

describe('swipe exact', () => {
  /** A list that takes a finger's way less 10, and gives no more than its 30 rows. */
  class Dragged extends ScrollingList {
    override taken(by: number) {
      return Math.abs(by) <= 10 ? 0 : by - Math.sign(by) * 10;
    }
  }

  it('moves the content by the distance, whatever a drag loses at its start', async () => {
    const d = new Dragged();
    const { call } = await connect(d);
    const r = await call('swipe', { direction: 'up', distance: 3000, exact: true });
    expect(r.error).toBe(false);
    expect(Math.abs(d.offset - 3000)).toBeLessThanOrEqual(2);
    expect(r.text).toMatch(/^scrolled up 3\d{3} of 3000 in \d strokes/);
    const moves = act(d).filter((a) => a.kind === 'gesture');
    expect(moves.length).toBeGreaterThan(1);
  });

  it('a list that ends is no failure: the answer says how far it went', async () => {
    const d = new Dragged();
    d.offset = 200 * 30 - 2400 - 300;
    const { call } = await connect(d);
    const r = await call('swipe', { direction: 'up', distance: 1000, exact: true });
    expect(r.error).toBe(false);
    expect(r.text).toMatch(/^scrolled up 300 of 1000 in \d strokes?: the list ended/);
  });

  it('wants a distance', async () => {
    const { call } = await connect(new Dragged());
    expect((await call('swipe', { direction: 'up', exact: true })).error).toBe(true);
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
    expect(name.data.matches?.[0]).toMatchObject({
      role: 'textField',
      enabled: true,
      checked: false,
      focused: true,
      value: 'Ayşe',
      bounds: { x: 0, y: 100, w: 500, h: 100 },
    });
    expect(name.text).toContain('focused');
    const box = await call('find', { text: 'Agree' });
    expect(box.data.matches?.[0]).toMatchObject({ enabled: false, checked: true });
    expect(box.text).toContain('disabled');
    const pw = await call('find', { id: 'dev.app:id/pw' });
    expect(must(pw.data.matches?.[0], 'a match').value).toBeUndefined();
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
    expect(drag.pointers[0]?.map((p) => [p.x, p.y])).toEqual([
      [10, 20],
      [10, 20],
      [500, 600],
      [500, 600],
    ]);
    const path = must(drag.pointers[0], 'its path');
    expect(must(path[2], 'its third point').t - must(path[1], 'its second point').t).toBe(900);
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
    const names = KEYS.map(keyName);
    for (const key of names) expect((await call('press_key', { key })).error).toBe(false);
    const sent = act(d).map((a) => (a as Extract<ActParams, { kind: 'key' }>).key);
    expect([...sent].sort()).toEqual([...KEYS].sort());
    expect(names).toContain('app_switch');
  });

  it('holds keys during a letter, a digit or a named key, and only a keyboard key', async () => {
    expect(keyPress('command+a')).toEqual({ key: 'a', modifiers: ['command'] });
    expect(keyPress('control+shift+arrow_left')).toEqual({
      key: 'arrowLeft',
      modifiers: ['control', 'shift'],
    });
    expect(keyPress('7')).toEqual({ key: '7', modifiers: [] });
    for (const bad of ['command+home', 'alt+a', 'command+', 'A', 'warp'])
      expect(keyPress(bad)).toBeUndefined();

    const d = new FakeDevice();
    const { call } = await connect(d);
    expect((await call('press_key', { key: 'command+a' })).text).toMatch(/^pressed command\+a/);
    expect(act(d).at(-1)).toEqual({ kind: 'key', key: 'a', modifiers: ['command'] });
    const refused = await call('press_key', { key: 'alt+a' });
    expect(refused).toMatchObject({ error: true });
    expect(refused.text).toContain('command+a');
  });

  it('presses count times with one settle, the last', async () => {
    const d = new FakeDevice();
    const { call } = await connect(d);
    await call('screen');
    d.calls.length = 0;
    const r = await call('press_key', { key: 'delete', count: 3 });
    expect(r.text).toMatch(/^pressed delete 3 times/);
    const acts = d.calls.filter((c) => c.name === 'act');
    expect(acts.map((c) => c.args[1])).toEqual([
      { settle: false, read: 'none' },
      { settle: false, read: 'none' },
      expect.objectContaining({ read: 'tree' }),
    ]);
    expect((await call('press_key', { key: 'delete', count: 0 })).error).toBe(true);
  });

  it('presses hardware buttons, and a server without home refuses what leaves the app', async () => {
    const d = new FakeDevice();
    const { call } = await connect(d);
    await call('press_key', { key: 'volume_up' });
    expect(act(d).at(-1)).toEqual({ kind: 'key', key: 'volumeUp' });
    await call('press_key', { key: 'lock' });
    expect(act(d).at(-1)).toEqual({ kind: 'key', key: 'lock' });
    const locked = await connect(new FakeDevice(), { policy: { allowHome: false } });
    for (const key of ['home', 'app_switch', 'power', 'lock', 'command+h', 'command+space'])
      expect((await locked.call('press_key', { key })).error).toBe(true);
    expect((await locked.call('press_key', { key: 'volume_down' })).error).toBe(false);
    expect((await locked.call('press_key', { key: 'command+a' })).error).toBe(false);
  });

  it('opens the system views by name, and a server without home refuses them', async () => {
    const d = new FakeDevice();
    const { call } = await connect(d);
    const r = await call('press_key', { key: 'control_center' });
    expect(r.text).toMatch(/^opened control_center/);
    expect(d.calls.filter((c) => c.name === 'openView').map((c) => c.args[0])).toEqual([
      'control_center',
    ]);
    const locked = await connect(new FakeDevice(), { policy: { allowHome: false } });
    for (const key of ['control_center', 'notification_center', 'spotlight'])
      expect((await locked.call('press_key', { key })).error).toBe(true);
  });

  it('opens Settings at a page or at an app, and takes one or the other', async () => {
    const d = new FakeDevice();
    const { call } = await connect(d);
    const opened = () => d.calls.filter((c) => c.name === 'openSettings').map((c) => c.args[0]);
    expect((await call('open_link', { settings: 'about' })).text).toMatch(
      /^opened Settings: about/,
    );
    await call('open_link', { settings: 'app' });
    await call('open_link', { settings: 'com.example.other' });
    expect(opened()).toEqual([{ page: 'about' }, { app: 'dev.app' }, { app: 'com.example.other' }]);
    expect((await call('open_link', {})).error).toBe(true);
    expect((await call('open_link', { url: 'https://a.b', settings: 'about' })).error).toBe(true);
    const wrong = await call('open_link', { settings: 'wifii' });
    expect(wrong.error).toBe(true);
    // the device's own pages, Android's here: a fingerprint and security, and none of iOS's
    expect(wrong.text).toMatch(/\bfingerprint\b/);
    expect(wrong.text).toMatch(/\bsecurity, /);
    for (const ios of ['siri', 'game_center', 'screen_time', 'privacy_photos'])
      expect(wrong.text).not.toContain(ios);
    const theirs = await call('open_link', { settings: 'game_center' });
    expect([theirs.data.code, theirs.text]).toEqual(['INVALID_ARGUMENT', wrong.text]);
    expect(opened()).toHaveLength(3);
    const locked = await connect(new FakeDevice(), { policy: { allowHome: false } });
    expect((await locked.call('open_link', { settings: 'about' })).data.code).toBe('POLICY_DENIED');
  });

  it('holds a drag at its start for as long as it is told', async () => {
    const d = new FakeDevice();
    const { call } = await connect(d);
    await call('gesture', { kind: 'drag', x: 10, y: 10, to: { x: 10, y: 500 }, holdMs: 900 });
    const path = must(
      (act(d).at(-1) as Extract<ActParams, { kind: 'gesture' }>).pointers[0],
      'its path',
    );
    expect(path[1]).toEqual({ x: 10, y: 10, t: 900 });
    await call('gesture', { kind: 'drag', x: 10, y: 10, to: { x: 10, y: 500 } });
    const usual = must(
      (act(d).at(-1) as Extract<ActParams, { kind: 'gesture' }>).pointers[0],
      'its path',
    );
    expect(usual[1]?.t).toBe(150);
  });

  it('ends a fixed location, and wants a position or that', async () => {
    const d = new FakeDevice();
    const { call } = await connect(d);
    expect((await call('set_location', { clear: true })).text).toContain('real one');
    expect(d.calls.some((c) => c.name === 'clearLocation')).toBe(true);
    expect((await call('set_location', { lat: 1 })).error).toBe(true);
  });

  it('asks for an image of the screen in tap units', async () => {
    const d = new FakeDevice();
    const { call } = await connect(d);
    const asked: unknown[] = [];
    const shot = d.screenshot.bind(d);
    Object.assign(d, {
      screenshot: async (o: unknown) => {
        asked.push(o);
        return shot();
      },
    });
    await call('screenshot', { points: true });
    await call('screenshot');
    await call('screenshot', { width: 540 });
    await call('screenshot', { width: 8_000 });
    expect(asked).toMatchObject([
      { maxPx: 2400 },
      { maxPx: 800 },
      { maxPx: 1200 },
      { maxPx: 8_192 },
    ]);
  });

  it('launches an app by its name, in any case, and refuses a name it cannot settle', async () => {
    const d = new FakeDevice();
    const names = [
      { id: 'dev.one', name: 'Ödeme' },
      { id: 'dev.two', name: 'Twin' },
      { id: 'dev.three', name: 'Twin' },
    ];
    Object.assign(d, { apps: { listApps: () => Promise.resolve(names) } });
    const { call } = await connect(d);
    expect((await call('launch_app', { app: 'ödeme' })).text).toContain(
      'brought dev.one to the front, on the screen it was on',
    );
    const none = await call('launch_app', { app: 'Nothing' });
    expect(none.text).toContain('no app named Nothing');
    expect((await call('launch_app', { app: 'Twin' })).text).toContain('dev.two, dev.three');
  });

  it('says whether a launch started the app or brought a running one to the front, asked before a first launch begins', async () => {
    const d = new FakeDevice();
    d.running = false;
    // the first call's launch begins alongside the device's start, and the app runs from then on
    d.launchAlongside = () => {
      d.running = true;
    };
    const { call } = await connect(d);
    expect((await call('launch_app')).text).toMatch(/^started dev\.app\n/);
    expect((await call('launch_app')).text).toMatch(
      /^brought dev\.app to the front, on the screen it was on\n/,
    );
    d.running = false;
    expect((await call('launch_app')).data.done).toBe('started dev.app');
  });

  it('warns that the app is not in front only when it left by itself', async () => {
    const d = new FakeDevice();
    let front = 'dev.app';
    const shown = d.current.bind(d);
    d.current = () => {
      const t = shown();
      for (const w of t.windows) w.pkg = front;
      return t;
    };
    const { call } = await connect(d);
    const warned = async (n: OpName, args: Record<string, unknown> = {}) =>
      (await call(n, args)).text.includes('WARNING: the app is not in the foreground');
    await call('screen');
    front = 'launcher';
    expect([await warned('press_key', { key: 'home' }), await warned('screen')]).toEqual([
      false,
      false,
    ]);
    front = 'dev.other';
    expect(await warned('launch_app', { app: 'dev.other' })).toBe(false);
    front = 'dev.app';
    expect(await warned('launch_app')).toBe(false);
    // back in front, and gone with nothing that took it away
    front = 'launcher';
    expect(await warned('screen')).toBe(true);
  });

  it('refuses an app the device does not have by one code on every platform, with how to list them', async () => {
    const d = new FakeDevice();
    let state = 'not_installed';
    Object.assign(d, { apps: { appState: () => Promise.resolve(state) } });
    // a simulator's launch of an app it does not have fails in simctl's own words
    d.launch = () => Promise.reject(new DeviceError('INTERNAL', 'simctl launch: code=4 failed'));
    const { call } = await connect(d);
    const gone = await call('launch_app', { app: 'dev.gone' });
    expect([gone.data.code, gone.text]).toEqual([
      'NOT_FOUND',
      'NOT_FOUND: dev.gone is not installed on emulator-5580\nhint: app action list names the installed apps',
    ]);
    // an app that is there and does not start keeps what its launch said
    state = 'stopped';
    d.launch = () => Promise.reject(new DeviceError('APP_NOT_RUNNING', 'dev.app did not start'));
    expect((await call('launch_app')).text).toBe('APP_NOT_RUNNING: dev.app did not start');
  });

  it('lists the links an app opens, as lines and as data', async () => {
    const d = new FakeDevice();
    const links = [
      { url: 'demo://', kind: 'scheme' },
      { url: 'https://example.com', kind: 'domain', state: 'verified' },
    ];
    Object.assign(d, { apps: { links: () => Promise.resolve(links) } });
    const { call } = await connect(d);
    const r = await call('open_link', { links: 'dev.app' });
    expect(r.text).toBe('scheme demo://\ndomain https://example.com: verified');
    expect(r.data.links).toEqual(links);
    Object.assign(d, { apps: { links: () => Promise.resolve([]) } });
    expect((await call('open_link', { links: 'dev.app' })).text).toBe('dev.app opens no links');
  });

  it('keeps a name to what the server allows', async () => {
    const d = new FakeDevice();
    Object.assign(d, {
      apps: { listApps: () => Promise.resolve([{ id: 'dev.other', name: 'Other' }]) },
    });
    const { call } = await connect(d, { policy: { apps: ['dev.app'] } });
    expect((await call('launch_app', { app: 'Other' })).text).toContain('not an allowed app');
  });

  it('launches in a language, restarting the app, and refuses what is none', async () => {
    const d = new FakeDevice();
    const launched: unknown[] = [];
    Object.assign(d, {
      apps: {
        launchWith: (app: string, o: unknown) => {
          launched.push([app, o]);
          return Promise.resolve();
        },
      },
    });
    const { call } = await connect(d);
    const r = await call('launch_app', { language: 'pt-BR' });
    expect(r.text).toMatch(/^started dev\.app in pt-BR/);
    expect(launched).toEqual([['dev.app', { language: 'pt-BR' }]]);
    expect((await call('launch_app', { language: 'tr; rm -rf' })).error).toBe(true);
  });

  it('saves a picture, into a folder too, and leaves what is there', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'appdyno-shot-'));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const d = new FakeDevice();
    Object.defineProperty(d, 'mirror', { value: {} });
    const { call } = await connect(d);
    const file = join(dir, 'a.png');
    expect((await call('screenshot', { file })).text).toContain(`saved ${file}`);
    expect(readFileSync(file)).toEqual(Buffer.from([1, 2, 3]));
    const again = await call('screenshot', { file });
    expect(again.error).toBe(true);
    expect(again.text).toContain('is there already');
    expect((await call('screenshot', { file, overwrite: true })).error).toBe(false);
    const named = await call('screenshot', { file: dir });
    expect(named.data.file).toMatch(/emulator-5580-.*\.png$/);
    expect((await call('screenshot', { file: join(dir, 'a.gif') })).error).toBe(true);
    // a picture at full size, 3 pixels to a tap unit, says to tap at a third
    const png = Buffer.alloc(24);
    png[0] = 0x89;
    png.writeUInt32BE(3240, 16);
    png.writeUInt32BE(7200, 20);
    d.screenshot = () =>
      Promise.resolve({ meta: { w: 3240, h: 7200, format: 'png', bytes: 24 }, data: png });
    const full = await call('screenshot', { file: join(dir, 'full.png') });
    expect([full.text, full.data.scale]).toEqual([
      `saved ${join(dir, 'full.png')} (3240x7200 px; its pixel x,y is tapped at x/3, y/3)`,
      0.333,
    ]);
  });

  it('reads the clipboard and keeps a secret off it', async () => {
    const d = new FakeDevice();
    const { call } = await connect(d, { policy: { secrets: ['hunter2'] } });
    expect((await call('clipboard', { text: 'hi' })).error).toBe(false);
    Object.assign(d, { getClipboard: () => Promise.resolve('pw hunter2') });
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
    expect((await call('open_link', { url: 'app://screen' })).data.done).toBe(
      'opened app://screen',
    );
    d.add = dialog('android', 3);
    expect((await call('open_link', { url: 'app://screen' })).data.done).toBe(
      'sent app://screen, and the system asks: Pixel keeps stopping (Close app, App info): answer it with alert',
    );
    expect((await call('open_link', { url: 'app://screen', read: 'none' })).data.done).toBe(
      'opened app://screen',
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

describe('app management', () => {
  const manager = (over: Partial<AppManager> = {}): AppManager & { log: unknown[][] } => {
    const log: unknown[][] = [];
    const rec =
      (name: string) =>
      (...a: unknown[]) => {
        log.push([name, ...a]);
        return Promise.resolve();
      };
    return {
      log,
      install: (...a: unknown[]) => {
        log.push(['install', ...a]);
        return Promise.resolve([]);
      },
      uninstall: rec('uninstall'),
      clearData: rec('clear'),
      downloadData: rec('download'),
      replaceData: rec('replace'),
      buildAndInstall: (...a: unknown[]) => {
        log.push(['build', ...a]);
        return Promise.resolve('dev.built');
      },
      listApps: () => Promise.resolve([{ id: 'dev.app', name: 'App', version: '1' }]),
      appState: () => Promise.resolve('running'),
      permission: rec('permission'),
      launchWith: rec('launch'),
      ...over,
    } as AppManager & { log: unknown[][] };
  };

  /** A person's yes in advance, by the server's flag: what asks first is `approval.test.ts`'s. */
  const allowed = { policy: { allowDataLoss: 'virtual' as const } };

  it('says whether launch started the app or restarted a running one, in the words launch_app uses', async () => {
    const d = Object.assign(new FakeDevice(), { apps: manager() });
    const { call } = await connect(d);
    expect((await call('app', { action: 'launch' })).text).toMatch(
      /^restarted dev\.app, which was running\n/,
    );
    d.running = false;
    expect((await call('app', { action: 'launch' })).data.done).toBe('started dev.app');
  });

  it('does each action, with the selected app by default', async () => {
    const apps = manager();
    const d = Object.assign(new FakeDevice(), { apps });
    const { call } = await connect(d, allowed);
    expect((await call('app', { action: 'list' })).data.apps?.[0]?.id).toBe('dev.app');
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
      install: () =>
        Promise.resolve(['passed a Play Protect warning for dev.app: "Unsafe app blocked"']),
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

  it('builds, installs and launches what a project makes, and only with no allowlist', async () => {
    const apps = manager();
    const { call } = await connect(Object.assign(new FakeDevice(), { apps }));
    expect((await call('app', { action: 'build_and_run' })).error).toBe(true);
    const built = await call('app', {
      action: 'build_and_run',
      path: '/tmp/My.xcodeproj',
      scheme: 'My',
      configuration: 'Release',
      read: 'none',
    });
    expect(built.text).toContain('built and launched dev.built');
    expect(apps.log[0]).toEqual([
      'build',
      { project: '/tmp/My.xcodeproj', scheme: 'My', configuration: 'Release' },
    ]);
    expect(apps.log[1]?.slice(0, 2)).toEqual(['launch', 'dev.built']);

    const narrow = manager();
    const { call: narrowCall } = await connect(Object.assign(new FakeDevice(), { apps: narrow }), {
      policy: { apps: ['dev.app'] },
    });
    const refused = await narrowCall('app', { action: 'build_and_run', path: '/tmp/a' });
    expect(refused.error).toBe(true);
    expect(narrow.log).toEqual([]);
  });

  it('lists a screen and presses by name, with no runner', async () => {
    const pressed: string[] = [];
    const inspector = {
      elements: () =>
        Promise.resolve([
          { caption: 'Form, Button', identifier: 'open_form' },
          { caption: 'Title' },
        ]),
      press: (name: string) => {
        pressed.push(name);
        return Promise.resolve({ caption: 'Form, Button' });
      },
    };
    const { call } = await connect(Object.assign(new FakeDevice(), { inspector }));
    const list = await call('inspector', { action: 'list' });
    expect(list.text).toBe('Form, Button #open_form\nTitle');
    expect((await call('inspector', { action: 'press' })).error).toBe(true);
    expect(pressed).toEqual([]);
    expect((await call('inspector', { action: 'press', name: 'Form' })).text).toBe(
      'pressed Form, Button',
    );
    expect(pressed).toEqual(['Form']);
    const none = await connect(new FakeDevice());
    expect((await none.call('inspector', { action: 'list' })).error).toBe(true);
  });

  it('copies an app data only with a safe folder', async () => {
    const apps = manager();
    const { call } = await connect(Object.assign(new FakeDevice(), { apps }), allowed);
    const base = mkdtempSync(join(tmpdir(), 'app-data-op-'));
    try {
      const to = join(base, 'new', 'copy');
      const down = { action: 'download_data', app: 'dev.app', path: to };
      expect((await call('app', { action: 'download_data', app: 'dev.app' })).error).toBe(true);
      expect((await call('app', down)).text).toContain(to);
      expect(apps.log).toEqual([['download', 'dev.app', to]]);
      expect(statSync(to).mode & 0o777).toBe(0o700);
      // a copy never lands among what a folder already holds
      writeFileSync(join(to, 'mine.txt'), 'mine');
      const refused = await call('app', down);
      expect(refused.error).toBe(true);
      expect(refused.text).toContain('new or empty');
      expect(apps.log).toHaveLength(1);

      const up = { action: 'replace_data', app: 'dev.app', path: to };
      expect((await call('app', up)).text).toContain(to);
      expect(apps.log.at(-1)).toEqual(['replace', 'dev.app', to]);
      const missing = await call('app', { ...up, path: join(base, 'gone') });
      expect(missing.error).toBe(true);
      expect(apps.log).toHaveLength(2);
    } finally {
      rmSync(base, { recursive: true, force: true });
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
      clearData: () => Promise.reject(new DeviceError('UNSUPPORTED', 'an iPhone cannot')),
    });
    const d = Object.assign(new FakeDevice(), { apps });
    const { call } = await connect(d, { policy: { apps: ['dev.app'], allowDataLoss: 'virtual' } });
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
    readonly kind = 'simulator';
    readonly platform = 'ios';
    startable = () => Promise.resolve(this.all);
    boot = (id: string) => {
      this.log.push(`boot ${id}`);
      must(
        this.all.find((d) => d.id === id),
        id,
      ).state = 'running';
      return Promise.resolve(id);
    };
    shutdown = (id: string) => {
      this.log.push(`shutdown ${id}`);
      must(
        this.all.find((d) => d.id === id),
        id,
      ).state = 'stopped';
      return Promise.resolve();
    };
    create = () => {
      this.all.push({ id: 'C', name: 'new', state: 'stopped' });
      return Promise.resolve('C');
    };
  }

  it('selects the one it creates, so that the next call goes to it', async () => {
    const fleet = new Fleet();
    const { call, ctx } = await connect(new FakeDevice(), { virtual: fleet });
    const r = await call('simulator', { action: 'create', name: 'iPhone 17' });
    expect(r.text).toContain('selected as C');
    expect(ctx.selected).toBe('C');
  });

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
    get = (name: SettingName) => {
      if (name === 'network')
        return Promise.reject(new DeviceError('UNSUPPORTED', 'a phone has no network shaping'));
      return Promise.resolve(must(this.values[name], name));
    };
    set = (name: SettingName, value: string): Promise<undefined> => {
      if (this.failing) return Promise.reject(new DeviceError('INTERNAL', 'broke'));
      this.values[name] = value;
      return Promise.resolve(undefined);
    };
    /** The app each listing of routes was for. */
    routesFor: (string | undefined)[] = [];
    pushRoutes = (app?: string): Promise<PushRoute[]> => {
      this.routesFor.push(app);
      return Promise.resolve([
        { type: 'alert', route: 'by hand', fields: ['title', 'data'], template: '{"aps":{}}' },
        { type: 'tapped', why: 'no hand' },
        { type: 'widgets', route: 'by APNs', fields: [], template: '{"aps":{}}' },
      ]);
    };
    push = (app: string, push: Push) => {
      this.pushed.push([app, push]);
      return Promise.resolve(`pushed to ${app}`);
    };
    biometric = () => Promise.reject(new DeviceError('UNSUPPORTED', 'simulator only'));
    resetKeychain = () => Promise.resolve(3);
    events: unknown[] = [];
    call = (number: string, end: boolean) => {
      this.events.push(['call', number, end]);
      return Promise.resolve();
    };
    sms = (from: string, text: string) => {
      this.events.push(['sms', from, text]);
      return Promise.resolve();
    };
  }

  it('answers changed only when the device reads it moved, as a command may take what it cannot do and say nothing', async () => {
    const settings = new Settings();
    settings.values.text_size = 'large';
    const set = settings.set;
    // as a simulator takes 1.3: "Invalid argument", and exit 0
    settings.set = (name: SettingName, value: string) =>
      value === '1.3' ? Promise.resolve(undefined) : set(name, value);
    const { call } = await connect(Object.assign(new FakeDevice(), { settings }));
    const r = await call('device_setting', { name: 'text_size', value: '1.3' });
    expect([r.error, r.text, r.data.changed, r.data.value]).toEqual([
      false,
      'text_size reads large, as before: nothing changed',
      undefined,
      'large',
    ]);
    expect((await call('device_setting', { name: 'restore' })).text).toBe('nothing was changed');
    const moved = await call('device_setting', { name: 'text_size', value: 'extra-large' });
    expect(moved.data.changed).toEqual({ text_size: 'extra-large' });
  });

  it('restores only what reads as it was, and keeps the rest written down with what it reads', async () => {
    const settings = new Settings();
    const { call } = await connect(Object.assign(new FakeDevice(), { settings }));
    await call('device_setting', { name: 'dark_mode', value: 'on' });
    const set = settings.set;
    // as Android's own write of a scale just before lands after the one that puts it back
    settings.set = () => Promise.resolve(undefined);
    const r = await call('device_setting', { name: 'restore' });
    expect(r.text).toBe('could not restore dark_mode (was no): it reads on');
    expect(r.data.notRestored).toHaveLength(1);
    settings.set = set;
    expect((await call('device_setting', { name: 'restore' })).text).toBe(
      'restored dark_mode: off',
    );
  });

  it("reads a battery back at default whatever its level, which is the moment's and no part of what is set", async () => {
    const settings = new Settings();
    settings.values.battery = 'default (now 80)';
    const set = settings.set;
    settings.set = (name: SettingName, value: string) =>
      set(name, value.startsWith('default') ? 'default (now 79)' : value);
    const { call } = await connect(Object.assign(new FakeDevice(), { settings }));
    await call('device_setting', { name: 'battery', value: '50' });
    expect((await call('device_setting', { name: 'restore' })).text).toBe(
      'restored battery: default (now 80)',
    );
    expect((await call('device_setting', { name: 'battery', value: 'default' })).text).toBe(
      'battery reads default (now 79), as before: nothing changed',
    );
  });

  it('takes one-shot events, and refuses what is not one', async () => {
    const settings = new Settings();
    const { call } = await connect(Object.assign(new FakeDevice(), { settings, events: settings }));
    await call('device_setting', { name: 'call', value: '+905551112233' });
    await call('device_setting', { name: 'call', value: 'end +905551112233' });
    await call('device_setting', { name: 'sms', title: '5553434', value: 'Merhaba' });
    expect(settings.events).toEqual([
      ['call', '+905551112233', false],
      ['call', '+905551112233', true],
      ['sms', '5553434', 'Merhaba'],
    ]);
    expect((await call('device_setting', { name: 'call', value: 'someone' })).text).toMatch(
      /phone number/,
    );
    expect((await call('device_setting', { name: 'sms', title: 'x', value: 'y' })).text).toMatch(
      /phone number/,
    );
  });

  it('keeps a change written down when the device refused after making it, and forgets one it never made', async () => {
    const settings = new Settings();
    settings.values.fold = 'default (now open)';
    // as a fold does that is asked for and does not read back in time: the request went, and holds
    settings.set = (name: SettingName, value: string) => {
      settings.values[name] = value;
      if (value === 'closed')
        return Promise.reject(new DeviceError('UNSUPPORTED', 'it stays in state 3'));
      return Promise.resolve(undefined);
    };
    const { call } = await connect(Object.assign(new FakeDevice(), { settings }));
    expect((await call('device_setting', { name: 'fold', value: 'closed' })).data.code).toBe(
      'UNSUPPORTED',
    );
    expect((await call('device_setting', { name: 'restore' })).text).toBe(
      'restored fold: default (now open)',
    );
    expect(settings.values.fold).toBe('default (now open)');
    settings.set = () => Promise.reject(new DeviceError('UNSUPPORTED', 'no fold here'));
    await call('device_setting', { name: 'fold', value: 'closed' });
    expect((await call('device_setting', { name: 'restore' })).text).toBe('nothing was changed');
  });

  it('changes a condition and puts it back at the end of the session', async () => {
    const settings = new Settings();
    const d = Object.assign(new FakeDevice(), { settings });
    const { call, ctx } = await connect(d);
    // read as it is set on both platforms: Android says no, iOS light
    expect((await call('device_setting', { name: 'dark_mode' })).data.value).toBe('off');
    expect((await call('device_setting', { name: 'dark_mode', value: 'on' })).text).toBe(
      'dark_mode: on; put back when this session ends, or by restore; it cannot be kept past the session',
    );
    settings.values.dark_mode = 'dark';
    expect((await call('device_setting', { name: 'dark_mode' })).text).toBe('dark_mode: on');
    await call('device_setting', { name: 'dark_mode', value: 'off' });
    await call('device_setting', { name: 'text_size', value: '1.3' });
    settings.values.fold = 'default (now open)';
    await call('device_setting', { name: 'fold', value: 'closed' });
    expect(settings.values).toEqual({ dark_mode: 'off', text_size: '1.3', fold: 'closed' });
    expect(await ctx.end()).toEqual([]);
    expect(settings.values).toEqual({
      dark_mode: 'no',
      text_size: '1.0',
      fold: 'default (now open)',
    });
  });

  it("refuses a condition held for another app, as that app's could not be put back", async () => {
    const settings = new Settings();
    const { call } = await connect(Object.assign(new FakeDevice(), { settings }));
    settings.values.locale = '';
    await call('device_setting', { name: 'locale', value: 'tr-TR', app: 'a.one' });
    await call('device_setting', { name: 'locale', value: 'de', app: 'a.one' });
    const other = await call('device_setting', { name: 'locale', value: 'de', app: 'a.two' });
    expect([other.data.code, other.text]).toEqual([
      'INVALID_ARGUMENT',
      'INVALID_ARGUMENT: locale is held for a.one until it is put back\nhint: device_setting restore first',
    ]);
    expect(settings.values.locale).toBe('de');
    expect((await call('device_setting', { name: 'restore' })).text).toBe('restored locale: ');
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
    const d = Object.assign(new FakeDevice(), { settings, events: settings });
    const { call } = await connect(d, { policy: { allowDataLoss: 'virtual' } });
    const net = await call('device_setting', { name: 'network', value: 'slow' });
    expect(net.data.code).toBe('UNSUPPORTED');
    expect(net.text).toContain('a phone has no network shaping');
    expect((await call('push')).text).toBe('alert: by hand\ntapped: no: no hand\nwidgets: by APNs');
    await call('push', { app: 'dev.other' });
    // the session's app, then the one named: a route may depend on the app's build
    expect(settings.routesFor).toEqual(['dev.app', 'dev.other']);
    const pushed = await call('push', {
      type: 'alert',
      title: 'T',
      data: { k: 'v' },
      read: 'none',
    });
    expect(pushed.text).toBe('pushed to dev.app');
    expect(settings.pushed).toEqual([['dev.app', { type: 'alert', title: 'T', data: { k: 'v' } }]]);
    expect((await call('push', { type: 'tapped' })).text).toBe(
      'UNSUPPORTED: no hand\nhint: type alert, widgets still work here',
    );
    expect((await call('push', { type: 'widgets', title: 'T' })).text).toBe(
      'INVALID_ARGUMENT: widgets here takes payload alone: not title',
    );
    expect((await call('push', { type: 'loud' })).text).toMatch(
      /^INVALID_ARGUMENT: type: alert, background, .*, not loud$/,
    );
    for (const [payload, why] of [
      ['[1]', 'payload is JSON: an object'],
      ['{', 'payload is JSON: an object'],
      [`{"a":"${'x'.repeat(4_100)}"}`, 'a payload is 4096 bytes at most'],
    ] as const)
      expect((await call('push', { type: 'alert', payload })).text).toBe(
        `INVALID_ARGUMENT: ${why}`,
      );
    const b = await call('device_setting', { name: 'biometric', value: 'match' });
    expect(b.data.code).toBe('UNSUPPORTED');
    expect((await call('device_setting', { name: 'biometric', value: 'x' })).error).toBe(true);
    const keychain = await call('device_setting', { name: 'keychain', value: 'reset' });
    expect(keychain.text).toBe('the keychain is empty: it held 3 items');
    expect((await call('device_setting', { name: 'keychain' })).text).toMatch(/needs value: reset/);
  });

  it("reads no app's routes off the allow list", async () => {
    const settings = new Settings();
    const d = Object.assign(new FakeDevice(), { settings, events: settings });
    const { call } = await connect(d, { policy: { apps: ['dev.app'] } });
    expect((await call('push', { app: 'dev.other' })).data.code).toBe('POLICY_DENIED');
    expect(settings.routesFor).toEqual([]);
  });
});

describe('device claims', () => {
  const claimOf = (pid: number) => {
    const started = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
    }).trim();
    const dir = join(must(process.env.APPDYNO_STATE_DIR, 'APPDYNO_STATE_DIR'), 'claims');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'emulator-5580.json'),
      JSON.stringify({ pid, started, tool: 'other agent', since: '2026-11-03T00:00:00Z' }),
    );
  };

  it('refuses a device a live process holds, naming it, unless asked to share', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']);
    const pid = must(child.pid, "the child's pid");
    try {
      claimOf(pid);
      const d = new FakeDevice();
      const { call, ctx } = await connect(d, { defaults: { claims: true } });
      const r = await call('use_device', { device: d.serial });
      expect(r.error).toBe(true);
      expect(r.data.code).toBe('DEVICE_CLAIMED');
      expect(r.text).toContain(`pid ${pid}`);
      expect(r.text).toContain('other agent');
      expect((await call('list_devices')).data.devices?.[0]?.heldBy?.pid).toBe(pid);
      expect((await call('use_device', { device: d.serial, share: true })).error).toBe(false);
      ctx.close();
    } finally {
      child.kill('SIGKILL');
    }
  });

  it('frees a dead owner’s claim, a pid reused by another process, and its own at the end', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']);
    claimOf(must(child.pid, "the child's pid"));
    child.kill('SIGKILL');
    await new Promise((r) => child.once('exit', r));
    const d = new FakeDevice();
    const first = await connect(d, { defaults: { claims: true, tool: 'one' } });
    expect((await first.call('use_device', { device: d.serial })).error).toBe(false);
    expect((await first.call('list_devices')).data.devices?.[0]?.heldBy).toMatchObject({
      pid: process.pid,
      tool: 'one',
    });
    first.ctx.close();
    expect(
      must((await first.call('list_devices')).data.devices?.[0], 'the device').heldBy,
    ).toBeUndefined();
    const dir = join(must(process.env.APPDYNO_STATE_DIR, 'APPDYNO_STATE_DIR'), 'claims');
    writeFileSync(
      join(dir, 'emulator-5580.json'),
      JSON.stringify({ pid: process.pid, started: 'long ago', tool: 'x', since: 'y' }),
    );
    const second = await connect(new FakeDevice(), { defaults: { claims: true } });
    expect(
      must((await second.call('list_devices')).data.devices?.[0], 'the device').heldBy,
    ).toBeUndefined();
  });
});

describe('a refusal of a call that names too little', () => {
  it('says where an app is found when the call names none and none is selected', async () => {
    const { call } = await connect(new FakeDevice(), { defaults: { app: undefined } });
    for (const r of [await call('logs'), await call('terminate_app'), await call('crashes')])
      expect(r.text).toBe(
        'INVALID_ARGUMENT: give app (or select one with use_device)\nhint: app action list names the installed apps by id; use_device with app selects one for the calls after',
      );
  });

  it('says where the words a find may name are, when it names none', async () => {
    const { call } = await connect(new FakeDevice());
    expect((await call('find')).text).toBe(
      'INVALID_ARGUMENT: give text, id or role\nhint: screen lists the elements, each by its ref, role and words',
    );
    expect((await call('tap')).data.hint).toBe(
      'screen lists the elements, each by its ref, role and words',
    );
  });
});
