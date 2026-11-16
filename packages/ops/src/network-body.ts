import type { NetworkDetail, NetworkEntry } from '@appdyno/core';
import { jsonOf, pathKeys, valueAt, type PathKey } from '@appdyno/flows';
import { bodyOf, keyed, sideOf } from './network-check.js';
import { ToolError } from './tool.js';

/** A shape or a value in an answer to here: past it the body itself is what to read. */
const MAX_CHARS = 2_000;
/** The lines a comparison gives: the rest are counted. */
const MAX_DIFFS = 20;
const VALUE_CHARS = 80;
/** The kinds a list's elements are told by, before the rest are left to a word. */
const MAX_KINDS = 4;

type Clean = (text: string) => string;
type Side = 'request' | 'response';
const SIDES: readonly Side[] = ['request', 'response'];

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** What several values are, as one: objects by all their keys, one in not all of them marked `?`. */
function shapeOfAll(values: unknown[]): string {
  if (values.length > 0 && values.every(isObject)) {
    const keys = [...new Set(values.flatMap((v) => Object.keys(v)))];
    const parts = keys.map((k) => {
      const held = values.filter((v) => Object.hasOwn(v, k));
      return `${k}${held.length < values.length ? '?' : ''}: ${shapeOfAll(held.map((v) => v[k]))}`;
    });
    return `{${parts.join(', ')}}`;
  }
  const kinds = [...new Set(values.map(shapeOf))];
  return kinds.length > MAX_KINDS
    ? `${kinds.slice(0, MAX_KINDS).join(' | ')} | …`
    : kinds.join(' | ');
}

/**
 * What a JSON value is made of and none of what it holds: each key with its type, a list with how many it holds and
 * what they are. A reader that pays for each character learns where a value is before it asks for it.
 */
export function shapeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return v.length === 0 ? '[]' : `[${v.length} × ${shapeOfAll(v)}]`;
  return isObject(v) ? shapeOfAll([v]) : typeof v;
}

const cut = (text: string, most = VALUE_CHARS) =>
  text.length > most ? `${text.slice(0, most)}…` : text;

/** A value as an answer shows it: hidden where its key names a credential, which the value alone cannot tell. */
function shown(key: PathKey | undefined, value: unknown, clean: Clean, most = VALUE_CHARS) {
  if (value === undefined) return 'none';
  const whole = keyed(key, value);
  if (isObject(value) || Array.isArray(value)) return cut(clean(JSON.stringify(value)), most);
  const text = clean(JSON.stringify(value));
  return clean(whole) === whole && text !== '"•••"' ? cut(text, most) : '•••';
}

/** Why a body gives no JSON, in a line: not kept, cut where it was kept, or no JSON at all. */
function unread(d: NetworkDetail | undefined, side: Side) {
  const text = bodyOf(d, side);
  const size = side === 'request' ? d?.requestBodySize : d?.responseBodySize;
  if (text === undefined) return `the ${side} body was not kept, or is no text`;
  return (size ?? 0) > Buffer.byteLength(text)
    ? `the ${side} body is ${size ?? 0} B and its first ${Buffer.byteLength(text)} were kept: no whole JSON`
    : `the ${side} body is no JSON`;
}

/** One value of a request's body by its path, the answer's unless the path begins `request:`. */
export function valueLine(d: NetworkDetail | undefined, words: string, clean: Clean) {
  const { side, rest } = sideOf(words, 'response');
  const keys = pathKeys(rest);
  if (!keys)
    throw new ToolError(
      `path is keys and indexes, as data.items[0].price: ${rest}`,
      'INVALID_ARGUMENT',
    );
  const json = jsonOf(bodyOf(d, side));
  if (!json) return unread(d, side);
  const value = valueAt(json.value, keys);
  return value === undefined
    ? `the ${side} body has no ${rest}: its shape is ${cut(shapeOf(json.value), MAX_CHARS)}`
    : `${side} ${rest}: ${shown(keys.at(-1), value, clean, MAX_CHARS)}`;
}

/** The shape of each body of a request that is JSON, and of one that is not why. */
export const shapeLines = (d: NetworkDetail | undefined) =>
  SIDES.flatMap((side) => {
    const json = jsonOf(bodyOf(d, side));
    if (json) return [`${side} body shape: ${cut(shapeOf(json.value), MAX_CHARS)}`];
    return side === 'request' && d?.requestBody === undefined ? [] : [unread(d, side)];
  });

/** Each place two JSON values differ, by its path, an element of a list against the one of its index. */
function differences(was: unknown, now: unknown, at: string, key: PathKey | undefined): Differs[] {
  if (Array.isArray(was) && Array.isArray(now))
    return Array.from({ length: Math.max(was.length, now.length) }, (_, i) =>
      differences(was[i], now[i], `${at}[${i}]`, i),
    ).flat();
  if (isObject(was) && isObject(now))
    return [...new Set([...Object.keys(was), ...Object.keys(now)])].flatMap((k) =>
      differences(was[k], now[k], `${at}.${k}`, k),
    );
  return JSON.stringify(was) === JSON.stringify(now) ? [] : [{ at, key, was, now }];
}
type Differs = { at: string; key: PathKey | undefined; was: unknown; now: unknown };

const queryOf = (e: NetworkEntry) => {
  try {
    return Object.fromEntries(new URL(e.url ?? '').searchParams);
  } catch {
    return {};
  }
};
const placeOf = (e: NetworkEntry) => `${e.method ?? 'GET'} ${(e.url ?? '').replace(/\?.*$/, '')}`;

/**
 * What differs between two requests, the earlier first: their address and status, their queries, and their bodies by
 * path where both are JSON. A few lines stand for two bodies that need not be read.
 */
export function diffLines(
  was: { e: NetworkEntry; d: NetworkDetail | undefined },
  now: { e: NetworkEntry; d: NetworkDetail | undefined },
  clean: Clean,
) {
  const all: Differs[] = [
    ...differences(placeOf(was.e), placeOf(now.e), 'address', undefined),
    ...differences(was.e.status, now.e.status, 'status', undefined),
    ...differences(queryOf(was.e), queryOf(now.e), 'request.query', undefined),
  ];
  const notes: string[] = [];
  for (const side of SIDES) {
    const [a, b] = [bodyOf(was.d, side), bodyOf(now.d, side)];
    const [ja, jb] = [jsonOf(a), jsonOf(b)];
    if (ja && jb) all.push(...differences(ja.value, jb.value, side, undefined));
    else if (a !== b)
      notes.push(
        `${side} body: differs, ${a === undefined ? 'none' : `${a.length} characters`} → ${b === undefined ? 'none' : `${b.length} characters`}, not both JSON`,
      );
  }
  const lines = all
    .slice(0, MAX_DIFFS)
    .map((x) => `${x.at}: ${shown(x.key, x.was, clean)} → ${shown(x.key, x.now, clean)}`);
  const id = (e: NetworkEntry) => e.id ?? 0;
  return [
    `${id(was.e)} → ${id(now.e)}: ${all.length + notes.length === 0 ? 'no difference in address, status, query or bodies' : `${all.length + notes.length} differ`}`,
    ...lines,
    ...(all.length > MAX_DIFFS ? [`${all.length - MAX_DIFFS} more differ`] : []),
    ...notes,
  ];
}
