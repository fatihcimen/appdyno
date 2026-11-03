import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DeviceError, type Hello } from '@appdyno/protocol';
import { z } from 'zod';
import {
  sleep,
  greet,
  pause,
  readStateFile,
  reportProgress,
  safeName,
  stateDir,
  writeStateFile,
  type RpcClient,
} from '@appdyno/core';
import { type Adb, assertSerial, shq } from './adb.js';
import { conflictHint, holdersIn, type Holder } from './holders.js';

export const AGENT_MAIN = 'dev.appdyno.agent.Main';
export const REMOTE_DIR = '/data/local/tmp/appdyno';
/**
 * How long a fresh agent may take to open its socket while its process is alive: a JVM start on a
 * loaded host took over 20 s (load 85). A process that is gone fails the start at once.
 */
const START_MS = 60_000;
/** A start that has no process after this long has failed (the process shows within a second). */
const NO_PROCESS_MS = 5_000;
const POLL_MS = 100;

/** The agent APK the package ships (or a development build), and its sha256. */
export async function agentApk(): Promise<{ path: string; sha256: string }> {
  const here = dirname(fileURLToPath(import.meta.url));
  const built = join(here, '../../../android/agent/build/outputs/apk/debug/agent-debug.apk');
  const packaged = join(here, '../agents/android/agent.apk');
  // from the sources (tests, development) the fresh build wins over a copy packaged earlier
  const fromSource = /[\\/]src$/.test(here);
  const candidates = [
    process.env.APPDYNO_ANDROID_AGENT,
    ...(fromSource ? [built, packaged] : [packaged, built]),
  ].filter((p): p is string => !!p);
  const path = candidates.find((p) => existsSync(p));
  if (!path)
    throw new DeviceError(
      'UNSUPPORTED',
      'the Android agent is not built',
      'build it: (cd android && ./gradlew :agent:assembleDebug), or set APPDYNO_ANDROID_AGENT',
    );
  const sha256 = createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
  return { path, sha256 };
}

const State = z.object({
  socket: z.string(),
  token: z.string(),
  sha256: z.string(),
  pid: z.number().optional(),
});
type State = z.infer<typeof State>;

/**
 * Starts, finds again and stops the Android agent of one device. The agent outlives the host process
 * (a new host reconnects in one round trip): its socket name and launch token are kept in a state file
 * readable only by this user. A different agent build on the device is replaced.
 */
export class AndroidAgentLauncher {
  constructor(
    private readonly adb: Adb,
    readonly serial: string,
    /** Stop another tool's helper that holds UI automation (the server's --takeover). */
    private readonly takeover = false,
  ) {
    assertSerial(serial);
  }

  private get statePath() {
    return join(stateDir(), `android-${safeName(this.serial)}.json`);
  }

  /** A connected client to a running agent of this build: the one already there, else a new one. */
  async connect(): Promise<{ rpc: RpcClient; hello: Hello; started: boolean }> {
    const apk = await agentApk();
    const state = await this.readState();
    if (state && state.sha256 === apk.sha256) {
      const c = await this.tryConnect(state).catch(() => undefined);
      if (c) return { ...c, started: false };
    }
    if (state?.pid) await this.kill(state.pid);
    const start = async () => ({ ...(await this.start(apk)), started: true });
    const unlessConflict = (e: unknown): DeviceError => {
      if (e instanceof DeviceError && e.code === 'AGENT_CONFLICT') return e;
      throw e;
    };
    let conflict: DeviceError;
    try {
      return await start();
    } catch (e) {
      conflict = unlessConflict(e);
    }
    // our own agent from a lost state (another state folder, a cleared cache) holds the device: it
    // cannot be reached without its token, so it is replaced, once
    if (await this.killOrphans()) {
      try {
        return await start();
      } catch (e) {
        conflict = unlessConflict(e);
      }
    }
    const holders = await this.holders();
    if (!this.takeover || holders.length === 0)
      throw new DeviceError(conflict.code, conflict.message, conflictHint(holders, this.serial));
    for (const h of holders) await this.stopHolder(h);
    return start();
  }

  /** Who holds UI automation, as the device's process list shows it. */
  private async holders(): Promise<Holder[]> {
    return holdersIn(await this.adb.exec(this.serial, 'ps -A -o PID,ARGS').catch(() => ''));
  }

  /** Only on --takeover: another tool's helper is stopped when its owner said so. */
  private async stopHolder(h: Holder) {
    await this.adb.exec(this.serial, h.shell).catch(() => undefined);
    await pause(500);
  }

  /** Stops this device's agent (and forgets it). */
  async stop(): Promise<void> {
    const state = await this.readState();
    if (state?.pid) await this.kill(state.pid);
    await rm(this.statePath, { force: true });
  }

  private async start(apk: { path: string; sha256: string }) {
    reportProgress('starting the Android agent');
    const remote = `${REMOTE_DIR}/agent-${apk.sha256.slice(0, 16)}.apk`;
    const have = await this.adb.exec(this.serial, `sha256sum ${shq(remote)} 2>/dev/null`);
    if (!have.startsWith(apk.sha256)) {
      await this.adb.exec(this.serial, `mkdir -p ${REMOTE_DIR}`);
      await this.adb.run(['-s', this.serial, 'push', apk.path, remote]);
    }
    const socket = `appdyno_${randomBytes(8).toString('hex')}`;
    const token = randomBytes(24).toString('hex');
    const log = `${REMOTE_DIR}/agent.log`;
    const session = await this.adb.startDetached(
      this.serial,
      `cd ${REMOTE_DIR} && CLASSPATH=${shq(remote)} setsid nohup app_process / ${AGENT_MAIN} ` +
        `--socket ${socket} --token ${token} > ${log} 2>&1 < /dev/null &`,
      START_MS + 2_000,
    );
    try {
      return await this.waitReady({ socket, token, sha256: apk.sha256 }, log);
    } finally {
      session.close();
    }
  }

  private async waitReady(s: State, log: string): Promise<{ rpc: RpcClient; hello: Hello }> {
    const started = Date.now();
    const deadline = started + START_MS;
    let polls = 0;
    for (;;) {
      const c = await this.tryConnect(s).catch((e: unknown) =>
        e instanceof Error ? e : new Error(String(e)),
      );
      if (!(c instanceof Error)) {
        await this.writeState({ ...s, ...(c.hello.pid && { pid: c.hello.pid }) });
        return c;
      }
      if (c instanceof DeviceError && c.code === 'DEVICE_GONE') throw c;
      const out = await this.adb.exec(this.serial, `cat ${log} 2>/dev/null`).catch(() => '');
      const failed = /^(AGENT_CONFLICT|UNSUPPORTED|INTERNAL|INVALID_ARGUMENT): (.*)$/m.exec(out);
      if (failed) {
        const code = failed[1] as
          'AGENT_CONFLICT' | 'UNSUPPORTED' | 'INTERNAL' | 'INVALID_ARGUMENT';
        throw new DeviceError(
          code,
          `the Android agent could not start: ${failed[2]}`,
          code === 'AGENT_CONFLICT'
            ? 'another UI automation server runs on this device: stop it, then retry'
            : undefined,
        );
      }
      // the readiness signal is the socket answering hello; meanwhile the process must be there (every 5th poll)
      if (
        ++polls % 5 === 0 &&
        Date.now() - started > NO_PROCESS_MS &&
        !(await this.running(s.socket))
      )
        throw new DeviceError(
          'AGENT_UNAVAILABLE',
          'the Android agent process ended before it was ready',
          out.trim().slice(-300) || undefined,
        );
      if (Date.now() >= deadline)
        throw new DeviceError(
          'AGENT_UNAVAILABLE',
          `the Android agent did not start within ${START_MS} ms`,
          out.trim().slice(0, 300) || undefined,
        );
      await sleep(POLL_MS);
    }
  }

  /** Our agent process for this socket is running (its command line names the socket). */
  private async running(socket: string): Promise<boolean> {
    // [g]etir… never matches this shell's own command line
    const pattern = `[${socket[0]}]${socket.slice(1)}`;
    const out = await this.adb
      .exec(this.serial, `pgrep -f '${pattern}' >/dev/null && echo yes; true`)
      .catch(() => 'yes');
    return out.includes('yes');
  }

  private async tryConnect(state: State): Promise<{ rpc: RpcClient; hello: Hello }> {
    const { socket, rest } = await this.adb.open(this.serial, `localabstract:${state.socket}`);
    return greet(socket, rest, 'agent', state.token, 3_000);
  }

  /** Stops every agent process of ours on the device; true when there was one. */
  private async killOrphans(): Promise<boolean> {
    const out = await this.adb
      .exec(this.serial, `pgrep -f '${AGENT_MAIN.replace(/\./g, '[.]')}'`)
      .catch(() => '');
    const pids = out
      .split(/\s+/)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0);
    for (const pid of pids) await this.kill(pid);
    if (pids.length > 0) await sleep(500);
    return pids.length > 0;
  }

  private async kill(pid: number) {
    // only our own agent (its command line names the agent's main class); gone before this returns
    // (it holds the device's one UI automation connection): 3 s to end, then killed outright
    const ours = `grep -q ${AGENT_MAIN} /proc/${pid}/cmdline 2>/dev/null`;
    await this.adb
      .exec(
        this.serial,
        `${ours} && kill ${pid}; for i in $(seq 1 30); do ${ours} || exit 0; sleep 0.1; done; ${ours} && kill -9 ${pid}; true`,
        { timeoutMs: 15_000 },
      )
      .catch(() => undefined);
  }

  private readState() {
    return readStateFile(this.statePath, State);
  }

  private async writeState(s: State) {
    await mkdir(stateDir(), { recursive: true, mode: 0o700 });
    await writeStateFile(this.statePath, s);
  }
}
