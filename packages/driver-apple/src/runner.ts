import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, openSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { connect, createServer, type Socket } from 'node:net';
import { join } from 'node:path';
import { DeviceError, type Hello } from '@appdyno/protocol';
import { z } from 'zod';
import {
  exclusively,
  sleep,
  greet,
  processAlive,
  readStateFile,
  reportProgress,
  run,
  agentLeft,
  sharedAgent,
  stateDir,
  writeStateFile,
  type Owner,
  type RpcClient,
} from '@appdyno/core';
import { runnerBuild } from './runner-build.js';
import { assertUdid, xcodeEnv } from './simctl.js';
import { recordXctMetrics } from './trace.js';

/** A first start installs the runner (on a phone, UI automation may wait for an approval): allow for it. */
const START_MS = 180_000;
const POLL_MS = 250;
const PROGRESS_MS = 5_000;

/**
 * SIGTERM ended xcodebuild in 5 to 31 ms, 11 of 11, as it served, as its simulator shut down and as it booted it again, at
 * load 20 to 110; one that shut down the simulator it had booted took over a second.
 */
const ENDS_MS = 5_000;
const ENDS_POLL_MS = 20;

/** Where a runner's start has got to, by the last milestone of xcodebuild's log. */
export function startPhase(log: string): string {
  if (/Test Suite .* started|Test Case .* started/.test(log))
    return 'the runner is running: waiting for its port to answer';
  if (/Testing started|Test session results|Writing result bundle/.test(log))
    return 'xcodebuild started testing: the runner is launching';
  return 'xcodebuild is preparing the device (installing the runner)';
}
export const RUNNER_TEST = 'Runner/RunnerTests/testServe';

const State = z.object({
  port: z.number().int(),
  token: z.string(),
  sha256: z.string(),
  pid: z.number().optional(),
});
type State = z.infer<typeof State>;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

/**
 * Starts, finds again and stops the runner of one simulator. The runner (a UI test kept running by
 * xcodebuild) outlives the host process; its port and launch token are kept in a state file readable
 * only by this user. A different runner build is replaced once no live host uses it.
 */
/** How the runner of one kind of device is built, given a port and reached. */
export type RunnerTransport = {
  build(): Promise<{ xctestrun: string; sha256: string }>;
  port(): Promise<number>;
  open(port: number): Promise<{ socket: Socket; rest?: Buffer }>;
  /** Whether a runner must take a tunnel too: else it is on the device's loopback and nowhere else. */
  tunnels?(): boolean;
};

/** A simulator: the runner as built, a free port of the Mac's loopback (the simulator shares it). */
export const simulatorTransport: RunnerTransport = {
  build: runnerBuild,
  port: freePort,
  open: (port) =>
    new Promise((resolve, reject) => {
      const c = connect({ host: '127.0.0.1', port });
      c.once('connect', () => resolve({ socket: c }));
      c.once('error', reject);
    }),
};

/** Another host is starting the runner of this device. */
class StartingElsewhere extends Error {
  constructor(readonly holder: Owner) {
    super(`pid ${holder.pid} is starting this runner`);
  }
}

export class IosRunnerLauncher {
  constructor(
    readonly udid: string,
    private readonly transport: RunnerTransport = simulatorTransport,
  ) {
    if (transport === simulatorTransport) assertUdid(udid);
  }

  private get statePath() {
    return join(stateDir(), `ios-${this.udid}.json`);
  }
  private get logPath() {
    return join(stateDir(), `ios-${this.udid}.log`);
  }
  private get startPath() {
    return join(stateDir(), `ios-${this.udid}.starting`);
  }
  /** What xcodebuild keeps of a session, replaced at each start: left to itself it keeps every one, in DerivedData. */
  private get keptPath() {
    return join(stateDir(), `ios-${this.udid}.kept`);
  }

  /**
   * `beforeStart` runs only when a new runner must be started (e.g. to check the simulator is up). One host starts it and
   * the others wait for that: a device serves one runner, and the state says where only once it answers, so two starting
   * at once take it from each other, and the one that lost hears nothing until its time is up.
   */
  async connect(
    target?: string,
    beforeStart?: () => Promise<void>,
  ): Promise<{ rpc: RpcClient; hello: Hello; started: boolean }> {
    const build = await this.transport.build();
    const running = async () => {
      const state = await this.readState();
      return sharedAgent(this.udid, state, build.sha256, (s) => this.tryConnect(s));
    };
    // one start's time in all: a host that waited for another's has that much less for its own
    let waitEnds: number | undefined;
    const start = async () => {
      const theirs = await running();
      if (theirs) return theirs;
      await beforeStart?.();
      await this.killServing();
      const deadline = waitEnds ?? Date.now() + START_MS;
      return { ...(await this.start(build, deadline, target)), started: true };
    };
    for (;;) {
      const there = await running();
      if (there) return there;
      try {
        const starter = (holder: Owner) => new StartingElsewhere(holder);
        return await exclusively(this.startPath, 'a runner start', starter, start);
      } catch (e) {
        if (!(e instanceof StartingElsewhere)) throw e;
        if (waitEnds === undefined) {
          reportProgress(`waiting for pid ${e.holder.pid} to start the iOS runner`);
          waitEnds = Date.now() + START_MS;
        }
        if (Date.now() >= waitEnds)
          throw new DeviceError(
            'AGENT_UNAVAILABLE',
            `pid ${e.holder.pid} did not start the iOS runner within ${START_MS} ms`,
            'close that process, or try again',
          );
        await sleep(POLL_MS);
      }
    }
  }

  async stop(rpc?: RpcClient) {
    agentLeft(this.udid);
    if (rpc && !rpc.closed)
      await rpc.call('shutdown', {}, { timeoutMs: 5_000 }).catch(() => undefined);
    const state = await this.readState();
    if (state?.pid) await this.kill(state.pid);
    await rm(this.statePath, { force: true });
    await rm(this.keptPath, { recursive: true, force: true });
  }

  /** The runner's product running one `measure()` test of `PerfMetricsTests` instead of serving. */
  async xctMetrics(bundle: string, test: 'launch' | 'hitches') {
    const { xctestrun } = await this.transport.build();
    return recordXctMetrics(this.udid, xctestrun, bundle, test);
  }

  private async start(
    build: { xctestrun: string; sha256: string },
    deadline: number,
    target?: string,
  ) {
    reportProgress('starting the iOS runner');
    const port = await this.transport.port();
    const token = randomBytes(24).toString('hex');
    await mkdir(stateDir(), { recursive: true, mode: 0o700 });
    const out = openSync(this.logPath, 'w', 0o600);
    await rm(this.keptPath, { recursive: true, force: true });
    const child = spawn(
      'xcodebuild',
      [
        'test-without-building',
        '-xctestrun',
        build.xctestrun,
        '-destination',
        `id=${this.udid}`,
        '-derivedDataPath',
        this.keptPath,
        '-resultBundlePath',
        join(this.keptPath, 'session.xcresult'),
        `-only-testing:${RUNNER_TEST}`,
      ],
      {
        detached: true,
        stdio: ['ignore', out, out],
        env: {
          ...xcodeEnv(),
          TEST_RUNNER_APPDYNO_PORT: String(port),
          TEST_RUNNER_APPDYNO_TOKEN: token,
          ...(this.transport.tunnels?.() && { TEST_RUNNER_APPDYNO_TUNNELS: '1' }),
          ...(target && { TEST_RUNNER_APPDYNO_TARGET: target }),
          // APPDYNO_FAST_TAP=0: taps through XCUI instead of XCTest's event synthesizer (the runner's EventShim)
          ...(process.env.APPDYNO_FAST_TAP && {
            TEST_RUNNER_APPDYNO_FAST_TAP: process.env.APPDYNO_FAST_TAP,
          }),
          // APPDYNO_ANIMATION_WAIT=0: a touch goes out without waiting for the app's animations to end
          ...(process.env.APPDYNO_ANIMATION_WAIT && {
            TEST_RUNNER_APPDYNO_ANIMATION_WAIT: process.env.APPDYNO_ANIMATION_WAIT,
          }),
        },
      },
    );
    closeSync(out);
    child.unref();
    let exited: number | null | undefined;
    child.once('exit', (code) => (exited = code));
    const s: State = { port, token, sha256: build.sha256, ...(child.pid && { pid: child.pid }) };
    const startedAt = Date.now();
    const say = (line: string) =>
      process.stderr.write(
        `${JSON.stringify({ runner: this.udid, startingMs: Date.now() - startedAt, line })}\n`,
      );
    say('starting the iOS runner: xcodebuild connects, installs and launches it');
    let told = startedAt;
    let reached = '';
    for (;;) {
      if (Date.now() - told >= PROGRESS_MS) {
        told = Date.now();
        const now = startPhase(await readFile(this.logPath, 'utf8').catch(() => ''));
        if (now !== reached) reached = now;
        say(reached);
      }
      const c = await this.tryConnect(s).catch((e: unknown) =>
        e instanceof Error ? e : new Error(String(e)),
      );
      if (!(c instanceof Error)) {
        await this.writeState(s);
        return c;
      }
      // it answered: an older build says the same until the time is up
      const refused = c instanceof DeviceError && c.code === 'AGENT_VERSION_MISMATCH';
      if (refused || exited !== undefined || Date.now() >= deadline) {
        const log = await readFile(this.logPath, 'utf8').catch(() => '');
        if (child.pid) await this.kill(child.pid);
        if (refused)
          throw new DeviceError(
            c.code,
            c.message,
            `build the runner again: ${build.xctestrun} is of another version of this host`,
          );
        throw new DeviceError(
          'AGENT_UNAVAILABLE',
          exited !== undefined
            ? `the iOS runner stopped (xcodebuild exit ${exited})`
            : `the iOS runner did not start within ${START_MS} ms`,
          log.trim().split('\n').slice(-6).join(' ').slice(0, 500) || undefined,
        );
      }
      await sleep(POLL_MS);
    }
  }

  private async tryConnect(s: State): Promise<{ rpc: RpcClient; hello: Hello }> {
    const { socket, rest } = await this.transport.open(s.port);
    socket.setNoDelay(true);
    return greet(socket, rest, 'runner', s.token, 5_000);
  }

  /**
   * Whatever state names it, or none does: a host killed during a start, or one with a state folder of its own, leaves
   * xcodebuild with no state here, and an xcodebuild whose runner is replaced starts it again, which kills the new one
   * before it connects. Found by the test alone, as the arguments between the device and the test change; `kill` keeps
   * to this device's.
   */
  private async killServing() {
    const serving = await run('pgrep', ['-f', `only-testing:${RUNNER_TEST}`]).then(
      (r) => r.stdout,
      () => '',
    );
    for (const pid of serving.split('\n').filter(Boolean)) await this.kill(Number(pid));
  }

  /**
   * Ended before what comes next: it writes its result bundle up to its end, once in the 31 ms after the SIGTERM, where a
   * start then removes and makes one, and a write within that removal fails it with ENOTEMPTY.
   */
  private async kill(pid: number) {
    // only our own xcodebuild: its command line names the runner test
    const cmd = await run('ps', ['-o', 'command=', '-p', String(pid)]).then(
      (r) => r.stdout,
      () => '',
    );
    if (!cmd.includes(RUNNER_TEST) || !cmd.includes(this.udid)) return;
    const send = (signal: NodeJS.Signals) => {
      try {
        process.kill(pid, signal);
      } catch {
        /* gone already */
      }
    };
    send('SIGTERM');
    const end = Date.now() + ENDS_MS;
    while (processAlive(pid) && Date.now() < end) await sleep(ENDS_POLL_MS);
    if (processAlive(pid)) send('SIGKILL');
  }

  private readState() {
    return readStateFile(this.statePath, State);
  }

  private writeState(s: State) {
    return writeStateFile(this.statePath, s);
  }
}
