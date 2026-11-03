import { execFile, spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  pause,
  readVideo,
  stateDir,
  type RecordingFiles,
  type RecordingHandle,
  type ScreenRecorder,
} from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { assertUdid, xcodeEnv } from './simctl.js';

const run = promisify(execFile);
const START_MS = 15_000;
/** Writing a long recording out takes a while. */
const STOP_MS = 120_000;
const logOf = (h: RecordingHandle) => String(h.log);

/**
 * A tool on the Mac that records until SIGINT. It runs detached, as a command line's `stop` is another
 * process, with its output in a file to read back.
 */
class ToolRecorder implements ScreenRecorder {
  constructor(
    readonly extension: 'mp4' | 'mov',
    private readonly args: (file: string) => string[],
    /** What the tool prints once it records; absent: it is up if it is still there after QUIET_MS. */
    private readonly started: RegExp | undefined,
    private readonly mark: string,
    private readonly stillNote?: string,
  ) {}

  async start(file: string): Promise<RecordingHandle> {
    const dir = join(stateDir(), 'video');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const log = join(dir, `${randomBytes(4).toString('hex')}.log`);
    const fd = openSync(log, 'w', 0o600);
    const child = spawn('xcrun', this.args(file), {
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
    for (;;) {
      const text = readFileSync(log, 'utf8');
      if (this.started?.test(text)) return { pid: child.pid!, log, file };
      if (exited || Date.now() > end) {
        if (!exited && !this.started) return { pid: child.pid!, log, file };
        if (!exited) child.kill('SIGKILL');
        rmSync(log, { force: true });
        throw new DeviceError(
          'UNSUPPORTED',
          `the recording did not start (${exited ?? `no word in ${START_MS} ms`}): ${text.trim().slice(0, 300)}`,
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
    'a simulator writes a frame only when the screen changes, so a still screen gives a very short video',
  );

// shortcut: what `devicectl` prints once it records has not been seen (no free phone); a process still
// there after QUIET_MS counts as recording. Read its output on a phone and wait for that instead.
export const phoneRecorder = (udid: string): ScreenRecorder =>
  new ToolRecorder(
    'mp4',
    (file) => [
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
    ],
    undefined,
    'screen-record',
  );
