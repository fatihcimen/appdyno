/**
 * Commands on one device never overlap: each starts after every earlier one has settled (resolved or
 * failed). The command's own timeout starts when it starts, never while it waits.
 */
export class DeviceQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private queued = 0;

  /** A command runs or waits: one given now waits for it. */
  get busy() {
    return this.queued > 0;
  }

  run<T>(fn: () => Promise<T>): Promise<T> {
    this.queued++;
    const run = this.tail.then(fn);
    const settled = () => {
      this.queued--;
    };
    this.tail = run.then(settled, settled);
    return run;
  }
}
