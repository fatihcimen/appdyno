import { spawn, execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, existsSync, openSync, readdirSync, statSync } from 'node:fs';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { connect, createServer, type Socket } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { DeviceError, PROTOCOL, type Hello } from '@appdyno/protocol';
import { z } from 'zod';
import { stateDir } from '../android/agent.js';
import { RpcClient } from '../rpc.js';
import { brandSimulatorRunner } from './brand.js';
import { assertUdid, xcodeEnv } from './simctl.js';

const run = promisify(execFile);
/** A first start installs the runner (on a phone, UI automation may wait for an approval): allow for it. */
const START_MS = 180_000;
const POLL_MS = 250;
export const RUNNER_TEST = 'Runner/RunnerTests/testServe';

const buildIds = new Map<string, { mtime: number; sha256: string }>();

/** The runner's products for a simulator or a phone: a development build, else built once from the packaged sources. */
export async function iosProducts(
  kind: 'simulator' | 'device',
  build = true,
): Promise<string | undefined> {
  const here = dirname(fileURLToPath(import.meta.url));
  const derived = kind === 'simulator' ? '.derived' : '.derived-device';
  const env =
    kind === 'simulator'
      ? process.env.APPDYNO_IOS_PRODUCTS
      : process.env.APPDYNO_IOS_DEVICE_PRODUCTS;
  const sdk = kind === 'simulator' ? 'iphonesimulator' : 'iphoneos';
  const has = (dir: string) =>
    existsSync(dir) && readdirSync(dir).some((f) => f.includes(sdk) && f.endsWith('.xctestrun'));
  const found = [env, join(here, `../../../../ios/${derived}/Build/Products`)].find(
    (d): d is string => !!d && has(d),
  );
  if (found) return found;
  const src = join(here, '../../agents/ios-src');
  if (!existsSync(join(src, 'Appdyno.xcodeproj'))) return undefined;
  const id = (await readFile(join(src, 'sources.sha256'), 'utf8').catch(() => 'unknown'))
    .trim()
    .slice(0, 16);
  const out = join(homedir(), 'Library/Caches/appdyno/ios-build', id, kind);
  const products = join(out, 'Build/Products');
  if (has(products) || !build) return has(products) ? products : undefined;
  process.stderr.write(`building the iOS runner for the ${kind} once (a few minutes)\n`);
  await run(
    'xcodebuild',
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
      '-quiet',
      ...(kind === 'device'
        ? ['CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO', 'CODE_SIGN_IDENTITY=']
        : []),
    ],
    { env: xcodeEnv(), timeout: 1_800_000, maxBuffer: 64 * 1024 * 1024 },
  ).catch((e: { stderr?: string; message: string }) => {
    throw new DeviceError(
      'UNSUPPORTED',
      `the iOS runner did not build: ${(e.stderr ?? e.message).trim().split('\n').slice(-3).join(' ').slice(0, 300)}`,
      'see appdyno doctor',
    );
  });
  return products;
}

/** Removes the runner builds of other packaged sources than the installed ones; how many were removed. */
export async function pruneIosBuilds(): Promise<number> {
  const here = dirname(fileURLToPath(import.meta.url));
  const id = (
    await readFile(join(here, '../../agents/ios-src/sources.sha256'), 'utf8').catch(() => '')
  )
    .trim()
    .slice(0, 16);
  const root = join(homedir(), 'Library/Caches/appdyno/ios-build');
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
 * only by this user. A different runner build is replaced.
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

  /** `beforeStart` runs only when a new runner must be started (e.g. to check the simulator is up). */
  async connect(
    target?: string,
    beforeStart?: () => Promise<void>,
  ): Promise<{ rpc: RpcClient; hello: Hello; started: boolean }> {
    const build = await this.transport.build();
    const state = await this.readState();
    if (state && state.sha256 === build.sha256) {
      const c = await this.tryConnect(state).catch(() => undefined);
      if (c) return { ...c, started: false };
    }
    await beforeStart?.();
    if (state?.pid) await this.kill(state.pid);
    return { ...(await this.start(build, target)), started: true };
  }

  async stop(rpc?: RpcClient) {
    if (rpc && !rpc.closed)
      await rpc.call('shutdown', {}, { timeoutMs: 5_000 }).catch(() => undefined);
    const state = await this.readState();
    if (state?.pid) await this.kill(state.pid);
    await rm(this.statePath, { force: true });
  }

  private async start(build: { xctestrun: string; sha256: string }, target?: string) {
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
          TEST_RUNNER_GD_PORT: String(port),
          TEST_RUNNER_GD_TOKEN: token,
          ...(target && { TEST_RUNNER_GD_TARGET: target }),
          // APPDYNO_FAST_TAP=0: taps through XCUI instead of XCTest's event synthesizer (the runner's EventShim)
          ...(process.env.APPDYNO_FAST_TAP && { TEST_RUNNER_GD_FAST_TAP: process.env.APPDYNO_FAST_TAP }),
        },
      },
    );
    closeSync(out);
    child.unref();
    let exited: number | null | undefined;
    child.once('exit', (code) => (exited = code));
    const s: State = { port, token, sha256: build.sha256, ...(child.pid && { pid: child.pid }) };
    const deadline = Date.now() + START_MS;
    for (;;) {
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
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }

  private async tryConnect(s: State): Promise<{ rpc: RpcClient; hello: Hello }> {
    const { socket, rest } = await this.transport.open(s.port);
    socket.setNoDelay(true);
    const rpc = new RpcClient(socket, rest);
    try {
      const { result } = await rpc.call(
        'hello',
        { token: s.token, protocol: PROTOCOL.major },
        { timeoutMs: 5_000 },
      );
      if (result.protocol.major !== PROTOCOL.major)
        throw new DeviceError(
          'AGENT_VERSION_MISMATCH',
          `runner protocol ${result.protocol.major}, host ${PROTOCOL.major}`,
        );
      return { rpc, hello: result };
    } catch (e) {
      rpc.close();
      throw e;
    }
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

  private async readState(): Promise<State | undefined> {
    try {
      return State.parse(JSON.parse(await readFile(this.statePath, 'utf8')));
    } catch {
      return undefined;
    }
  }

  private async writeState(s: State) {
    await writeFile(this.statePath, JSON.stringify(s), { mode: 0o600 });
    await chmod(this.statePath, 0o600);
  }
}
