import { must, type LogLevel, type LogMark, type LogsAnswer, type LogsQuery } from '@appdyno/core';
import { type Adb, shq } from './adb.js';
import { parseExitInfo } from './crashes.js';

const LEVEL: Record<LogLevel, string> = {
  verbose: 'V',
  debug: 'D',
  info: 'I',
  warn: 'W',
  error: 'E',
};

/**
 * The `logcat` command of a query. `since` is held against the device's clock: shortcut: an untimed query gives the
 * host's, which a phone may be seconds off; a timed one has measured the difference and gives the device's own.
 */
export const logcatCommand = (
  pid: string,
  q: Pick<LogsQuery, 'since' | 'level' | 'maxLines' | 'timed'>,
) =>
  `logcat -d --pid=${pid} -v threadtime${q.timed ? ' -v epoch' : ''} ${q.since ? `-t ${(q.since / 1000).toFixed(3)}` : `-t ${q.maxLines}`} '*:${LEVEL[q.level]}'`;

const RANK: Record<string, LogMark['level']> = { W: 'warn', E: 'error', F: 'error' };

/** `1793841365.998  6178  6178 I Choreographer: …`, as `-v epoch` prints a line; a line of no such shape has no place. */
export const markOfLine = (line: string): LogMark | undefined => {
  const m = /^\s*(\d+)\.(\d{3})\s+\d+\s+\d+\s+([VDIWEFA])\s/.exec(line);
  if (!m) return undefined;
  const level = RANK[must(m[3], 'a level')];
  return { at: Number(m[1]) * 1000 + Number(m[2]), ...(level && { level }) };
};

/** A line's head as logcat prints it, its time to the millisecond, process, thread, rank and tag: `… E Tag: `. */
const HEAD = /^\s*\S+(?: \S+)?\s+\d+\s+\d+ [VDIWEFA] .*?: /;

/**
 * How many more lines logcat is asked for than a count wants: a count can begin inside a message, and the oldest of
 * those read, that one among them, are then left out.
 */
const PAST = 200;

/** Each message whole: logcat prints every line of one with its head, and those after the first are joined without. */
function messagesOf(lines: string[]) {
  const out: string[] = [];
  let last: string | undefined;
  for (const line of lines) {
    const head = HEAD.exec(line)?.[0];
    if (head !== undefined && head === last)
      out.push(`${out.pop() ?? ''}\n${line.slice(head.length)}`);
    else out.push(line);
    last = head;
  }
  return out;
}

export async function androidLogs(adb: Adb, serial: string, q: LogsQuery): Promise<LogsAnswer> {
  const live = q.pid ?? (await adb.exec(serial, `pidof ${shq(q.app)}`)).trim().split(/\s+/)[0];
  // a phone ends a crashed process at once, where an emulator's dialog holds it, and may start the app anew: what it
  // wrote as it died is under the pid that died
  const died = q.pid
    ? undefined
    : parseExitInfo(await adb.exec(serial, `dumpsys activity exit-info ${shq(q.app)}`))[0]?.pid;
  const ended = died !== live ? died : undefined;
  if (!live && !ended)
    return {
      lines: [],
      source: 'logcat',
      note: `${q.app} is not running, so it has no log to read by process; its crash and exit reports say why it ended`,
    };
  // shortcut: an ended pid the system gave another process is left out only while that one runs; `since` keeps the
  // rest to the time after the last action
  const asked = { ...q, maxLines: q.maxLines + PAST };
  const out = await adb.exec(
    serial,
    [
      ...(ended ? [`[ -e /proc/${ended} ] || ${logcatCommand(ended, asked)}`] : []),
      ...(live ? [logcatCommand(live, asked)] : []),
    ].join('; '),
  );
  const source = `logcat --pid=${[ended, live].filter(Boolean).join(',')}`;
  const note = live
    ? undefined
    : `${q.app} is not running: these are the lines of its process that ended; its crash and exit reports say why it ended`;
  const printed = out.split(/\r?\n/).filter((l) => l && !l.startsWith('--------- beginning of'));
  const messages = messagesOf(printed);
  // the newest as many as asked, of more read: a message the count began inside is among those left out. shortcut: one
  // of more than PAST lines, that the count began inside, is given from where the count began
  const lines = q.since ? messages : messages.slice(-q.maxLines);
  if (!q.timed) return { lines, source, ...(note && { note }) };
  const placed = lines.flatMap((line) => {
    const mark = markOfLine(line);
    // its time is in its mark, and stands on the page's clock: here it would be a long number to read past
    return mark ? [{ line: line.replace(/^\s*\d+\.\d{3}\s+/, ''), mark }] : [];
  });
  return {
    lines: placed.map((p) => p.line),
    marks: placed.map((p) => p.mark),
    source,
    ...(note && { note }),
  };
}
