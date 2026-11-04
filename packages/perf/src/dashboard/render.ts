import { esc } from '@appdyno/core';
import { attentionSection } from './attention.js';
import { appAnchor, time } from './format.js';
import type { DashboardData } from './load.js';
import { measuresTable } from './measures.js';
import { dashboardPage, emptySection, pageHead } from './page.js';
import { trendsSection } from './trends.js';
import { appViewOf, namesOf, scenariosOf, type AppView } from './view.js';
import { whySection } from './why.js';

const appSection = (v: AppView) =>
  `<section class="app" id="${esc(appAnchor(v.app))}"><h2>${esc(v.app)}</h2>${whySection(v.scenarios)}<h3>Measures by device</h3>${measuresTable(v)}${trendsSection(v)}</section>`;

/** The whole page from what was loaded: the same data gives the same page. */
export function renderDashboard(data: DashboardData): string {
  const title = data.app ? `appdyno dashboard: ${data.app}` : 'appdyno dashboard';
  const names = namesOf(data);
  const unread = [...data.unread];
  const scenarios = scenariosOf(data, unread);
  const apps = [...new Set(data.keys.map((k) => k.key.app))];
  if (apps.length === 0) {
    const refusals = names.size
      ? `<section class="app"><h3>What the devices said they cannot read</h3>${measuresTable(appViewOf('', [], data, names))}</section>`
      : '';
    return dashboardPage(title, `${pageHead(data.now, [])}${emptySection(data.app)}${refusals}`);
  }
  return dashboardPage(
    title,
    [
      pageHead(data.now, apps),
      attentionSection(scenarios, names, time(data.now), unread, data.rules.length),
      ...apps.map((app) => appSection(appViewOf(app, scenarios, data, names))),
    ].join(''),
  );
}
