import { mkdtempSync, readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { must, type AppManager, type DeviceProvider } from '@appdyno/core';
import { parseFlow, type StepEvent } from '@appdyno/flows';
import { DeviceError } from '@appdyno/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { flowRecorder } from '../src/flow/recorder.js';
import {
  ACT,
  defineOp,
  DEFAULT_POLICY,
  flowFiles,
  flowsFor,
  flowsTagged,
  paramsOf,
  reply,
  ServerContext,
  ToolError,
} from '../src/index.js';
import { FakeDevice, SCREENS, WithKeyboard } from './fake-device.js';
import { callerOf } from './helpers.js';

const SECRET = 's3cr3t-pass';

describe('flows', () => {
  let dir: string;
  let device: FakeDevice;
  const context = (secrets: string[] = []) => {
    const provider: DeviceProvider = {
      list: () => Promise.resolve([{ serial: device.serial, state: 'device', ready: true }]),
      handles: () => true,
      open: () => device,
    };
    return new ServerContext({ ...DEFAULT_POLICY, secrets }, [provider], { app: 'dev.app' });
  };
  const refusal = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      expect(e).toBeInstanceOf(ToolError);
      return e as ToolError;
    }
    throw new Error('it did not refuse');
  };
  const refOf = (text: string, label: string) =>
    new RegExp(`(@[a-z0-9-]+) \\w+ "${label}"`).exec(text)?.[1];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'appdyno-flow-'));
    vi.stubEnv('APPDYNO_STATE_DIR', join(dir, 'state'));
    device = new FakeDevice();
  });
  afterEach(() => vi.unstubAllEnvs());

  const recorded = async (
    call: ReturnType<typeof callerOf>,
    actions: () => Promise<unknown>,
    name = 'a.flow',
  ) => {
    await call('flow', { action: 'start' });
    await actions();
    await call('flow', { action: 'stop' });
    const file = join(dir, name);
    await call('flow', { action: 'save', file });
    return { file, text: readFileSync(file, 'utf8') };
  };

  describe('recording', () => {
    it('records a tap on what an answer folded into its row, by its own text', async () => {
      const call = callerOf(context());
      device.screen = 'settings';
      const { text } = await recorded(call, async () => {
        const { data } = await call('find', { text: 'Wi-Fi' });
        await call('tap', { ref: must(data.matches[0], 'a match').ref });
      });
      expect(text).toContain('text="Wi-Fi"');
      expect(text).not.toMatch(/@\w/);
    });

    it('writes no step for the links an app opens: they are read, and nothing is opened', async () => {
      device.apps = {
        links: () => Promise.resolve([{ url: 'app://', kind: 'scheme' }]),
      } as unknown as AppManager;
      const call = callerOf(context());
      const { text } = await recorded(call, async () => {
        await call('open_link', { links: 'dev.app' });
        await call('open_link', { url: 'app://x' });
      });
      expect(
        text
          .trim()
          .split('\n')
          .filter((l) => l.startsWith('open_link')),
      ).toEqual(['open_link "app://x"']);
    });

    it('records a tap on a control an answer said once with its row, by its role', async () => {
      const call = callerOf(context());
      device.screen = 'doubled';
      const { text } = await recorded(call, async () => {
        const { data } = await call('find', { role: 'button', text: 'Camera' });
        await call('tap', { ref: must((data.matches as { ref: string }[])[0], 'a match').ref });
      });
      expect(text).toContain('tap role=button text="Camera"');
    });

    it('logs each action with the best selector, whatever named its target', async () => {
      const call = callerOf(context());
      const { text } = await recorded(call, async () => {
        await call('launch_app');
        const home = await call('screen');
        await call('tap', { ref: refOf(home.text, 'Form') });
        await call('type_text', { text: 'Ayşe', selector: { id: 'name' } });
        await call('press_key', { key: 'back' });
        await call('open_link', { url: 'app://x' });
        await call('set_location', { lat: 41, lon: 29 });
        await call('swipe', { direction: 'up' });
      });
      expect(text).toBe(`app dev.app

launch !running
tap role=button text="Form"
type "Ayşe" id=name
press_key back
open_link "app://x"
set_location 41 29
swipe up
`);
      expect(text).not.toMatch(/@\w/);
    });

    it('turns a tap at a point into the selector of what is there', async () => {
      const call = callerOf(context());
      const { text } = await recorded(call, () => call('tap', { x: 500, y: 350 }));
      expect(text).toContain('tap role=button text="Form"\n');
    });

    it('flags coordinates when nothing is there, with the screen they hold for', async () => {
      const call = callerOf(context());
      const { text } = await recorded(call, () => call('tap', { x: 500, y: 2000 }));
      expect(text).toContain('tap x=500 y=2000 screen=1080x2400 !coordinates\n');
    });

    it('records an ambiguous target with its index, flagged, and says so', async () => {
      device.screen = 'login';
      const call = callerOf(context());
      await call('flow', { action: 'start' });
      const s = await call('screen');
      const second = must(
        [...s.text.matchAll(/(@[a-z0-9-]+) button "Add"/g)][1]?.[1],
        'the second Add',
      );
      await call('tap', { ref: second });
      const stop = await call('flow', { action: 'stop' });
      expect(stop.text).toContain('tap role=button text="Add" index=1 !ambiguous');
      expect(stop.text).toContain('look at step 1: ambiguous');
      expect(stop.data.flagged).toEqual(['step 1: ambiguous']);
    });

    it('keeps out of the file what is not an action, or did not happen', async () => {
      const call = callerOf(context());
      const { text } = await recorded(call, async () => {
        await call('screen');
        await call('find', { text: 'Form' });
        await call('screenshot');
        await call('device_info');
        await refusal(call('tap', { selector: { text: 'Nothing like it' } }));
        await refusal(call('assert', { text: 'Nothing like it' }));
        await refusal(call('wait_for', { text: 'Nothing like it', timeoutMs: 300 }));
        await call('assert', { text: 'Ana sayfa' });
      });
      expect(text).toBe('app dev.app\n\nassert text="Ana sayfa"\n');
    });

    it('logs every step of a `steps` call, each named on its own screen', async () => {
      const call = callerOf(context());
      const { text } = await recorded(call, () =>
        call('steps', {
          steps: [
            { action: 'tap', selector: { text: 'Form' } },
            { action: 'wait_for', id: 'name' },
            { action: 'type_text', text: 'x', selector: { id: 'name' } },
            { action: 'tap', selector: { text: 'Gönder' } },
            { action: 'assert', id: 'result', check: 'text', equals: 'Gönderildi' },
          ],
        }),
      );
      expect(text).toBe(`app dev.app

tap role=button text="Form"
wait_for id=name
type "x" id=name
tap role=button text="Gönder"
assert id=result check=text equals="Gönderildi"
`);
    });

    it('keeps the steps of a `steps` call that ran before one failed', async () => {
      const call = callerOf(context());
      await call('flow', { action: 'start' });
      await refusal(
        call('steps', {
          steps: [
            { action: 'tap', selector: { text: 'Form' } },
            { action: 'tap', selector: { text: 'Nothing like it' } },
          ],
        }),
      );
      const stop = await call('flow', { action: 'stop' });
      expect(stop.text).toContain('tap role=button text="Form"');
      expect(stop.text).not.toContain('Nothing like it');
    });

    it('marks an action with no step, so that a replay cannot pass without it', async () => {
      const call = callerOf(context());
      const { text } = await recorded(call, () => call('gesture', { kind: 'pinch', scale: 2 }));
      expect(text).toContain('unrecorded "gesture pinch"');
    });

    it('leaves a window and a person out: neither is a step of the app, nor stops a replay', async () => {
      const call = callerOf(context());
      await expect(
        recorded(call, async () => {
          await call('mirror', { action: 'status' });
          await call('hand_off', { reason: 'Face ID', timeoutS: 1 });
        }),
      ).rejects.toThrow('nothing was recorded yet');
    });

    it('records an answered alert and a closed keyboard, and neither where nothing was there', async () => {
      device = new WithKeyboard();
      device.permissionUp = true;
      const call = callerOf(context());
      const { text } = await recorded(call, async () => {
        await call('alert', { answer: 'allow' });
        await refusal(call('alert', { answer: 'allow' }));
        await call('keyboard', { action: 'status' });
        await call('keyboard', { action: 'dismiss' });
        await call('keyboard', { action: 'dismiss' });
      });
      expect(text.match(/^alert /gm)).toHaveLength(1);
      expect(text).toContain('alert "allow"');
      expect(text.match(/^hide_keyboard$/gm)).toHaveLength(1);
    });

    it('marks whatever else changes things, so that a replay stops there', async () => {
      const page = { id: 'p', title: 't', url: 'https://x.test/', visible: true };
      device = Object.assign(new FakeDevice(), {
        web: {
          pages: () => Promise.resolve([page]),
          evaluate: () =>
            Promise.resolve({ tag: 'a', text: 'Go', title: 't', url: page.url, elements: [] }),
        },
        network: {
          paths: () => Promise.resolve([{ via: 'bytes', sees: 'bytes' }]),
          start: () => Promise.resolve({ id: 'handle' }),
          read: () => Promise.resolve({ entries: [] }),
          stop: () => Promise.resolve({ entries: [] }),
        },
      });
      const call = callerOf(context());
      const { text } = await recorded(call, async () => {
        await call('webview', { action: 'pages' });
        await call('webview', { action: 'elements' });
        await call('webview', { action: 'click', selector: '#go' });
        await call('webview', { action: 'eval', js: 'secretWork()' });
        await call('network', { action: 'paths' });
        await call('network', { action: 'start', via: 'bytes' });
        await call('network', { action: 'read' });
        await call('network', { action: 'stop' });
        await call('perf_launch', { repeats: 1 });
      });
      const unrecorded = text.split('\n').filter((l) => l.startsWith('unrecorded'));
      expect(unrecorded).toEqual([
        'unrecorded "webview click"',
        'unrecorded "webview eval"',
        'unrecorded "network start"',
        'unrecorded "network stop"',
      ]);
      expect(text).not.toContain('secretWork');
    });

    it('marks an op that no list knows yet, by its name alone', async () => {
      const ctx = context();
      const call = callerOf(ctx);
      const op = flowRecorder(ctx).wrap(
        defineOp({
          name: 'new_op',
          title: 'x',
          description: 'x',
          input: z.object({}).loose(),
          output: z.object({}),
          annotations: ACT,
          run: () => Promise.resolve(reply('done', {})),
        }),
      );
      const { text } = await recorded(call, () => op.handler({ words: 'typed words' }));
      expect(text).toContain('unrecorded "new_op"');
      expect(text).not.toContain('typed words');
    });

    it('marks nothing for what only looks, picks the device, films it or runs the recording', async () => {
      device = Object.assign(new FakeDevice(), {
        recorder: {
          extension: 'mp4',
          start: () => Promise.resolve({ id: 'handle' }),
          stop: () => Promise.resolve({ files: [] }),
        },
      });
      const call = callerOf(context());
      const { text } = await recorded(call, async () => {
        await call('list_devices');
        await call('use_device', { device: device.serial });
        await call('simulator', { action: 'list' });
        await call('record', { action: 'start', file: join(dir, 'a.mp4') });
        await call('record', { action: 'stop' });
        await call('report', { action: 'write', dir: join(dir, 'report') });
        await call('screen');
        await call('perf_snapshot');
        await call('app', { action: 'state' }).catch(() => undefined);
        await call('launch_app');
      });
      expect(text.split('\n').filter((l) => l && !l.startsWith('app '))).toEqual([
        'launch !running',
      ]);
    });

    it('writes a launch that started the app as a start, and flags one that found it running', async () => {
      const call = callerOf(context());
      device.running = false;
      const started = await recorded(call, () => call('launch_app'), 'started.flow');
      expect(started.text.split('\n').filter((l) => l && !l.startsWith('app '))).toEqual([
        'stop',
        'launch',
      ]);
      const stopped = await recorded(
        call,
        async () => {
          await call('terminate_app');
          await call('launch_app');
        },
        'stopped.flow',
      );
      expect(stopped.text).toBe(started.text);
      device.running = true;
      await call('flow', { action: 'start' });
      await call('launch_app');
      const stop = await call('flow', { action: 'stop' });
      expect(stop.text).toContain('\nlaunch !running\n');
      expect(stop.data.flagged).toEqual([
        expect.stringMatching(/^step 1: running: the app was running, and a replay goes on/),
      ]);
    });

    it('holds across the processes of a command line, on the device it began on', async () => {
      await callerOf(context())('flow', { action: 'start' });
      await callerOf(context())('tap', { selector: { text: 'Form' } });
      device = new FakeDevice('emulator-9999');
      device.screen = 'form';
      await callerOf(context())('assert', { text: 'Bilgiler' });
      device = new FakeDevice();
      const stop = await callerOf(context())('flow', { action: 'stop' });
      expect(stop.data.steps).toBe(1);
    });

    it('refuses a second start, a replay during a recording, and an empty or unnamed save', async () => {
      const call = callerOf(context());
      const stopped = await refusal(call('flow', { action: 'stop' }));
      expect(stopped.message).toContain('no recording');
      await call('flow', { action: 'start' });
      expect((await refusal(call('flow', { action: 'start' }))).message).toContain('running');
      expect(
        (await refusal(call('flow', { action: 'save', file: join(dir, 'e.flow') }))).message,
      ).toContain('nothing was recorded');
      await call('launch_app');
      expect((await refusal(call('flow', { action: 'save' }))).message).toContain('needs file');
      expect(
        (await refusal(call('flow', { action: 'save', file: join(dir, 'x.txt') }))).message,
      ).toContain('.flow');
      writeFileSync(join(dir, 'r.flow'), 'launch\n');
      expect(
        (await refusal(call('flow', { action: 'run', file: join(dir, 'r.flow') }))).message,
      ).toContain('stop the recording');
    });

    it('does not replace a saved flow unless told to', async () => {
      const call = callerOf(context());
      const { file, text } = await recorded(call, () => call('launch_app'));
      expect((await refusal(call('flow', { action: 'save', file }))).message).toContain('exists');
      expect(readFileSync(file, 'utf8')).toBe(text);
      await call('flow', { action: 'save', file, overwrite: true });
    });
  });

  describe('secrets', () => {
    it('a password field, and any later echo, become a name; no value reaches the disk', async () => {
      device.screen = 'login';
      const call = callerOf(context());
      const { text } = await recorded(call, async () => {
        await call('type_text', { text: SECRET, selector: { id: 'pass' } });
        await call('assert', { id: 'greeting', check: 'text', equals: `Merhaba ${SECRET}` });
        await call('tap', { selector: { id: 'greeting' } });
      });
      expect(device.typed).toEqual([SECRET]);
      expect(text).toBe(`app dev.app
secret PASS

type "\${PASS}" id=pass
assert id=greeting check=text equals="Merhaba \${PASS}"
tap id=greeting
`);
      const kept = readdirSync(join(dir, 'state', 'recordings'));
      for (const f of kept)
        expect(readFileSync(join(dir, 'state', 'recordings', f), 'utf8')).not.toContain(SECRET);
    });

    it('tells a password field by the focus, when text goes to no target', async () => {
      device.screen = 'login';
      const node = must(SCREENS.login?.[1], 'the password field');
      const was = must(node.f, 'its flags');
      node.f = was | 8;
      try {
        const call = callerOf(context());
        const { text } = await recorded(call, () => call('type_text', { text: 'p4ss' }));
        expect(text).not.toContain('p4ss');
        expect(text).toContain('type "${PASS}"');
      } finally {
        node.f = was;
      }
    });

    it('text matching APPDYNO_SECRETS becomes a name in any field', async () => {
      const call = callerOf(context(['kod-9911']));
      const { text } = await recorded(call, async () => {
        await call('tap', { selector: { text: 'Form' } });
        await call('type_text', { text: 'kod-9911', selector: { id: 'name' } });
      });
      expect(text).not.toContain('kod-9911');
      expect(text).toContain('secret SECRET_1');
      expect(text).toContain('type "${SECRET_1}" id=name');
    });
  });

  describe('replay', () => {
    const flowFile = (body: string, name = 'r.flow') => {
      const file = join(dir, name);
      writeFileSync(file, body);
      return file;
    };
    const FORM = `app dev.app
launch
tap text="Form"
type "Ayşe" id=name
tap text="Gönder"
assert id=result check=text equals="Gönderildi"
`;

    it('runs a recording back on the device through the same operations, with its timings', async () => {
      const call = callerOf(context());
      const { file } = await recorded(call, async () => {
        await call('launch_app');
        await call('tap', { selector: { text: 'Form' } });
        await call('type_text', { text: 'Ayşe', selector: { id: 'name' } });
        await call('tap', { selector: { text: 'Gönder' } });
      });
      device.screen = 'home';
      device.typed = [];
      const r = await call('flow', { action: 'run', file });
      expect(device.typed).toEqual(['Ayşe']);
      expect(device.screen).toBe('sent');
      expect(r.text).toContain('2. tap role=button text="Form": settled in 120 ms');
      expect(r.text).toContain('passed: 4 steps');
      const timings = must(r.data.timings, 'its timings');
      expect(timings[1]).toMatchObject({ settledMs: 120, settled: true, line: 4 });
      expect(timings[0]?.settledMs).toBeGreaterThanOrEqual(0);
    });

    it('touches a target only once it has stopped moving', async () => {
      device.screen = 'form';
      const send = must(
        SCREENS.form?.find((n) => n.t === 'Gönder'),
        'the send button',
      );
      const home = send.b;
      const tree = device.tree.bind(device);
      let reads = 0;
      // a list still coasting: the first reads each find it somewhere else
      device.tree = async () => {
        const drift = Math.max(0, 6 - ++reads) * 40;
        send.b = [home[0], home[1] + drift, home[2], home[3] + drift];
        return tree();
      };
      try {
        await callerOf(context())('flow', {
          action: 'run',
          file: flowFile('app dev.app\ntap text="Gönder"\n'),
        });
      } finally {
        send.b = home;
      }
      const tap = must(
        device.calls.find((c) => c.name === 'act'),
        'a touch',
      ).args[0] as { y: number };
      expect(tap.y).toBe((home[1] + home[3]) / 2);
    });

    it('settles every action', async () => {
      await callerOf(context())('flow', { action: 'run', file: flowFile(FORM) });
      const acts = device.calls.filter((c) => c.name === 'act');
      expect(acts.length).toBeGreaterThan(2);
      for (const a of acts) expect((a.args[1] as { settle?: unknown }).settle).toBeTruthy();
    });

    it('goes on past a prompt that does not come: it comes once, and a second run has none', async () => {
      const file = flowFile('app dev.app\nalert allow\ntap text="Form"\n');
      await callerOf(context())('flow', { action: 'run', file });
      expect(device.screen).toBe('form');
    });

    it('stops at a wait that ran out, with the nearest candidates', async () => {
      const file = flowFile('app dev.app\nwait_for text="Forn" timeoutMs=300\n');
      const e = await refusal(callerOf(context())('flow', { action: 'run', file }));
      expect(e.code).toBe('TIMEOUT');
      expect(e.message).toContain('not shown after 300 ms; nearest: ');
    });

    it('stops at a miss with the nearest candidates, the screen, the step and the line', async () => {
      const ctx = context();
      const file = flowFile(`app dev.app\n\n# the form\ntap text="Formm"\ntap text="Form"\n`);
      vi.useFakeTimers();
      const p = refusal(callerOf(ctx)('flow', { action: 'run', file }));
      await vi.advanceTimersByTimeAsync(30_000);
      const e = await p;
      vi.useRealTimers();
      expect(e.code).toBe('NOT_FOUND');
      expect(e.message).toContain(`${file}:4: step 1 failed: tap text="Formm"`);
      expect(e.message).toContain('nearest: ');
      expect(e.message).toMatch(/nearest: @\w+ button "Form"/);
      expect(e.message).toContain('Ana sayfa');
      expect(e.message).toContain(`--from 1`);
      // nothing after it ran, and nothing was tapped in its place
      expect(device.screen).toBe('home');
      expect(device.calls.filter((c) => c.name === 'act')).toEqual([]);
    });

    it('refuses several matches rather than take the first', async () => {
      device.screen = 'login';
      const e = await refusal(
        callerOf(context())('flow', { action: 'run', file: flowFile('tap text="Add"\n') }),
      );
      expect(e.code).toBe('AMBIGUOUS');
      expect(device.calls.filter((c) => c.name === 'act')).toEqual([]);
    });

    it('resumes at --from', async () => {
      device.screen = 'form';
      const r = await callerOf(context())('flow', {
        action: 'run',
        file: flowFile(FORM),
        from: 3,
      });
      expect(r.text).not.toContain('launch');
      expect(r.text).toContain('passed: 3 steps');
      expect(device.calls.some((c) => c.name === 'launch')).toBe(false);
      const out = await refusal(
        callerOf(context())('flow', { action: 'run', file: flowFile(FORM), from: 99 }),
      );
      expect(out.message).toContain('steps 1 to 5');
    });

    it('takes parameters from the call, then the environment; a missing one runs nothing', async () => {
      device.screen = 'form';
      const file = flowFile(`app dev.app\nparam WHO\ntype "\${WHO}" id=name\n`);
      const missing = await refusal(callerOf(context())('flow', { action: 'run', file }));
      expect(missing.message).toContain('no value for WHO');
      expect(device.calls.filter((c) => c.name === 'typeText')).toEqual([]);
      vi.stubEnv('WHO', 'env-person');
      await callerOf(context())('flow', { action: 'run', file });
      await callerOf(context())('flow', { action: 'run', file, params: ['WHO=param-person'] });
      expect(device.typed).toEqual(['env-person', 'param-person']);
    });

    it('takes values from an env file, under the call and over the environment', async () => {
      device.screen = 'form';
      const file = flowFile(
        `app dev.app\nparam WHO\nparam WHERE\ntype "\${WHO} \${WHERE}" id=name\n`,
      );
      const envFile = join(dir, 'ci.env');
      writeFileSync(envFile, '# staging\nWHO="file person"\nexport WHERE=file=place\n');
      vi.stubEnv('WHERE', 'env-place');
      const run = (o: object) =>
        callerOf(context())('flow', { action: 'run', file, envFile, ...o });
      await run({});
      await run({ params: ['WHO=param-person'] });
      expect(device.typed).toEqual(['file person file=place', 'param-person file=place']);
      const gone = await refusal(run({ envFile: join(dir, 'none.env') }));
      expect(gone.code).toBe('NOT_FOUND');
      expect(gone.message).toContain('no such file');
    });

    it('keeps a secret from an env file out of what a failure shows', async () => {
      device.screen = 'login';
      const file = flowFile(
        'app dev.app\nsecret CODE\nassert id=none check=text equals="${CODE}" timeoutMs=300\n',
      );
      const envFile = join(dir, 'ci.env');
      writeFileSync(envFile, `CODE=${SECRET}\n`);
      const e = await refusal(callerOf(context())('flow', { action: 'run', file, envFile }));
      expect(e.message).toContain('Merhaba •••');
      expect(e.message).not.toContain(SECRET);
    });

    describe('a flow that runs another', () => {
      const write = (name: string, text: string) => {
        writeFileSync(join(dir, name), text);
        return join(dir, name);
      };

      it('runs its steps in place, and a failure names the file they are in', async () => {
        const inner = write('inner.flow', 'launch\n\nassert id=none timeoutMs=200\n');
        const file = write('outer.flow', 'app dev.app\nlaunch\nrun inner.flow\nlaunch\n');
        const e = await refusal(callerOf(context())('flow', { action: 'run', file }));
        expect(e.message).toContain(`${inner}:3: step 3 failed: assert id=none`);
        expect(e.message).toContain(`appdyno flow run ${file} --from 3`);
        expect(device.calls.filter((c) => c.name === 'launch')).toHaveLength(2);
      });

      it('counts steps as they run, for --from and in its timings', async () => {
        const inner = write('inner.flow', 'launch\nassert text="Ana sayfa"\n');
        const file = write('outer.flow', 'app dev.app\nrun inner.flow\nlaunch\n');
        const { data } = await callerOf(context())('flow', { action: 'run', file, from: 2 });
        expect(data.timings?.map((t) => [t.n, t.file])).toEqual([
          [2, inner],
          [3, undefined],
        ]);
      });

      it('asks for the values of the file it runs, and hides its secrets', async () => {
        device.screen = 'login';
        write(
          'inner.flow',
          'secret CODE\nassert id=none check=text equals="${CODE}" timeoutMs=200\n',
        );
        const file = write('outer.flow', 'app dev.app\nrun inner.flow\n');
        const missing = await refusal(callerOf(context())('flow', { action: 'run', file }));
        expect(missing.message).toContain('no value for CODE');
        const params = [`CODE=${SECRET}`];
        const e = await refusal(callerOf(context())('flow', { action: 'run', file, params }));
        expect(e.message).toContain('Merhaba •••');
        expect(e.message).not.toContain(SECRET);
      });

      it('refuses before its first step what is wrong in any file', async () => {
        const run = (text: string) => {
          const file = write('outer.flow', `app dev.app\nlaunch\n${text}`);
          return refusal(callerOf(context())('flow', { action: 'run', file }));
        };
        write('broken.flow', 'launch\nfly\n');
        write('loop.flow', 'run outer.flow\n');
        expect((await run('run none.flow\n')).code).toBe('NOT_FOUND');
        expect((await run('run broken.flow\n')).message).toContain(
          'broken.flow: line 2: no step fly',
        );
        const cycle = await run('run loop.flow\n');
        expect(cycle.code).toBe('INVALID_ARGUMENT');
        expect(cycle.message).toContain('a flow cannot run itself');
        expect((await run('run outer.txt\n')).message).toContain('ends in .flow');
        expect(device.calls.filter((c) => c.name === 'launch')).toEqual([]);
      });

      it('exports the steps it holds, and a test run names the file of a failure', async () => {
        write('inner.flow', 'assert id=none timeoutMs=200\n');
        const file = write('outer.flow', 'app dev.app\nlaunch\nrun inner.flow\n');
        const { text } = await callerOf(context())('flow', { action: 'export', file });
        expect(text).toContain('launchApp');
        expect(text).toContain('id: "none"');
        const junit = join(dir, 'j.xml');
        await flowsFor(context()).test({ files: [file], devices: [], artifacts: dir, junit });
        expect(readFileSync(junit, 'utf8')).toContain('message="inner.flow line 1, step 2:');
      });
    });

    it('hides a secret from the failure it may show up in', async () => {
      device.screen = 'login';
      const file = flowFile(`app dev.app
secret CODE
assert id=greeting check=text equals="\${CODE}" timeoutMs=300
`);
      const e = await refusal(
        callerOf(context())('flow', { action: 'run', file, params: [`CODE=${SECRET}`] }),
      );
      expect(e.code).toBe('CHECK_FAILED');
      expect(e.message).not.toContain(SECRET);
      expect(e.message).toContain('•••');
    });

    it('checks every line before the first step acts', async () => {
      const file = flowFile('launch\npress_key warp\n');
      const e = await refusal(callerOf(context())('flow', { action: 'run', file }));
      expect(e.message).toContain(`${file}:2`);
      expect(device.calls.some((c) => c.name === 'launch')).toBe(false);
    });

    it('stops at an action that was not recorded, naming it', async () => {
      const e = await refusal(
        callerOf(context())('flow', {
          action: 'run',
          file: flowFile('launch\nunrecorded "gesture pinch"\nlaunch\n'),
        }),
      );
      expect(e.message).toContain('step 2 failed');
      expect(e.message).toContain('gesture pinch');
      expect(device.calls.filter((c) => c.name === 'launch')).toHaveLength(1);
    });

    it('refuses coordinates on a screen of another size, and takes them on their own', async () => {
      const file = flowFile('tap x=500 y=350 screen=720x1280 !coordinates\n');
      const e = await refusal(callerOf(context())('flow', { action: 'run', file }));
      expect(e.message).toContain('720x1280');
      expect(device.calls.filter((c) => c.name === 'act')).toEqual([]);
      await callerOf(context())('flow', {
        action: 'run',
        file: flowFile('tap x=500 y=350 screen=1080x2400 !coordinates\n', 's.flow'),
      });
      expect(device.screen).toBe('form');
    });

    it('fails a step whose app died, saying why', async () => {
      device.crashReports = [{ at: 'now', reason: 'NullPointerException' }];
      device.pid = '100';
      device.appPid = () => {
        const was = device.pid;
        device.pid = '200';
        return Promise.resolve(was);
      };
      const e = await refusal(
        callerOf(context())('flow', { action: 'run', file: flowFile('tap text="Form"\n') }),
      );
      expect(e.message).toContain('the app died: NullPointerException');
    });

    it('says a device failure while a step waits for its target, with no op around it', async () => {
      const real = device.tree.bind(device);
      let reads = 0;
      device.tree = async () => {
        if (++reads === 2) throw new DeviceError('TIMEOUT', 'tree.get did not answer');
        return real();
      };
      const r = await flowsFor(context()).replay(flowFile('tap text="Form"\n'));
      expect(r.failure).toMatchObject({
        code: 'TIMEOUT',
        message: 'tree.get did not answer',
        hint: 'the device did not answer; read the screen and try again',
      });
    });

    it('gives a measure each step around its action, in order', async () => {
      const events: string[] = [];
      const r = await flowsFor(context()).replay(flowFile(FORM), {
        onStep: (e: StepEvent) => {
          if (e.phase === 'before') {
            const acted = device.calls.filter((c) => c.name === 'act').length;
            events.push(`${e.n} before ${acted}`);
          } else events.push(`${e.n} after ${String(e.result.settledMs !== undefined)}`);
        },
      });
      expect(r.passed).toBe(true);
      expect(events[0]).toBe('1 before 0');
      expect(events[1]).toBe('1 after true');
      expect(events[2]).toMatch(/^2 before/);
      expect(events.at(-1)).toBe('5 after false');
      expect(events).toHaveLength(10);
    });
  });

  describe('export', () => {
    it('gives Maestro YAML with no device, and refuses a step it has no form for', async () => {
      const ctx = new ServerContext(DEFAULT_POLICY, []);
      const call = callerOf(ctx);
      const ok = join(dir, 'ok.flow');
      writeFileSync(ok, 'app dev.app\nlaunch\ntap id=x\n');
      expect((await call('flow', { action: 'export', file: ok })).text).toContain('tapOn:');
      const no = join(dir, 'no.flow');
      writeFileSync(no, 'app dev.app\nlaunch\nalert allow\n');
      const e = await refusal(call('flow', { action: 'export', file: no }));
      expect(e.message).toContain('step 2');
    });
  });

  describe('the test runner', () => {
    it('finds flows in a directory in order; finding none is a failure', () => {
      expect(() => flowFiles([join(dir, 'none')])).toThrow(/no such file/);
      expect(() => flowFiles([dir])).toThrow(/no .flow files/);
      const tests = mkdtempSync(join(dir, 'tests-'));
      for (const f of ['b.flow', 'a.flow', 'c.txt']) writeFileSync(join(tests, f), 'launch\n');
      expect(flowFiles([tests])).toEqual([join(tests, 'a.flow'), join(tests, 'b.flow')]);
    });

    it('selects files by their tags, and a broken file stays to fail', () => {
      const tests = mkdtempSync(join(dir, 'tests-'));
      const file = (name: string, text: string) => {
        writeFileSync(join(tests, name), text);
        return join(tests, name);
      };
      const smoke = file('a.flow', 'tag smoke login\nlaunch\n');
      const slow = file('b.flow', 'tag smoke slow\nlaunch\n');
      const plain = file('c.flow', 'launch\n');
      const broken = file('d.flow', 'fly\n');
      const files = [smoke, slow, plain, broken];
      expect(flowsTagged(files)).toEqual(files);
      expect(flowsTagged(files, ['login'])).toEqual([smoke, broken]);
      expect(flowsTagged(files, ['login', 'slow'])).toEqual([smoke, slow, broken]);
      expect(flowsTagged(files, [], ['slow'])).toEqual([smoke, plain, broken]);
      expect(flowsTagged(files, ['smoke'], ['slow'])).toEqual([smoke, broken]);
      expect(() => flowsTagged([smoke, slow], ['none'], ['slow'])).toThrow(
        'no flow of 2 is selected by --tag none --exclude-tag slow',
      );
    });

    it('runs every file, writes JUnit, and keeps a failure’s screenshot and tree', async () => {
      const tests = mkdtempSync(join(dir, 'tests-'));
      writeFileSync(join(tests, 'a-good.flow'), 'app dev.app\nlaunch\nassert text="Ana sayfa"\n');
      writeFileSync(
        join(tests, 'b-bad.flow'),
        'app dev.app\nsecret CODE\nlaunch\nassert id=none check=text equals="${CODE}" timeoutMs=300\n',
      );
      writeFileSync(join(tests, 'c-broken.flow'), 'fly\n');
      writeFileSync(join(tests, 'd-good.flow'), 'app dev.app\nlaunch\n');
      const artifacts = join(dir, 'artifacts');
      const junit = join(artifacts, 'junit.xml');
      const lines: string[] = [];
      const r = await flowsFor(context()).test({
        files: flowFiles([tests]),
        devices: ['emulator-5580'],
        artifacts,
        junit,
        params: { CODE: 'sifre-1' },
        log: (l) => lines.push(l),
      });
      expect(r.passed).toBe(false);
      expect(r.suites[0]?.cases.map((c) => [c.name, !!c.failure])).toEqual([
        ['a-good.flow', false],
        ['b-bad.flow', true],
        ['c-broken.flow', true],
        ['d-good.flow', false],
      ]);
      const xml = readFileSync(junit, 'utf8');
      expect(xml).toContain('<testsuites tests="4" failures="2"');
      expect(xml).toContain('<testsuite name="emulator-5580"');
      expect(xml).toContain('message="line 4, step 2:');
      expect(xml).toContain('settled in');
      expect(xml).not.toContain('sifre-1');
      const kept = join(artifacts, 'emulator-5580', 'b-bad.flow');
      expect(existsSync(join(kept, 'screen.jpg'))).toBe(true);
      const tree = readFileSync(join(kept, 'tree.json'), 'utf8');
      expect(JSON.parse(tree)).toHaveProperty('nodes');
      expect(lines.join('\n')).toContain('FAIL b-bad.flow');
      expect(lines.join('\n')).toContain('ok   d-good.flow');
    });

    it('hides a secret typed on the screen in the saved tree', async () => {
      const tests = mkdtempSync(join(dir, 'tests-'));
      device.screen = 'login';
      writeFileSync(
        join(tests, 'echo.flow'),
        'app dev.app\nsecret CODE\nassert id=none check=text equals="${CODE}" timeoutMs=300\n',
      );
      const artifacts = join(dir, 'artifacts');
      await flowsFor(context()).test({
        files: flowFiles([tests]),
        devices: [],
        artifacts,
        junit: join(artifacts, 'j.xml'),
        params: { CODE: SECRET },
      });
      const tree = readFileSync(join(artifacts, device.serial, 'echo.flow', 'tree.json'), 'utf8');
      expect(tree).not.toContain(SECRET);
      expect(tree).toContain('Merhaba •••');
      expect(readFileSync(join(artifacts, 'j.xml'), 'utf8')).not.toContain(SECRET);
    });

    describe('a retry', () => {
      const flow = 'app dev.app\nopen_link "app://x"\nassert text="Ana sayfa" timeoutMs=200\n';
      /** The test run of one file, on a screen that fails it, with `onRetry` as a retry begins. */
      const run = async (text: string, retries: number, onRetry: () => void = () => undefined) => {
        const tests = mkdtempSync(join(dir, 'tests-'));
        writeFileSync(join(tests, 'a.flow'), text);
        const artifacts = join(dir, 'artifacts');
        const lines: string[] = [];
        device.screen = 'form';
        const r = await flowsFor(context()).test({
          files: flowFiles([tests]),
          devices: [],
          artifacts,
          junit: join(artifacts, 'j.xml'),
          retries,
          log: (l) => {
            lines.push(l);
            if (l.includes('retry')) onRetry();
          },
        });
        return {
          ...r,
          lines,
          kept: join(artifacts, device.serial, 'a.flow'),
          xml: readFileSync(join(artifacts, 'j.xml'), 'utf8'),
        };
      };
      const firstSteps = () => device.calls.filter((c) => c.name === 'openUrl').length;

      it('calls a file that passed only on a retry flaky, never a plain pass', async () => {
        const r = await run(flow, 2, () => (device.screen = 'home'));
        expect(r.passed).toBe(true);
        expect(r.flaky).toEqual([`${device.serial}/a.flow`]);
        expect(r.xml).toContain('failures="0" errors="0" flakes="1"');
        expect(r.xml).toMatch(
          /<flakyFailure message="line 3, step 2: .+" type="flow"><stackTrace>/,
        );
        expect(r.xml).toContain('flaky: passed on attempt 2 of 3');
        expect(r.xml.indexOf('</flakyFailure>')).toBeLessThan(r.xml.indexOf('<system-out>'));
        expect(r.xml).not.toContain('rerunFailure');
        const said = r.lines.join('\n');
        expect(said).toContain('FLAKY a.flow: passed on attempt 2 of 3');
        expect(said).toContain('0 passed, 1 flaky, 0 failed');
        expect(said).toContain('flaky, passed only on a retry');
        expect(said).not.toContain('ok   a.flow');
        // what failed stays, and a passing retry leaves nothing over it
        expect(existsSync(join(r.kept, 'screen.jpg'))).toBe(true);
        expect(existsSync(join(r.kept, 'attempt-2'))).toBe(false);
      });

      it('starts the file over at its first step: a failed step never passes within a run', async () => {
        const r = await run(flow, 1, () => (device.screen = 'home'));
        expect(r.flaky).toHaveLength(1);
        expect(firstSteps()).toBe(2);
      });

      it('fails a file that fails every attempt, with each one in the report', async () => {
        const r = await run(flow, 2);
        expect(r.passed).toBe(false);
        expect(r.flaky).toEqual([]);
        expect(firstSteps()).toBe(3);
        expect(r.xml).toContain('failures="1" errors="0" flakes="0"');
        expect(r.xml.match(/<rerunFailure /g)).toHaveLength(2);
        expect(r.xml).not.toContain('flakyFailure');
        for (const f of [r.kept, join(r.kept, 'attempt-2'), join(r.kept, 'attempt-3')])
          expect(existsSync(join(f, 'screen.jpg'))).toBe(true);
      });

      it('leaves a run with no retries as it was', async () => {
        const r = await run(flow, 0);
        expect(firstSteps()).toBe(1);
        expect(r.lines.at(-1)).toBe('0 passed, 0 flaky, 1 failed');
        expect(r.lines.join('\n')).not.toContain('retry');
        expect(r.xml).not.toContain('rerunFailure');
      });

      it('does not run again what cannot end otherwise', async () => {
        const r = await run('fly\n', 3);
        expect(r.passed).toBe(false);
        expect(r.lines.join('\n')).not.toContain('retry');
      });

      it('refuses to retry a measured flow', async () => {
        const o = { files: [], devices: [], artifacts: dir, junit: join(dir, 'j.xml') };
        const test = flowsFor(context()).test({ ...o, retries: 1, iterations: 5 });
        expect((await refusal(test)).code).toBe('INVALID_ARGUMENT');
      });
    });

    it('runs on each device in turn, and a device that will not open fails its files alone', async () => {
      const tests = mkdtempSync(join(dir, 'tests-'));
      writeFileSync(join(tests, 'a.flow'), 'app dev.app\nlaunch\n');
      const devices = new Map([
        ['one', new FakeDevice('one')],
        ['two', new FakeDevice('two')],
      ]);
      const provider: DeviceProvider = {
        list: () =>
          Promise.resolve(
            [...devices.keys()].map((serial) => ({ serial, state: 'device', ready: true })),
          ),
        handles: (serial) => devices.has(serial),
        open: (serial) => must(devices.get(serial), serial),
      };
      const ctx = new ServerContext(DEFAULT_POLICY, [provider]);
      const artifacts = join(dir, 'artifacts');
      const r = await flowsFor(ctx).test({
        files: flowFiles([tests]),
        devices: ['one', 'gone', 'two'],
        artifacts,
        junit: join(artifacts, 'j.xml'),
      });
      expect(
        r.suites.map((s) => [s.name, must(s.cases[0], 'its case').failure === undefined]),
      ).toEqual([
        ['one', true],
        ['gone', false],
        ['two', true],
      ]);
      for (const d of devices.values()) expect(d.calls.some((c) => c.name === 'launch')).toBe(true);
    });
  });

  it('reads NAME=value, a value with = in it included', () => {
    expect(paramsOf(['A=1', 'B=x=y', 'C='])).toEqual({ A: '1', B: 'x=y', C: '' });
    expect(() => paramsOf(['nope'])).toThrow(/NAME=value/);
  });

  it('writes a flow its own parser reads back', async () => {
    device.screen = 'login';
    const call = callerOf(context());
    const { text } = await recorded(call, async () => {
      await call('type_text', {
        text: SECRET,
        selector: { id: 'pass' },
        replace: true,
        submit: true,
      });
      await call('wait_for', { id: 'greeting', timeoutMs: 800 });
      await call('assert', { text: 'Merhaba', check: 'absent', expect: false });
      await call('scroll_to', { selector: { id: 'greeting' }, direction: 'down', maxSwipes: 3 });
      await call('swipe', { direction: 'left', distance: 200 });
      await call('gesture', { kind: 'long_press', selector: { id: 'greeting' }, durationMs: 300 });
      await call('gesture', { kind: 'double_tap', selector: { id: 'greeting' } });
      await call('terminate_app');
    });
    const f = parseFlow(text);
    expect(f.steps.map((s) => s.action)).toEqual([
      'type',
      'wait_for',
      'assert',
      'scroll_to',
      'swipe',
      'long_press',
      'double_tap',
      'stop',
    ]);
    expect(text).toContain('swipe left distance=200 screen=1080x2400 !coordinates');
  });
});
