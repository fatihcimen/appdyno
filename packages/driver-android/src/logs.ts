import type { LogLevel, LogsAnswer, LogsQuery } from '@appdyno/core';
import { type Adb, shq } from './adb.js';

const LEVEL: Record<LogLevel, string> = {
  verbose: 'V',
  debug: 'D',
  info: 'I',
  warn: 'W',
  error: 'E',
};

/**
 * The `logcat` command of a query. Shortcut: `since` is the host's clock against the device's, which
 * a phone may be seconds off; upgrade by reading the device's `date +%s` when that misleads.
 */
export const logcatCommand = (pid: string, q: Pick<LogsQuery, 'since' | 'level' | 'maxLines'>) =>
  `logcat -d --pid=${pid} -v threadtime ${q.since ? `-t ${(q.since / 1000).toFixed(3)}` : `-t ${q.maxLines}`} '*:${LEVEL[q.level]}'`;

export async function androidLogs(adb: Adb, serial: string, q: LogsQuery): Promise<LogsAnswer> {
  const pid = (await adb.exec(serial, `pidof ${shq(q.app)}`)).trim().split(/\s+/)[0];
  if (!pid)
    return {
      lines: [],
      source: 'logcat',
      note: `${q.app} is not running, so it has no log to read by process; crashes says why it ended`,
    };
  const out = await adb.exec(serial, logcatCommand(pid, q));
  return {
    lines: out.split(/\r?\n/).filter((l) => l && !l.startsWith('--------- beginning of')),
    source: `logcat --pid=${pid}`,
  };
}
