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

/** How a wait that found its element but saw it go before it held says so. */
export const wentAgain = (screen: Screen, clean: Clean) => {
  const page = firstWords(screen, clean);
  return `; it was shown, then the screen changed${page ? ` to ${page}` : ''}`;
};

/** Codes of a step whose target was not there. */
const MISSED = new Set(['NOT_FOUND', 'STALE', 'CHECK_FAILED']);

/**
 * What the waits of one call's steps showed, by what they named it: a later step refused for that same target says what
 * came between, as a screen that moved on by itself after the wait.
 */
export function shownByWaits(clean: Clean) {
  const shown = new Map<string, { step: number; page: string | undefined }>();
  return {
    /** Step `n` waited for its element to show, and it did, on `screen`. */
    passed(what: string | undefined, n: number, screen: Screen) {
      if (what) shown.set(what, { step: n, page: firstWords(screen, clean) });
    },
    /** The line for step `n`, refused with `code` for `what`, on `screen`; none where no wait showed it. */
    since(what: string | undefined, n: number, code: string, screen: Screen | undefined) {
      const was = what === undefined || !MISSED.has(code) ? undefined : shown.get(what);
      if (what === undefined || !was) return undefined;
      const page = screen && firstWords(screen, clean);
      return page && page !== was.page
        ? `${what} was shown at step ${was.step}, and the screen changed to ${page} before step ${n}`
        : `${what} was shown at step ${was.step}, and was gone by step ${n}`;
    },
  };
}
