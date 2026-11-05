import { esc, PAGE_MARK, selfContainedPage } from '@appdyno/core';
import { appAnchor, when } from './format.js';
import { ICONS } from './marks.js';
import { STYLE } from './style.js';

/** How often an open page takes up what the last kept run wrote; it closes an open table, so not too often. */
const RELOAD_SECONDS = 60;

export const dashboardPage = (title: string, body: string) =>
  selfContainedPage({
    title,
    style: STYLE,
    head: `<meta http-equiv="refresh" content="${RELOAD_SECONDS}">\n`,
    body: `${ICONS}<main>${body}</main>`,
  });

export const pageHead = (now: string, apps: string[]) =>
  `<header class="bar"><h1>${PAGE_MARK}appdyno <span>dashboard</span></h1>${
    apps.length > 1
      ? `<nav>${apps.map((a) => `<a href="#${esc(appAnchor(a))}">${esc(a)}</a>`).join('')}</nav>`
      : ''
  }<span class="m">written ${esc(when(now))}; reloads itself every minute</span></header>`;

/** The one command that fills an empty page. */
export const emptySection = (app?: string) =>
  `<section class="card"><h2>${esc(app ? `No measured run of ${app} yet` : 'No measured run yet')}</h2><p>One command fills this page, with every measure the device can give:</p><pre><code>${esc(`appdyno perf survey --app ${app ?? '<app id>'}`)}</code></pre></section>`;
