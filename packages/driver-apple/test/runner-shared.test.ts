import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { deviceStateFile, noting, processAlive, startOf, thisOwner, must } from '@appdyno/core';
import { fakeAgentStream, HELLO, TOKEN } from '@appdyno/testing/fake-agent.js';
import {
  IosRunnerLauncher,
  RUNNER_MINOR,
  simulatorTransport,
  type RunnerTransport,
} from '../src/runner.js';
import { fakeTimed, onFakeTime } from '@appdyno/testing/fake-time.js';

const UDID = '00000000-0000-4000-8000-000000000001';

/** What a runner of this host's sources says; one before 1.3.8 said no minor. */
const CURRENT = { ...HELLO, protocol: { major: 2, minor: RUNNER_MINOR } };
const BEFORE_MINOR = { ...HELLO, agentVersion: '0.6.0', protocol: { major: 2 }, pid: 4242 };

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
    const pid = must(other.pid, 'its pid');
    const host = { ...thisOwner('host'), pid, started: startOf(pid) };
    writeFileSync(file, JSON.stringify(used ? [host] : []));
  };

  const transport = (hello: object = CURRENT) =>
    ({
      build: () => Promise.resolve({ xctestrun: 'x', sha256: 'a'.repeat(64) }),
      port: vi.fn(() => {
        return Promise.reject(new Error('a new runner was asked for'));
      }),
      open: () => {
        const { host } = fakeAgentStream({ hello: () => ({ result: hello }) });
        return Promise.resolve({
          socket: Object.assign(host, { setNoDelay: () => undefined }) as unknown as Socket,
        });
      },
    }) satisfies RunnerTransport;

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

  it("needs the minor this host's runner says, as RunnerCore's test holds its hello to the same fixture", () => {
    const fixtures = new URL('../../protocol/fixtures/results.json', import.meta.url);
    const results = JSON.parse(readFileSync(fixtures, 'utf8')) as {
      'hello.ios': { result: { protocol: { minor?: number } } };
    };
    expect(results['hello.ios'].result.protocol.minor).toBe(RUNNER_MINOR);
  });

  it('is replaced under another live host when it is older than this host, and that host is told why', async () => {
    left(true);
    const through = transport(BEFORE_MINOR);
    const { value: refused, notes } = await noting(() =>
      new IosRunnerLauncher(UDID, through).connect().then(
        () => undefined,
        (e: unknown) => e as Error,
      ),
    );
    expect(refused?.message).toBe('a new runner was asked for');
    const why = `it was of protocol 2.0, where 2.${RUNNER_MINOR} is needed`;
    expect(notes).toContain(`the agent on ${UDID} is replaced by this host's: ${why}`);
    // the host that used it reads this, where it finds this host's in its place
    const ended = JSON.parse(readFileSync(deviceStateFile('agent-ended', UDID), 'utf8')) as object;
    expect(ended).toMatchObject({ pid: 4242, by: process.pid, why });
  });

  it('gives way when nobody else uses it', async () => {
    left(false);
    const through = transport();
    await expect(new IosRunnerLauncher(UDID, through).connect()).rejects.toThrow(
      'a new runner was asked for',
    );
  });

  it(
    'waits for a start under way and shares what it brings, as two would take the phone from each other',
    fakeTimed(async () => {
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
      await vi.waitFor(() => expect(through.port).toHaveBeenCalledOnce(), { timeout: 10_000 });
      const second = new IosRunnerLauncher(UDID, through).connect();
      await new Promise((r) => setTimeout(r, 400));
      expect(through.port).toHaveBeenCalledOnce();
      finish();
      await expect(first).rejects.toThrow('this start ends here');
      const found = await second;
      found.rpc.close();
      expect(found.started).toBe(false);
      expect(through.port).toHaveBeenCalledOnce();
    }),
  );
});

describe('a start that cannot come', () => {
  const REBUILD = 'build it again, as its transport says';
  const PATH = process.env.PATH;
  let state: string;
  let other: ReturnType<typeof spawn>;

  const through = (
    major: number,
    handlers: Parameters<typeof fakeAgentStream>[0] = {},
    minor = RUNNER_MINOR,
  ): RunnerTransport => ({
    build: () => Promise.resolve({ xctestrun: '/products/x.xctestrun', sha256: 'a'.repeat(64) }),
    rebuild: () => REBUILD,
    port: () => Promise.resolve(1),
    open: () => {
      const hello = () => ({ result: { ...CURRENT, protocol: { major, minor } } });
      const { host } = fakeAgentStream({ hello, ...handlers });
      return Promise.resolve({
        socket: Object.assign(host, { setNoDelay: () => undefined }) as unknown as Socket,
      });
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
    process.env.PATH = `${state}:${String(PATH)}`;
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
      message: expect.stringContaining('runner protocol 1') as unknown,
      hint: REBUILD,
    });
    expect(Date.now() - started).toBeLessThan(4_000);
    expect(stopped).toHaveBeenCalledWith(expect.any(Number), 'SIGTERM');
  });

  it('ends when the runner it started is older than this host, and says how to make it its own again', async () => {
    await expect(
      new IosRunnerLauncher(UDID, through(2, {}, RUNNER_MINOR - 1)).connect(),
    ).rejects.toMatchObject({
      code: 'AGENT_VERSION_MISMATCH',
      message: `the iOS runner this host started is of protocol 2.${RUNNER_MINOR - 1}, where 2.${RUNNER_MINOR} is needed`,
      hint: REBUILD,
    });
  });

  it('builds a runner in place of a fetched one that did not start, once', async () => {
    writeFileSync(join(state, 'xcodebuild'), `#!${process.execPath}\nprocess.exit(65);\n`);
    const builds = ['/fetched/x.xctestrun', '/built/x.xctestrun'];
    const build = vi.fn(() =>
      Promise.resolve({ xctestrun: must(builds.shift(), 'a build'), sha256: 'a'.repeat(64) }),
    );
    const unfit = vi.fn((xctestrun: string) => Promise.resolve(xctestrun.startsWith('/fetched')));
    const open = () => Promise.reject(new Error('connection refused'));
    await expect(
      new IosRunnerLauncher(UDID, { ...through(2), open, build, unfit }).connect(),
    ).rejects.toMatchObject({ message: 'the iOS runner stopped (xcodebuild exit 65)' });
    // the built one stopped too, and is what the person hears of: nothing is built a second time
    expect(unfit.mock.calls).toEqual([['/fetched/x.xctestrun']]);
    expect(build).toHaveBeenCalledTimes(2);
  });

  /** A runner whose port never answers, under an xcodebuild that says `said` and serves nothing. */
  const silent = (said: string) => {
    writeFileSync(
      join(state, 'xcodebuild'),
      `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(said)});\nsetTimeout(() => {}, 30000);\n`,
    );
    return { ...through(2), open: () => Promise.reject(new Error('connection refused')) };
  };

  it(
    'says a start that ran out of time did not start, and how far it got, not that it stopped',
    fakeTimed(async () => {
      const leftOver = vi.fn(() => Promise.resolve());
      await expect(
        new IosRunnerLauncher(UDID, { ...silent(''), leftOver }).connect(),
      ).rejects.toMatchObject({
        code: 'AGENT_UNAVAILABLE',
        message: expect.stringMatching(
          /^the iOS runner did not start within 18\d s: xcodebuild is preparing the device/,
        ) as unknown,
      });
      // the runner app its xcodebuild was launching is ended too, not left running in the simulator
      expect(leftOver).toHaveBeenCalledWith(UDID);
    }),
  );

  it('gives a start that got on to launching the runner 90 s more from then, and says how far it got', async () => {
    const realTimeout = setTimeout;
    const said: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      said.push(String(chunk));
      return true;
    });
    vi.useFakeTimers();
    try {
      const asked = new IosRunnerLauncher(UDID, silent('')).connect();
      asked.catch(() => undefined);
      const log = join(state, `ios-${UDID}.log`);
      await vi.waitFor(() => expect(existsSync(log)).toBe(true), { timeout: 10_000 });
      await vi.advanceTimersByTimeAsync(150_000);
      // the runner's first line, as xcodebuild writes it, late in the start
      appendFileSync(log, 'Runner-Runner[91150:20746824] [Default] Running tests...\n');
      // the start reads its log on its own clock and the disk on the real one: on a loaded Mac the read came after the
      // deadline, so each look is given the real time it takes before the clock goes on
      const seen = () => said.some((l) => l.includes('the runner is launching'));
      for (let look = 0; look < 6 && !seen(); look++) {
        await vi.advanceTimersByTimeAsync(5_000);
        for (let t = 0; t < 40 && !seen(); t++) await new Promise((r) => realTimeout(r, 50));
      }
      // the 90 s more count from the moment the launch was seen, which on a loaded Mac can be early in the launcher's
      // own clock, as its timer may start after the log exists: the total is 90 s or more, not a fixed figure
      const refused = await onFakeTime(asked).then(
        () => undefined,
        (e: unknown) => e as Error,
      );
      const within = refused?.message.match(
        /^the iOS runner did not start within (\d+) s: xcodebuild started testing: the runner is launching/,
      );
      expect(within, refused?.message).not.toBeNull();
      expect(Number(within?.[1])).toBeGreaterThanOrEqual(90);
      // a line a person reads on a terminal, as the device's other lines are
      expect(said[0]).toBe(
        `${UDID}: starting the iOS runner: xcodebuild connects, installs and launches it\n`,
      );
      expect(said.filter((l) => l.startsWith('{'))).toEqual([]);
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
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
    // a loaded Mac can take seconds to start the stand-in xcodebuild's node: wait as long as the test may
    await vi.waitFor(() => expect(readFileSync(heard, 'utf8')).toBe(told), { timeout: 25_000 });
    await runner.stop(rpc);
  });

  it("keeps the last runner's log beside the new one's, which a start wrote over", async () => {
    const udid = randomUUID().toUpperCase();
    const log = join(state, `ios-${udid}.log`);
    writeFileSync(log, 'the last runner\'s: Find the "Toolbar" Any\n');
    const runner = new IosRunnerLauncher(udid, through(2));
    const { rpc } = await runner.connect();
    expect(readFileSync(`${log}.1`, 'utf8')).toBe('the last runner\'s: Find the "Toolbar" Any\n');
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

  it("ends the DTServiceHub a simulator's killed xcodebuild left to launchd, and no other process", async () => {
    // a DTServiceHub by its name: sleep under that name, which the runner's xcodebuild starts and a kill leaves, and
    // which takes no SIGTERM, as the real one takes none. A link, as macOS 27.2 kills a system binary's copy at its start
    const hub = join(state, 'DTServiceHub');
    symlinkSync('/bin/sleep', hub);
    const pidFile = join(state, 'hub.pid');
    writeFileSync(
      join(state, 'xcodebuild'),
      `#!${process.execPath}
const { spawn } = require('node:child_process');
const child = spawn('/bin/sh', ['-c', 'trap "" TERM; exec "$0" 60', ${JSON.stringify(hub)}], { stdio: 'ignore' });
require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));
setTimeout(() => {}, 30000);
`,
    );
    // one of this process's own under the same name, which nobody left behind
    const own = spawn(hub, ['60'], { stdio: 'ignore' });
    onTestFinished(() => void own.kill('SIGKILL'));
    const udid = randomUUID().toUpperCase();
    const runner = new IosRunnerLauncher(udid, { ...through(2), stop: simulatorTransport.stop });
    const { rpc } = await runner.connect();
    await vi.waitFor(() => expect(existsSync(pidFile)).toBe(true), { timeout: 10_000 });
    const left = Number(readFileSync(pidFile, 'utf8'));
    onTestFinished(() => {
      if (processAlive(left)) process.kill(left, 'SIGKILL');
    });
    expect(processAlive(left)).toBe(true);
    await runner.stop(rpc);
    await vi.waitFor(() => expect(processAlive(left)).toBe(false), { timeout: 10_000 });
    expect(processAlive(must(own.pid, 'its pid'))).toBe(true);
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
      port: () => Promise.resolve(++port),
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

  /** A runner served by a fake xcodebuild, on a device `down` says is shutting down or off, its connection then lost. */
  const lost = async (down: boolean) => {
    const udid = randomUUID().toUpperCase();
    const runner = new IosRunnerLauncher(udid, {
      ...through(2),
      stop: 'kill',
      down: () => Promise.resolve(down),
    });
    const { rpc } = await runner.connect();
    const { pid } = JSON.parse(readFileSync(join(state, `ios-${udid}.json`), 'utf8')) as {
      pid: number;
    };
    rpc.close();
    return { runner, pid };
  };

  it('ends the xcodebuild of a simulator shut down under its runner, as it would boot it again', async () => {
    const { pid } = await lost(true);
    // a process's end is the system's to come to, slower at load 30: 1 s was too little 2 times in 3
    await vi.waitFor(() => expect(processAlive(pid)).toBe(false), { timeout: 10_000 });
  });

  it('leaves it serving where its device is up, as when a host lets its connection go', async () => {
    const { runner, pid } = await lost(false);
    await new Promise((r) => setTimeout(r, 300));
    expect(processAlive(pid)).toBe(true);
    await runner.stop();
  });

  it(
    'is waited for no longer than one, with who holds it said',
    fakeTimed(async () => {
      const holder = {
        ...thisOwner('a runner start'),
        pid: must(other.pid, 'its pid'),
        started: startOf(must(other.pid, 'its pid')),
      };
      writeFileSync(join(state, `ios-${UDID}.starting`), JSON.stringify(holder));
      const asked = new IosRunnerLauncher(UDID, through(2)).connect();
      await new Promise((r) => setTimeout(r, 400));
      const now = Date.now();
      vi.spyOn(Date, 'now').mockImplementation(() => now + 271_000);
      await expect(asked).rejects.toMatchObject({
        code: 'AGENT_UNAVAILABLE',
        message: expect.stringContaining(`pid ${must(other.pid, 'its pid')}`) as unknown,
      });
    }),
  );
});
