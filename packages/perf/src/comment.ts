import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { answerOf, type GateAnswer, type GateStatus } from './answer.js';
import { answerMarkdown } from './answer-text.js';
import { reportKey } from './report.js';
import {
  latestRuns,
  loadAnswer,
  loadBaseline,
  loadBudgets,
  runKeys,
  type RunKey,
} from './store.js';

/** A pull request's comment holds 65,536 characters at most, and the body is cut well under it. */
const MOST_CHARACTERS = 60_000;

const ORDER: GateStatus[] = [
  'regression',
  'over-budget',
  'noisy',
  'refused',
  'few-samples',
  'no-baseline',
  'clear',
];

/** Each key's newest run as the gate reads it, with what `perf why` kept of that very run. No device is touched. */
export async function gateAnswers(
  dir: string,
  projectDir: string,
  filter: Partial<RunKey> = {},
): Promise<GateAnswer[]> {
  const rules = await loadBudgets(projectDir);
  const answers: GateAnswer[] = [];
  for (const key of await runKeys(dir, filter)) {
    const [run = []] = await latestRuns(dir, key);
    const baseline = await loadBaseline(projectDir, key);
    const report = reportKey(key, [run], baseline, rules);
    const kept = await loadAnswer(dir, key);
    answers.push(kept?.run === report.run ? kept : answerOf(report, run, baseline));
  }
  return answers.toSorted((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
}

/** Only what the gate called reads as called: a run under noise or with no baseline is no pass, here of all places. */
const headline = (answers: GateAnswer[]) => {
  const all = answers.length;
  const scenarios = all === 1 ? 'scenario' : 'scenarios';
  const count = (status: GateStatus) => answers.filter((a) => a.status === status).length;
  if (all === 0) return 'no measured run';
  if (count('regression')) return `${count('regression')} of ${all} ${scenarios} got worse`;
  if (count('over-budget')) return `${count('over-budget')} of ${all} ${scenarios} over budget`;
  const open = all - count('clear');
  return open
    ? `${open} of ${all} ${scenarios} not called`
    : `no regression in ${all} ${scenarios}`;
};

/** A pull request's comment as Markdown: every word that comes from the app is escaped by `answerMarkdown`. */
export function commentOf(answers: GateAnswer[]): string {
  const body = [`## appdyno: ${headline(answers)}`, ...answers.map(answerMarkdown)].join('\n\n');
  return body.length <= MOST_CHARACTERS
    ? `${body}\n`
    : `${body.slice(0, MOST_CHARACTERS)}\n\nCut here: the kept answers hold the rest.\n`;
}

/** The comment as a file: posting it is the job of whoever runs this, with their own token. */
export async function writeComment(
  dir: string,
  projectDir: string,
  file: string,
  filter: Partial<RunKey> = {},
) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, commentOf(await gateAnswers(dir, projectDir, filter)));
  return file;
}
