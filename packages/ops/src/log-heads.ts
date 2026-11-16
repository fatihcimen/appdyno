/** A line's day before its time: `11-14 ` as logcat prints it, `2026-11-05 ` as a simulator's log does. */
const DAY = /^(\d{4}-\d\d-\d\d|\d\d-\d\d) (?=\d\d:\d\d:\d\d\.\d{3} )/;

/** What names a line's process once its day is gone, and the line without it. */
const PROCESS: { head: RegExp; named: (m: RegExpExecArray) => string; rest: string }[] = [
  // logcat -v threadtime: `22:59:52.313  4242  4250 E Tag: …`, its process and its thread
  {
    head: /^(\d\d:\d\d:\d\d\.\d{3}) +(\d+) +(?=\d+ [VDIWEFA] )/,
    named: (m) => `pid ${m[2] ?? ''}`,
    rest: '$1 ',
  },
  // a simulator's log: `04:46:59.959 Df App[1:2] …`, its process and its thread
  {
    head: /^(\d\d:\d\d:\d\d\.\d{3} \S+ +)(\S+?\[\d+):(\w+)\] /,
    named: (m) => `${m[2] ?? ''}]`,
    rest: '$1$3 ',
  },
];

/** Fewer lines than this save nothing over the line that says what they left out. */
const MIN_LINES = 3;

/**
 * A log's lines without what each of them repeats, and that, to say once: the day, and then the process. Only what
 * every line has the same is left out, so a log that runs past midnight keeps its days, and one of two processes
 * keeps them. A message of several lines has its head on the first.
 */
export function sharedHead(lines: string[]): { lines: string[]; shared: string[] } {
  if (lines.length < MIN_LINES) return { lines, shared: [] };
  const same = (values: (string | undefined)[]) =>
    values[0] !== undefined && values.every((v) => v === values[0]) ? values[0] : undefined;
  const day = same(lines.map((l) => DAY.exec(l)?.[1]));
  if (!day) return { lines, shared: [] };
  const timed = lines.map((l) => l.replace(DAY, ''));
  for (const { head, named, rest } of PROCESS) {
    const process = same(
      timed.map((l) => {
        const m = head.exec(l);
        return m ? named(m) : undefined;
      }),
    );
    if (process) return { lines: timed.map((l) => l.replace(head, rest)), shared: [day, process] };
  }
  return { lines: timed, shared: [day] };
}
