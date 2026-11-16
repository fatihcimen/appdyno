import type { NetworkEntry } from '@appdyno/core';
import { howOf } from './network-answer.js';
import { captures } from './network-capture.js';
import type { Session } from './session.js';
import { ToolError } from './tool.js';

/** The system's number for a request the app itself gave up: no failure of the network's. */
const GIVEN_UP = -999;
/** What a rule or the throttle did by itself: asked for, so `strict` does not fail for it. */
const MADE: ReadonlySet<string | undefined> = new Set(['mocked', 'failed', 'lost']);
/** Failed requests an answer names, each in a line: the rest are counted. */
const MAX_TOLD = 3;

/** The finished requests an action's answer has looked at, by device, of the capture that began at `since`. */
const looked = new Map<string, { since: number; ids: Set<number> }>();

/** A transport's failure that was the network's: one the app gave up, or that ended with the app, is none. */
const broke = (e: NetworkEntry) => !!e.error && e.code !== undefined && e.code !== GIVEN_UP;
/** What an answer names: refused by the server, or failed on its way. */
export const failed = (e: NetworkEntry) => (e.status ?? 0) >= 400 || broke(e);
/** What `strict` fails for: the server's own fault or the network's, which no rule made. */
const unexpected = (e: NetworkEntry) => !MADE.has(e.how) && ((e.status ?? 0) >= 500 || broke(e));

/** Where a request went, with no query: short, and with none of what a query may hold. */
export function placeOf(url = '') {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return url;
  }
}

/** A request in the fewest words that tell it from another: what was asked, of where, and how it ended. */
export const shortLine = (e: NetworkEntry, clean: (text: string) => string) =>
  `${e.method ?? 'GET'} ${clean(placeOf(e.url))} ${e.inFlight ? 'in flight' : e.error ? `failed: ${clean(e.error)}` : (e.status ?? 0)}${howOf(e)}`;

/**
 * The requests that failed since an action began, while the probe's capture runs: a line each for an action's answer,
 * so that a tap that got a 500 says so with no read of the list. Each is told once: one that ended after the answer of
 * the action before is told with the next, and says it came before. Under the capture's `strict`, one that no rule
 * made refuses the action, with what it did.
 */
export async function failedSince(
  s: Session,
  began: number,
  done: string,
  clean: (text: string) => string,
): Promise<string[]> {
  const { serial } = s.device;
  const c = captures.read(serial);
  if (c?.via !== 'probe' || !c.handle || !s.device.network) return [];
  const { entries } = await s.device.network
    .read(c.handle, true)
    .catch(() => ({ entries: [] as NetworkEntry[] }));
  const ended = entries.filter((e) => !e.inFlight && e.id !== undefined);
  const at = (e: NetworkEntry) => Date.parse(e.at ?? '') - (e.ms ?? 0);
  let seen = looked.get(serial);
  if (seen?.since !== c.since) {
    // the first action of a capture answers for what came since it began, and for nothing before
    seen = {
      since: c.since,
      ids: new Set(ended.filter((e) => Date.parse(e.at ?? '') < began).map((e) => e.id ?? 0)),
    };
    looked.set(serial, seen);
  }
  const ids = seen.ids;
  const bad = ended.filter((e) => !ids.has(e.id ?? 0) && failed(e));
  for (const e of ended) ids.add(e.id ?? 0);
  const line = (e: NetworkEntry) =>
    `${shortLine(e, clean)} (id ${e.id ?? 0}${at(e) < began ? ', before this action' : ''})`;
  const breaking = c.strict ? bad.filter(unexpected) : [];
  if (breaking.length > 0)
    throw new ToolError(
      [...(done ? [done] : []), ...breaking.map((e) => `network strict: ${line(e)}`)].join('\n'),
      'CHECK_FAILED',
      'what it did stands, and screen shows what that left; network read id gives the request whole; network mock strict: false ends this',
      true,
    );
  return [
    ...bad.slice(0, MAX_TOLD).map((e) => `network: ${line(e)}`),
    ...(bad.length > MAX_TOLD
      ? [`network: ${bad.length - MAX_TOLD} more failed: network read lists them first`]
      : []),
  ];
}
