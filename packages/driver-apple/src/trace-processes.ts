import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import { run } from '@appdyno/core';

/**
 * Waits for one post of `note`, for `capS` at most however this process ends: an alarm is a process's own and outlives
 * its exec, so a server killed mid-recording leaves no watcher behind, where `notifyutil -w` waited for days.
 */
export const noteWatcher = (note: string, capS: number) =>
  spawn(
    '/usr/bin/perl',
    ['-e', 'alarm shift; exec @ARGV', String(capS), '/usr/bin/notifyutil', '-1', note],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  );

/**
 * The trace tool's word that its recording started, by `note`, or `waitMs` on: what a recording's `during` waits for.
 * The watcher ends by itself a little after that, whoever is left to end it.
 */
export function startWord(note: string, waitMs: number) {
  const watcher = noteWatcher(note, waitMs / 1000 + 10);
  const started = new Promise<void>((resolve) => {
    // it prints the name when the note comes, and ends
    watcher.stdout.once('data', () => resolve());
    watcher.once('exit', () => resolve());
    watcher.once('error', () => resolve());
    // a tool that never says: `during` runs anyway, and the result shows what it caught
    setTimeout(resolve, waitMs).unref();
  });
  return { started, end: () => watcher.kill() };
}

/** The children of a running process by their name. */
export async function childrenNamed(pid: number, name: string): Promise<number[]> {
  const { stdout } = await run('pgrep', ['-P', String(pid), '-x', name]).catch(() => ({
    stdout: '',
  }));
  return stdout.split('\n').filter(Boolean).map(Number);
}

/**
 * Ends what a process left behind of its children, by their pids: each one launchd now holds that still runs `name`,
 * and so no process another took the pid for.
 */
export async function endLeftBehind(pids: Iterable<number>, name: string) {
  for (const pid of pids) {
    const { stdout } = await run('ps', ['-o', 'ppid=,comm=', '-p', String(pid)]).catch(() => ({
      stdout: '',
    }));
    const [, ppid, command] = /^\s*(\d+)\s+(.*)$/.exec(stdout.trim()) ?? [];
    if (ppid !== '1' || !command || basename(command) !== name) continue;
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // gone meanwhile
    }
  }
}
