import { inCall, must } from '@appdyno/core';
import { DeviceError, type Tree } from '@appdyno/protocol';
import { describe, expect, it } from 'vitest';
import { opsFor } from '../../src/index.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { SCREENS } from '@appdyno/testing/fake-screens.js';
import { callerOf } from '@appdyno/testing/calls.js';
import { fakeTimed } from '@appdyno/testing/fake-time.js';
import { connect, act, withScreen } from './shared.js';

describe('waiting on the device', () => {
  it('says its longest wait in its description, and in the hint of a refusal of a longer one', async () => {
    const { call, ctx } = await connect(new FakeDevice());
    expect(must(opsFor(ctx).wait_for, 'wait_for').description).toContain('at most 15000');
    const r = await call('wait_for', { text: 'Loaded', timeoutMs: 30000 });
    expect(r.text).toBe(
      'INVALID_ARGUMENT: timeoutMs: Too big: expected number to be <=15000\nhint: timeoutMs is at most 15000: change that and call again: nothing was done',
    );
    const step = await call('steps', {
      steps: [{ action: 'wait_for', text: 'L', timeoutMs: 20000 }],
    });
    expect(step.text).toMatch(/\nhint: timeoutMs is at most 15000: change that and call again/);
  });

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
  it(
    'is touched where the element is now, not where the last answer had it',
    fakeTimed(async () => {
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
    }),
  );

  it('costs no second read when the client acts at once on what it just read', async () => {
    const d = new FakeDevice();
    d.screen = 'settings';
    const { call } = await connect(d);
    const line = must(/(@\w+) "Wi-Fi On"/.exec((await call('screen')).text), 'its line');
    const reads = d.calls.filter((c) => c.name === 'tree').length;
    await call('tap', { ref: line[1], read: 'none' });
    expect(d.calls.filter((c) => c.name === 'tree').length).toBe(reads);
  });

  it('of two taps sent at once, the second aims at the screen the first left', async () => {
    const d = new FakeDevice();
    const { call } = await connect(d);
    const text = (await call('screen')).text;
    const form = must(/(@\w+) button "Form"/.exec(text), 'Form')[1];
    const allow = must(/(@\w+) button "İzin"/.exec(text), 'İzin')[1];
    const [first, second] = await Promise.all([
      call('tap', { ref: form }),
      call('tap', { ref: allow }),
      // a read runs beside them
      call('screen'),
    ]);
    expect(first.error).toBe(false);
    // where İzin was, the form has its Gönder, which a tap aimed at the screen before would have sent
    expect([second.data.code, second.data.dispatched]).toEqual(['STALE', false]);
    expect(act(d)).toHaveLength(1);
    expect(d.screen).toBe('form');
  });

  it(
    'says a tap changed the screen it opened, though a read beside it saw that screen first',
    fakeTimed(async () => {
      const d = new FakeDevice();
      const own = d.act.bind(d);
      let touched: () => void = () => undefined;
      const landed = new Promise<void>((r) => (touched = r));
      // the touch lands at once, and the answer takes a while: a read beside it meanwhile sees the screen it opened
      d.act = async (a, o) => {
        const r = await own(a, o);
        touched();
        await new Promise((r) => setTimeout(r, 300));
        return r;
      };
      const { call } = await connect(d);
      await call('screen');
      const tap = call('tap', { selector: { text: 'Form' } });
      await landed;
      expect((await call('screen')).text).toContain('Gönder');
      const r = await tap;
      expect(r.data.changed).toBe(true);
      expect(r.text).not.toContain('no change seen');
    }),
  );

  it('says a link changed the screen it opened, though a read beside it saw that screen first', async () => {
    const d = new FakeDevice();
    let opened: () => void = () => undefined;
    let answer: () => void = () => undefined;
    const landed = new Promise<void>((r) => (opened = r));
    const held = new Promise<void>((r) => (answer = r));
    // the link opens its screen at once, and the device answers when the test lets it: a read beside it sees that screen
    d.openUrl = async () => {
      d.screen = 'form';
      opened();
      await held;
    };
    const { call } = await connect(d);
    await call('screen');
    const link = call('open_link', { url: 'https://example.com/form' });
    await landed;
    expect((await call('screen')).text).toContain('Gönder');
    answer();
    const r = await link;
    expect(r.error).toBe(false);
    expect(r.data.changed).toBe(true);
  });

  it('runs a profile beside an action, and one that scrolls meanwhile in its turn', async () => {
    for (const [scroll, order] of [
      [undefined, ['perf_profile', 'tap']],
      ['down', ['tap', 'perf_profile']],
    ] as const) {
      const d = new FakeDevice();
      const own = d.act.bind(d);
      d.act = async (a, o) => {
        if (a.kind === 'tap') await new Promise((r) => setTimeout(r, 300));
        return own(a, o);
      };
      const { call } = await connect(d);
      await call('screen');
      const done: string[] = [];
      const end = (name: string) => () => void done.push(name);
      await Promise.all([
        call('tap', { selector: { text: 'Form' } }).then(end('tap')),
        call('perf_profile', { seconds: 1, ...(scroll && { scroll }) }).then(end('perf_profile')),
      ]);
      expect(done, scroll).toEqual(order);
    }
  });

  it(
    'tells a call that waits its turn why, and one that need not wait nothing of it',
    fakeTimed(async () => {
      const d = new FakeDevice();
      const own = d.act.bind(d);
      d.act = async (a, o) => {
        await new Promise((r) => setTimeout(r, 300));
        return own(a, o);
      };
      const { ctx } = await connect(d);
      const call = callerOf(ctx);
      const told: [string[], string[]] = [[], []];
      const [first, second] = told.map((seen, i) =>
        inCall({ progress: (m) => seen.push(m) }, () =>
          i ? call('press_key', { key: 'tab' }) : call('tap', { selector: { text: 'Form' } }),
        ),
      );
      await Promise.all([first, second]);
      const waits = 'waiting its turn';
      expect(told[0].filter((m) => m.includes(waits))).toEqual([]);
      expect(told[1][0]).toContain(waits);
    }),
  );

  it(
    'does nothing of a call its client gave up while it waited its turn',
    fakeTimed(async () => {
      const d = new FakeDevice();
      const own = d.act.bind(d);
      d.act = async (a, o) => {
        await new Promise((r) => setTimeout(r, 300));
        return own(a, o);
      };
      const { ctx } = await connect(d);
      const call = callerOf(ctx);
      const gaveUp = new AbortController();
      const first = call('tap', { selector: { text: 'Form' } });
      const second = inCall({ signal: gaveUp.signal }, () => call('press_key', { key: 'tab' }));
      gaveUp.abort();
      await first;
      await expect(second).rejects.toMatchObject({ code: 'CANCELLED' });
      // as long as a key would take to land
      await new Promise((r) => setTimeout(r, 600));
      expect(act(d).map((a) => a.kind)).toEqual(['tap']);
    }),
  );
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

  it('in a language begins none alongside, which the next plain launch took for its own and started nothing', async () => {
    const d = new FakeDevice();
    const began: string[] = [];
    d.launchAlongside = (pkg) => void began.push(pkg);
    const launched: unknown[] = [];
    Object.assign(d, {
      apps: {
        launchWith: (app: string, o: unknown) => Promise.resolve(void launched.push([app, o])),
      },
    });
    const { call } = await connect(d);
    expect((await call('launch_app', { language: 'de-DE' })).text).toMatch(
      /^started dev\.app in de-DE/,
    );
    expect(launched).toEqual([['dev.app', { language: 'de-DE' }]]);
    expect(began).toEqual([]);
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
