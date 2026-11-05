import type { MotionWatch } from './port.js';
import type { ViewerLink, ViewerMessage } from './viewer.js';

/** What a viewer is asked to time, and answers for later. */
export class ViewerAsks {
  private readonly marks: ((ms: number) => void)[] = [];
  private readonly watches = new Map<string, (m: MotionWatch) => void>();
  private count = 0;

  constructor(
    private readonly viewer: () => ViewerLink | undefined,
    /** A picture a still screen goes on sending says nothing: only a bigger one is an answer. */
    private readonly sendsWhenStill: () => boolean,
  ) {}

  /** What moved in the stream's frames for this long, read by the viewer that has them decoded. */
  watch(ms: number, strip: boolean): Promise<MotionWatch> {
    const id = String(++this.count);
    this.viewer()?.send({ op: 'watch', id, ms, strip });
    return new Promise((r) => this.watches.set(id, r));
  }

  /** The time from now to the next frame to arrive; for the bench, around an input. */
  mark(): Promise<number> {
    this.viewer()?.send({ op: 'mark', bigger: this.sendsWhenStill() });
    return new Promise((r) => this.marks.push(r));
  }

  marked(ms: number) {
    this.marks.splice(0).forEach((r) => r(ms));
  }

  watched(m: ViewerMessage) {
    this.watches.get(String(m.id))?.(m as unknown as MotionWatch);
    this.watches.delete(String(m.id));
  }
}
