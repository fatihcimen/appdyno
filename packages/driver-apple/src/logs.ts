import { basename } from 'node:path';
import type { LogLevel, LogsAnswer, LogsQuery } from '@appdyno/core';
import { assertBundle, assertUdid, type Simctl } from './simctl.js';

const pad = (n: number) => String(n).padStart(2, '0');
/** `log`'s --start format, in this machine's time zone (a simulator shares it). */
const localTime = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const LEVEL_FLAGS: Record<LogLevel, string[]> = {
  verbose: ['--info', '--debug'],
  debug: ['--info', '--debug'],
  info: ['--info'],
  warn: [],
  error: [],
};

/**
 * `log show`, the same log `log stream` follows: a stream sees only what comes after it starts, and
 * this answers about the time since the last action.
 */
export function logShowArgs(udid: string, appPath: string, q: LogsQuery): string[] {
  const predicate =
    `processImagePath CONTAINS "/${basename(appPath)}/"` +
    (q.level === 'error' ? ' AND (messageType == error OR messageType == fault)' : '');
  return [
    'spawn',
    assertUdid(udid),
    'log',
    'show',
    '--style',
    'compact',
    ...LEVEL_FLAGS[q.level],
    ...(q.since ? ['--start', localTime(q.since)] : ['--last', '5m']),
    '--predicate',
    predicate,
  ];
}

export async function simulatorLogs(
  simctl: Simctl,
  udid: string,
  q: LogsQuery,
): Promise<LogsAnswer> {
  const app = await simctl.exec(['get_app_container', assertUdid(udid), assertBundle(q.app)]);
  const out = await simctl.exec(logShowArgs(udid, app.trim(), q), 60_000);
  return {
    lines: out
      .split('\n')
      .filter((l) => l && !/^(Timestamp\s|Filtering the log data|Skipping info)/.test(l)),
    source: 'simctl spawn log show',
  };
}

/** The whole of what devicectl offers about a running app's log. */
export const PHONE_LOGS_NOTE =
  "devicectl cannot read a running app's log on an iPhone. It can restart the app and follow what it prints: `xcrun devicectl device process launch --console --terminate-existing --device <udid> <bundle>`. The system log is in Console.app; crashes works here.";

export const phoneLogs = async (): Promise<LogsAnswer> => ({
  lines: [],
  source: 'devicectl',
  note: PHONE_LOGS_NOTE,
});
