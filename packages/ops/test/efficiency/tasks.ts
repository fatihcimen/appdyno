import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { must, stateDir } from '@appdyno/core';
import type { Tree } from '@appdyno/protocol';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { clientOf, recorded, Scripted, simulator, type Call } from './kit.js';

const FIXTURE = 'dev.appdyno.fixture';
const FORM = 'driver-apple/test/fixtures/ios-screens/form-number-pad.json';
const LIST = 'driver-apple/test/fixtures/ios-screens/list-under-status-bar.json';
const SETTINGS = 'ops/test/fixtures/apps/android-settings.json';

/** A recorded screen with words of it changed, as the app changes them under a touch. */
const reworded = (t: Tree, from: string, to: string, at = ''): Tree => ({
  ...(JSON.parse(JSON.stringify(t).replace(from, to)) as Tree),
  hash: `${t.hash}${at}+${to}`,
});

/** The ref a screen's text gives the row that ends in `words`. */
const refOf = (screen: string, words: string) =>
  must(new RegExp(`^(@\\S+) .*${words}`, 'm').exec(screen)?.[1], `the ref of ${words}`);

/** As logcat prints an app's lines with `-v threadtime`. */
export const logLines = (n: number) =>
  Array.from({ length: n }, (_, i) => {
    const at = `${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.${String((i * 37) % 1000).padStart(3, '0')}`;
    return `11-15 10:${at}  6178  ${i % 5 ? 6178 : 6203} I Fixture: request ${i} GET /items?page=${i} answered 200 in ${20 + (i % 40)} ms`;
  });

/**
 * A reader that does what the server's words say and no more: it reads the screen where they say to or where an answer
 * has not shown it, sends one action a call unless they say to send the known ones together, and asks for a crash's
 * report or log where a hint or they send it there. So one sequence measures every tree, and what moves its numbers is
 * the server's own words.
 */
/** How long the reader waits for what takes time: a wait names its time. */
const WAIT_MS = 5_000;

async function reader(device: FakeDevice, app: string) {
  const { call, calls, client } = await clientOf(device, app);
  const words = client.getInstructions() ?? '';
  const readsFirst = words.includes('Read the screen first');
  const together = words.includes('one run_steps call');
  const said: string[] = [];
  const say = async (tool: string, args: Record<string, unknown> = {}) => {
    const r = await call(tool, args);
    said.push(r.text);
    return r;
  };
  return {
    calls,
    said,
    say,
    /** The app in front, and its screen: the launch's own answer, or a read after it. */
    open: async () => {
      const launched = await say('launch_app');
      return readsFirst ? (await say('read_screen')).text : launched.text;
    },
    /** A touch that may be refused: the screen after it, read only where the refusal did not show it. */
    touch: async (args: Record<string, unknown>) => {
      const r = await say('tap_screen', args);
      const shown = /^(screen unchanged|foreground: |\d+ elements?\b)/m.test(r.text);
      return r.refused && !shown ? { ...r, text: (await say('read_screen')).text } : r;
    },
    /** Actions already known: one call, or one each; `then` waits for what takes time. */
    act: async (
      steps: ({ tool: string } & Record<string, unknown>)[],
      then?: { selector: { text: string } },
    ) => {
      if (together)
        return say('run_steps', {
          steps: then ? [...steps, { tool: 'check_element', ...then, timeoutMs: WAIT_MS }] : steps,
        });
      let last = { text: '', refused: false, hint: '' };
      for (const { tool, ...args } of steps) last = await say(tool, args);
      // a tap whose result is not there yet says to wait for it
      return then && !last.text.includes(then.selector.text)
        ? say('check_element', { ...then, timeoutMs: WAIT_MS })
        : last;
    },
    /** After an app died under an action: what a hint or the instructions still send for. */
    why: async (hint: string) => {
      const toldAbove = words.includes('already says');
      // a hint that says why is elsewhere is followed; one that says where the whole report is, after why, is not
      if (hint.includes('crashes says why')) await say('read_logs', { source: 'crashes' });
      if (hint.includes('logs says why') || (words.includes('misbehaves: read_logs') && !toldAbove))
        await say('read_logs');
    },
  };
}

export type Task = { name: string; run: () => Promise<{ calls: Call[]; proof: boolean }> };

const NAME = { tool: 'type_text', selector: { text: 'Your name' }, text: 'Ada' };
const PASSWORD = { tool: 'type_text', selector: { text: 'Password' }, text: 'hunter2' };

/** The form of the fixture app: a result line comes `late` reads after Send. */
const logIn = (late: number) => async () => {
  const form = recorded(FORM);
  const sent = reworded(form, '"Enter your details"', '"Sent: Ada"');
  const d = simulator(form);
  let reads = -1;
  d.onAct = (a) => {
    if (a.kind !== 'tap') return;
    if (late) reads = late;
    else d.fixture = sent;
  };
  const tree = d.tree.bind(d);
  d.tree = () => {
    if (reads >= 0 && reads-- === 0) d.fixture = sent;
    return tree();
  };
  const r = await reader(d, FIXTURE);
  await r.open();
  await r.act([NAME, PASSWORD, { tool: 'tap_screen', selector: { text: 'Send' } }], {
    selector: { text: 'Sent: Ada' },
  });
  return { calls: r.calls, proof: r.said.join('\n').includes('"Sent: Ada"') };
};

export const TASKS: Task[] = [
  { name: 'log in', run: logIn(0) },
  { name: 'log in, a slow result', run: logIn(4) },
  {
    name: 'three items in the basket',
    run: async () => {
      const d = simulator(recorded(LIST));
      // the row under the finger counts one more
      d.onAct = (a) => {
        if (a.kind !== 'tap') return;
        const t = must(d.fixture, 'the list');
        const row = t.nodes.find((n) => n.d === 'In basket: 0' && n.b[1] <= a.y && a.y <= n.b[3]);
        if (row) row.d = 'In basket: 1';
        t.hash = `${t.hash}+${a.y}`;
      };
      const r = await reader(d, FIXTURE);
      const screen = await r.open();
      await r.act(
        [35, 36, 37].map((n) => ({ tool: 'tap_screen', ref: refOf(screen, `Product ${n}$`) })),
      );
      const all = r.said.join('\n');
      return {
        calls: r.calls,
        proof: [35, 36, 37].every((n) => all.includes(`"Product ${String(n)} In basket: 1 Add"`)),
      };
    },
  },
  {
    name: 'find a setting, change it',
    run: async () => {
      const top = recorded(SETTINGS);
      const d = Object.assign(new Scripted(), { fixture: top });
      // the row is one swipe down, and a touch turns it on
      d.onAct = (a) => {
        if (a.kind === 'tap')
          d.fixture = reworded(must(d.fixture, 'a screen'), 'Dark theme', 'Dark theme on');
        else if (d.fixture === top) d.fixture = reworded(top, 'Sound & vibration', 'Dark theme');
      };
      const r = await reader(d, 'com.android.settings');
      await r.open();
      const row = { selector: { text: 'Dark theme' } };
      await r.touch(row);
      await r.act([
        { tool: 'swipe_screen', until: row.selector },
        { tool: 'tap_screen', ...row },
      ]);
      return { calls: r.calls, proof: must(r.said.at(-1), 'an answer').includes('Dark theme on') };
    },
  },
  {
    name: 'a crash and its log',
    run: async () => {
      const d = new FakeDevice();
      d.pid = '6178';
      d.appPid = d.fakePid;
      d.crashReports = [
        {
          at: '2026-11-15T10:01:22.000Z',
          reason: 'java.lang.IllegalStateException: fixture crash',
          file: '/tmp/crash-dev.app.txt',
        },
      ];
      d.logLines = [
        ...logLines(70),
        '11-15 10:01:22.101  6178  6178 E AndroidRuntime: FATAL EXCEPTION: main',
        '11-15 10:01:22.101  6178  6178 E AndroidRuntime: java.lang.IllegalStateException: fixture crash',
        ...Array.from(
          { length: 10 },
          (_, i) =>
            `11-15 10:01:22.101  6178  6178 E AndroidRuntime: \tat dev.app.Screen.frame${i}`,
        ),
      ];
      const own = d.act.bind(d);
      d.act = (a, o) => {
        if (a.kind !== 'tap') return own(a, o);
        d.running = false;
        d.pid = undefined;
        return own(a, o);
      };
      const r = await reader(d, 'dev.app');
      await r.open();
      const died = await r.say('tap_screen', { selector: { text: 'Form' } });
      await r.why(died.hint);
      const all = r.said.join('\n');
      return {
        calls: r.calls,
        proof: died.refused && all.includes('fixture crash') && all.includes('FATAL EXCEPTION'),
      };
    },
  },
  {
    name: 'record a flow, replay it',
    run: async () => {
      const file = join(mkdtempSync(join(stateDir(), 'efficiency-')), 'form.flow');
      const r = await reader(new FakeDevice(), 'dev.app');
      await r.say('run_flow', { action: 'record' });
      await r.open();
      await r.act([
        { tool: 'tap_screen', selector: { text: 'Form' } },
        { tool: 'type_text', selector: { text: 'Adınız' }, text: 'Ada' },
        { tool: 'tap_screen', selector: { text: 'Gönder' } },
      ]);
      await r.say('run_flow', { action: 'stop', file });
      const ran = await r.say('run_flow', { action: 'run', file });
      return { calls: r.calls, proof: !ran.refused && r.calls.every((c) => !c.refused) };
    },
  },
  ...(
    [
      ['a stale ref, then the row', { ref: '@gone' }],
      ['a selector with no match, then the row', { selector: { text: 'Nowhere' } }],
    ] as const
  ).map(([name, miss]) => ({
    name,
    run: async () => {
      const r = await reader(simulator(recorded(FORM)), FIXTURE);
      const screen = await r.open();
      await r.touch(miss);
      const sent = await r.say('tap_screen', { ref: refOf(screen, '"Send" .*') });
      return { calls: r.calls, proof: !sent.refused };
    },
  })),
];
