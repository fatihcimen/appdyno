import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_POLICY, flowFiles, ServerContext } from '../../src/index.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { callerOf, flowsFor, flowHelpers } from './harness.js';

describe('a flow with a setup and a teardown', () => {
  let dir: string;
  let tests: string;
  let device: FakeDevice;
  const { context, refusal } = flowHelpers(
    () => device,
    () => dir,
  );
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'appdyno-flow-'));
    // a folder the harness's server may write in, so a project there is one of its own
    tests = join(dir, 'flows');
    mkdirSync(join(tests, 'shop'), { recursive: true });
    vi.stubEnv('APPDYNO_STATE_DIR', join(dir, 'state'));
    device = new FakeDevice();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  const write = (name: string, ...lines: string[]) => {
    writeFileSync(join(tests, name), `${lines.join('\n')}\n`);
    return join(tests, name);
  };
  const project = (prepare: Record<string, string[] | string>) => {
    mkdirSync(join(tests, '.appdyno'), { recursive: true });
    writeFileSync(join(tests, '.appdyno', 'test.json'), JSON.stringify({ prepare }));
  };
  /** A command of this project's that prints `line`, by the Node that runs the tests. */
  const prints = (line: string) => [process.execPath, '-e', `console.log(${JSON.stringify(line)})`];
  const test = async (ctx: ServerContext, retries = 0) => {
    const artifacts = join(dir, 'artifacts');
    const lines: string[] = [];
    const r = await flowsFor(ctx).test({
      files: flowFiles([tests]),
      devices: [],
      artifacts,
      junit: join(artifacts, 'j.xml'),
      retries,
      log: (l) => void lines.push(l),
    });
    return { ...r, said: lines.join('\n'), xml: readFileSync(join(artifacts, 'j.xml'), 'utf8') };
  };
  const did = () =>
    device.calls.flatMap((c) =>
      c.name === 'launch' || c.name === 'terminate'
        ? [c.name]
        : c.name === 'openUrl'
          ? [String(c.args[0])]
          : [],
    );
  const PASSES = 'assert text="Ana sayfa" timeoutMs=300';
  const FAILS = 'assert text="Yok" timeoutMs=300';

  it("runs each folder's shared files around every flow under it, and none of them as a test", async () => {
    project({});
    write('_setup.flow', 'app dev.app', 'launch');
    write('_teardown.flow', 'stop');
    write('shop/_setup.flow', 'open_link "app://sign-in"');
    write('shop/_teardown.flow', 'open_link "app://sign-out"');
    write('shop/pay.flow', 'open_link "app://pay"', PASSES);
    write('top.flow', 'open_link "app://top"');
    expect(flowFiles([tests])).toEqual([join(tests, 'shop/pay.flow'), join(tests, 'top.flow')]);
    const r = await test(context());
    expect(r.passed).toBe(true);
    expect(did()).toEqual([
      ...['launch', 'app://sign-in', 'app://pay', 'app://sign-out', 'terminate'],
      ...['launch', 'app://top', 'terminate'],
    ]);
    expect(r.xml).toContain('setup 1. launch');
    expect(r.xml).toContain('teardown 2. stop');
    expect(r.said).toContain('ok   shop/pay.flow (2 steps');
  });

  it('runs the teardown after a failure, with the evidence of the failure and not of what cleaned up', async () => {
    write('_teardown.flow', 'app dev.app', 'open_link "app://clean"', 'launch');
    write('a.flow', 'tap text="Form"', FAILS);
    device.screen = 'home';
    const r = await test(context());
    expect(r.passed).toBe(false);
    expect(did()).toEqual(['app://clean', 'launch']);
    expect(r.said).toContain('FAIL a.flow: line 2, step 2');
    expect(r.said).not.toContain('TEARDOWN');
    // the form the failure was on: the teardown's launch went home after it was kept
    const kept = join(dir, 'artifacts', device.serial, 'a.flow', 'tree.json');
    expect(readFileSync(kept, 'utf8')).toContain('Gönder');
    expect(r.xml).toContain('a.flow --from 2');
  });

  it("tells a teardown's failure apart: the file's case passed, a case of its own failed, the run failed", async () => {
    write('_teardown.flow', 'app dev.app', FAILS, 'open_link "app://after"');
    write('a.flow', 'launch', PASSES);
    const r = await test(context());
    expect(r.passed).toBe(false);
    expect(did()).toEqual(['launch', 'app://after']);
    expect(r.said).toContain('ok   a.flow (2 steps');
    expect(r.said).toContain('TEARDOWN FAILED a.flow: teardown _teardown.flow line 2, step 1:');
    expect(r.said).toContain('1 passed, 0 flaky, 1 failed');
    expect(r.suites[0]?.cases.map((c) => [c.name, !c.failure])).toEqual([
      ['a.flow', true],
      ['a.flow (teardown)', false],
    ]);
    const call = callerOf(context());
    const e = await refusal(call('run_flow', { action: 'run', file: join(tests, 'a.flow') }));
    expect(e.code).toBe('CHECK_FAILED');
    expect(e.message).toContain('passed: 2 steps\nthe teardown failed');
    // beside a failed step too, which stays the refusal
    write('a.flow', 'launch', 'assert text="Hiç" timeoutMs=300');
    const both = await refusal(call('run_flow', { action: 'run', file: join(tests, 'a.flow') }));
    expect(both.message).toContain('step 2 failed: assert text="Hiç"');
    expect(both.message).toContain(
      'the teardown failed, so what runs next starts from what it left:',
    );
  });

  it('fails a flow on its setup, runs none of its steps, and names the setup in the failure', async () => {
    write('a.flow', 'app dev.app', 'setup _in.flow', 'open_link "app://never"');
    write('_in.flow', FAILS);
    const r = await test(context());
    expect(did()).toEqual([]);
    expect(r.said).toContain('FAIL a.flow: _in.flow line 1, step 1');
    expect(r.xml).toContain('_in.flow:1: setup step 1 failed');
    expect(r.xml).not.toContain('--from');
  });

  it('runs the teardown and the setup again for a retry, and says once what stands between two goes', async () => {
    write('_setup.flow', 'app dev.app', 'launch');
    write('_teardown.flow', 'stop');
    write('a.flow', FAILS);
    const r = await test(context(), 2);
    expect(did()).toEqual(Array(3).fill(['launch', 'terminate']).flat());
    expect(r.said.split("the failed attempt's teardown runs")).toHaveLength(2);
    expect(r.said).toContain('then the setup runs again');
  });

  describe('a prepare step', () => {
    it("runs the project's command with no shell, said first, and types the value it printed", async () => {
      project({ seed: prints('WHO=Ada; echo x'), 'sign-in': 'shared/_in.flow' });
      mkdirSync(join(tests, 'shared'));
      write('shared/_in.flow', 'open_link "app://in"');
      write(
        'a.flow',
        ...['app dev.app', 'param WHO', 'prepare seed gives=WHO', 'prepare sign-in'],
        'open_link "app://${WHO}"',
      );
      const r = await test(context());
      expect(r.said.split('\n')[0]).toContain("prepare seed runs the project's own command:");
      expect(r.passed).toBe(true);
      expect(did()).toEqual(['app://in', 'app://Ada; echo x']);
    });

    it('keeps a value a person gave by name, and hides one that is a secret', async () => {
      project({ seed: prints('WHO=Ada\nTOKEN=tok-98765') });
      write(
        'a.flow',
        ...['app dev.app', 'param WHO', 'secret TOKEN', 'prepare seed gives=WHO gives=TOKEN'],
        ...['open_link "app://${WHO}"', 'assert text="${TOKEN}" timeoutMs=300'],
      );
      const artifacts = join(dir, 'artifacts');
      await flowsFor(context()).test({
        files: flowFiles([tests]),
        devices: [],
        artifacts,
        junit: join(artifacts, 'j.xml'),
        params: { WHO: 'Grace' },
      });
      expect(did()).toEqual(['app://Grace']);
      expect(readFileSync(join(artifacts, 'j.xml'), 'utf8')).not.toContain('tok-98765');
    });

    it('asks a person before it runs for a tool call, and runs nothing with no yes', async () => {
      const mark = join(tests, 'ran');
      const touch = `require('fs').writeFileSync(${JSON.stringify(mark)}, '')`;
      project({ seed: [process.execPath, '-e', touch] });
      const file = write('a.flow', 'app dev.app', 'prepare seed', 'launch');
      const e = await refusal(callerOf(context())('run_flow', { action: 'run', file }));
      expect(e.message).toContain('prepare seed asks the person first');
      expect(existsSync(mark)).toBe(false);
      expect(did()).toEqual([]);
      // a test run a tool call asked for is no command line's: its file fails on the same question
      const to = join(dir, 'artifacts', 'asked');
      const run = await callerOf(context())('run_flow', { action: 'test', file, to });
      expect(run.data.verdict).toBe('FAIL');
      expect(run.text).toContain('prepare seed asks the person first');
      expect(existsSync(mark)).toBe(false);
      const allowed = new ServerContext(
        { ...DEFAULT_POLICY, allowBuild: true, writeDirs: [tests] },
        [
          {
            list: () => Promise.resolve([{ serial: device.serial, state: 'device', ready: true }]),
            handles: () => true,
            open: () => device,
          },
        ],
        { app: 'dev.app' },
      );
      await callerOf(allowed)('run_flow', { action: 'run', file });
      expect(existsSync(mark)).toBe(true);
      expect(did()).toEqual(['launch']);
    });

    it('refuses before the first step a name the project does not give, a failed command, and a value not printed', async () => {
      project({ seed: prints('OTHER=1'), broken: [process.execPath, '-e', 'process.exit(3)'] });
      write('a.flow', 'app dev.app', 'launch', 'prepare sed');
      write('b.flow', 'app dev.app', 'param WHO', 'launch', 'prepare seed gives=WHO');
      write('c.flow', 'app dev.app', 'launch', 'prepare broken');
      const r = await test(context());
      // a.flow never launched: its line is refused as the file is read
      expect(did()).toEqual(['launch', 'launch']);
      expect(r.said).toContain('a.flow:3: ');
      expect(r.said).toContain('names no preparation sed: seed, broken');
      expect(r.said).toContain('prepare seed printed no WHO');
      expect(r.said).toContain('prepare broken failed');
      expect(r.said).toContain('exit 3');
    });
  });
});
