import { describe, expect, it, vi } from 'vitest';
import type { Adb } from '../src/adb.js';
import { AndroidRecorder } from '../src/record.js';

/** A device whose folder reads as `reads` says, one read at a time, the last for ever. */
const saying = (...reads: string[]) =>
  new AndroidRecorder(
    {
      startDetached: async () => ({ close: () => undefined }),
      exec: async (_serial: string, command: string) =>
        command.startsWith('rm') ? '' : reads.length > 1 ? reads.shift()! : reads[0]!,
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
