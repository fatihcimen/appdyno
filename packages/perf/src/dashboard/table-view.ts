import { esc } from '@appdyno/core';

/** The table a chart is also read as: its text is escaped here, so callers pass plain strings. */
export const tableView = (summary: string, head: string[], rows: string[][]) =>
  `<details class="view"><summary>${esc(summary)}</summary><div class="tw"><table class="data"><thead><tr>${head
    .map((h) => `<th scope="col">${esc(h)}</th>`)
    .join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></div></details>`;
