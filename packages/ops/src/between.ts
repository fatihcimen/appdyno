import { quoted, shownLabel, type Rect, type Screen, type ScreenElement } from '@appdyno/core';
import type { Session } from './session.js';

type Clean = (s: string) => string;

const within = (e: ScreenElement, r: Rect) =>
  e.x >= r.x && e.x <= r.x + r.width && e.y >= r.y && e.y <= r.y + r.height;

/** The topmost plain words of the screen, or of what lies in `area`: what names a page, a sheet or a dialog. */
export function firstWords(screen: Screen, clean: Clean, area?: Rect): string | undefined {
  const top = screen.list
    .filter((e) => e.role === 'text' && e.label && (!area || within(e, area)))
    .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)[0];
  return top && quoted(shownLabel(top, clean));
}

/**
 * What the app shows over the rest of its screen, said first where a target was not found there: what stands between a
 * step and its target. Empty where nothing does.
 */
export function overApp(s: Session, screen: Screen, clean: Clean): string {
  // another app's window over it is that app's, said as the app not in front
  if (s.appId && screen.foreground !== s.appId) return '';
  const o = s.device.platformScreen.overlay?.(screen.tree, screen.elements);
  if (!o) return '';
  const name = firstWords(screen, clean, o.rect);
  return `${/^[aeiou]/.test(o.kind) ? 'an' : 'a'} ${o.kind} is open over the app${name ? `: ${name}` : ''}; ${o.close}; `;
}
