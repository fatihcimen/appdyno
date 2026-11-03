import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import {
  run,
  pause,
  readVideo,
  stateDir,
  type RecordingFiles,
  type RecordingHandle,
  type ScreenRecorder,
} from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { assertUdid, xcodeEnv } from './simctl.js';

const START_MS = 15_000;
/** Writing a long recording out takes a while. */
const STOP_MS = 120_000;
const logOf = (h: RecordingHandle) => String(h.log);
/** What a tool says, without the dump it adds for its own log. */
const whatToolSaid = (text: string) =>
  (text.trim().split('\n')[0] ?? '')
    .replace(/^ERROR:\s*/, '')
    .replace(/\s*\(com\.apple[^)]*\)/, '');

/**
 * A tool on the Mac that records until SIGINT. It runs detached, as a command line's `stop` is another
 * process, with its output in a file to read back.
 */
class ToolRecorder implements ScreenRecorder {
  constructor(
    readonly extension: 'mp4' | 'mov',
    private readonly args: (file: string, maxSeconds: number) => string[],
    /** What the tool prints once it records; absent: it is up if it is still there after QUIET_MS. */
    private readonly started: RegExp | undefined,
    private readonly mark: string,
    /** The tool has no limit of its own: a sleeper ends it. */
    private readonly limits: boolean,
    private readonly stillNote?: string,
    private readonly refusedHint?: string,
  ) {}

  /** Asks the recorder to end after `seconds`, if it is still that recorder; ends with `stop` too. */
  private sleeper(pid: number, seconds: number) {
    const child = spawn(
      'sh',
      [
        '-c',
        `sleep ${seconds}; ps -o command= -p ${pid} | grep -q ${this.mark} && kill -INT ${pid}`,
      ],
      { detached: true, stdio: 'ignore' },
    );
    child.unref();
    return child.pid!;
  }

  async start(file: string, { maxSeconds }: { maxSeconds: number }): Promise<RecordingHandle> {
    const dir = join(stateDir(), 'video');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const log = join(dir, `${randomBytes(4).toString('hex')}.log`);
    const fd = openSync(log, 'w', 0o600);
    const child = spawn('xcrun', this.args(file, maxSeconds), {
      detached: true,
      stdio: ['ignore', fd, fd],
      env: xcodeEnv(),
    });
    closeSync(fd);
    child.unref();
    let exited: string | undefined;
    child.on('exit', (code, signal) => (exited = `exit ${code ?? signal}`));
    child.on('error', (e) => (exited = e.message));
    const end = Date.now() + (this.started ? START_MS : QUIET_MS);
    const up = () => ({
      pid: child.pid!,
      log,
      file,
      ...(this.limits ? {} : { sleeper: this.sleeper(child.pid!, maxSeconds) }),
    });
    for (;;) {
      const text = readFileSync(log, 'utf8');
      if (this.started?.test(text)) return up();
      if (exited || Date.now() > end) {
        if (!exited && !this.started) return up();
        if (!exited) child.kill('SIGKILL');
        rmSync(log, { force: true });
        throw new DeviceError(
          'UNSUPPORTED',
          `the recording did not start (${exited ?? `no word in ${START_MS} ms`}): ${whatToolSaid(text)}`,
          this.refusedHint,
        );
      }
      await pause(100);
    }
  }

  /** Its own process, not another that took its number after it ended. */
  private async alive(pid: number) {
    const { stdout } = await run('ps', ['-o', 'command=', '-p', String(pid)]).catch(() => ({
      stdout: '',
    }));
    return stdout.includes(this.mark);
  }

  async stop(h: RecordingHandle): Promise<RecordingFiles> {
    const pid = Number(h.pid);
    const file = String(h.file);
    const wasAlive = await this.alive(pid);
    if (h.sleeper) {
      try {
        process.kill(Number(h.sleeper));
      } catch {
        // its time came, and it has gone
      }
    }
    if (wasAlive) process.kill(pid, 'SIGINT');
    const end = Date.now() + STOP_MS;
    while ((await this.alive(pid)) && Date.now() < end) await pause(100);
    if (await this.alive(pid))
      throw new DeviceError('TIMEOUT', `the recorder did not end in ${STOP_MS} ms`);
    const log = existsSync(logOf(h)) ? readFileSync(logOf(h), 'utf8').trim() : '';
    rmSync(logOf(h), { force: true });
    if (!existsSync(file))
      throw new DeviceError(
        'INTERNAL',
        `the recording failed: no file was written${log ? ` (${log.slice(-300)})` : ''}`,
      );
    const notes = wasAlive ? [] : [`the recorder had already ended: ${log.slice(-200)}`];
    const video = await readVideo(file).catch(() => undefined);
    if (video && video.frames <= 2 && this.stillNote) notes.push(this.stillNote);
    return { files: [file], ...(notes.length > 0 && { note: notes.join('; ') }) };
  }
}

const QUIET_MS = 3_000;

/** It writes a QuickTime movie, whatever the file is called. */
export const simulatorRecorder = (udid: string): ScreenRecorder =>
  new ToolRecorder(
    'mov',
    (file) => ['simctl', 'io', assertUdid(udid), 'recordVideo', '--codec=h264', '--force', file],
    /Recording started/,
    'recordVideo',
    false,
    'a simulator writes a frame only when the screen changes, so a still screen gives a very short video',
  );

// shortcut: what `devicectl` prints once it records has not been seen, as the one phone tried (iPhone 13 Pro Max,
// iOS 27.0.1) lacks the capability and refuses at once; a process still there after QUIET_MS counts as recording.
// Read its output on a phone that has it and wait for that instead.
export const phoneRecorder = (udid: string): ScreenRecorder =>
  new ToolRecorder(
    'mp4',
    (file, maxSeconds) => [
      'devicectl',
      'device',
      'capture',
      'screen-record',
      '--device',
      udid,
      '--destination',
      file,
      '--codec',
      'h264',
      '--duration',
      String(maxSeconds),
    ],
    undefined,
    'screen-record',
    true,
    undefined,
    'this phone does not offer it to devicectl: record on the phone (Control Center, Screen Recording), or with QuickTime Player on this Mac',
  );
