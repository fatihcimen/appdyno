import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deviceStateFile, startOf, thisOwner } from '@appdyno/core';
import { fakeAgentStream, HELLO, TOKEN } from '../../core/test/fake-agent.js';
import { IosRunnerLauncher, simulatorTransport, type RunnerTransport } from '../src/runner.js';

const UDID = '00000000-0000-4000-8000-000000000001';

describe('a runner of another build on a simulator', () => {
  let state: string;
  let other: ReturnType<typeof spawn>;

  /** Writes what a host before this one left: its runner, and that it uses it. */
  const left = (used: boolean) => {
    writeFileSync(
      join(state, `ios-${UDID}.json`),
      JSON.stringify({ port: 1, token: TOKEN, sha256: 'b'.repeat(64) }),
    );
    const file = deviceStateFile('agent-hosts', UDID);
    mkdirSync(join(file, '..'), { recursive: true });
    const host = { ...thisOwner('host'), pid: other.pid!, started: startOf(other.pid!) };
    writeFileSync(file, JSON.stringify(used ? [host] : []));
  };

  const transport = (): RunnerTransport => ({
    build: async () => ({ xctestrun: 'x', sha256: 'a'.repeat(64) }),
    port: vi.fn(async () => {
      throw new Error('a new runner was asked for');
    }),
    open: async () => {
      const { host } = fakeAgentStream();
      return { socket: Object.assign(host, { setNoDelay: () => undefined }) as unknown as Socket };
    },
  });

  beforeEach(() => {
    state = mkdtempSync(join(tmpdir(), 'appdyno-runner-'));
    process.env.APPDYNO_STATE_DIR = state;
    other = spawn('sleep', ['30'], { stdio: 'ignore' });
  });
  afterEach(() => {
    other.kill('SIGKILL');
    rmSync(state, { recursive: true, force: true });
  });

  it('is used as it is while another live host uses it', async () => {
    left(true);
    const through = transport();
    const found = await new IosRunnerLauncher(UDID, through).connect();
    found.rpc.close();
    expect(found.started).toBe(false);
    expect(through.port).not.toHaveBeenCalled();
  });

  it('gives way when nobody else uses it', async () => {
    left(false);
    const through = transport();
    await expect(new IosRunnerLauncher(UDID, through).connect()).rejects.toThrow(
      'a new runner was asked for',
    );
  });

  it('waits for a start under way and shares what it brings, as two would take the phone from each other', async () => {
    let finish!: () => void;
    const held = new Promise<void>((r) => (finish = r));
    const through = transport();
    vi.mocked(through.port).mockImplementationOnce(async () => {
      await held;
      // what a start leaves as its runner answers; a real one goes on to spawn xcodebuild, which no test may
      writeFileSync(
        join(state, `ios-${UDID}.json`),
        JSON.stringify({ port: 1, token: TOKEN, sha256: 'a'.repeat(64) }),
      );
      throw new Error('this start ends here');
    });
    const first = new IosRunnerLauncher(UDID, through).connect();
    await vi.waitFor(() => expect(through.port).toHaveBeenCalledOnce());
    const second = new IosRunnerLauncher(UDID, through).connect();
    await new Promise((r) => setTimeout(r, 400));
    expect(through.port).toHaveBeenCalledOnce();
    finish();
    await expect(first).rejects.toThrow('this start ends here');
    const found = await second;
    found.rpc.close();
    expect(found.started).toBe(false);
    expect(through.port).toHaveBeenCalledOnce();
  });
});

describe('a start that cannot come', () => {
  const PATH = process.env.PATH;
  let state: string;
  let other: ReturnType<typeof spawn>;

  const through = (
    major: number,
    handlers: Parameters<typeof fakeAgentStream>[0] = {},
  ): RunnerTransport => ({
    build: async () => ({ xctestrun: '/products/x.xctestrun', sha256: 'a'.repeat(64) }),
    port: async () => 1,
    open: async () => {
      const hello = () => ({ result: { ...HELLO, protocol: { major } } });
      const { host } = fakeAgentStream({ hello, ...handlers });
      return { socket: Object.assign(host, { setNoDelay: () => undefined }) as unknown as Socket };
    },
  });

  beforeEach(() => {
    state = mkdtempSync(join(tmpdir(), 'appdyno-runner-'));
    process.env.APPDYNO_STATE_DIR = state;
    other = spawn('sleep', ['30'], { stdio: 'ignore' });
    // what a start spawns, with the command line that names the runner: no test may run the real one
    writeFileSync(
      join(state, 'xcodebuild'),
      `#!${process.execPath}\nsetTimeout(() => {}, 30000);\n`,
    );
    chmodSync(join(state, 'xcodebuild'), 0o755);
    process.env.PATH = `${state}:${PATH}`;
  });
  afterEach(() => {
    process.env.PATH = PATH;
    vi.restoreAllMocks();
    other.kill('SIGKILL');
    rmSync(state, { recursive: true, force: true });
  });

  it('ends when the runner it started speaks another protocol, which it will say until the time is up', async () => {
    const stopped = vi.spyOn(process, 'kill');
    const started = Date.now();
    await expect(new IosRunnerLauncher(UDID, through(1)).connect()).rejects.toMatchObject({
      code: 'AGENT_VERSION_MISMATCH',
      message: expect.stringContaining('runner protocol 1'),
      hint: expect.stringContaining('/products/x.xctestrun'),
    });
    expect(Date.now() - started).toBeLessThan(4_000);
    expect(stopped).toHaveBeenCalledWith(expect.any(Number), 'SIGTERM');
  });

  it.each([
    ['takes a tunnel on a phone paired for Wi-Fi', true, '1'],
    ['stays on the loopback on any other', false, 'undefined'],
  ])('%s', async (_, tunnels, told) => {
    const heard = join(state, 'heard');
    writeFileSync(
      join(state, 'xcodebuild'),
      `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(heard)}, String(process.env.TEST_RUNNER_APPDYNO_TUNNELS));\nsetTimeout(() => {}, 30000);\n`,
    );
    const runner = new IosRunnerLauncher(UDID, { ...through(2), tunnels: () => tunnels });
    const { rpc } = await runner.connect();
    await vi.waitFor(() => expect(readFileSync(heard, 'utf8')).toBe(told), { timeout: 5_000 });
    await runner.stop(rpc);
  });

  it("stops the xcodebuild another host's start left, found by the command line a start gives it", async () => {
    // a device of its own: what stops a runner goes by the device, and another run of these tests has this one's
    const udid = randomUUID().toUpperCase();
    (await new IosRunnerLauncher(udid, through(2)).connect()).rpc.close();
    const { pid } = JSON.parse(readFileSync(join(state, `ios-${udid}.json`), 'utf8')) as {
      pid: number;
    };
    // another host, with a state folder of its own, where no state names that xcodebuild
    const own = mkdtempSync(join(tmpdir(), 'appdyno-runner-'));
    process.env.APPDYNO_STATE_DIR = own;
    const second = new IosRunnerLauncher(udid, through(2));
    const { rpc } = await second.connect();
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow());
    await second.stop(rpc);
    rmSync(own, { recursive: true, force: true });
  });

  it('makes its folder for what xcodebuild keeps once the xcodebuild that kept it there has ended', async () => {
    const udid = randomUUID().toUpperCase();
    // what is still written as it ends, as by one that lived on through an erase beside the new start
    writeFileSync(
      join(state, 'xcodebuild'),
      `#!${process.execPath}
const fs = require('node:fs');
const bundle = process.argv[process.argv.indexOf('-resultBundlePath') + 1];
process.on('SIGTERM', () => setTimeout(() => {
  fs.mkdirSync(bundle, { recursive: true });
  fs.writeFileSync(bundle + '/late', '');
  process.exit(0);
}, 300));
setTimeout(() => {}, 30000);
`,
    );
    let port = 0;
    let erased = -1;
    const runner = new IosRunnerLauncher(udid, {
      ...through(2),
      port: async () => ++port,
      open: async (at) => {
        if (at === erased) throw new Error('its runner went with the erase');
        return through(2).open(at);
      },
    });
    (await runner.connect()).rpc.close();
    erased = port;
    const { rpc } = await runner.connect();
    await new Promise((r) => setTimeout(r, 600));
    expect(existsSync(join(state, `ios-${udid}.kept`, 'session.xcresult', 'late'))).toBe(false);
    await runner.stop(rpc);
  });

  it.each([
    [
      "a simulator's is killed, and its runner not asked to end",
      simulatorTransport.stop,
      ['SIGKILL'],
    ],
    ["an iPhone's runner is asked, then its xcodebuild told", undefined, ['SIGTERM']],
  ] as const)('%s: a simulator it booted again stays up', async (_, stop, signals) => {
    const udid = randomUUID().toUpperCase();
    let asked = false;
    const shutdown = () => ((asked = true), { result: {} });
    const runner = new IosRunnerLauncher(udid, { ...through(2, { shutdown }), stop });
    const { rpc } = await runner.connect();
    const { pid } = JSON.parse(readFileSync(join(state, `ios-${udid}.json`), 'utf8')) as {
      pid: number;
    };
    const sent = vi.spyOn(process, 'kill');
    await runner.stop(rpc);
    const to = sent.mock.calls.filter(([p, s]) => p === pid && s !== 0).map(([, s]) => s);
    expect([to, asked]).toEqual([signals, stop !== 'kill']);
  });

  it('is waited for no longer than one, with who holds it said', async () => {
    const holder = {
      ...thisOwner('a runner start'),
      pid: other.pid!,
      started: startOf(other.pid!),
    };
    writeFileSync(join(state, `ios-${UDID}.starting`), JSON.stringify(holder));
    const asked = new IosRunnerLauncher(UDID, through(2)).connect();
    await new Promise((r) => setTimeout(r, 400));
    const now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now + 181_000);
    await expect(asked).rejects.toMatchObject({
      code: 'AGENT_UNAVAILABLE',
      message: expect.stringContaining(`pid ${other.pid}`),
    });
  });
});
