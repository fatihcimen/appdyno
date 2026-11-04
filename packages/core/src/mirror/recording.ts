import type { ViewerLink, ViewerMessage } from './viewer.js';

/** What a movie came to; `why` if it ended early or never began. */
export type RecordingResult = { frames: number; seconds?: number; dropped?: number; why?: string };

/** One movie through a viewer: it starts at a key frame, and the viewer answers for its end. */
export class MirrorRecording {
  private answer: ((r: RecordingResult) => void) | undefined;

  constructor(private readonly viewer: () => ViewerLink | undefined) {}

  start(file: string) {
    this.viewer()?.send({ op: 'record', file });
  }

  stop(timeoutMs = 60_000): Promise<RecordingResult> {
    return new Promise((resolve) => {
      const viewer = this.viewer();
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
