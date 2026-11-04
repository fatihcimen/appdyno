import { esc } from '@appdyno/core';
import { answerRows, answerTitle } from '../answer-text.js';
import type { Scenario } from './view.js';

/** The answer of each scenario the gate calls worse: the rows the command line prints and a comment holds. */
export function whySection(scenarios: Scenario[]): string {
  const worse = scenarios.filter((s) => s.answer.status === 'regression');
  if (worse.length === 0) return '';
  const rows = (s: Scenario) =>
    answerRows(s.answer)
      .map((r) => `<dt>${esc(r.label)}</dt><dd>${esc(r.text)}</dd>`)
      .join('');
  return `<h3>Why it got worse</h3>${worse
    .map(
      (s) =>
        `<div class="card why"><h4>${esc(answerTitle(s.answer))}</h4><dl>${rows(s)}</dl></div>`,
    )
    .join('')}`;
}
