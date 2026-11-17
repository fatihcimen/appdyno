import { tally, type Contents, type RunCase, type RunRecord } from './run-record.js';

/** How many cases a verdict names before it sends its reader to the page. */
const MAX_CASE_LINES = 30;

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A length of time as a line says it: 42s, 6m12s. */
export const took = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
};

/** The run in one line, the verdict first: what a job's log, a pull request and the page all open with. */
export function verdictLine(r: RunRecord) {
  const t = tally(r.cases);
  const devices = new Set(r.cases.map((c) => c.device)).size || r.devices.length;
  return [
    `${r.verdict}: ${t.passed} passed, ${t.flaky} flaky, ${t.failed} failed`,
    ...(t.notRun > 0 ? [`, ${t.notRun} not run`] : []),
    ` on ${count(devices, 'device')} in ${took(Date.parse(r.ended) - Date.parse(r.began))}`,
    ...(r.shard ? [`, shard ${r.shard.i}/${r.shard.n}`] : []),
  ].join('');
}

/** A teardown that failed under the case. */
const tornBadly = (c: RunCase) => !!c.teardown && !c.teardown.ok;

/** The cases a reader has to look at, the failed ones first: all but those that passed with nothing left behind. */
export const notable = (r: RunRecord) => {
  const rank = (c: RunCase) => ['failed', 'not_run', 'flaky', 'passed'].indexOf(c.outcome);
  return r.cases
    .filter((c) => c.outcome !== 'passed' || tornBadly(c) || !!c.cleanup?.length)
    .sort((a, b) => rank(a) - rank(b));
};

/** What a case came to, in a word: one that passed is here for what it left behind. */
export const wordOf = (c: RunCase) =>
  c.outcome === 'passed'
    ? tornBadly(c)
      ? 'TEARDOWN FAILED'
      : 'CLEANUP FAILED'
    : { failed: 'FAIL', not_run: 'NOT RUN', flaky: 'FLAKY' }[c.outcome];

/** The failure a line shows for a case: its last, or the teardown's where its own steps passed. */
export const failureOf = (c: RunCase) => c.attempts.findLast((a) => a.failure);

/** Why a case is to be looked at: its failure, the teardown's, why it did not run, and what it left uncleaned. */
export const saidOf = (c: RunCase) =>
  [
    c.outcome === 'not_run'
      ? c.why
      : c.outcome === 'passed'
        ? c.teardown?.failed[0]
        : failureOf(c)?.failure?.message,
    c.cleanup?.[0],
  ]
    .filter(Boolean)
    .join('; ') || 'failed';

/** The names a rerun's line leaves out, as what to do about them. */
export const needsLine = (needs: string[] | undefined) =>
  needs?.length ? `set ${needs.join(', ')} in the environment or an env file` : undefined;

/**
 * `verdict.txt`: the verdict's line, why where it failed, then a line for each case that failed, was flaky or did not
 * run, with its picture and the command that runs it alone. `pathOf` turns a path under the run's folder into one the
 * reader can open.
 */
export function verdictText(r: RunRecord, pathOf: (under: string) => string) {
  const cases = notable(r);
  const lines = cases.slice(0, MAX_CASE_LINES).map((c) => {
    const shot = failureOf(c)?.evidence.shot;
    const needs = needsLine(c.needs);
    return [
      `${wordOf(c)} ${c.device} ${c.label} ${saidOf(c)}`,
      ...(shot ? [pathOf(shot)] : []),
      `rerun: ${c.rerun}${needs ? ` (${needs})` : ''}`,
    ].join(' | ');
  });
  return [
    verdictLine(r),
    ...(r.why.length > 0 ? [`because: ${r.why.join('; ')}`] : []),
    ...lines,
    ...(cases.length > lines.length
      ? [`and ${cases.length - lines.length} more: see ${pathOf('index.html')}`]
      : []),
    '',
  ].join('\n');
}

const MB = 1024 * 1024;

/** What a run's folder holds, a line a kind, the least hidden first: read before the folder is sent to anyone. */
export function holdsLines(c: Contents) {
  return [
    ...(c.videos > 0
      ? [
          `${count(c.videos, 'video')}, NOT painted: anything shown on screen is in them, typed passwords included`,
        ]
      : []),
    `${count(c.shots, 'picture')}: a failure's is painted over where an element is a password field or holds a listed secret (${c.painted} had one); text drawn with no element behind it is not, and neither is a picture a screenshot step saved`,
    `${count(c.trees, 'screen tree')}, ${count(c.logs, 'log tail')} and ${count(c.crashes, 'crash report')}, with listed secrets and what looks like a credential hidden`,
    count(c.hars, 'network capture'),
    ...(c.without?.length ? [`left out of this copy: ${c.without.join(', ')}`] : []),
    `${(c.bytes / MB).toFixed(1)} MB. Listed secrets: ${c.secretsListed}.`,
  ];
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

/** The app, the commit and the devices of a run, a line each: what was tested, on what. */
export function factsOf(r: RunRecord) {
  const apps = [
    ...new Set(
      r.cases.flatMap((c) =>
        c.app
          ? [
              `${c.app.id}${c.app.version ? ` ${c.app.version}` : ''}${c.app.build ? ` (${c.app.build})` : ''}`,
            ]
          : [],
      ),
    ),
  ];
  return [
    ...(apps.length > 0 ? [`app: ${apps.join(', ')}`] : []),
    ...(r.repo
      ? [
          `commit: ${r.repo.commit.slice(0, 12)}${r.repo.branch ? ` on ${r.repo.branch}` : ''}${r.repo.dirty ? ', with changes not committed' : ''}`,
        ]
      : []),
    ...r.devices.map(
      (d) =>
        `device: ${d.name} (${d.serial}), ${d.os}${d.virtual ? ', virtual' : ''}${
          Object.keys(d.conditions).length > 0
            ? `; ${Object.entries(d.conditions)
                .map(([k, v]) => `${k} ${v}`)
                .join(', ')}`
            : ''
        }`,
    ),
    `appdyno ${r.tool.version} on ${r.host.os} ${r.host.arch}, load ${r.host.load1.toFixed(1)}`,
  ];
}

/**
 * A pull request's text for the run, as Markdown: the verdict, the cases to look at with a link to each one's picture,
 * what was tested, the commands that run each again, and what the report holds. No picture is in it, as a pull
 * request's text holds no file: each link is a path inside the run's folder, as a job uploads it.
 */
export function prBody(r: RunRecord) {
  const cases = notable(r);
  const shown = cases.slice(0, MAX_CASE_LINES);
  const needs = needsLine([...new Set(shown.flatMap((c) => c.needs ?? []))]);
  return [
    `## appdyno test: ${r.verdict}`,
    '',
    verdictLine(r),
    ...(r.why.length > 0 ? ['', `Because: ${r.why.join('; ')}.`] : []),
    ...(shown.length > 0
      ? [
          '',
          '| | device | file | what | picture |',
          '| --- | --- | --- | --- | --- |',
          ...shown.map((c) => {
            const shot = failureOf(c)?.evidence.shot;
            return `| ${wordOf(c)} | ${cell(c.device)} | ${cell(c.label)} | ${cell(saidOf(c))} | ${shot ? `[picture](${shot})` : ''} |`;
          }),
          ...(cases.length > shown.length ? ['', `And ${cases.length - shown.length} more.`] : []),
          '',
          'To run each again:',
          '',
          '```sh',
          ...shown.map((c) => c.rerun),
          '```',
          ...(needs ? ['', `Before that, ${needs}.`] : []),
        ]
      : []),
    '',
    ...factsOf(r).map((f) => `- ${f}`),
    '',
    `The whole report is \`index.html\` in the run's folder, which the links above are paths in. It holds: ${holdsLines(r.contents).join('; ')}`,
    '',
  ].join('\n');
}
