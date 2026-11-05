import {
  compareMetric,
  latestRuns,
  MIN_SAMPLES,
  runKeys,
  type BaselineMetric,
  type Comparison,
  type PerfRecord,
} from '@appdyno/perf';

/** A kept run, as a window's Results says it. */
export type PastMeasure = {
  ok: true;
  title: string;
  value: string;
  detail: string;
  why: string;
  /** A person should look: what was found, or that it could not be judged. */
  flagged: boolean;
  verdict?: 'regression' | 'improvement';
};

const RUNS_READ = 30;
const SHOWN = 20;
const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The number a run is for, by its scenario: the rest of its records say why, on the dashboard. */
const MAINS = [
  {
    scenario: /^launch-cold$/,
    title: 'Cold launch',
    kind: /^launch\.(ttid|first_frame|until)_ms$/,
    value: (v: number) => `${Math.round(v)} ms`,
  },
  {
    scenario: /^scroll-/,
    title: 'Scroll',
    kind: /^frames\.jank_percent$/,
    value: (v: number) => `${Math.round(v)}% jank`,
  },
];

const counted = (n: number, what: string) => `${n} ${what}${n === 1 ? '' : 's'} ago`;

const ago = (at: string, now: number) => {
  const gone = now - Date.parse(at);
  if (gone < MINUTE) return counted(Math.max(1, Math.round(gone / SECOND)), 'second');
  if (gone < HOUR) return counted(Math.round(gone / MINUTE), 'minute');
  if (gone < DAY) return counted(Math.round(gone / HOUR), 'hour');
  return counted(Math.round(gone / DAY), 'day');
};

const signed = (c: Comparison) => {
  const by = Math.round(c.shift ?? 0);
  return `${by > 0 ? '+' : ''}${by} ${c.unit === 'percent' ? '%' : c.unit}`;
};

/** What a comparison comes to in words; none where the number is all there is to say. */
function judged(c: Comparison): Pick<PastMeasure, 'flagged' | 'verdict'> & { words?: string } {
  switch (c.verdict) {
    case 'regression':
      return { flagged: true, verdict: 'regression', words: `Regression ${signed(c)}` };
    case 'improvement':
      return { flagged: false, verdict: 'improvement', words: `Improvement ${signed(c)}` };
    case 'few-samples':
      return {
        flagged: true,
        words: `Could not judge: ${c.n.current} of ${MIN_SAMPLES} samples`,
      };
    case 'noisy':
      return { flagged: true, words: 'Could not judge: measured under load' };
    case 'refused':
      return { flagged: true, words: 'Could not judge: not the same kind of build' };
    default:
      return { flagged: false };
  }
}

const lineOf = (
  main: PerfRecord,
  title: string,
  value: string,
  c: Comparison,
  now: number,
): PastMeasure => {
  const { words, ...verdict } = judged(c);
  return {
    ok: true,
    title: words ?? title,
    value: words ? '' : value,
    detail: words ? `${title} ${value} · ${ago(main.at, now)}` : ago(main.at, now),
    why: main.at,
    ...verdict,
  };
};

/**
 * What was measured on this device, for this app, newest first, each judged by the method the gate uses against the runs
 * before it. It reads files only: nothing is asked of a device, so a phone is not touched for it.
 */
export async function measureHistory(dir: string, app: string, serial: string, now = Date.now()) {
  const lines: { at: string; line: PastMeasure }[] = [];
  for (const key of await runKeys(dir, { app })) {
    const shape = MAINS.find((m) => m.scenario.test(key.scenario));
    if (!shape) continue;
    const runs = (await latestRuns(dir, key, RUNS_READ)).reverse();
    const before: BaselineMetric['runs'] = [];
    for (const records of runs) {
      const main = records.find((r) => shape.kind.test(r.kind));
      if (!main) continue;
      const { samples, build, compile, noise, at, kind, unit, better, value } = main;
      const base = before.length ? { unit, better, runs: [...before] } : undefined;
      const compared = compareMetric(kind, { samples, build, compile, noise }, base, unit, better);
      if (main.device.serial === serial)
        lines.push({ at, line: lineOf(main, shape.title, shape.value(value), compared, now) });
      before.push({ at, samples, build, ...(compile && { compile }), noise });
    }
  }
  return lines
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, SHOWN)
    .map((l) => l.line);
}
