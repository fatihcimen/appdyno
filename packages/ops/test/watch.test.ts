import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { deviceStateFile, writeState, type MotionRegion, type MotionWatch } from '@appdyno/core';
import { describe, expect, it, vi } from 'vitest';
import { answerWatches, motionText, movedIn, regionLine } from '../src/watch.js';

const SCREEN = { w: 400, h: 800 };
const band: MotionRegion = {
  kind: 'moves',
  x: 0,
  y: 0.15,
  w: 1,
  h: 0.05,
  axis: 'x',
  sign: -1,
  speed: 0.2,
  events: [],
};
const watch = (regions: MotionRegion[], noisy = false): MotionWatch => ({
  summary: { frames: 120, ms: 2_000, noisy, regions },
});

describe('what a watch says', () => {
  it('gives a smooth band in the units of a tap', () => {
    expect(regionLine(band, SCREEN, 2_000)).toBe('y 120-160: moves left at 80/s, smoothly');
  });

  it('says what broke it, and when', () => {
    const line = regionLine(
      {
        ...band,
        events: [
          { kind: 'jump', at: 1_200, by: -0.1 },
          { kind: 'back', at: 1_800, by: 0.02 },
        ],
      },
      SCREEN,
      2_000,
    );
    expect(line).toBe('y 120-160: moves left at 80/s, jumped 40 at 1.2 s, ran backwards at 1.8 s');
  });

  it("calls an edge inside the screen cut, and the screen's own no such thing", () => {
    expect(regionLine({ ...band, w: 0.6 }, SCREEN, 2_000)).toContain('cut at x 240');
    expect(regionLine(band, SCREEN, 2_000)).not.toContain('cut');
  });

  it('claims no cut for what has not travelled that far', () => {
    expect(regionLine({ ...band, w: 0.6 }, SCREEN, 500)).not.toContain('cut');
  });

  it('warns of a video or a game', () => {
    expect(motionText(watch([band], true), SCREEN)).toContain('read this as noise');
  });

  it('warns of a stream that sent few frames', () => {
    const few = { summary: { frames: 10, ms: 2_000, noisy: false, regions: [band] } };
    expect(motionText(few, SCREEN)).toContain('few frames came');
  });

  it('says nothing moved, on a still screen and on a stream that sent nothing', () => {
    expect(motionText(watch([]), SCREEN)).toContain('nothing moved');
    expect(
      motionText({ summary: { frames: 0, ms: 0, noisy: false, regions: [] } }, SCREEN),
    ).toContain('nothing new');
  });

  it('keeps its first lines short, the rest counted', () => {
    const many = Array.from({ length: 9 }, () => band);
    const text = motionText(watch(many), SCREEN);
    expect(text.split('\n')).toHaveLength(8);
    expect(text).toContain('and 3 smaller');
  });

  it('asks whether something moved in a box', () => {
    const m = watch([band]);
    expect(movedIn(m, SCREEN)).toBe(true);
    expect(movedIn(m, SCREEN, { x: 0, y: 130, w: 50, h: 10 })).toBe(true);
    expect(movedIn(m, SCREEN, { x: 0, y: 500, w: 50, h: 10 })).toBe(false);
    expect(movedIn(watch([{ ...band, kind: 'changes' }]), SCREEN)).toBe(false);
  });

  it('holds "must keep still" to a spinner or a video too, in the box it is asked of', () => {
    const spinner = watch([{ ...band, kind: 'changes' }]);
    expect(movedIn(spinner, SCREEN, undefined, true)).toBe(true);
    expect(movedIn(spinner, SCREEN, { x: 0, y: 130, w: 50, h: 10 }, true)).toBe(true);
    expect(movedIn(spinner, SCREEN, { x: 0, y: 500, w: 50, h: 10 }, true)).toBe(false);
    expect(movedIn(watch([]), SCREEN, undefined, true)).toBe(false);
  });
});

describe('a window that shares its stream', () => {
  it('asks nothing of a session with no request', () => {
    const watching = vi.fn();
    answerWatches('phone', { watch: watching })();
    expect(watching).not.toHaveBeenCalled();
  });

  it('takes a request once, and answers it by file under its id', async () => {
    const watching = vi.fn(() => Promise.resolve({ why: 'no picture' }));
    const answerFile = deviceStateFile('watch', 'phone.answer');
    writeState(deviceStateFile('watch', 'phone'), { id: 'a', ms: 10, strip: false });
    const look = answerWatches('phone', { watch: watching });
    look();
    look();
    expect(watching).toHaveBeenCalledExactlyOnceWith(10, false);
    await vi.waitFor(() => expect(existsSync(answerFile)).toBe(true));
    expect(JSON.parse(readFileSync(answerFile, 'utf8'))).toEqual({ why: 'no picture', id: 'a' });
  });

  it('reads a broken request as none', () => {
    const watching = vi.fn();
    const file = deviceStateFile('watch', 'phone');
    writeState(file, { id: 'a' });
    answerWatches('phone', { watch: watching })();
    writeFileSync(file, '{"id":');
    answerWatches('phone', { watch: watching })();
    expect(watching).not.toHaveBeenCalled();
  });
});
