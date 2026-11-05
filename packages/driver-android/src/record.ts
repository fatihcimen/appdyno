import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  joinVideos,
  pause,
  readVideo,
  stateDir,
  type RecordingFiles,
  type RecordingHandle,
  type ScreenRecorder,
} from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { shq, type Adb } from './adb.js';
import { REMOTE_DIR } from './agent.js';

/** What `screenrecord` takes at most in one run. */
const SEGMENT_S = 180;
/** A tenth of its default: a long recording must fit the device, and a screen of UI needs no more. */
const BIT_RATE = 4_000_000;
/** Text stays legible on a phone's screen at this rate, and a segment stays a few MB. */
const LIGHT_BIT_RATE = 1_000_000;
const START_MS = 15_000;
const PULL_MS = 600_000;

/** The state folder may be on another volume than the video. */
const move = (from: string, to: string) =>
  rename(from, to).catch(async (e: NodeJS.ErrnoException) => {
    if (e.code !== 'EXDEV') throw e;
    await copyFile(from, to);
  });

const segmentSeconds = () => Number(process.env.APPDYNO_RECORD_SEGMENT_S ?? SEGMENT_S);

/**
 * `screenrecord` runs on the device, one segment after another, in a shell that needs no host: a command
 * line's `stop` is another process. A file ends properly only on the first SIGINT its process gets: the
 * second kills it, leaving no index.
 */
export class AndroidRecorder implements ScreenRecorder {
  readonly extension = 'mp4';

  constructor(
    private readonly adb: Adb,
    private readonly serial: string,
  ) {}

  private sh = (c: string, timeoutMs = 30_000) => this.adb.exec(this.serial, c, { timeoutMs });

  async start(
    file: string,
    { maxSeconds, light }: { maxSeconds: number; light?: boolean },
  ): Promise<RecordingHandle> {
    const dir = `${REMOTE_DIR}/video-${randomBytes(4).toString('hex')}`;
    const segment = segmentSeconds();
    const bitRate = light ? LIGHT_BIT_RATE : BIT_RATE;
    const loop =
      `cd ${dir}; i=0; left=${maxSeconds}; while [ ! -e stop ] && [ $left -gt 0 ]; do i=$((i+1)); ` +
      `t=${segment}; [ $left -lt $t ] && t=$left; left=$((left-t)); ` +
      `screenrecord --time-limit $t --bit-rate ${bitRate} seg$i.mp4 >>log 2>&1 & echo $! > pid; wait $!; ` +
      `c=$?; [ $c -eq 0 ] || { echo "screenrecord exited with $c" >> log; break; }; done; touch done`;
    const session = await this.adb.startDetached(
      this.serial,
      `mkdir -p ${dir} && setsid nohup sh -c ${shq(loop)} > /dev/null 2>&1 < /dev/null &`,
      START_MS + 2_000,
    );
    try {
      const end = Date.now() + START_MS;
      for (;;) {
        // the file appears after screenrecord has set its signal handler; a ring's next segment waits for what is in it,
        // as a Samsung A52 runs one encoder: a second recording makes its file and dies at the first frame
        const out = await this.sh(
          `cd ${dir} 2>/dev/null && { [ ${light ? '-s' : '-e'} seg1.mp4 ] && echo up; [ -e done ] && cat log; }`,
        );
        if (out.startsWith('up')) return { dir, file };
        if (out.trim() || Date.now() > end) {
          await this.sh(`rm -rf ${dir}`);
          throw new DeviceError(
            'UNSUPPORTED',
            `screenrecord did not start: ${out.trim().slice(0, 300) || `no file after ${START_MS} ms`}`,
          );
        }
        await pause(150);
      }
    } finally {
      session.close();
    }
  }

  async stop(h: RecordingHandle): Promise<RecordingFiles> {
    const { dir, file } = h as { dir: string; file: string };
    // one signal per process; a second only if it is still there 20 s on, as a signal that came before
    // it had its handler is lost
    const out = await this.sh(
      `cd ${dir} || { echo no-dir; exit; }; touch stop; last=; n=0; while [ ! -e done ] && [ $n -lt 300 ]; do ` +
        `p=$(cat pid 2>/dev/null); if [ -n "$p" ] && [ "$p" != "$last" ] && grep -q screenrecord /proc/$p/cmdline 2>/dev/null; then ` +
        `kill -INT $p; last=$p; fi; sleep 0.2; n=$((n+1)); [ $n -eq 100 ] && last=; done; ` +
        `[ -e done ] && echo stopped; echo; cat log 2>/dev/null; echo; ls -1 seg*.mp4 2>/dev/null`,
      90_000,
    );
    if (out.startsWith('no-dir'))
      throw new DeviceError('NOT_FOUND', `the recording's folder is gone from ${this.serial}`);
    const lines = out.split('\n');
    const stopped = lines[0] === 'stopped';
    const names = lines
      .filter((l) => /^seg\d+\.mp4$/.test(l.trim()))
      .map((l) => l.trim())
      .sort((a, b) => parseInt(a.slice(3), 10) - parseInt(b.slice(3), 10));
    const log = lines
      .filter((l) => l.trim() && l !== 'stopped' && !/^seg\d+\.mp4$/.test(l.trim()))
      .join(' ')
      .slice(0, 300);
    // not beside the video: a session's end may be cut short while this copies, and leaves it
    await mkdir(join(stateDir(), 'video'), { recursive: true, mode: 0o700 });
    const here = await mkdtemp(join(stateDir(), 'video', 'pull-'));
    try {
      const good: string[] = [];
      const torn: string[] = [];
      for (const name of names) {
        const local = join(here, name);
        await this.adb.run(['-s', this.serial, 'pull', `${dir}/${name}`, local], PULL_MS);
        await readVideo(local).then(
          () => good.push(local),
          (e: Error) => torn.push(`${name}: ${e.message.replace(`${local} `, '')}`),
        );
      }
      if (good.length === 0) {
        await this.sh(`rm -rf ${dir}`);
        throw new DeviceError(
          'INTERNAL',
          `the recording failed: ${torn.join('; ') || 'screenrecord wrote no file'}${log ? ` (${log})` : ''}`,
        );
      }
      const notes = [
        ...(torn.length > 0 ? [`left out as torn: ${torn.join('; ')}`] : []),
        ...(stopped ? [] : ['screenrecord did not stop when asked, so the last part may be lost']),
      ];
      const files = await this.finish(good, file, notes);
      await this.sh(`rm -rf ${dir}`);
      return { files, ...(notes.length > 0 && { note: notes.join('; ') }) };
    } finally {
      await rm(here, { recursive: true, force: true });
    }
  }

  /** One file: the only segment, or all of them joined; else the segments, next to it, in order. */
  private async finish(good: string[], file: string, notes: string[]) {
    if (good.length === 1) {
      await move(good[0]!, file);
      return [file];
    }
    try {
      await joinVideos(good, file);
      notes.push(`${good.length} segments joined: a moment is lost at each join`);
      return [file];
    } catch (e) {
      notes.push(`${good.length} segments kept apart: ${(e as Error).message}`);
      return Promise.all(
        good.map(async (g, i) => {
          const to = file.replace(/(\.\w+)?$/, `-${i + 1}$1`);
          await move(g, to);
          return to;
        }),
      );
    }
  }
}
