import { spawn } from 'node:child_process';

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
 * The trace tool's word that its recording started, by `note`: what a recording's `during` waits for, and whether it
 * came within `waitMs`. The watcher ends by itself a little after that, whoever is left to end it.
 */
export function startWord(note: string, waitMs: number) {
  const watcher = noteWatcher(note, waitMs / 1000 + 10);
  const started = new Promise<boolean>((resolve) => {
    // it prints the name when the note comes, and ends
    watcher.stdout.once('data', () => resolve(true));
    // a watcher gone tells nothing either way: the recording goes on as one that started
    watcher.once('exit', () => resolve(true));
    watcher.once('error', () => resolve(true));
    setTimeout(() => resolve(false), waitMs).unref();
  });
  return { started, end: () => watcher.kill() };
}
