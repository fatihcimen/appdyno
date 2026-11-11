import { basename } from 'node:path';
import { type LogLevel, type LogMark, type LogsAnswer, type LogsQuery, must } from '@appdyno/core';
import { assertUdid, type Simctl } from './simctl.js';

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

/** What XCTest logs in the app's process, where appdyno's runner reads the screen and touches: never the app's. */
const RUNNER = 'subsystem != "com.apple.dt.xctest"';

/**
 * Below debug, the app's own lines: its messages, NSLog's among them, and of Apple's frameworks only their errors, but
 * the thousand a simulator's keyboard logs as it draws, and no activity or signpost.
 */
const APP_OWN = [
  'eventType == logEvent',
  'NOT (subsystem == "com.apple.UIKit" AND category == "UIKBRenderingLog")',
  '(NOT subsystem BEGINSWITH "com.apple." OR messageType == error OR messageType == fault)',
];

/**
 * `log show`, the same log `log stream` follows: a stream sees only what comes after it starts, and
 * this answers about the time since the last action.
 */
export function logShowArgs(udid: string, appPath: string, q: LogsQuery): string[] {
  const predicate = [
    `processImagePath CONTAINS "/${basename(appPath)}/"`,
    RUNNER,
    ...(q.level === 'debug' || q.level === 'verbose' ? [] : APP_OWN),
    ...(q.level === 'error' ? ['(messageType == error OR messageType == fault)'] : []),
  ].join(' AND ');
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

/** `2026-11-05 04:46:59.959 Df …`, in this Mac's time zone, which is a simulator's. */
const STAMPED = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)\.(\d{3}) (\w+)\s/;
const STAMP_CHARS = '2026-11-05 04:46:59.959 '.length;

/**
 * Lines with their place on the clock. A message of several lines has its time on the first alone, so the rest go on
 * from it; one with no line before it to go on from has no place, and is left out.
 */
export function placeLines(lines: string[]) {
  const placed: { line: string; mark: LogMark }[] = [];
  for (const line of lines) {
    const m = STAMPED.exec(line);
    if (m) {
      const [y, mo, d, h, mi, s, ms] = m.slice(1, 8).map(Number) as [
        number,
        number,
        number,
        number,
        number,
        number,
        number,
      ];
      const level = /^[EF]/.test(must(m[8], 'a level')) ? ('error' as const) : undefined;
      const at = new Date(y, mo - 1, d, h, mi, s, ms).getTime();
      // its time is in its mark: what is left is what happened
      placed.push({ line: line.slice(STAMP_CHARS), mark: { at, ...(level && { level }) } });
    } else {
      const last = placed.at(-1);
      if (last) placed.push({ line, mark: last.mark });
    }
  }
  return placed;
}

/** Each message whole, its lines after the first joined to it; lines with no message begun before them are left out. */
export function entriesOf(lines: string[]) {
  const out: string[] = [];
  for (const line of lines) {
    if (STAMPED.test(line)) out.push(line);
    else if (out.length > 0) out.push(`${out.pop() ?? ''}\n${line}`);
  }
  return out;
}

export async function simulatorLogs(
  simctl: Simctl,
  udid: string,
  q: LogsQuery,
): Promise<LogsAnswer> {
  const app = await simctl.appContainer(udid, q.app);
  const out = await simctl.exec(logShowArgs(udid, app.trim(), q), 60_000);
  const lines = out
    .split('\n')
    .filter((l) => l && !/^(Timestamp\s|Filtering the log data|Skipping info)/.test(l));
  const source = 'simctl spawn log show';
  if (!q.timed) return { lines: entriesOf(lines), source };
  const placed = placeLines(lines);
  return { lines: placed.map((p) => p.line), marks: placed.map((p) => p.mark), source };
}

/** The whole of what devicectl offers about a running app's log. */
export const PHONE_LOGS_NOTE =
  "devicectl cannot read a running app's log on an iPhone. It can restart the app and follow what it prints: `xcrun devicectl device process launch --console --terminate-existing --device <udid> <bundle>`. The system log is in Console.app; crashes works here. A person can collect the phone's log with `sudo log collect --device-udid <udid> --last 5m --output x.logarchive`: it needs root, so this tool does not.";

export const phoneLogs = (): Promise<LogsAnswer> =>
  Promise.resolve({ lines: [], source: 'devicectl', note: PHONE_LOGS_NOTE });
