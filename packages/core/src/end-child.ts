import type { ChildProcess } from 'node:child_process';
import { sleep } from './call.js';
import { must } from './must.js';
import { processAlive } from './owner.js';

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
  // set when it closes, which the compiler does not follow into the loop below
  let closed = false as boolean;
  const whenClosed = new Promise<void>((done) => {
    child.once('close', () => {
      closed = true;
      done();
    });
  });
  const send = (signal: NodeJS.Signals) => {
    try {
      if (group) process.kill(-must(child.pid, 'its pid'), signal);
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

export type EndPid = {
  /** What it is asked by, in turn: the last is the last word, as no SIGKILL is added. */
  signals: NodeJS.Signals[];
  /** How long it has to go after each. */
  graceMs: number;
  /** How often it is looked for meanwhile. */
  pollMs: number;
};

/** Ends a process this one did not start, by its pid: each signal in turn, until it has gone. */
export async function endPid(pid: number, { signals, graceMs, pollMs }: EndPid) {
  for (const signal of signals) {
    try {
      process.kill(pid, signal);
    } catch {
      return; // gone already
    }
    const end = Date.now() + graceMs;
    while (processAlive(pid) && Date.now() < end) await sleep(pollMs);
    if (!processAlive(pid)) return;
  }
}
