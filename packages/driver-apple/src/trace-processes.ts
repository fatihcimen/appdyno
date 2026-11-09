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
