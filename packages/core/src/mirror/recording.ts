import type { ViewerLink, ViewerMessage } from './viewer.js';

/** What a movie came to; `why` if it ended early or never began. */
export type RecordingResult = { frames: number; seconds?: number; dropped?: number; why?: string };

/** One movie's end, as a viewer answers it. */
export class MirrorRecording {
  private answer: ((r: RecordingResult) => void) | undefined;

  stop(viewer: ViewerLink | undefined, timeoutMs = 60_000): Promise<RecordingResult> {
    return new Promise((resolve) => {
      if (!viewer) {
        resolve({ frames: 0, why: 'the window had gone' });
        return;
      }
      const timer = setTimeout(() => {
        this.answer = undefined;
        resolve({ frames: 0, why: 'the recording did not end in time' });
      }, timeoutMs);
      this.answer = (r) => {
        clearTimeout(timer);
        resolve(r);
      };
      viewer.send({ op: 'recordStop' });
    });
  }

  onMessage(m: ViewerMessage) {
    this.answer?.(m as unknown as RecordingResult);
    this.answer = undefined;
  }
}
