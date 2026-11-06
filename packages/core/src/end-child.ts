import type { ChildProcess } from 'node:child_process';

export type EndChild = {
  /** How long it has after each signal, and after the kill. */
  graceMs: number;
  /** All it started too: it was spawned `detached`, and leads a group of its own. */
  group?: boolean;
  /** What it is asked by, in turn, before the one it cannot refuse. */
  signals?: NodeJS.Signals[];
};

/**
 * Ends a child, and answers when it has: once its streams close, and within a grace of its kill however it behaves,
 * as what it started and let go can hold a stream open for ever.
 */
export async function endChild(
  child: ChildProcess,
  { graceMs, group = false, signals = ['SIGTERM'] }: EndChild,
) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  let closed = false;
  const whenClosed = new Promise<void>((done) => {
    child.once('close', () => {
      closed = true;
      done();
    });
  });
  const send = (signal: NodeJS.Signals) => {
    try {
      if (group) process.kill(-child.pid!, signal);
      else child.kill(signal);
    } catch {
      // nothing of it is left
    }
  };
  for (const signal of [...signals, 'SIGKILL'] as const) {
    if (closed) return;
    send(signal);
    await new Promise<void>((done) => {
      const timer = setTimeout(done, graceMs);
      void whenClosed.then(() => {
        clearTimeout(timer);
        done();
      });
    });
  }
  child.stdout?.destroy();
  child.stderr?.destroy();
}
