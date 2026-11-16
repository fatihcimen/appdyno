import { pause, type NetworkDetail, type NetworkEntry } from '@appdyno/core';
import { bodyHas, bodyMatch, jsonOf, valueAt, valueText } from '@appdyno/flows';
import { fits, type Filter } from './network-answer.js';
import { captures } from './network-capture.js';
import { shortLine } from './network-watch.js';
import type { Session } from './session.js';
import { ToolError } from './tool.js';

const POLL_MS = 250;
/** How long a check waits for its request where it is not told. */
export const CHECK_WAIT_MS = 5_000;

type Side = 'request' | 'response';

/** Which body some words are about, by the word before them, `response:` or `request:`; `otherwise` with neither. */
export function sideOf(words: string, otherwise: Side): { side: Side; rest: string } {
  const m = /^(request|response):\s*/.exec(words);
  return m
    ? { side: m[1] === 'request' ? 'request' : 'response', rest: words.slice(m[0].length) }
    : { side: otherwise, rest: words };
}

export const bodyOf = (d: NetworkDetail | undefined, side: Side) =>
  side === 'request' ? d?.requestBody : d?.responseBody;

/** A value with the key it stands under, so that what hides a credential by its name still knows it. */
export const keyed = (key: string | number | undefined, value: unknown) =>
  typeof key === 'string' ? JSON.stringify({ [key]: value }) : valueText(value);

/** The request a check looks for: by a part of its address, its method, its status, and what a body of it holds. */
export type Wanted = Filter & { has?: string | undefined; timeoutMs?: number | undefined };

/**
 * Waits until the capture has a finished request that fits, and gives it. When none came in time it refuses with the
 * one that came nearest and what of it differed, so that a miss says why with no read of the list.
 */
export async function awaitRequest(
  read: () => Promise<NetworkEntry[]>,
  detail: (id: number) => Promise<NetworkDetail | undefined>,
  w: Wanted,
  clean: (text: string) => string,
): Promise<NetworkEntry> {
  const timeoutMs = w.timeoutMs ?? CHECK_WAIT_MS;
  const body = w.has === undefined ? undefined : sideOf(w.has, 'request');
  const match = body && bodyMatch(body.rest);
  const holds = async (e: NetworkEntry) =>
    !body ||
    !match ||
    bodyHas(bodyOf(e.id === undefined ? undefined : await detail(e.id), body.side), match);
  const end = Date.now() + timeoutMs;
  let scoped: NetworkEntry[];
  for (;;) {
    scoped = (await read()).filter(
      (e) => e.url && (w.after === undefined || (e.id ?? Infinity) > w.after),
    );
    for (const e of scoped) if (!e.inFlight && fits(e, w) && (await holds(e))) return e;
    if (Date.now() >= end) break;
    await pause(Math.min(POLL_MS, Math.max(1, end - Date.now())));
  }
  const asked = clean(
    [w.method, w.contains, w.status, ...(w.has === undefined ? [] : [`has ${w.has}`])]
      .filter(Boolean)
      .join(' '),
  );
  const since = w.after === undefined ? '' : ` after id ${w.after}`;
  // what fits in most ways, and of those the newest
  const score = (e: NetworkEntry) =>
    Number(fits(e, { contains: w.contains })) * 4 +
    Number(fits(e, { method: w.method })) * 2 +
    Number(!e.inFlight && fits(e, { status: w.status }));
  const near = scoped.reduce<NetworkEntry | undefined>(
    (best, e) => (!best || score(e) >= score(best) ? e : best),
    undefined,
  );
  if (!near)
    throw new ToolError(
      `no request${asked ? ` ${asked}` : ''} in ${timeoutMs} ms${since}: the app made none`,
      'CHECK_FAILED',
    );
  const differs = [
    ...(fits(near, { contains: w.contains }) ? [] : [`its address has no ${w.contains ?? ''}`]),
    ...(fits(near, { method: w.method }) ? [] : [`${near.method ?? 'GET'}, not ${w.method ?? ''}`]),
    ...(near.inFlight
      ? ['it has not ended']
      : fits(near, { status: w.status })
        ? []
        : [`${near.error ? 'failed' : (near.status ?? 0)}, not ${w.status ?? ''}`]),
  ];
  if (differs.length === 0 && body && match) {
    const text = bodyOf(near.id === undefined ? undefined : await detail(near.id), body.side);
    const json = match.path ? jsonOf(text) : undefined;
    const found = json && match.path ? valueAt(json.value, match.path) : undefined;
    differs.push(
      text === undefined
        ? `its ${body.side} body was not kept, or is no text`
        : found === undefined
          ? `its ${body.side} body has no ${clean(body.rest)}`
          : `its ${body.side} body has ${clean(keyed(match.path?.at(-1), found)).slice(0, 200)}`,
    );
  }
  throw new ToolError(
    `no request${asked ? ` ${asked}` : ''} in ${timeoutMs} ms${since}; nearest: ${shortLine(near, clean)} (id ${near.id ?? 0}): ${differs.join('; ')}`,
    'CHECK_FAILED',
    'network read id gives it whole',
  );
}

/** The newest request of the capture that runs: what a flow's `request` steps look past, as they ask of the run alone. */
export async function lastRequest(s: Session) {
  const c = captures.read(s.device.serial);
  if (!c?.handle || !s.device.network) return undefined;
  const { entries } = await s.device.network
    .read(c.handle, true)
    .catch(() => ({ entries: [] as NetworkEntry[] }));
  return { since: c.since, id: entries.at(-1)?.id ?? -1 };
}
