import { describe, expect, it, vi } from 'vitest';
import type { Adb } from '../src/adb.js';
import { AndroidRecorder } from '../src/record.js';

/** A device whose folder reads as `reads` says, one read at a time, the last for ever. */
const saying = (...reads: string[]) =>
  new AndroidRecorder(
    {
      startDetached: () => Promise.resolve({ close: () => undefined }),
      exec: (_serial: string, command: string) =>
        Promise.resolve(
          command.startsWith('rm') ? '' : reads.length > 1 ? reads.shift() : reads[0],
        ),
    } as unknown as Adb,
    'R58M',
  );

const started = (r: AndroidRecorder) => r.start('out.mp4', { maxSeconds: 10 });

describe('a recording that starts', () => {
  it('is up once its file holds something', async () => {
    await expect(started(saying('', 'made\n', 'up\nmade\n'))).resolves.toMatchObject({
      file: 'out.mp4',
    });
  });

  it('refuses at once where no encoder is free, as its file is made and dies empty', async () => {
    const log = 'Encoder failed (err=-38)\nscreenrecord exited with 235\n';
    await expect(started(saying('made\n', `${log}made\n`))).rejects.toThrow(
      /did not start: Encoder failed/,
    );
  });

  it('takes a file still empty for a moment as a device with nothing to draw', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    try {
      const up = started(saying('made\n'));
      await vi.advanceTimersByTimeAsync(2_500);
      await expect(up).resolves.toMatchObject({ file: 'out.mp4' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a recording that may have ended by itself', () => {
  const DIR = '/data/local/tmp/appdyno/video-0123abcd';
  const asking = (answer: string) => {
    const asked: string[] = [];
    const r = new AndroidRecorder(
      {
        exec: (_serial: string, command: string) => {
          asked.push(command);
          return Promise.resolve(answer);
        },
      } as unknown as Adb,
      'R58M',
    );
    return { asked, endedAt: (dir = DIR) => r.endedAt({ dir, file: 'out.mp4' }) };
  };

  it('runs while the device says nothing, as its screenrecord is up', async () => {
    const { asked, endedAt } = asking('');
    await expect(endedAt()).resolves.toBeUndefined();
    // looked at twice a second apart before it is called ended, as between segments none runs for a moment
    expect(asked[0]).toMatch(/^cd \/data\/local\/tmp\/appdyno\/video-0123abcd 2>/);
    expect(asked[0]).toContain('sleep 1;');
    expect(asked[0]).toContain('[ -e done ] || touch done');
  });

  it('ended as long ago as the device says its last write was, by its own clock', async () => {
    const before = Date.now();
    await expect(asking('42\n').endedAt()).resolves.toBeLessThanOrEqual(before - 42_000 + 50);
    await expect(asking('42\n').endedAt()).resolves.toBeGreaterThan(before - 43_000);
  });

  it('ended at no time it can say when its folder is gone', async () => {
    await expect(asking('gone\n').endedAt()).resolves.toBe(0);
  });

  it('runs, as far as it can tell, where the device says something else', async () => {
    await expect(asking('sh: stat: not found\n').endedAt()).resolves.toBeUndefined();
  });

  it('sends the device no folder but the form its start names', async () => {
    const { asked, endedAt } = asking('');
    await expect(endedAt(`${DIR}; reboot #`)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(asked).toEqual([]);
  });
});

describe('a recording that stops', () => {
  it('sends the device no folder but the form its start names, as a state file may hold any', async () => {
    const asked: string[] = [];
    const r = new AndroidRecorder(
      {
        exec: (_serial: string, command: string) => {
          asked.push(command);
          return Promise.resolve('no-dir');
        },
      } as unknown as Adb,
      'R58M',
    );
    await expect(
      r.stop({ dir: '/data/local/tmp/appdyno/video-1; reboot #', file: 'out.mp4' }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(asked).toEqual([]);
    await expect(
      r.stop({ dir: '/data/local/tmp/appdyno/video-0123abcd', file: 'out.mp4' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(asked[0]).toMatch(/^cd \/data\/local\/tmp\/appdyno\/video-0123abcd \|\|/);
  });
});
