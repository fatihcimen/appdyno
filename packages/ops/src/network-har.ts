import { createReadStream } from 'node:fs';
import { must, type NetworkEntry } from '@appdyno/core';
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
