import type { MotionWatch } from './port.js';
import type { ViewerLink } from './viewer.js';
import type { ViewerSaid } from './viewer-wire.js';

const NO_VIEWER = 'its window went';

/** What a viewer is asked to time, and answers for later. */
export class ViewerRequests {
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
    const viewer = this.viewer();
    if (!viewer) return Promise.resolve({ why: NO_VIEWER });
    const id = String(++this.count);
    viewer.send({ op: 'watch', id, ms, strip });
    return new Promise((r) => this.watches.set(id, r));
  }

  /** The time from now to the next frame to arrive; for the bench, around an input. */
  mark(): Promise<number> {
    const viewer = this.viewer();
    if (!viewer) return Promise.resolve(Number.NaN);
    viewer.send({ op: 'mark', bigger: this.sendsWhenStill() });
    return new Promise((r) => this.marks.push(r));
  }

  marked(ms: number) {
    this.marks.splice(0).forEach((r) => r(ms));
  }

  watched(m: ViewerSaid<'watched'>) {
    this.watches.get(m.id)?.(m);
    this.watches.delete(m.id);
  }

  /** The viewer went, and with it what it was asked: no one is left to answer these. */
  gone() {
    this.marks.splice(0).forEach((r) => r(Number.NaN));
    this.watches.forEach((r) => r({ why: NO_VIEWER }));
    this.watches.clear();
  }
}
