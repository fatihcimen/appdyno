import { esc, PAGE_MARK } from '@appdyno/core';
import {
  factsOf,
  failureOf,
  holdsLines,
  needsLine,
  notable,
  saidOf,
  verdictLine,
  wordOf,
  type Evidence,
  type RunCase,
  type RunRecord,
} from '@appdyno/flows';
import { reportPage } from '../report-page.js';

const STYLE = `
.verdict{display:inline-block;font-size:1.75rem;font-weight:700;letter-spacing:-.022em;margin:0;padding:.1rem .8rem;border-radius:10px;color:#fff;background:var(--good)}
.verdict.fail{background:var(--critical)}
table{border-collapse:collapse;font-size:.86rem}th,td{text-align:left;padding:.3rem .8rem;border-bottom:1px solid var(--edge)}
td a{color:inherit}.ok{color:var(--good)}.flaky{color:var(--warning)}
ul{padding-left:1.2rem;margin:.4rem 0}`;

const pre = (s: string) => `<pre>${esc(s)}</pre>`;

/** A case's place on the page. */
const anchorOf = (r: RunRecord, c: RunCase) => `c${r.cases.indexOf(c) + 1}`;

/** A failed attempt's files, each where the page can show or lead to it. */
function evidenceHtml(e: Evidence) {
  const link = (key: keyof Evidence, says: string) =>
    e[key] === undefined ? [] : [`<a href="${esc(e[key])}">${esc(says)}</a>`];
  const links = [
    ...link('tree', 'the screen as a tree'),
    ...link('log', "the app's last log lines"),
    ...link('crash', 'its crash reports'),
  ];
  return {
    shot: e.shot
      ? `<img alt="the screen at the failure" src="${esc(e.shotMarked ?? e.shot)}">`
      : '',
    rest: [
      ...(e.video === undefined
        ? []
        : [
            `<video controls src="${esc(e.video)}"></video>`,
            '<p class="note">A video is NOT painted over: anything the screen showed is in it.</p>',
          ]),
      ...(links.length > 0 ? [`<p class="note">${links.join(' · ')}</p>`] : []),
    ].join(''),
  };
}

function caseHtml(r: RunRecord, c: RunCase) {
  const last = failureOf(c);
  const seen = last ? evidenceHtml(last.evidence) : { shot: '', rest: '' };
  const needs = needsLine(c.needs);
  const changed = Object.entries(c.start.changed).map(([k, v]) => `${k} (${v})`);
  const earlier = c.attempts.filter((a) => a !== last && a.failure);
  const words = [
    `<h3 id="${anchorOf(r, c)}"><span class="bad">${wordOf(c)}</span>${esc(c.label)} <span class="note">${esc(c.device)}, ${c.ms} ms${c.attempts.length > 1 ? `, ${c.attempts.length} attempts` : ''}</span></h3>`,
    `<p>${esc(saidOf(c))}</p>`,
    ...(last?.failure?.step ? [pre(last.failure.step)] : []),
    ...(last?.failure ? [pre(last.failure.detail)] : []),
    ...(c.teardown && !c.teardown.ok ? [pre(c.teardown.failed.join('\n'))] : []),
    ...(c.cleanup?.length ? [pre(c.cleanup.join('\n'))] : []),
    `<p class="note">To run it alone${needs ? `, ${esc(needs)}, then` : ''}:</p>`,
    pre(c.rerun),
    `<p class="note">${esc(
      [
        ...(c.app
          ? [
              `app ${c.app.id}${c.app.version ? ` ${c.app.version}` : ''}${c.app.build ? ` (${c.app.build})` : ''}`,
            ]
          : []),
        changed.length > 0
          ? `changed on the device by this tool when it began: ${changed.join(', ')}`
          : 'nothing on the device had been changed by this tool when it began',
      ].join(' · '),
    )}</p>`,
    seen.rest,
    ...earlier.map(
      (a) =>
        `<details><summary>attempt ${a.n}: ${esc(a.failure?.message ?? '')}</summary>${pre(a.failure?.detail ?? '')}${evidenceHtml(a.evidence).rest}</details>`,
    ),
    ...(c.out ? [`<details><summary>the steps that ran</summary>${pre(c.out)}</details>`] : []),
  ].join('');
  return `<article class="step card failed"><div>${words}</div>${seen.shot}</article>`;
}

/** Every file against every device, each cell leading to its case. */
function gridHtml(r: RunRecord) {
  const devices = [...new Set(r.cases.map((c) => c.device))];
  const labels = [...new Set(r.cases.map((c) => c.label))];
  const cell = (label: string, device: string) => {
    const c = r.cases.find((x) => x.label === label && x.device === device);
    if (!c) return '<td class="note">not on it</td>';
    const failed = c.outcome !== 'passed' && c.outcome !== 'flaky';
    const word = c.outcome === 'not_run' ? 'not run' : c.outcome;
    return `<td class="${failed ? 'bad' : c.outcome === 'flaky' ? 'flaky' : 'ok'}"><a href="#${anchorOf(r, c)}">${word}</a>${c.teardown && !c.teardown.ok ? ' <span class="bad">teardown failed</span>' : ''}${c.cleanup?.length ? ' <span class="bad">cleanup failed</span>' : ''}</td>`;
  };
  return [
    '<table>',
    `<tr><th>file</th>${devices.map((d) => `<th>${esc(d)}</th>`).join('')}</tr>`,
    ...labels.map((l) => `<tr><td>${esc(l)}</td>${devices.map((d) => cell(l, d)).join('')}</tr>`),
    '</table>',
  ];
}

/**
 * A whole run as one page: the verdict, what was tested and on what, what the folder holds, every file against every
 * device, then the cases to look at, failed first, each with its step, its error, its picture and the command that
 * runs it alone; the passed ones folded. Its pictures and videos are files beside it, so the folder is the report.
 */
export function testPage(r: RunRecord) {
  const look = notable(r);
  const passed = r.cases.filter((c) => !look.includes(c));
  const body = [
    `<header class="bar"><h1>${PAGE_MARK}appdyno <span>test report</span></h1></header>`,
    `<p class="verdict${r.verdict === 'FAIL' ? ' fail' : ''}">${r.verdict}</p>`,
    `<p class="facts">${esc(verdictLine(r))}</p>`,
    ...(r.why.length > 0 ? [`<p class="bad">${esc(r.why.join('; '))}</p>`] : []),
    `<ul class="note">${factsOf(r)
      .map((f) => `<li>${esc(f)}</li>`)
      .join(
        '',
      )}<li>${esc(`${r.began} to ${r.ended}`)}</li>${r.command.length > 0 ? `<li>${esc(r.command.join(' '))}</li>` : ''}</ul>`,
    '<h2>What this folder holds</h2>',
    `<ul class="note">${holdsLines(r.contents)
      .map((l) => `<li>${esc(l)}</li>`)
      .join('')}</ul>`,
    '<p class="note">Read that before you send it to anyone. This page alone is not the report: its pictures and videos are files beside it, and <code>appdyno test share</code> packs the folder, with the kinds you choose left out.</p>',
    '<h2>Files and devices</h2>',
    ...gridHtml(r),
    `<h2>To look at (${look.length})</h2>`,
    ...(look.length === 0 ? ['<p class="note">nothing failed, and nothing was flaky</p>'] : []),
    ...look.map((c) => caseHtml(r, c)),
    `<details><summary>Passed (${passed.length})</summary>`,
    ...passed.map(
      (c) =>
        `<h3 id="${anchorOf(r, c)}">${esc(c.label)} <span class="note">${esc(c.device)}, ${c.ms} ms</span></h3>${c.out ? pre(c.out) : ''}`,
    ),
    '</details>',
  ];
  return reportPage(`appdyno test ${r.verdict}`, body.join('\n'), STYLE);
}
