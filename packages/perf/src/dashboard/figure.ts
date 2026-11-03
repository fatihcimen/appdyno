import { esc } from '@appdyno/core';
import { nameOf, type AppView } from './view.js';

/** One small multiple: which device, what it is about, then the chart and what goes with it. */
export function figure(
  v: AppView,
  cls: string,
  about: string,
  chips: string[],
  ...body: string[]
): string {
  const name = nameOf(v, cls);
  return `<figure class="card"><figcaption><strong>${esc(name.name)}</strong> <span class="m">${esc(name.detail)}</span><div class="m">${esc(about)}</div>${chips.join('')}</figcaption>${body.join('')}</figure>`;
}

/** Small multiples side by side; nothing at all when there are none. */
export const multiples = (figures: string[]) =>
  figures.length ? `<div class="multiples">${figures.join('')}</div>` : '';
