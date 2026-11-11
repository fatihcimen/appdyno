import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  must,
  pause,
  sleep,
  stateDir,
  tracesDir,
  type FrameStats,
  type FrameTrace,
  type Measured,
} from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import {
  PROBE_LIMITS,
  probeFrames,
  probeHead,
  probeMarks,
  probeSummary,
  probeWindow,
} from './probe.js';
import { assertBundle, type Simctl } from './simctl.js';
import { helperBinary } from './simhelper.js';

const at = () => new Date().toISOString();

/** The probe's file shows what happened only after its next write (every 250 ms). */
const PROBE_FLUSH_MS = 350;

/** What a list coasts on after its swipes. */
const COAST_MS = 1_500;

/** A simulator app's frames by the probe started inside it, which writes them to a file this Mac reads by its clock. */
export class ProbedFrames {
  constructor(
    private readonly udid: string,
    private readonly simctl: Simctl,
    /** The app's process id (it must be running). */
    private readonly pid: (bundle: string) => Promise<number>,
  ) {}

  /** Where the probe in the app writes. */
  file(bundle: string) {
    return join(stateDir(), 'probes', `${this.udid}-${assertBundle(bundle)}.jsonl`);
  }

  /** Whether the app's running process is the one writing the probe's file. */
  private async probed(bundle: string): Promise<boolean> {
    const text = await readFile(this.file(bundle), 'utf8').catch(() => '');
    const { pid } = probeHead(text);
    return pid !== undefined && pid === (await this.pid(bundle).catch(() => undefined));
  }

  private async requireProbe(bundle: string) {
    if (!(await this.probed(bundle)))
      throw new DeviceError(
        'UNSUPPORTED',
        `${bundle} runs without the frame probe`,
        'the probe takes a relaunch of the app with it inside',
      );
  }

  /** The app started afresh with the probe in it; the time its process took to its first frame. */
  async launch(bundle: string, vars: Record<string, string> = {}): Promise<number> {
    const file = this.file(bundle);
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await this.simctl.terminate(this.udid, bundle);
    await rm(file, { force: true });
    const out = await this.simctl.launch(this.udid, bundle, {
      DYLD_INSERT_LIBRARIES: await helperBinary('SimProbe'),
      APPDYNO_PROBE_OUT: file,
      ...vars,
    });
    const pid = Number(/:\s*(\d+)/.exec(out)?.[1]);
    for (const end = Date.now() + 20_000; Date.now() < end;) {
      const head = probeHead(await readFile(file, 'utf8').catch(() => ''));
      if (head.pid === pid && head.launchMs !== undefined) return head.launchMs;
      await pause(50);
    }
    throw new DeviceError(
      'UNSUPPORTED',
      `the frame probe in ${bundle} reported no first frame within 20 s`,
      `its file is at ${file}`,
    );
  }

  /** Relaunches the app with the frame probe unless it runs under it already: true if it did. */
  async attach(bundle: string): Promise<boolean> {
    if (await this.probed(bundle)) return false;
    await this.launch(bundle);
    return true;
  }

  async reset(bundle: string): Promise<void> {
    await this.requireProbe(bundle);
    await appendFile(this.file(bundle), `${JSON.stringify({ reset: Date.now() })}\n`);
  }

  /** The frames since `since`, else the last reset, else the app's start under the probe, then a reset unless told not. */
  async frames(
    bundle: string,
    opts: { reset?: boolean; since?: number } = {},
  ): Promise<Measured<FrameStats>> {
    await this.requireProbe(bundle);
    const to = Date.now();
    await sleep(PROBE_FLUSH_MS);
    const text = await readFile(this.file(bundle), 'utf8');
    const head = probeHead(text);
    const from = opts.since ?? head.resetAt ?? must(head.loadedAt, "the probe's start");
    const raw = probeWindow(text, from, to);
    if (opts.reset !== false) await this.reset(bundle);
    return { value: probeFrames(raw, from, to), raw, at: at() };
  }

  /** What the probe counts to the end of what a list coasts on after `during`: by the clock, which no reset moves. */
  async during(bundle: string, during: () => Promise<unknown>) {
    await this.requireProbe(bundle);
    const from = Date.now();
    await during();
    await sleep(COAST_MS);
    return this.frames(bundle, { reset: false, since: from });
  }

  /** The probe's lines for a window of `seconds`, and `during` too if it takes longer. */
  async trace(
    bundle: string,
    seconds: number,
    during?: () => Promise<unknown>,
  ): Promise<Measured<FrameTrace>> {
    await this.requireProbe(bundle);
    const from = Date.now();
    await Promise.all([during?.(), sleep(seconds * 1000)]);
    const to = Date.now();
    await sleep(PROBE_FLUSH_MS);
    const raw = probeWindow(await readFile(this.file(bundle), 'utf8'), from, to);
    const dir = tracesDir();
    await mkdir(dir, { recursive: true });
    const tracePath = join(dir, `probe-${to}.jsonl`);
    await writeFile(tracePath, `${raw}\n`);
    return {
      value: { kind: 'probe', tracePath, ...probeSummary(raw, from, to) },
      raw: tracePath,
      at: at(),
      source: 'CADisplayLink probe',
    };
  }

  /** The probe's frames from when `during` is called until it ends or `seconds` pass; its process reads this Mac's clock. */
  async marks(bundle: string, seconds: number, during: () => Promise<unknown>) {
    await this.requireProbe(bundle);
    const from = Date.now();
    await Promise.race([during(), sleep(seconds * 1000)]);
    const to = Date.now();
    await sleep(PROBE_FLUSH_MS);
    const raw = probeWindow(await readFile(this.file(bundle), 'utf8'), from, to);
    return {
      value: { frames: probeMarks(raw), limits: PROBE_LIMITS },
      raw,
      at: at(),
      source: 'CADisplayLink probe',
    };
  }
}
