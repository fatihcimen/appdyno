import { mkdtempSync, readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DeviceProvider } from '@appdyno/core';
import { parseFlow, type StepEvent } from '@appdyno/flows';
import { DeviceError } from '@appdyno/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_POLICY,
  flowFiles,
  flowsFor,
  paramsOf,
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
      list: async () => [{ serial: device.serial, state: 'device', ready: true }],
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
        await call('tap', { ref: (data.matches as { ref: string }[])[0]!.ref });
      });
      expect(text).toContain('text="Wi-Fi"');
      expect(text).not.toMatch(/@\w/);
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

launch
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
      const second = [...s.text.matchAll(/(@[a-z0-9-]+) button "Add"/g)][1]![1];
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
        await call('wait_for', { text: 'Nothing like it', timeoutMs: 300 });
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

    it('records an answered alert and a closed keyboard, and neither where nothing was there', async () => {
      device = new WithKeyboard();
      device.permissionUp = true;
      const call = callerOf(context());
      const { text } = await recorded(call, async () => {
        await call('alert', { answer: 'allow' });
        await call('alert', { answer: 'allow' });
        await call('keyboard', { action: 'status' });
        await call('keyboard', { action: 'dismiss' });
        await call('keyboard', { action: 'dismiss' });
      });
      expect(text.match(/^alert /gm)).toHaveLength(1);
      expect(text).toContain('alert "allow"');
      expect(text.match(/^hide_keyboard$/gm)).toHaveLength(1);
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
      const node = SCREENS.login![1]!;
      const was = node.f;
      node.f = was! | 8;
      try {
        const call = callerOf(context());
        const { text } = await recorded(call, () => call('type_text', { text: 'p4ss' }));
        expect(text).not.toContain('p4ss');
        expect(text).toContain('type "${PASS}"');
      } finally {
        node.f = was!;
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
      const timings = r.data.timings as { settledMs?: number; settled?: boolean; line: number }[];
      expect(timings[1]).toMatchObject({ settledMs: 120, settled: true, line: 4 });
      expect(timings[0]!.settledMs).toBeGreaterThanOrEqual(0);
    });

    it('touches a target only once it has stopped moving', async () => {
      device.screen = 'form';
      const send = SCREENS.form!.find((n) => n.t === 'Gönder')!;
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
      const tap = device.calls.find((c) => c.name === 'act')!.args[0] as { y: number };
      expect(tap.y).toBe((home[1] + home[3]) / 2);
    });

    it('settles every action', async () => {
      await callerOf(context())('flow', { action: 'run', file: flowFile(FORM) });
      const acts = device.calls.filter((c) => c.name === 'act');
      expect(acts.length).toBeGreaterThan(2);
      for (const a of acts) expect((a.args[1] as { settle?: unknown }).settle).toBeTruthy();
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
      device.appPid = async () => {
        const was = device.pid;
        device.pid = '200';
        return was;
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
        message: expect.stringContaining('tree.get did not answer (TIMEOUT)'),
      });
    });

    it('gives a measure each step around its action, in order', async () => {
      const events: string[] = [];
      const r = await flowsFor(context()).replay(flowFile(FORM), {
        onStep: (e: StepEvent) => {
          if (e.phase === 'before') {
            const acted = device.calls.filter((c) => c.name === 'act').length;
            events.push(`${e.n} before ${acted}`);
          } else events.push(`${e.n} after ${e.result.settledMs !== undefined}`);
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
      expect(r.suites[0]!.cases.map((c) => [c.name, !!c.failure])).toEqual([
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

    it('runs on each device in turn, and a device that will not open fails its files alone', async () => {
      const tests = mkdtempSync(join(dir, 'tests-'));
      writeFileSync(join(tests, 'a.flow'), 'app dev.app\nlaunch\n');
      const devices = new Map([
        ['one', new FakeDevice('one')],
        ['two', new FakeDevice('two')],
      ]);
      const provider: DeviceProvider = {
        list: async () =>
          [...devices.keys()].map((serial) => ({ serial, state: 'device', ready: true })),
        handles: (serial) => devices.has(serial),
        open: (serial) => devices.get(serial)!,
      };
      const ctx = new ServerContext(DEFAULT_POLICY, [provider]);
      const artifacts = join(dir, 'artifacts');
      const r = await flowsFor(ctx).test({
        files: flowFiles([tests]),
        devices: ['one', 'gone', 'two'],
        artifacts,
        junit: join(artifacts, 'j.xml'),
      });
      expect(r.suites.map((s) => [s.name, s.cases[0]!.failure === undefined])).toEqual([
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
