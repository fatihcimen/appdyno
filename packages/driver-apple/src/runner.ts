import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, existsSync, openSync, readdirSync, statSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { connect, createServer, type Socket } from 'node:net';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { DeviceError, type Hello } from '@appdyno/protocol';
import { z } from 'zod';
import {
  exclusively,
  sleep,
  greet,
  inCheckout,
  inPackage,
  readStateFile,
  reportProgress,
  run,
  sharedAgent,
  stateDir,
  writeStateFile,
  type Owner,
  type RpcClient,
} from '@appdyno/core';
import { brandSimulatorRunner } from './brand.js';
import { assertUdid, xcodeEnv } from './simctl.js';
import { recordXctMetrics } from './trace.js';

/** A first start installs the runner (on a phone, UI automation may wait for an approval): allow for it. */
const START_MS = 180_000;
const POLL_MS = 250;
const PROGRESS_MS = 5_000;

/** Where a runner's start has got to, by the last milestone of xcodebuild's log. */
export function startPhase(log: string): string {
  if (/Test Suite .* started|Test Case .* started/.test(log))
    return 'the runner is running: waiting for its port to answer';
  if (/Testing started|Test session results|Writing result bundle/.test(log))
    return 'xcodebuild started testing: the runner is launching';
  return 'xcodebuild is preparing the device (installing the runner)';
}
export const RUNNER_TEST = 'Runner/RunnerTests/testServe';

const buildIds = new Map<string, { mtime: number; sha256: string }>();

/** The runner's products for a simulator or a phone: a development build, else built once from the packaged sources. */
export async function iosProducts(
  kind: 'simulator' | 'device',
  build = true,
): Promise<string | undefined> {
  const derived = kind === 'simulator' ? '.derived' : '.derived-device';
  const env =
    kind === 'simulator'
      ? process.env.APPDYNO_IOS_PRODUCTS
      : process.env.APPDYNO_IOS_DEVICE_PRODUCTS;
  const sdk = kind === 'simulator' ? 'iphonesimulator' : 'iphoneos';
  const has = (dir: string) =>
    existsSync(dir) && readdirSync(dir).some((f) => f.includes(sdk) && f.endsWith('.xctestrun'));
  const repo = inCheckout('ios');
  const found = [env, repo && join(repo, derived, 'Build/Products')].find(
    (d): d is string => !!d && has(d),
  );
  if (found) return found;
  const src = inPackage('ios');
  if (!src || !existsSync(join(src, 'Appdyno.xcodeproj'))) return undefined;
  const id = (await readFile(join(src, 'sources.sha256'), 'utf8').catch(() => 'unknown'))
    .trim()
    .slice(0, 16);
  const out = join(stateDir(), 'ios-build', id, kind);
  const products = join(out, 'Build/Products');
  if (has(products) || !build) return has(products) ? products : undefined;
  // one build per folder: a client that timed out and asks again joins it (xcodebuild would refuse a second)
  let building = builds.get(out);
  if (!building) {
    building = xcodebuildTelling(
      [
        'build-for-testing',
        '-project',
        join(src, 'Appdyno.xcodeproj'),
        '-scheme',
        'Runner',
        '-destination',
        kind === 'simulator' ? 'generic/platform=iOS Simulator' : 'generic/platform=iOS',
        '-derivedDataPath',
        out,
        ...(kind === 'device'
          ? ['CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO', 'CODE_SIGN_IDENTITY=']
          : []),
      ],
      `building the iOS runner for the ${kind} once (a few minutes)`,
    ).finally(() => builds.delete(out));
    builds.set(out, building);
  }
  await building;
  return products;
}

const builds = new Map<string, Promise<void>>();

/** The phase a line of xcodebuild's output starts, if any. */
export function buildPhase(line: string): string | undefined {
  const target = /^=== BUILD TARGET (\S+)/.exec(line);
  if (target) return `target ${target[1]}`;
  // SwiftExplicitDependency…: the system's modules, the long part of a first build
  if (
    /^(SwiftExplicitDependency\w*|SwiftCompile|CompileSwift|SwiftEmitModule|CompileC)\b/.test(line)
  )
    return 'compiling';
  if (/^Ld\b/.test(line)) return 'linking';
  if (/^CodeSign\b/.test(line)) return 'signing';
  return undefined;
}

/** Runs xcodebuild, telling each phase once and where it stands every 10 s: someone waits on it for minutes. */
export function xcodebuildTelling(args: string[], what: string): Promise<void> {
  const started = Date.now();
  const phases = new Set<string>();
  let phase = 'starting';
  const tell = () => {
    const line = `${what}: ${phase}, ${Math.round((Date.now() - started) / 1000)} s`;
    process.stderr.write(`${line}\n`);
    reportProgress(line);
  };
  const last: string[] = [];
  const onLine = (line: string) => {
    if (line.trim()) last.push(line.trim());
    last.splice(0, last.length - 3);
    const p = buildPhase(line);
    if (p && !phases.has(p)) {
      phases.add(p);
      phase = p;
      tell();
    }
  };
  const child = spawn('xcodebuild', args, {
    env: xcodeEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 1_800_000,
  });
  createInterface({ input: child.stdout }).on('line', onLine);
  createInterface({ input: child.stderr }).on('line', onLine);
  tell();
  const beat = setInterval(tell, 10_000);
  return new Promise<void>((resolve, reject) => {
    const failed = (why: string) =>
      reject(
        new DeviceError(
          'UNSUPPORTED',
          `the iOS runner did not build: ${why.slice(0, 300)}`,
          'see appdyno doctor',
        ),
      );
    child.once('error', (e) => failed(e.message));
    child.once('close', (code, signal) => {
      if (code === 0) resolve();
      else failed(signal ? `xcodebuild stopped by ${signal}` : last.join(' '));
    });
  }).finally(() => clearInterval(beat));
}

/** Removes the runner builds of other packaged sources than the installed ones; how many were removed. */
export async function pruneIosBuilds(): Promise<number> {
  const sources = inPackage('ios', 'sources.sha256');
  const id = sources ? (await readFile(sources, 'utf8')).trim().slice(0, 16) : '';
  const root = join(stateDir(), 'ios-build');
  if (!id || !existsSync(root)) return 0;
  let n = 0;
  for (const d of readdirSync(root))
    if (d !== id && /^[0-9a-f]{16}$/.test(d)) {
      await rm(join(root, d), { recursive: true, force: true });
      n++;
    }
  return n;
}

/** The built runner (xctestrun file and products) and an id of its build. */
export async function runnerBuild(): Promise<{ xctestrun: string; sha256: string }> {
  const dir = await iosProducts('simulator');
  const file = dir && readdirSync(dir).find((f) => /iphonesimulator.*\.xctestrun$/.test(f));
  if (!dir || !file)
    throw new DeviceError(
      'UNSUPPORTED',
      'the iOS runner is not built',
      "build it: (cd ios && xcodebuild build-for-testing -project Appdyno.xcodeproj -scheme Runner -destination 'generic/platform=iOS Simulator' -derivedDataPath .derived)",
    );
  // the home screen shows the runner as appdyno (once per build; the test binary is not touched)
  await brandSimulatorRunner(join(dir, 'Debug-iphonesimulator/Runner-Runner.app'));
  const binary = join(dir, 'Debug-iphonesimulator/Runner-Runner.app/PlugIns/Runner.xctest/Runner');
  const hashed = existsSync(binary) ? binary : join(dir, file);
  const mtime = statSync(hashed).mtimeMs;
  // the build id is read once per build (hashing the binary on every connect costs time)
  if (buildIds.get(hashed)?.mtime !== mtime)
    buildIds.set(hashed, {
      mtime,
      sha256: createHash('sha256')
        .update(await readFile(hashed))
        .digest('hex'),
    });
  return { xctestrun: join(dir, file), sha256: buildIds.get(hashed)!.sha256 };
}

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
    const start = async () => {
      const theirs = await running();
      if (theirs) return theirs;
      await beforeStart?.();
      const state = await this.readState();
      if (state?.pid) await this.kill(state.pid);
      return { ...(await this.start(build, target)), started: true };
    };
    let told = false;
    for (;;) {
      const there = await running();
      if (there) return there;
      try {
        const starter = (holder: Owner) => new StartingElsewhere(holder);
        return await exclusively(this.startPath, 'a runner start', starter, start);
      } catch (e) {
        if (!(e instanceof StartingElsewhere)) throw e;
        if (!told) reportProgress(`waiting for pid ${e.holder.pid} to start the iOS runner`);
        told = true;
        await sleep(POLL_MS);
      }
    }
  }

  async stop(rpc?: RpcClient) {
    if (rpc && !rpc.closed)
      await rpc.call('shutdown', {}, { timeoutMs: 5_000 }).catch(() => undefined);
    const state = await this.readState();
    if (state?.pid) await this.kill(state.pid);
    await rm(this.statePath, { force: true });
  }

  /** The runner's product running one `measure()` test of `PerfMetricsTests` instead of serving. */
  async xctMetrics(bundle: string, test: 'launch' | 'hitches') {
    const { xctestrun } = await this.transport.build();
    return recordXctMetrics(this.udid, xctestrun, bundle, test);
  }

  private async start(build: { xctestrun: string; sha256: string }, target?: string) {
    reportProgress('starting the iOS runner');
    const port = await this.transport.port();
    const token = randomBytes(24).toString('hex');
    await mkdir(stateDir(), { recursive: true, mode: 0o700 });
    const out = openSync(this.logPath, 'w', 0o600);
    const child = spawn(
      'xcodebuild',
      [
        'test-without-building',
        '-xctestrun',
        build.xctestrun,
        '-destination',
        `id=${this.udid}`,
        `-only-testing:${RUNNER_TEST}`,
      ],
      {
        detached: true,
        stdio: ['ignore', out, out],
        env: {
          ...xcodeEnv(),
          TEST_RUNNER_APPDYNO_PORT: String(port),
          TEST_RUNNER_APPDYNO_TOKEN: token,
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
    const deadline = Date.now() + START_MS;
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
      if (exited !== undefined || Date.now() >= deadline) {
        const log = await readFile(this.logPath, 'utf8').catch(() => '');
        if (child.pid) await this.kill(child.pid);
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

  private async kill(pid: number) {
    // only our own xcodebuild: its command line names the runner test
    const cmd = await run('ps', ['-o', 'command=', '-p', String(pid)]).then(
      (r) => r.stdout,
      () => '',
    );
    if (cmd.includes(RUNNER_TEST) && cmd.includes(this.udid)) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        /* gone already */
      }
    }
  }

  private readState() {
    return readStateFile(this.statePath, State);
  }

  private writeState(s: State) {
    return writeStateFile(this.statePath, s);
  }
}
