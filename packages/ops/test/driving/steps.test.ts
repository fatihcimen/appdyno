import { must } from '@appdyno/core';
import { describe, expect, it } from 'vitest';
import { opsFor } from '../../src/index.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { fakeTimed } from '@appdyno/testing/fake-time.js';
import { connect, act, ScrollingList } from './shared.js';

describe('steps across screens', () => {
  it('runs selectors, wait_for and assert across screens with one read at the end', async () => {
    const d = new FakeDevice();
    const { call } = await connect(d);
    const r = await call('steps', {
      steps: [
        { action: 'tap', selector: { text: 'Form' } },
        { action: 'wait_for', selector: { text: 'Bilgiler' } },
        { action: 'type_text', text: 'x', selector: { role: 'textField' } },
        { action: 'tap', selector: { text: 'Gönder' } },
        {
          action: 'assert',
          selector: { id: 'dev.app:id/result' },
          check: 'text',
          equals: 'Gönderildi',
        },
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

  it("reads a tool's screen as a touch's is: where its step says, or at the last as the call says", async () => {
    const { call } = await connect(new FakeDevice());
    const r = await call('steps', {
      steps: [
        { action: 'open_link', url: 'app://x' },
        { action: 'launch_app' },
        { action: 'open_link', url: 'app://y', read: 'full' },
      ],
      read: 'none',
    });
    expect(r.text.split('\n').slice(0, 2)).toEqual([
      '1. opened app://x',
      '2. brought dev.app to the front, on the screen it was on',
    ]);
    expect(r.text).toMatch(/\n3\. opened app:\/\/y\nforeground: dev\.app\n3 elements: ref role/);
  });

  it('says no change was seen of no last step that only looked, or found what it scrolled to', async () => {
    const { call } = await connect(new FakeDevice());
    for (const last of [
      { action: 'wait_for', selector: { text: 'Form' } },
      { action: 'assert', selector: { text: 'Form' } },
    ]) {
      const r = await call('steps', { steps: [{ action: 'press_key', key: 'tab' }, last] });
      expect(r.error, last.action).toBe(false);
      expect(r.text, last.action).not.toContain('no change seen');
    }
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
        { action: 'assert', selector: { text: 'Nope' } },
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
        { action: 'find', selector: { text: 'Form' } },
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

  it("says a touch's target goes in selector, and shows a step that put it at the top in the right shape", async () => {
    const { call, ctx } = await connect(new FakeDevice());
    expect(must(opsFor(ctx).steps, 'steps').description).toContain(
      '{ action: tap, selector: { text: OK } }',
    );
    const r = await call('steps', {
      steps: [
        { action: 'wait_for', selector: { text: 'Form' } },
        { action: 'tap', text: 'Crash', read: 'full' },
      ],
    });
    expect(r.text).toBe(
      'INVALID_ARGUMENT: step 2: ✖ Unrecognized key: "text"\nhint: a target goes in selector: {"action":"tap","selector":{"text":"Crash"}}',
    );
  });

  it('takes a selector in selector in every tool that looks for an element, and says so of one at the top', async () => {
    const { call } = await connect(new FakeDevice());
    for (const tool of ['find', 'wait_for', 'assert'] as const) {
      expect((await call(tool, { text: 'Form' })).data.hint, tool).toBe(
        'a target goes in selector: {"selector":{"text":"Form"}}',
      );
      expect((await call(tool, { selector: { text: 'Form' } })).error, tool).toBe(false);
    }
  });

  it("says where a tool's target goes by its own selector, as a tap with text at the top has it", async () => {
    const d = new FakeDevice();
    const { call } = await connect(d);
    expect((await call('tap', { text: 'OK', read: 'none' })).text).toBe(
      'INVALID_ARGUMENT: Unrecognized key: "text"\nhint: a target goes in selector: {"read":"none","selector":{"text":"OK"}}',
    );
    // beside a selector it has, and on the tools that share a tap's target
    expect(
      (await call('gesture', { kind: 'long_press', index: 1, selector: { text: 'A' } })).text,
    ).toMatch(
      /hint: a target goes in selector: \{"kind":"long_press","selector":\{"text":"A","index":1\}\}$/,
    );
    expect((await call('type_text', { text: 'hi', id: 'email' })).text).toMatch(
      /hint: a target goes in selector: \{"text":"hi","selector":\{"id":"email"\}\}$/,
    );
    // in a drag's end, and its start named as from, which is the target at its top
    expect(
      (await call('gesture', { kind: 'drag', selector: { text: 'A' }, to: { text: 'B' } })).text,
    ).toMatch(
      /hint: a target goes in selector: \{"kind":"drag","selector":\{"text":"A"\},"to":\{"selector":\{"text":"B"\}\}\}$/,
    );
    expect(
      (await call('gesture', { kind: 'drag', from: { text: 'A', index: 1 }, to: { id: 'b' } }))
        .text,
    ).toMatch(
      /hint: a target goes in selector: \{"kind":"drag","to":\{"selector":\{"id":"b"\}\},"selector":\{"text":"A","index":1\}\}$/,
    );
    expect(
      (await call('steps', { steps: [{ action: 'drag', ref: '@a1', to: { text: 'B' } }] })).text,
    ).toMatch(
      /hint: a target goes in selector: \{"action":"drag","ref":"@a1","to":\{"selector":\{"text":"B"\}\}\}$/,
    );
    // what no selector takes is said as before
    expect((await call('tap', { label: 'OK' })).data.hint).toBe(
      'change that and call again: nothing was done',
    );
    expect(act(d)).toEqual([]);
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

  /** A device whose app is gone, with the launcher in front, once `gone` says so. */
  const dying = (gone: (d: FakeDevice) => boolean) => {
    const d = new FakeDevice();
    d.crashReports = [{ at: 'now', reason: 'APP CRASH(EXCEPTION)', file: '/tmp/report.txt' }];
    d.current = ((own) => () => {
      const t = own();
      if (!gone(d)) return t;
      d.running = false;
      t.windows = t.windows.map((w) => ({ ...w, pkg: 'com.android.launcher3' }));
      return t;
    })(d.current.bind(d));
    return d;
  };

  it(
    "says at once that the app died under a touch whose answer a crash holds, with the app's last lines",
    fakeTimed(async () => {
      for (const android of [false, true]) {
        const d = new FakeDevice();
        if (android) {
          d.pid = '4242';
          d.appPid = d.fakePid;
        }
        d.crashReports = [{ at: 'now', reason: 'fixture crash', file: '/tmp/report.ips' }];
        // the lines shown start at the newest that says why, past an earlier crash, a weaker one before it and a stack's
        // tail after it
        d.logLines = [
          'E AndroidRuntime: FATAL EXCEPTION: main, an earlier crash',
          'IllegalStateException: an earlier crash',
          'I Fixture: Did post notification. error:0',
          'E OpenGLRenderer: Unable to match the desired swap behavior, an error',
          'E AndroidRuntime: FATAL EXCEPTION: main',
          'IllegalStateException: fixture crash',
          ...Array.from({ length: 9 }, (_, i) => `\tat Frame${String(i)}`),
        ];
        const own = d.act.bind(d);
        // as an iPhone simulator's runner held its answer for 15 s while the app it read went down
        d.act = (a, o) => {
          if (a.kind !== 'tap') return own(a, o);
          d.running = false;
          d.pid = undefined;
          return new Promise(() => undefined);
        };
        const { call } = await connect(d);
        await call('screen');
        const started = Date.now();
        const r = await call('tap', { selector: { text: 'Form' } });
        expect(Date.now() - started, `android ${String(android)}`).toBeLessThan(10_000);
        expect([r.data.code, r.data.hint, r.data.dispatched]).toEqual([
          'APP_NOT_RUNNING',
          'launch_app starts it again, and crashes says why it died',
          true,
        ]);
        expect(r.text).toMatch(
          /^APP_NOT_RUNNING: the app died: fixture crash \(\/tmp\/report\.ips\)\nits last log lines:\nE AndroidRuntime: FATAL EXCEPTION: main\nIllegalStateException: fixture crash/,
        );
        expect(r.text).toMatch(/\tat Frame5\nhint:/);
      }
    }),
  );

  it(
    'refuses a touch whose app died under it however the device answers, with its last lines',
    fakeTimed(async () => {
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      // the answer at once, and once the watch has found the death but is still reading the log
      for (const answerMs of [0, 1_800]) {
        let tapped = false;
        const d = dying(() => tapped);
        d.logLines = ['E AndroidRuntime: FATAL EXCEPTION: main'];
        // as long as a loaded simulator's log read takes: an answer that came meanwhile won the race, unsaid
        const logs = d.logs.bind(d);
        d.logs = async (q) => {
          await wait(2_000);
          return logs(q);
        };
        const own = d.act.bind(d);
        d.act = async (a, o) => {
          if (a.kind !== 'tap') return own(a, o);
          tapped = true;
          await wait(answerMs);
          return own(a, o);
        };
        const { call } = await connect(d);
        await call('screen');
        const r = await call('tap', { selector: { text: 'Form' } });
        expect([r.data.code, r.data.dispatched], String(answerMs)).toEqual([
          'APP_NOT_RUNNING',
          true,
        ]);
        expect(r.text).toMatch(
          /^APP_NOT_RUNNING: (tapped @\w+ "Form"; )?the app died: APP CRASH\(EXCEPTION\) \(\/tmp\/report\.txt\)\nits last log lines:\nE AndroidRuntime: FATAL EXCEPTION: main\n/,
        );
      }
    }),
  );

  it(
    'stops a scroll or a key pressed again whose app died under it at its refusal: nothing reaches the device after it',
    fakeTimed(async () => {
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      // its process gone, or held for "keeps stopping" with the same pid and no report written yet
      for (const [tool, args, kind, held] of [
        ['scroll_to', { selector: { text: 'Row 99' }, maxSwipes: 40 }, 'gesture', false],
        ['press_key', { key: 'tab', count: 10 }, 'key', false],
        ['scroll_to', { selector: { text: 'Row 99' }, maxSwipes: 40 }, 'gesture', true],
      ] as const) {
        const d = new ScrollingList();
        d.pid = '4242';
        d.appPid = d.fakePid;
        if (!held)
          d.crashReports = [{ at: 'now', reason: 'fixture crash', file: '/tmp/report.ips' }];
        let crashing = false;
        d.appCrashing = () => Promise.resolve(crashing);
        let sent = 0;
        const own = d.act.bind(d);
        // the second ends the app; each takes as long as a settled stroke does, so the watch finds it under way
        d.act = async (a, o) => {
          const r = await own(a, o);
          if (a.kind === kind && ++sent === 2) {
            if (held) crashing = true;
            else d.pid = undefined;
          }
          if (a.kind === kind) await wait(400);
          return r;
        };
        const { call } = await connect(d);
        await call('screen');
        const r = await call(tool, args);
        const atRefusal = sent;
        const how = `${tool}${held ? ', held' : ''}`;
        expect([r.data.code, r.data.dispatched], how).toEqual(['APP_NOT_RUNNING', true]);
        expect(r.text, how).toContain(
          held
            ? 'the app died: the system holds its process for its crash dialog'
            : 'the app died: fixture crash',
        );
        await wait(2_000);
        expect(sent, how).toBe(atRefusal);
      }
    }),
  );

  it('says a step with no app selected killed the one it aimed at, gone or started again under the same screen', async () => {
    // as an emulator's "keeps stopping" stands over the app's last screen: its process gone, or a new one in its place
    for (const after of [undefined, '200']) {
      const d = new FakeDevice();
      d.pid = '100';
      d.appPid = d.fakePid;
      d.crashReports = [{ at: 'now', reason: 'APP CRASH(EXCEPTION)', file: '/tmp/report.txt' }];
      const own = d.act.bind(d);
      d.act = (a, o) => {
        if (a.kind === 'tap') d.pid = after;
        return own(a, o);
      };
      const { call } = await connect(d, { defaults: { app: undefined } });
      const r = await call('steps', {
        steps: [
          { action: 'tap', selector: { text: 'Form' } },
          { action: 'tap', selector: { text: 'Gönder' } },
        ],
      });
      expect([r.data.code, r.data.dispatched], after).toEqual(['APP_NOT_RUNNING', true]);
      expect(r.text).toContain('the app died: APP CRASH(EXCEPTION) (/tmp/report.txt)');
      expect(r.text).toContain('the app died in step 1, tap: the rest were not run');
      expect(act(d)).toHaveLength(1);
    }
  });

  it(
    'says the app died whose process the system holds for its "keeps stopping", alone or in a batch',
    fakeTimed(async () => {
      // a repeated crash: the process lives on, held by the system's dialog, which takes the front; no report is written
      for (const [tool, app] of [
        ['tap', 'dev.app'],
        ['steps', undefined],
      ] as const) {
        const d = new FakeDevice();
        d.pid = '100';
        d.appPid = d.fakePid;
        let crashing = false;
        d.appCrashing = () => Promise.resolve(crashing);
        d.logLines = ['E AndroidRuntime: FATAL EXCEPTION: main'];
        d.current = ((own) => () => {
          const t = own();
          if (crashing) t.windows = t.windows.map((w) => ({ ...w, pkg: 'android' }));
          return t;
        })(d.current.bind(d));
        const act0 = d.act.bind(d);
        d.act = (a, o) => {
          if (a.kind === 'tap') crashing = true;
          return act0(a, o);
        };
        const { call } = await connect(d, { defaults: { app } });
        await call('screen');
        const tap = { selector: { text: 'Form' } };
        const r =
          tool === 'tap'
            ? await call('tap', tap)
            : await call('steps', {
                steps: [
                  { action: 'tap', ...tap },
                  { action: 'tap', selector: { text: 'Gönder' } },
                ],
              });
        expect([r.data.code, r.data.dispatched], tool).toEqual(['APP_NOT_RUNNING', true]);
        expect(r.text).toContain(
          'the app died: the system holds its process for its crash dialog, and no crash report says why yet\nits last log lines:\nE AndroidRuntime: FATAL EXCEPTION: main',
        );
        // no report is written while the dialog is up: what says why is the log
        expect(r.data.hint, tool).toBe(
          'logs says why it died now, and crashes once alert answers its crash dialog; launch_app starts it again after',
        );
        expect(act(d)).toHaveLength(1);
      }
    }),
  );

  it('stops at a step whose app died, refused as that action alone is, with no app selected too', async () => {
    // with none selected, the app is the one in front as the touch aimed, as a launch or a link in the batch opened it
    for (const [read, app] of [
      [undefined, 'dev.app'],
      ['diff', 'dev.app'],
      [undefined, undefined],
      ['diff', undefined],
    ] as const) {
      const d = dying((x) => x.screen === 'form');
      const { call } = await connect(d, { defaults: { app } });
      const r = await call('steps', {
        steps: [
          { action: 'wait_for', selector: { text: 'Form' } },
          { action: 'tap', selector: { text: 'Form' }, ...(read && { read }) },
          { action: 'tap', selector: { text: 'Gönder' } },
          { action: 'type_text', text: 'Ada' },
        ],
      });
      expect([r.error, r.data.code, r.data.dispatched], `${String(read)} ${String(app)}`).toEqual([
        true,
        'APP_NOT_RUNNING',
        true,
      ]);
      expect(r.text).toMatch(
        /^APP_NOT_RUNNING: 1\. text="Form" shown\n2\. tapped @\w+ "Form"; the app died: APP CRASH\(EXCEPTION\) \(\/tmp\/report\.txt\)\n/,
      );
      expect(r.text).toContain(
        'the app died in step 2, tap: the rest were not run\nforeground: com.android.launcher3',
      );
      expect(act(d)).toHaveLength(1);
    }
    // an app that was not in front when a step began has no death to tell
    const d = dying(() => true);
    const { call } = await connect(d);
    const r = await call('steps', {
      steps: [
        { action: 'tap', x: 5, y: 5, read: 'diff' },
        { action: 'tap', x: 5, y: 5 },
      ],
    });
    expect(r.text).not.toContain('the rest were not run');
    expect(act(d)).toHaveLength(2);
  });

  /** A batch whose third step looks for what the form never has: as a crash leaves it, or the app running still. */
  const cutShort = (call: Awaited<ReturnType<typeof connect>>['call']) =>
    call('steps', {
      steps: [
        { action: 'wait_for', selector: { text: 'Form' } },
        { action: 'tap', selector: { text: 'Form' }, read: 'none' },
        { action: 'tap', selector: { text: 'Kaydet' } },
        { action: 'type_text', text: 'Ada' },
      ],
    });

  it(
    'says the app died when a step fails as it is gone, where no step before had looked',
    fakeTimed(async () => {
      // with no app selected, the one in front as the step began
      for (const app of ['dev.app', undefined]) {
        const d = dying((x) => x.screen === 'form');
        const { call } = await connect(d, { defaults: { app } });
        const r = await cutShort(call);
        expect([r.data.code, r.data.hint], app).toEqual([
          'APP_NOT_RUNNING',
          'launch_app starts it again, and crashes says why it died',
        ]);
        expect(r.text).toMatch(
          /\n3\. tap failed, the rest were not run: [^\n]+\nthe app died: APP CRASH\(EXCEPTION\) \(\/tmp\/report\.txt\), by step 3\n/,
        );
        expect(act(d)).toHaveLength(1);
      }
    }),
  );

  it(
    'tells no death in a step that fails while the app still runs',
    fakeTimed(async () => {
      const d = dying(() => false);
      d.crashReports = [];
      const r = await cutShort((await connect(d)).call);
      expect(r.data.code).toBe('NOT_FOUND');
      expect(r.text).toContain('3. tap failed, the rest were not run: ');
      expect(r.text).not.toContain('the app died');
    }),
  );
});
