import type { NetworkAnswer, NetworkDetail, NetworkEntry, NetworkTimings } from '@appdyno/core';
import type { ServerContext } from './context.js';
import { boundLines } from './diagnose.js';
import { writeInside } from './flow/shared.js';
import { readCapture, type Capture } from './network-capture.js';
import { cleanHeaders, harOf } from './network-har.js';
import { ruleHits } from './network-rules.js';
import { redact, redactLog } from './policy.js';
import type { Session } from './session.js';
import { reply } from './tool.js';

/** A body in an answer to here: the rest is in the export. */
const BODY_CHARS = 4_000;

/** What a rule or the throttle did to a request, as its line says it. */
const HOW: Record<string, (e: NetworkEntry) => string> = {
  mocked: () => 'mocked',
  failed: () => 'failed by a rule',
  delayed: () => 'delayed by a rule',
  sent: (e) => `sent to ${e.to ?? 'another host'}`,
  lost: () => 'lost by the throttle',
};
const howOf = (e: NetworkEntry) => (e.how ? ` [${HOW[e.how]?.(e) ?? e.how}]` : '');

/** How long a request has been under way, as a person says it. */
const since = (ms = 0) => (ms < 10_000 ? `${ms} ms` : `${Math.round(ms / 1000)} s`);

/** A request, or a count, as one line; a request whose headers and bodies can be asked for starts with its id. */
export const line = (e: NetworkEntry, ids = false) =>
  e.inFlight
    ? `${ids && e.id !== undefined ? `${e.id} ` : ''}${e.method ?? 'GET'} ${e.url ?? ''} in flight ${since(e.ms)}`
    : e.url
      ? `${ids && e.id !== undefined ? `${e.id} ` : ''}${e.method ?? 'GET'} ${e.url}${e.status ? ` ${e.status}` : ''}${e.ms !== undefined ? ` ${e.ms} ms` : ''}${e.bytes !== undefined ? ` ${e.bytes} B` : ''}${e.body ? ' (body in the export)' : ''}${e.error ? ` failed: ${e.error}` : ''}${howOf(e)}`
      : `${e.direction ?? ''} ${e.host ?? ''}: ${e.packets !== undefined ? `${e.packets} packets, ` : ''}${e.bytes ?? 0} B`.trim();

export type Filter = {
  contains?: string | undefined;
  method?: string | undefined;
  status?: string | undefined;
};

/** Whether a request is one asked for: by a part of its address, its method, and its status, a class of it or `failed`. */
export function fits(e: NetworkEntry, { contains, method, status }: Filter) {
  if (contains && !`${e.url ?? ''} ${e.host ?? ''}`.includes(contains)) return false;
  if (method && (e.method ?? 'GET').toUpperCase() !== method.toUpperCase()) return false;
  if (!status) return true;
  if (status === 'failed') return !!e.error;
  const code = String(e.status ?? '');
  return /^\dxx$/i.test(status) ? code.startsWith(status.charAt(0)) : code === status;
}

/** The capture's rules with what each took, and its throttle, as the last lines of an answer; none where it has neither. */
export function controlLines(c: Capture | undefined, entries: NetworkEntry[]) {
  const hits = ruleHits(c?.rules ?? [], entries);
  return [
    ...hits.map((h, i) => `rule ${i + 1}${h.off ? ' (off)' : ''}: ${h.rule} (${h.hits} taken)`),
    ...(c?.throttle ? [`throttle: ${c.throttle}`] : []),
  ];
}

const body = (what: string, text: string | undefined, size: number | undefined) =>
  text === undefined
    ? size
      ? [`${what} body: ${size} B, not text or not kept`]
      : []
    : [
        `${what} body (${size ?? text.length} B${text.length > BODY_CHARS ? `, its first ${BODY_CHARS} characters` : ''}):`,
        text.slice(0, BODY_CHARS),
      ];

/** The requests that have started and not ended, as an answer's last line: one that hangs, a stream that stays open. */
export function flightLine(entries: NetworkEntry[]) {
  const flying = entries.filter((e) => e.inFlight);
  const shown = flying
    .slice(-5)
    .map((e) => `${e.method ?? 'GET'} ${e.url ?? ''} ${since(e.ms)}`)
    .join(', ');
  return flying.length > 0 ? [`in flight: ${flying.length} (${shown})`] : [];
}

const phase = (name: string, ms: number) => (ms >= 0 ? [`${name} ${Math.round(ms)} ms`] : []);

/**
 * What the session measured of a request, in a line. Its connection and protocol are the probe's session's, and say
 * nothing of how the app keeps its own connections: the line says so.
 */
export function timingLine(t: NetworkTimings | undefined) {
  if (!t) return [];
  if (t.cache) return ['from the cache'];
  const parts = [
    ...(t.proto ? [t.proto] : []),
    `connection ${t.reused ? 'reused' : 'new'}`,
    ...phase('dns', t.dns),
    ...phase('connect', t.connect),
    ...phase('tls', t.tls),
    ...phase('wait', t.wait),
    ...phase('receive', t.receive),
    ...(t.wire > 0 ? [`${t.wire} B on the wire`] : []),
    ...(t.ip ? [t.ip] : []),
  ];
  return [`${parts.join(', ')} (the probe's own connection, not the app's)`];
}

/** One request whole: its line, then its headers and bodies as they were kept, cleaned. */
export function detailLines(
  e: NetworkEntry,
  d: NetworkDetail | undefined,
  clean: (text: string) => string,
) {
  if (!d)
    return [
      line(e, true),
      ...timingLine(e.timings),
      e.inFlight
        ? 'it has not ended: its headers and bodies are kept when it does'
        : 'its headers and bodies were not kept: start with bodies: true',
    ];
  const headers = (h: Record<string, string>) =>
    cleanHeaders(clean, h).map(({ name, value }) => `  ${name}: ${value}`);
  return [
    line(e, true),
    ...timingLine(e.timings),
    'request headers:',
    ...headers(d.requestHeaders),
    ...body('request', d.requestBody && clean(d.requestBody), d.requestBodySize),
    'response headers:',
    ...headers(d.responseHeaders),
    ...body('response', d.responseBody && clean(d.responseBody), d.responseBodySize),
    ...(d.note ? [d.note] : []),
  ];
}

/** What an answer shows of a capture: the requests asked for, to a limit, and a file to write them to. */
export type Asked = Filter & {
  limit: number;
  save?: string | undefined;
  overwrite?: boolean | undefined;
};

/** What `network` answers with, cleaned as this server's policy has it. */
export function networkAnswers(ctx: ServerContext) {
  const clean = (t: string) => redactLog(ctx.policy, t);

  /** A request's headers and bodies, where the capture's way keeps them. */
  const detailOf = (s: Session, c: Capture | undefined) => async (id: number) =>
    c?.handle ? await s.device.network?.detail?.(c.handle, id) : undefined;

  const shownOf = (e: NetworkEntry) => ({
    ...e,
    ...(e.url && { url: clean(e.url) }),
    ...(e.error && { error: clean(e.error) }),
  });

  /** Every request asked for, past what an answer shows, as a HAR file: where it was written. */
  const exportHar = async (
    s: Session,
    c: Capture | undefined,
    entries: NetworkEntry[],
    asked: Asked,
  ) => {
    if (!asked.save) return undefined;
    const hits = entries.map(shownOf).filter((e) => e.url && !e.inFlight && fits(e, asked));
    const file = writeInside(
      /\.har$/i.test(asked.save) ? asked.save : `${asked.save}.har`,
      JSON.stringify(await harOf(hits, detailOf(s, c), clean)),
      asked.overwrite,
    );
    return `saved ${hits.length} requests as HAR 1.2 in ${file}`;
  };

  const answer = async (
    s: Session,
    c: Capture | undefined,
    { entries, note }: NetworkAnswer,
    asked: Asked,
    source: string,
    saved?: string,
  ) => {
    saved ??= await exportHar(s, c, entries, asked);
    const hits = entries.map(shownOf).filter((e) => !e.inFlight && fits(e, asked));
    const flying = flightLine(entries.map(shownOf));
    const ids = c?.bodies === true;
    const { kept, dropped } = boundLines(
      hits.map((e) => line(e, ids)),
      asked.limit,
    );
    const list = hits.slice(hits.length - kept.length);
    const withBody = list.filter((e) => e.body).length;
    const bodies = ids
      ? 'bodies: read with id gives one request whole'
      : list.some((e) => e.url) && list.some((e) => e.body !== undefined)
        ? `bodies: ${withBody} of ${list.length} in the export`
        : 'bodies: not by this way';
    const head = [
      `${list.length} of ${hits.length} from ${source}${c ? ` since ${new Date(c.since).toISOString()}` : ''}`,
      ...(note ? [note] : []),
      bodies,
      ...(saved ? [saved] : []),
    ];
    const rules = controlLines(c, entries).map((l) => redact(ctx.policy, l));
    return reply([...head, ...kept, ...flying, ...rules].join('\n'), {
      entries: list,
      dropped,
      source,
      bodies,
      ...(saved && { saved }),
      ...(note && { note }),
    });
  };

  /** What the capture's rules are and what each took, and its throttle: what `mock` and `throttle` answer with. */
  const controlAnswer = async (s: Session, c: Capture | undefined, did: string[]) => {
    const { entries } = (c && (await readCapture(s, c))) ?? { entries: [] };
    const rules = ruleHits(c?.rules ?? [], entries);
    const lines = controlLines(c, entries).map((l) => redact(ctx.policy, l));
    const t = [...did, ...(lines.length > 0 ? lines : ['no rule is set'])].join('\n');
    return reply(t, {
      done: t,
      rules: rules.map((r) => ({ ...r, rule: redact(ctx.policy, r.rule) })),
      throttle: c?.throttle ?? 'full',
    });
  };

  return { clean, shownOf, detailOf, exportHar, answer, controlAnswer };
}
