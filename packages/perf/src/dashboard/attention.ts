import { esc } from '@appdyno/core';
import { age, appAnchor, deviceLabel, deviceName, type DeviceName } from './format.js';
import { chip, icon, type Status } from './marks.js';
import { againstText, budgetText, changeText, loud, type Scenario } from './view.js';

const NOISY_SHOWN_OPEN = 5;

const tile = (status: Status, count: number, label: string) =>
  `<div class="tile${count ? '' : ' quiet'}"><div class="count">${count}</div>${count ? chip(status, label) : `<span class="tl-quiet">${esc(label)}</span>`}</div>`;

const item = (s: Scenario, names: Map<string, DeviceName>, now: number, what: string) => {
  const cls = s.key.deviceClass;
  return `<li><a href="#${esc(appAnchor(s.key.app))}">${esc(s.key.app)}</a>, ${esc(s.key.scenario)}, ${esc(deviceLabel(names.get(cls) ?? deviceName(cls)))}: ${esc(what)}, ${esc(age(s.report.at, now))}</li>`;
};

const which = (title: string, items: string[]) =>
  items.length ? `<h3>${esc(title)}</h3><ul class="which">${items.join('')}</ul>` : '';

/** What a reader should look at first, with its counts; what the page cannot vouch for is said here too. */
export function attentionSection(
  scenarios: Scenario[],
  names: Map<string, DeviceName>,
  now: number,
  unread: string[],
  budgetRules: number,
): string {
  const list = <T>(pick: (s: Scenario) => T[], words: (x: T, s: Scenario) => string) =>
    scenarios.flatMap((s) => pick(s).map((x) => item(s, names, now, words(x, s))));
  const regressions = list(
    (s) => s.report.comparisons.filter((c) => c.verdict === 'regression'),
    (c) => `${c.kind} ${againstText(c)}, ${changeText(c)}`,
  );
  const budgets = list(
    (s) => s.report.budgets.filter((b) => !b.ok),
    (b, s) => `${b.kind} ${budgetText(b, s)}`,
  );
  const noisy = list(
    (s) => (loud(s.report.noise).length ? [s] : []),
    (s) =>
      `${loud(s.report.noise).join(', ')}${s.report.comparisons.some((c) => c.verdict === 'noisy') ? '; a change was seen: measure again' : ''}`,
  );
  const compared = scenarios.filter((s) => s.baseline).length;
  const coverage = `Against a baseline: ${compared} of ${scenarios.length} scenarios. Budget rules: ${budgetRules}.`;
  const problems = unread.length
    ? `<p class="note">${icon('no')} Could not read:</p><ul class="which">${unread.map((u) => `<li>${esc(u)}</li>`).join('')}</ul>`
    : '';
  const nothing = !regressions.length && !budgets.length && !noisy.length;
  return `<section class="attention card"><h2>What needs attention</h2>${
    nothing
      ? `<p class="clear">${chip('good', 'Nothing needs attention')} no regression, no broken budget and no noisy run in the newest run of each scenario.</p>`
      : `<div class="tiles">${tile('critical', regressions.length, regressions.length === 1 ? 'regression' : 'regressions')}${tile('critical', budgets.length, budgets.length === 1 ? 'broken budget' : 'broken budgets')}${tile('warning', noisy.length, noisy.length === 1 ? 'noisy run' : 'noisy runs')}</div>${which('Regressions', regressions)}${which('Broken budgets', budgets)}${
          noisy.length
            ? `<details${noisy.length <= NOISY_SHOWN_OPEN ? ' open' : ''}><summary>Noisy runs (${noisy.length})</summary><ul class="which">${noisy.join('')}</ul></details>`
            : ''
        }`
  }<p class="note">${esc(coverage)}</p>${problems}</section>`;
}
