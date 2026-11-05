import { rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { joinVideos, readVideo, type RecordingHandle, type ScreenRecorder } from '@appdyno/core';
import type { VideoFacts } from '@appdyno/perf';
import { placeVideo } from './sources.js';

type Segment = { file: string; startedAt: number };
type Running = Segment & { handle: RecordingHandle };

export type RingVideo = { file: string; facts: VideoFacts; withinMs: number };

/** Kept finished, beside the one being made: two of a half of what is asked for hold all of it, whenever it ends. */
const FINISHED = 2;

/**
 * The last moments of a screen, in segments on this Mac that overlap, so that nothing falls between two. What it holds
 * is bounded by the length of a segment and a recorder's light rate. One thing at a time: a turn that comes while the
 * last is under way waits for it, so a ring that is closing starts nothing new.
 */
export class VideoRing {
  private done: Segment[] = [];
  private current: Running | undefined;
  private count = 0;
  private closed = false;
  private turn: Promise<unknown> = Promise.resolve();
  /** The running segment's handle, for whoever has to end it if this process cannot. */
  onHandle: (handle: RecordingHandle, file: string) => void = () => undefined;

  constructor(
    private readonly recorder: ScreenRecorder,
    private readonly dir: string,
    /** How long a segment runs; past three times that one ends by itself, if nothing is left to end it. */
    private readonly segmentSeconds: number,
    private readonly offsetMs: number,
  ) {}

  private inTurn<T>(work: () => Promise<T>): Promise<T> {
    const next = this.turn.then(work, work);
    this.turn = next.catch(() => undefined);
    return next;
  }

  /** Starts a new segment, and only then ends the one before it. */
  rotate() {
    return this.inTurn(async () => {
      if (this.closed) return;
      const file = join(this.dir, `segment-${++this.count}.${this.recorder.extension}`);
      const handle = await this.recorder.start(file, {
        maxSeconds: this.segmentSeconds * 3,
        light: true,
      });
      const before = this.current;
      this.current = { file, startedAt: Date.now(), handle };
      this.onHandle(handle, file);
      if (before) await this.finish(before);
      while (this.done.length > FINISHED) await rm(this.done.shift()!.file, { force: true });
    });
  }

  private async finish({ file, startedAt, handle }: Running) {
    await this.recorder.stop(handle);
    this.done.push({ file, startedAt });
  }

  private endRunning() {
    const running = this.current;
    this.current = undefined;
    this.closed = true;
    return running;
  }

  private async placed(s: Segment) {
    const place = await placeVideo(s.file, this.recorder, s.startedAt, this.offsetMs);
    return { ...place, durationMs: (await readVideo(s.file)).durationMs };
  }

  /** Ends what runs and gives what is kept as one video in `out`; the newest segment alone where they will not join. */
  seal(out: string): Promise<RingVideo | undefined> {
    return this.inTurn(async () => {
      const running = this.endRunning();
      if (running) await this.finish(running);
      const read = await Promise.all(
        this.done.map((s) =>
          this.placed(s).then(
            (p) => ({ ...p, file: s.file }),
            () => undefined,
          ),
        ),
      );
      const good = read.flatMap((p) => (p ? [p] : []));
      const newest = good.at(-1);
      if (!newest) return undefined;
      const joined = await joinVideos(
        good.map((g) => g.file),
        out,
      ).then(
        () => good.length > 1,
        () => false,
      );
      const parts = joined ? good : [newest];
      const file = joined ? out : newest.file;
      let s = 0;
      const map = parts.map((p) => {
        const part = { at: p.facts.firstAt, s };
        s += p.durationMs / 1_000;
        return part;
      });
      return {
        file,
        facts: {
          ...newest.facts,
          bytes: (await stat(file)).size,
          firstAt: map[0]!.at,
          ...(map.length > 1 && { parts: map }),
        },
        withinMs: Math.max(...parts.map((p) => p.withinMs)),
      };
    });
  }

  /** Ends what runs and leaves nothing of it. */
  drop() {
    return this.inTurn(async () => {
      const running = this.endRunning();
      if (running) await this.recorder.stop(running.handle).catch(() => undefined);
      for (const s of this.done.splice(0)) await rm(s.file, { force: true });
    });
  }
}
