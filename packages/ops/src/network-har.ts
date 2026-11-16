import { createReadStream } from 'node:fs';
import { must, type NetworkDetail, type NetworkEntry } from '@appdyno/core';
import { ToolError } from './tool.js';

type HarEntry = {
  _id?: unknown;
  startedDateTime?: string;
  time?: number;
  request?: { method?: string; url?: string };
  response?: { status?: number; bodySize?: number; content?: { size?: number; text?: string } };
};

const toEntry = (e: HarEntry): NetworkEntry => ({
  ...(e.startedDateTime && { at: e.startedDateTime }),
  ...(e.request?.method && { method: e.request.method }),
  ...(e.request?.url && { url: e.request.url }),
  ...(e.response?.status !== undefined && { status: e.response.status }),
  ...(e.time !== undefined && { ms: Math.round(e.time) }),
  ...(e.response?.content?.size !== undefined && { bytes: e.response.content.size }),
  body: !!e.response?.content?.text,
});

/** Above this one entry is not parsed: a string cannot hold much more, and it is a body anyway. */
const MAX_ENTRY_BYTES = 256 * 1024 * 1024;
const ENTRIES = Buffer.from('"entries"');
const OPEN = 0x7b;
const CLOSE = 0x7d;
const QUOTE = 0x22;
const BACKSLASH = 0x5c;

/**
 * The requests of a HAR file (what a debugging proxy exports) from `since` on, one at a time:
 * a proxy's session reaches hundreds of megabytes, past what a string may hold.
 */
export async function harEntries(file: string, since?: number): Promise<NetworkEntry[]> {
  const out: NetworkEntry[] = [];
  let found = false;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let parts: Buffer[] = [];
  let size = 0;
  const finish = () => {
    if (size > MAX_ENTRY_BYTES) return;
    const e = JSON.parse(Buffer.concat(parts).toString('utf8')) as HarEntry;
    // Proxyman's whole-session export lists a request once per group it falls in
    if (e._id !== undefined && seen.has(e._id)) return;
    if (e._id !== undefined) seen.add(e._id);
    const at = e.startedDateTime ? Date.parse(e.startedDateTime) : undefined;
    if (since === undefined || at === undefined || at >= since) out.push(toEntry(e));
  };
  const seen = new Set<unknown>();
  let tail = Buffer.alloc(0);
  try {
    for await (const chunk of createReadStream(file) as AsyncIterable<Buffer>) {
      let b = chunk;
      if (!found) {
        const joined = Buffer.concat([tail, b]);
        const at = joined.indexOf(ENTRIES);
        if (at < 0) {
          tail = joined.subarray(Math.max(0, joined.length - ENTRIES.length));
          continue;
        }
        found = true;
        b = joined.subarray(at + ENTRIES.length);
      }
      let from = depth > 0 ? 0 : -1;
      for (let i = 0; i < b.length; i++) {
        const c = must(b[i], 'a byte');
        if (inString) {
          if (escaped) escaped = false;
          else if (c === BACKSLASH) escaped = true;
          else if (c === QUOTE) inString = false;
        } else if (c === QUOTE) inString = depth > 0;
        else if (c === OPEN) {
          if (depth++ === 0) from = i;
        } else if (c === CLOSE) {
          if (--depth === 0) {
            parts.push(b.subarray(from, i + 1));
            size += i + 1 - from;
            finish();
            parts = [];
            size = 0;
            from = -1;
          } else if (depth < 0) return out; // the end of `log`
        }
      }
      if (depth > 0 && from >= 0 && (size += b.length - from) <= MAX_ENTRY_BYTES)
        parts.push(b.subarray(from));
    }
  } catch (e) {
    throw new ToolError(`not a HAR file: ${(e as Error).message}`, 'INVALID_ARGUMENT');
  }
  if (!found) throw new ToolError(`not a HAR file: it has no entries`, 'INVALID_ARGUMENT');
  return out;
}

/**
 * Headers with what names a credential hidden, by the rules a log is read with: each goes through them as the line a
 * log would have it on, so `Authorization`, `Cookie`, `Set-Cookie` and a key or a token by its name lose their value.
 */
export const cleanHeaders = (clean: (text: string) => string, headers: Record<string, string>) =>
  Object.entries(headers).map(([name, value]) => ({
    name,
    value: clean(`${name}: ${value}`).slice(name.length + 2),
  }));

/** The revision of what this writes, which a HAR names its maker by. */
const HAR_WRITER = '1';

const typeOf = (headers: Record<string, string> | undefined) =>
  Object.entries(headers ?? {}).find(([name]) => /^content-type$/i.test(name))?.[1] ?? '';

const queryOf = (url: string) => {
  try {
    return [...new URL(url).searchParams].map(([name, value]) => ({ name, value }));
  } catch {
    return [];
  }
};

/**
 * A capture as HAR 1.2, what a proxy's viewer or `capture_network` `read` with `har` opens: each request with its headers and
 * text bodies where the capture kept them, all of it cleaned as an answer is, with the phases, the protocol and the
 * address the session measured where it sent the request; what a rule did to one is in `_how`.
 */
export async function harOf(
  entries: NetworkEntry[],
  detail: (id: number) => Promise<NetworkDetail | undefined>,
  clean: (text: string) => string,
) {
  const requests = entries.filter((e) => e.url);
  const list = await Promise.all(
    requests.map(async (e) => {
      const d = e.id === undefined ? undefined : await detail(e.id);
      const url = clean(e.url ?? '');
      const ms = e.ms ?? 0;
      const t = e.timings;
      const known = (n: number | undefined) => (n !== undefined && n >= 0 ? Math.round(n) : -1);
      return {
        startedDateTime: new Date((e.at ? Date.parse(e.at) : 0) - ms).toISOString(),
        time: ms,
        request: {
          method: e.method ?? 'GET',
          url,
          httpVersion: t?.proto ?? 'unknown',
          cookies: [],
          headers: cleanHeaders(clean, d?.requestHeaders ?? {}),
          queryString: queryOf(url),
          headersSize: -1,
          bodySize: d?.requestBodySize ?? -1,
          ...(d?.requestBody !== undefined && {
            postData: { mimeType: typeOf(d.requestHeaders), text: clean(d.requestBody) },
          }),
        },
        response: {
          status: e.status ?? 0,
          statusText: '',
          httpVersion: t?.proto ?? 'unknown',
          cookies: [],
          headers: cleanHeaders(clean, d?.responseHeaders ?? {}),
          content: {
            size: d?.responseBodySize ?? e.bytes ?? 0,
            mimeType: typeOf(d?.responseHeaders),
            ...(d?.responseBody !== undefined && { text: clean(d.responseBody) }),
          },
          redirectURL: '',
          headersSize: -1,
          bodySize: e.bytes ?? -1,
        },
        cache: {},
        // send, wait and receive are never unknown in a HAR: the whole time is the wait where no phase was measured
        timings: {
          blocked: -1,
          dns: known(t?.dns),
          connect: known(t?.connect),
          ssl: known(t?.tls),
          send: 0,
          wait: t && t.wait >= 0 ? Math.round(t.wait) : ms,
          receive: t && t.receive >= 0 ? Math.round(t.receive) : 0,
        },
        ...(t?.ip && { serverIPAddress: t.ip }),
        ...(e.how && { _how: e.how }),
        ...(e.error && { _error: clean(e.error) }),
      };
    }),
  );
  return {
    log: { version: '1.2', creator: { name: 'appdyno', version: HAR_WRITER }, entries: list },
  };
}
