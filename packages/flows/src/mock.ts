import { createHash } from 'node:crypto';
import type { NetworkRule } from '@appdyno/core';
import { bodyMatch } from './body-match.js';
import type { FlowStep } from './format.js';
import { FlowError } from './tokens.js';

const FAILS = ['offline', 'timeout', 'reset'] as const;
const TO = /^(?:(https?):\/\/)?([\w.-]+)(?::(\d{1,5}))?$/;
const MAX_DELAY_MS = 600_000;

/** A pattern over a whole text for a glob, where `*` is any run of it. */
const globPattern = (glob: string) =>
  `^${glob
    .split('*')
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')}$`;

/**
 * The rule a `mock` step makes, as the probe reads it: the first word is `host[:port][/path]` with `*` for any run, or
 * `*` alone for every request, and `regex` a pattern for the whole path in its place; `has` is what the request's body
 * holds and `when` a header it carries, as `Name: value` with `*` in the value. It answers by itself with
 * `status`, `type`, `header` and `body` (`@file`: that file's bytes, `bodyFile` here, for the caller to place), fails
 * with `fail`, sends the request elsewhere with `to` (a bare `localhost`: `http://127.0.0.1`), and waits `delayMs`
 * before any of them or before the real one.
 */
export function mockRule(st: FlowStep, line = st.line): NetworkRule {
  const a = st.args;
  const wrong = (what: string) => new FlowError(`mock: ${what}`, line);
  if (a.request === undefined || a.from !== undefined || a.unmatched !== undefined)
    throw wrong('a rule is a request, host, host/path or *, then what it does');
  const request = String(a.request);
  const slash = request.indexOf('/');
  const host = (slash < 0 ? request : request.slice(0, slash)).toLowerCase();
  const path = slash < 0 ? undefined : request.slice(slash);
  if (!host) throw wrong(`a request is host, host/path or *: ${request}`);
  if (a.regex !== undefined) {
    if (path !== undefined) throw wrong('a path or regex, not both');
    try {
      new RegExp(String(a.regex));
    } catch {
      throw wrong(`regex is not a pattern: ${String(a.regex)}`);
    }
  }
  const fail = FAILS.find((f) => f === a.fail);
  if (a.fail !== undefined && !fail) throw wrong(`fail is ${FAILS.join(', ')}: ${String(a.fail)}`);
  const to = a.to === undefined ? undefined : TO.exec(String(a.to));
  if (to === null) throw wrong(`to is a host, host:port or http://host:port: ${String(a.to)}`);
  const body = a.body === undefined ? undefined : String(a.body);
  const answers =
    a.status !== undefined || body !== undefined || a.type !== undefined || a.header !== undefined;
  if (Number(!!fail) + Number(!!to) + Number(answers) > 1)
    throw wrong('one of an answer (status, type, header, body), fail or to');
  if (!fail && !to && !answers && a.delayMs === undefined)
    throw wrong('say what it does: status, body, fail, to or delayMs');
  const whole = (name: string, min: number, max: number) => {
    const n = a[name];
    if (n === undefined) return undefined;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max)
      throw wrong(`${name} is a whole number from ${min} to ${max}`);
    return n;
  };
  const pairs = (name: string) =>
    ((a[name] as string[] | undefined) ?? []).map((h): [string, string] => {
      const colon = h.indexOf(':');
      if (colon < 1) throw wrong(`a ${name} is "Name: value": ${h}`);
      return [h.slice(0, colon).trim(), h.slice(colon + 1).trim()];
    });
  const headers = Object.fromEntries(pairs('header'));
  const when = pairs('when').map(([name, value]) => ({ name, value: globPattern(value) }));
  const has = ((a.has as string[] | undefined) ?? []).map(bodyMatch);
  const file = body?.startsWith('@') ? body.slice(1) : undefined;
  const json = file ? /\.json$/i.test(file) : /^\s*[{[]/.test(body ?? '');
  const type =
    a.type ?? (body === undefined ? undefined : json ? 'application/json' : 'text/plain');
  if (type !== undefined && !Object.keys(headers).some((h) => /^content-type$/i.test(h)))
    headers['Content-Type'] = String(type);
  const { off: _, ...on } = a;
  const status = whole('status', 100, 599);
  const delayMs = whole('delayMs', 0, MAX_DELAY_MS);
  const times = whole('times', 1, 1_000_000);
  const port = to?.[3] === undefined ? undefined : Number(to[3]);
  // `localhost` with no scheme is a server on this Mac, which seldom speaks TLS: plain HTTP, by the address, which
  // an app's transport security lets through where a name it does not know is refused
  const local = to && !to[1] && /^localhost$/i.test(String(to[2]));
  const query = a.query === undefined ? undefined : [...new URLSearchParams(String(a.query))];
  return {
    // the same on and off, so that what it took stays counted
    id: createHash('sha1')
      .update(JSON.stringify(Object.entries(on).sort(([x], [y]) => (x < y ? -1 : 1))))
      .digest('hex')
      .slice(0, 6),
    ...(a.off === true && { off: true as const }),
    ...(a.method !== undefined && { method: String(a.method).toUpperCase() }),
    ...(host !== '*' && { host: globPattern(host) }),
    ...(path !== undefined && { path: globPattern(path) }),
    ...(a.regex !== undefined && { path: `^(?:${String(a.regex)})$` }),
    ...(query && { query }),
    ...(has.length > 0 && { has }),
    ...(when.length > 0 && { when }),
    ...(answers && { status: status ?? 200, headers }),
    ...(body !== undefined && (file ? { bodyFile: file } : { body })),
    ...(delayMs !== undefined && { delayMs }),
    ...(fail && { fail }),
    ...(to && {
      to: {
        ...(to[1] && { scheme: to[1] }),
        ...(local && { scheme: 'http' }),
        host: local ? '127.0.0.1' : String(to[2]),
        ...(port !== undefined && { port }),
      },
    }),
    ...(times !== undefined && { times }),
  };
}
