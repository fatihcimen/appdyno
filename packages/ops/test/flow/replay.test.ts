import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { must } from '@appdyno/core';
import { type StepEvent } from '@appdyno/flows';
import { DeviceError } from '@appdyno/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDevice, WithKeyboard } from '@appdyno/testing/fake-device.js';
import { SCREENS } from '@appdyno/testing/fake-screens.js';
import { callerOf, flowsFor, SECRET, flowHelpers } from './harness.js';

describe('flows', () => {
  let dir: string;
  let device: FakeDevice;
  const { context, refusal, recorded } = flowHelpers(
    () => device,
    () => dir,
  );
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'appdyno-flow-'));
    vi.stubEnv('APPDYNO_STATE_DIR', join(dir, 'state'));
    device = new FakeDevice();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
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

    it('closes a full-screen keyboard over the button a step taps, which the touch would type on', async () => {
      const keyboard = new WithKeyboard();
      keyboard.top = 0;
      keyboard.screen = 'form';
      device = keyboard;
      const call = callerOf(context());
      const file = flowFile('app dev.app\ntap text="Gönder"\nassert id=result\n');
      expect((await call('flow', { action: 'run', file })).text).toContain('passed: 2 steps');
      expect(keyboard.up).toBe(false);
    });

    it('closes the keyboard at once where the window it shrank leaves out what a step taps, before the wait for it', async () => {
      const keyboard = new WithKeyboard();
      keyboard.hides = 'Gönder';
      keyboard.screen = 'form';
      device = keyboard;
      const call = callerOf(context());
      const file = flowFile('app dev.app\ntap text="Gönder"\nassert id=result\n');
      const started = Date.now();
      expect((await call('flow', { action: 'run', file })).text).toContain('passed: 2 steps');
      // a replayed step waits 10 s for its target, which only the keyboard's going brings
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(keyboard.up).toBe(false);
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
      const e = await refusal(callerOf(ctx)('flow', { action: 'run', file }));
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

    it("takes parameters from the call, then a command line's environment and never a server's; a missing one runs nothing", async () => {
      device.screen = 'form';
      const file = flowFile(`app dev.app\nparam WHO\ntype "\${WHO}" id=name\n`);
      vi.stubEnv('WHO', 'env-person');
      const missing = await refusal(callerOf(context())('flow', { action: 'run', file }));
      expect(missing.message).toContain('no value for WHO');
      expect(device.calls.filter((c) => c.name === 'typeText')).toEqual([]);
      await callerOf(context([], { env: process.env }))('flow', { action: 'run', file });
      await callerOf(context())('flow', { action: 'run', file, params: ['WHO=param-person'] });
      expect(device.typed).toEqual(['env-person', 'param-person']);
    });

    it('hides for good each value a run took from an env file, and no other', async () => {
      device.screen = 'login';
      const file = flowFile(
        'app dev.app\nparam CODE\nparam USER\ntype "${CODE}" id=user\ntype "${USER}" id=pass\n',
      );
      const envFile = join(dir, 'ci.env');
      writeFileSync(envFile, `CODE=${SECRET}\nUSER=ada\nDEBUG=1\nEMPTY=\n`);
      const call = callerOf(context());
      await call('flow', { action: 'run', file, envFile, params: ['USER=Merhaba'] });
      expect(device.typed).toEqual([SECRET, 'Merhaba']);
      const { text } = await call('screen', {});
      expect(text).toContain('Merhaba •••');
      expect(text).not.toContain(SECRET);
      expect(text).toContain('Merhaba');
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

    it('fails a step that finds the app gone with its death, where the step before could not tell it', async () => {
      // the system restarted the app in front, and nothing knew its process before: only the report tells
      device.crashReports = [{ at: 'now', reason: 'IllegalStateException: fixture crash' }];
      const e = await refusal(
        callerOf(context())('flow', {
          action: 'run',
          file: flowFile('tap text="Form"\ntap text="Kaydet"\n'),
        }),
      );
      expect([e.code, e.hint]).toEqual([
        'APP_NOT_RUNNING',
        'launch_app starts it again, and crashes says why it died',
      ]);
      expect(e.message).toContain(
        '\nthe app died: IllegalStateException: fixture crash, by step 2\n',
      );
      device.crashReports = [];
      const plain = await refusal(
        callerOf(context())('flow', { action: 'run', file: flowFile('tap text="Kaydet"\n') }),
      );
      expect(plain.code).toBe('NOT_FOUND');
    });

    it('tells that death by the app in front as the step began where none is selected, as a batch does', async () => {
      device.crashReports = [{ at: 'now', reason: 'IllegalStateException: fixture crash' }];
      const e = await refusal(
        callerOf(context([], { app: null }))('flow', {
          action: 'run',
          file: flowFile('tap text="Form"\ntap text="Kaydet"\n'),
        }),
      );
      expect(e.code).toBe('APP_NOT_RUNNING');
      expect(e.message).toContain(
        '\nthe app died: IllegalStateException: fixture crash, by step 2\n',
      );
    });

    it('says a device failure while a step waits for its target, with no op around it', async () => {
      const real = device.tree.bind(device);
      let reads = 0;
      // the first read is the look for a keyboard over the target, the second finds it, the third waits for it to hold still
      device.tree = async () => {
        if (++reads === 3) throw new DeviceError('TIMEOUT', 'tree.get did not answer');
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
});
