import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { iosScreen } from '@appdyno/driver-apple';
import type { ActParams, Tree } from '@appdyno/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { connect } from './shared.js';

beforeEach(() => {
  vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-driving-')));
});

/** A screen of the fixture app read on an iPhone 17 simulator with iOS 27.2. */
const recorded = (name: string) =>
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, `../../../driver-apple/test/fixtures/ios-screens/${name}.json`),
      'utf8',
    ),
  ) as Tree;

const APP = { defaults: { app: 'dev.appdyno.fixture' } };

/** The form with its keyboard: the app's first window, its own, and two more the keyboard's. */
const keyboardUp = recorded('form-letters-keyboard');

/** The same form with no keyboard and no field focused: the keyboard's windows left out. */
function keyboardDown(t: Tree): Tree {
  const gone = new Set<number>();
  t.nodes.forEach((n, i) => {
    if ((n.c === 'Window' && i > 1) || gone.has(n.p)) gone.add(i);
  });
  const at = new Map<number, number>();
  const nodes = t.nodes.flatMap((n, i) => {
    if (gone.has(i)) return [];
    at.set(i, at.size);
    return [{ ...n, p: n.p < 0 ? n.p : (at.get(n.p) ?? -1), f: n.c === 'TextField' ? 149 : n.f }];
  });
  return { ...t, nodes, hash: `${t.hash}-down` };
}

/** The fixture app on an iOS simulator, showing recorded trees: a tap on a field brings the keyboard up. */
class Simulator extends FakeDevice {
  constructor(public fixture: Tree) {
    super('DC5E9228-0F8D-44E1-9657-97880485E857');
    Object.defineProperty(this, 'platform', { value: 'ios' });
    Object.defineProperty(this, 'platformScreen', { value: iosScreen });
    this.hello = {
      ...this.hello,
      platform: 'ios',
      osVersion: '27.2',
      model: 'iPhone 17',
      screen: { w: 402, h: 874, density: 3, rotation: 0 },
    };
    delete this.hello.sdk;
  }
  override act(action: ActParams, opts: Parameters<FakeDevice['act']>[1] = {}) {
    if (action.kind === 'tap' && action.y > 160 && action.y < 200) this.fixture = keyboardUp;
    return super.act(action, opts);
  }
}

describe('an iOS screen', () => {
  it('lists the keyboard as one element, and no key, prediction or bar of it', async () => {
    const { call } = await connect(new Simulator(keyboardUp), APP);
    const r = await call('screen');
    expect(r.text).toContain('@keyboard keyboard "" 201,703');
    expect(r.text).not.toMatch(/"q"|"return"|inputView|Typing Predictions|Dictate|Next keyboard/);
    expect(r.data.elements).toBe(10);
  });

  it('lists no keyboard that has slid below the screen as it closes', async () => {
    const closing = structuredClone(keyboardUp);
    for (const n of closing.nodes) if (n.c === 'Keyboard') n.b = [0, 900, 402, 1126];
    const { call } = await connect(new Simulator(closing), APP);
    expect((await call('screen')).text).not.toContain('@keyboard');
  });

  it('says a tap that opened the keyboard changed the screen, by one line', async () => {
    const d = new Simulator(keyboardDown(keyboardUp));
    const { call } = await connect(d, APP);
    const name = /(@\w+) "Your name"/.exec((await call('screen')).text)?.[1];
    const r = await call('tap', { ref: name });
    expect(r.data.changed).toBe(true);
    expect(r.text).not.toContain('no change seen');
    expect(r.text).toContain('\n+ @keyboard keyboard "" 201,703');
    expect(r.text.split('\n').filter((l) => l.startsWith('+ '))).toHaveLength(1);
  });

  it('refuses a touch on the keyboard, saying what types and what closes it', async () => {
    const d = new Simulator(keyboardUp);
    const { call } = await connect(d, APP);
    await call('screen');
    for (const args of [{ ref: '@keyboard' }, { selector: { role: 'keyboard' } }]) {
      const r = await call('tap', args);
      expect(r.data.code).toBe('INVALID_ARGUMENT');
      expect(r.text).toContain('type_text types, press_key enter presses its return key');
    }
    expect(d.calls.filter((c) => c.name === 'act')).toEqual([]);
  });

  it("answers a system alert with the app's screen, not the home screen's card of it while the app comes back", async () => {
    const prompt = JSON.parse(
      readFileSync(
        join(
          import.meta.dirname,
          '../../../driver-apple/test/fixtures/ios-notification-prompt.json',
        ),
        'utf8',
      ),
    ) as Tree;
    const app: Tree = {
      ...prompt,
      windows: prompt.windows.slice(0, 1),
      nodes: prompt.nodes.filter((n) => n.w === 0),
      hash: 'app',
    };
    // as the runner read it after "Allow", 5 of 5: the home screen app in front, showing the app's card alone
    const card: Tree = {
      windows: [
        {
          type: 1,
          pkg: 'com.apple.springboard',
          layer: 0,
          b: [0, 0, 402, 874],
          active: true,
          focused: true,
        },
      ],
      nodes: [
        { p: -1, w: 0, c: 'Other', id: 'AppSwitcherContentView', b: [0, 0, 402, 874], f: 17 },
        { p: 0, w: 0, c: 'StaticText', d: 'appdyno fixture', b: [150, 427, 252, 447], f: 17 },
      ],
      truncated: false,
      elapsedMs: 5,
      hash: 'card',
    };
    // and as a runner told no app reads it: the home screen app's alone, the selected app running under it
    const alone: Tree = {
      ...prompt,
      windows: prompt.windows.map((w, i) => (i ? w : { ...w, pkg: 'com.apple.springboard' })),
    };
    for (const before of [prompt, alone]) {
      const d = new Simulator(before);
      const act = d.act.bind(d);
      d.act = (action, opts) => {
        d.fixture = card;
        return act(action, opts);
      };
      const tree = d.tree.bind(d);
      let cards = 0;
      d.tree = () => {
        if (d.fixture === card && ++cards > 2) d.fixture = app;
        return tree();
      };
      const { call } = await connect(d, APP);
      const r = await call('alert', { answer: 'Allow', read: 'full' });
      expect(r.text).toContain(
        'answered the system alert: "Allow"\nforeground: dev.appdyno.fixture',
      );
      expect(r.text).not.toMatch(/WARNING|AppSwitcherContentView/);
    }
  });

  it('refuses typing with no field focused and no keyboard, before any key is sent', async () => {
    const d = new Simulator(keyboardDown(keyboardUp));
    const { call } = await connect(d, APP);
    const r = await call('type_text', { text: 'hello' });
    expect(r.data.code).toBe('NO_FOCUS');
    expect(r.data.dispatched).toBe(false);
    expect(r.text).toContain('tap the field first (or give type_text a ref)');
    expect(d.typed).toEqual([]);
    d.fixture = keyboardUp;
    // focused by the app since the last read: read again before it is refused
    expect((await call('type_text', { text: 'hello' })).error).toBe(false);
    expect(d.typed).toEqual(['hello']);
  });

  it('leaves out what lies under the status bar or the navigation bar, as a touch there scrolls the list to its top', async () => {
    const d = new Simulator(recorded('list-under-status-bar'));
    const { call } = await connect(d, APP);
    const r = await call('screen');
    // the row at -24 to 41 is under the status bar, and the one at 41 to 105 under the navigation bar, at 62 to 116
    expect(r.text).not.toMatch(/Product 3[34]/);
    expect(r.text).toContain('"Product 35 In basket: 0 Add" 137');
    expect(r.text).toContain('@v181 button "Back" 38,84');
    // the first Add is the first a touch reaches
    expect((await call('find', { selector: { text: 'Add', index: 0 } })).text).toMatch(
      /^@\w+ button "Add" 339,137 /,
    );
    expect((await call('tap', { selector: { text: 'Add', index: 0 } })).error).toBe(false);
    expect(d.calls.filter((c) => c.name === 'act').map((c) => c.args[0])).toEqual([
      expect.objectContaining({ kind: 'tap', x: 339, y: 137 }),
    ]);
  });
});
