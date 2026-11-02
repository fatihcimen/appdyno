import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { DeviceError } from '@appdyno/protocol';
import type { CpuProfile, Measured } from '@appdyno/core';
import { traceProcessor } from './tools.js';
import type { AndroidDevice } from './device.js';
import {
  parseAmStart,
  parseFrameStats,
  parseFrameTimelineCsv,
  parseMeminfo,
  parseProcStatTicks,
  parseVitals,
  type DeviceVitals,
  type FrameStats,
  type FrameTimeline,
  type LaunchSample,
  type MemoryStats,
  parseSimpleperfReport,
} from './perf-parse.js';

const run = promisify(execFile);

export type HeapDump = { file: string; bytes: number };

export type CpuStats = {
  percent: number;
  windowMs: number;
  ticks: number;
  clockTicksPerSec: number;
};
export type LaunchStats = {
  mode: 'cold' | 'warm';
  /** The launches measured (the first one, a warm-up, is left out). */
  samples: LaunchSample[];
  medianMs?: number;
};

const PKG = /^[A-Za-z][\w]*(\.[A-Za-z][\w]*)+$/;
const assertPkg = (p: string) => {
  if (!PKG.test(p)) throw new DeviceError('INVALID_ARGUMENT', `not a package name: ${p}`);
  return p;
};
const at = () => new Date().toISOString();
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return undefined;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1]! + s[m]!) / 2);
};

/**
 * The app's and the device's performance on Android, from the platform's own tools: frames (gfxinfo,
 * Perfetto's frame timeline), memory (meminfo), CPU (/proc), launch time (`am start -W`) and the
 * device's state while measuring (load, CPU pressure, memory, thermal status, battery temperature).
 * Commands run in the C locale (a localized device writes `0,0`).
 */
export class AndroidPerf {
  constructor(private readonly device: AndroidDevice) {}

  private sh(cmd: string, timeoutMs?: number) {
    return this.device.shell(`LC_ALL=C ${cmd}`, timeoutMs);
  }

  /** Frames since the stats were last reset, then a reset (the next read starts a new window). */
  async frames(pkg: string, opts: { reset?: boolean } = {}): Promise<Measured<FrameStats>> {
    assertPkg(pkg);
    const raw = await this.sh(
      `dumpsys gfxinfo ${pkg} framestats${opts.reset === false ? '' : `; dumpsys gfxinfo ${pkg} reset > /dev/null`}`,
    );
    if (/No process found/i.test(raw))
      throw new DeviceError('APP_NOT_RUNNING', `${pkg} is not running`);
    return { value: parseFrameStats(raw), raw, at: at() };
  }

  async resetFrames(pkg: string) {
    await this.sh(`dumpsys gfxinfo ${assertPkg(pkg)} reset > /dev/null`);
  }

  async memory(pkg: string): Promise<Measured<MemoryStats>> {
    assertPkg(pkg);
    const raw = await this.sh(`dumpsys meminfo ${pkg}`);
    if (/No process found/i.test(raw))
      throw new DeviceError('APP_NOT_RUNNING', `${pkg} is not running`);
    return { value: parseMeminfo(raw), raw, at: at() };
  }

  async pid(pkg: string): Promise<number> {
    const out = (await this.sh(`pidof ${assertPkg(pkg)}`)).trim();
    const pid = Number(out.split(/\s+/)[0]);
    if (!out || !Number.isInteger(pid))
      throw new DeviceError('APP_NOT_RUNNING', `${pkg} is not running`);
    return pid;
  }

  /** The app's CPU over `windowMs`: its CPU time before and after, as % of one core. */
  async cpu(pkg: string, windowMs = 2_000): Promise<Measured<CpuStats>> {
    const pid = await this.pid(pkg);
    const read = () => this.sh(`cat /proc/${pid}/stat; getconf CLK_TCK`);
    const a = await read();
    const t0 = Date.now();
    await new Promise((r) => setTimeout(r, windowMs));
    const b = await read();
    const ms = Date.now() - t0;
    const hz = Number(b.trim().split('\n').pop()) || 100;
    const ticks = parseProcStatTicks(b.split('\n')[0]!) - parseProcStatTicks(a.split('\n')[0]!);
    const percent = Math.round(((ticks / hz) * 1000 * 1000) / ms) / 10;
    return {
      value: { percent, windowMs: ms, ticks, clockTicksPerSec: hz },
      raw: `${a}\n---\n${b}`,
      at: at(),
    };
  }

  /**
   * Launch time: `repeats` launches after one warm-up, the median of their TotalTime. Cold: the app is
   * stopped first; warm: it goes to the background (home) and comes back. Only launches the system
   * reports in the asked state count.
   */
  async launch(
    pkg: string,
    opts: { mode?: 'cold' | 'warm'; repeats?: number } = {},
  ): Promise<Measured<LaunchStats>> {
    assertPkg(pkg);
    const mode = opts.mode ?? 'cold';
    const repeats = Math.min(Math.max(opts.repeats ?? 3, 1), 10);
    const component = (
      await this.sh(
        `cmd package resolve-activity --brief -c android.intent.category.LAUNCHER ${pkg}`,
      )
    )
      .trim()
      .split('\n')
      .pop()!;
    if (!component.includes('/'))
      throw new DeviceError('APP_NOT_RUNNING', `${pkg} has no launcher activity`);
    const raws: string[] = [];
    const samples: LaunchSample[] = [];
    for (let i = 0; i <= repeats; i++) {
      if (mode === 'cold') await this.sh(`am force-stop ${pkg}`);
      else {
        await this.sh(`am start -W -n ${component} > /dev/null`);
        await this.sh('input keyevent KEYCODE_HOME');
        await new Promise((r) => setTimeout(r, 800));
      }
      const raw = await this.sh(`am start -W -n ${component}`, 60_000);
      raws.push(raw);
      const s = parseAmStart(raw);
      if (i > 0) samples.push(s); // the first launch warms caches up
      await new Promise((r) => setTimeout(r, 1_000));
    }
    const want = mode === 'cold' ? 'COLD' : /^(WARM|HOT)$/;
    const ok = samples.filter(
      (s) =>
        s.totalMs !== undefined &&
        (typeof want === 'string' ? s.state === want : want.test(s.state ?? '')),
    );
    const m = median(ok.map((s) => s.totalMs!));
    return {
      value: { mode, samples, ...(m !== undefined && { medianMs: m }) },
      raw: raws.join('\n---\n'),
      at: at(),
    };
  }

  /** The device's own state: load, CPU pressure, memory, thermal status, battery temperature. */
  async vitals(): Promise<Measured<DeviceVitals>> {
    const raw = await this.sh(
      'echo ==load==; cat /proc/loadavg; echo ==pressure==; cat /proc/pressure/cpu 2>/dev/null; ' +
        'echo ==mem==; head -3 /proc/meminfo; echo ==thermal==; dumpsys thermalservice 2>/dev/null | head -5; ' +
        'echo ==battery==; dumpsys battery 2>/dev/null',
    );
    return { value: parseVitals(raw), raw, at: at() };
  }

  /**
   * Where the app's CPU time goes: `simpleperf` samples its threads for `durationMs` (the app must be
   * debuggable or profileable) and reports the functions by their share of the samples.
   */
  async cpuProfile(
    pkg: string,
    durationMs = 3_000,
    during?: () => Promise<unknown>,
  ): Promise<Measured<CpuProfile>> {
    assertPkg(pkg);
    await this.pid(pkg);
    const s = Math.min(Math.max(Math.round(durationMs / 1000), 1), 30);
    const file = `/data/local/tmp/appdyno-${randomBytes(4).toString('hex')}.data`;
    try {
      const rec = this.device.shellAlongside(
        // the CPU clock (time-based sampling) works on every device; emulators have no cycle counter
        `LC_ALL=C simpleperf record --app ${pkg} -e cpu-clock -f 1000 --duration ${s} -o ${file} 2>&1`,
        (s + 30) * 1000,
      );
      if (during) await during();
      const recorded = await rec;
      if (/ E |error|fail|not supported/i.test(recorded) && !/Samples recorded/i.test(recorded))
        throw new DeviceError(
          'UNSUPPORTED',
          `simpleperf could not record ${pkg}: ${recorded.trim().slice(0, 300)}`,
        );
      const report = await this.sh(
        `simpleperf report -i ${file} --sort symbol -n --percent-limit 0.3 2>&1`,
        60_000,
      );
      const total = Number(/^Samples:\s*(\d+)/m.exec(report)?.[1] ?? 0);
      return {
        value: { durationMs: s * 1000, samples: total, top: parseSimpleperfReport(report) },
        raw: `${recorded}\n---\n${report}`,
        at: at(),
      };
    } finally {
      await this.device.shell(`rm -f ${file}`).catch(() => undefined);
    }
  }

  /** A heap dump of the app (HPROF, for a memory analyser) saved at `localPath`; the file stays on this machine. */
  async heapDump(pkg: string, localPath: string): Promise<Measured<HeapDump>> {
    assertPkg(pkg);
    await this.pid(pkg);
    const remote = `/data/local/tmp/appdyno-${randomBytes(4).toString('hex')}.hprof`;
    try {
      const out = await this.sh(`am dumpheap ${pkg} ${remote} 2>&1`, 120_000);
      // the dump is written by the app after the command returns: wait until its size stops growing
      let last = -1;
      for (let i = 0; i < 120; i++) {
        const size = Number(
          (await this.device.shell(`stat -c %s ${remote} 2>/dev/null`)).trim() || -1,
        );
        if (size > 0 && size === last) break;
        last = size;
        await new Promise((r) => setTimeout(r, 500));
      }
      if (last <= 0)
        throw new DeviceError('UNSUPPORTED', `no heap dump of ${pkg}: ${out.trim().slice(0, 200)}`);
      await this.device.pull(remote, localPath);
      return { value: { file: localPath, bytes: last }, raw: out, at: at() };
    } finally {
      await this.device.shell(`rm -f ${remote}`).catch(() => undefined);
    }
  }

  /**
   * Every frame of the app over `durationMs` from Perfetto's frame timeline (Android 12+): the time each
   * frame took and why it was late (the app, the compositor, buffer stuffing). `during` runs while it
   * records (a scroll, a transition). Needs the trace processor (`appdyno tools install`).
   */
  async frameTimeline(
    pkg: string,
    durationMs: number,
    during?: () => Promise<unknown>,
  ): Promise<Measured<FrameTimeline> & { tracePath?: string }> {
    assertPkg(pkg);
    const tp = await traceProcessor();
    const remote = `/data/misc/perfetto-traces/appdyno-${randomBytes(4).toString('hex')}.pftrace`;
    const ms = Math.min(Math.max(Math.round(durationMs), 500), 60_000);
    const config = [
      'buffers { size_kb: 32768 fill_policy: RING_BUFFER }',
      'data_sources { config { name: "android.surfaceflinger.frametimeline" } }',
      'data_sources { config { name: "linux.process_stats" target_buffer: 0 process_stats_config { scan_all_processes_on_start: true } } }',
      `duration_ms: ${ms}`,
    ].join('\n');
    const started = await this.device.shell(
      `echo '${config}' | perfetto --txt -c - -o ${remote} --background 2>&1`,
      20_000,
    );
    const pid = Number(/^(\d+)\s*$/m.exec(started)?.[1]);
    if (!pid)
      throw new DeviceError(
        'UNSUPPORTED',
        `perfetto did not start: ${started.trim().slice(0, 200)}`,
      );
    try {
      if (during) await during();
      const end = Date.now() + ms + 15_000;
      while (
        Date.now() < end &&
        (await this.device.shell(`[ -d /proc/${pid} ] && echo up`)).includes('up')
      )
        await new Promise((r) => setTimeout(r, 300));
      const trace = await this.device.shellBuffer(`cat ${remote}`, 60_000);
      if (trace.length === 0) throw new DeviceError('INTERNAL', 'the trace is empty');
      const dir = await mkdtemp(join(tmpdir(), 'appdyno-trace-'));
      try {
        const file = join(dir, 'trace.pftrace');
        const query = join(dir, 'frames.sql');
        await writeFile(file, trace);
        await writeFile(
          query,
          `SELECT a.ts, a.dur, a.jank_type FROM actual_frame_timeline_slice a JOIN process p USING (upid) WHERE p.name = '${pkg}' ORDER BY a.ts;`,
        );
        const { stdout } = await run(tp, ['-q', query, file], {
          timeout: 120_000,
          maxBuffer: 64 * 1024 * 1024,
        });
        return { value: parseFrameTimelineCsv(stdout), raw: stdout, at: at() };
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    } finally {
      await this.device.shell(`rm -f ${remote}`).catch(() => undefined);
    }
  }
}
