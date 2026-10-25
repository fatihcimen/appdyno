/**
 * Commands on one device never overlap: each starts after every earlier one has settled (resolved or
 * failed). The command's own timeout starts when it starts, never while it waits.
 */
export class DeviceQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn);
    this.tail = run.catch(() => undefined);
    return run;
  }
}
