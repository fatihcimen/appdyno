import { createReadStream, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  deviceState,
  must,
  Owner,
  run,
  reportProgress,
  type NetworkAnswer,
  type NetworkEntry,
  type NetworkPath,
} from '@appdyno/core';
import { z } from 'zod';
import type { ServerContext } from './context.js';
import { restoreCondition, setCondition } from './settings.js';
import { boundLines } from './diagnose.js';
import { checkApp, redactLog } from './policy.js';
import { Handle, NetworkOut } from './schemas.js';
import type { Session } from './session.js';
import { defineOp, DESTRUCTIVE, reply, ToolError } from './tool.js';

const MAX_ENTRIES = 200;
const DEFAULT_ENTRIES = 50;
const VIA = ['proxy', 'probe', 'packets', 'bytes'] as const;

const SEES_PROXY =
  "every HTTP request of an app that keeps the system proxy, through a proxy you run; HTTPS shows only its host unless the proxy decrypts it, with its own CA on the device (this tool installs none). Bodies: only in the proxy's export, only where it decrypted. Pinned apps and apps that set no proxy do not show";

const Capture = z.object({
  via: z.enum(VIA),
  since: z.number(),
  handle: Handle.optional(),
  proxy: z.string().optional(),
  owner: Owner.optional(),
});
type Capture = z.infer<typeof Capture>;

/** The device's capture. */
export const captures = deviceState('network', Capture);

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

const PROXYMAN_CLI = [
  '/Applications/Proxyman.app/Contents/MacOS/proxyman-cli',
  '/Applications/Setapp/Proxyman.app/Contents/MacOS/proxyman-cli',
];

/** What a running Proxyman listening on `proxy`'s port has seen, if that is what `proxy` is. */
async function proxymanEntries(proxy: string | undefined, since: number) {
  const cli = PROXYMAN_CLI.find((p) => existsSync(p));
  if (!cli) return undefined;
  const host = await run(cli, ['proxy-host'], { timeout: 10_000 }).catch(() => undefined);
  const port = host && /"port"\s*:\s*(\d+)/.exec(host.stdout)?.[1];
  if (!port || !proxy?.endsWith(`:${port}`)) return undefined;
  const dir = mkdtempSync(join(tmpdir(), 'appdyno-har-'));
  try {
    const file = join(dir, 'export.har');
    await run(cli, ['export-log', '-m', 'all', '-f', 'har', '-o', file], { timeout: 300_000 });
    return await harEntries(file, since);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const listening = (hostPort: string) =>
  new Promise<boolean>((resolve) => {
    const [host, port] = hostPort.split(':');
    const c = connect({ host: must(host, 'a host'), port: Number(port), timeout: 2_000 });
    const done = (v: boolean) => {
      c.destroy();
      resolve(v);
    };
    c.once('connect', () => done(true));
    c.once('error', () => done(false));
    c.once('timeout', () => done(false));
  });

const line = (e: NetworkEntry) =>
  e.url
    ? `${e.method ?? 'GET'} ${e.url}${e.status ? ` ${e.status}` : ''}${e.ms !== undefined ? ` ${e.ms} ms` : ''}${e.bytes !== undefined ? ` ${e.bytes} B` : ''}${e.body ? ' (body in the export)' : ''}${e.error ? ` failed: ${e.error}` : ''}`
    : `${e.direction ?? ''} ${e.host ?? ''}: ${e.packets !== undefined ? `${e.packets} packets, ` : ''}${e.bytes ?? 0} B`.trim();

/** What a running capture has seen so far; none from a proxy whose list this tool cannot read. */
export async function readCapture(s: Session, c: Capture): Promise<NetworkAnswer | undefined> {
  if (c.via !== 'proxy')
    return must(s.device.network, "the device's capture").read(
      must(c.handle, "the capture's handle"),
    );
  const entries = await proxymanEntries(c.proxy, c.since);
  return entries && { entries };
}

/** Ends a device's capture, its proxy put back; what the way saw to the end. */
export async function endCapture(s: Session): Promise<NetworkAnswer | undefined> {
  const serial = s.device.serial;
  const c = captures.read(serial);
  if (!c) return undefined;
  let answer: NetworkAnswer = { entries: [] };
  try {
    if (c.handle && s.device.network) answer = await s.device.network.stop(c.handle);
  } finally {
    if (c.via === 'proxy') await restoreCondition(s, 'proxy');
    captures.remove(serial);
  }
  return answer;
}

export function networkOps(ctx: ServerContext) {
  const clean = (t: string) => redactLog(ctx.policy, t);

  const paths = async (s: Session): Promise<NetworkPath[]> => {
    const own = (await s.device.network?.paths()) ?? [];
    const proxy = await s.device.settings.get('proxy').then(
      (now) => ({ via: 'proxy' as const, sees: `${SEES_PROXY}. Now: ${now}` }),
      (e: unknown) => ({
        via: 'proxy' as const,
        refused: e instanceof Error ? e.message : String(e),
      }),
    );
    return [proxy, ...own];
  };

  const answer = (
    c: Capture | undefined,
    { entries, note }: NetworkAnswer,
    contains: string | undefined,
    limit: number,
    source: string,
  ) => {
    const shown = entries.map((e) => ({
      ...e,
      ...(e.url && { url: clean(e.url) }),
      ...(e.error && { error: clean(e.error) }),
    }));
    const hits = contains
      ? shown.filter((e) => `${e.url ?? ''} ${e.host ?? ''}`.includes(contains))
      : shown;
    const { kept, dropped } = boundLines(hits.map(line), limit);
    const list = hits.slice(hits.length - kept.length);
    const withBody = list.filter((e) => e.body).length;
    const bodies = !list.some((e) => e.url)
      ? 'bodies: not by this way'
      : list.some((e) => e.body !== undefined)
        ? `bodies: ${withBody} of ${list.length} in the export`
        : 'bodies: not by this way';
    const head = [
      `${list.length} of ${hits.length} from ${source}${c ? ` since ${new Date(c.since).toISOString()}` : ''}`,
      ...(note ? [note] : []),
      bodies,
    ];
    return reply([...head, ...kept].join('\n'), {
      entries: list,
      dropped,
      source,
      bodies,
      ...(note && { note }),
    });
  };

  return [
    defineOp({
      name: 'network',
      title: 'Network',
      description:
        "An app's network traffic (HTTP), bounded. paths: what each way sees here, or why not; start (via proxy: at proxy host:port; probe: restarts the app); read (har: a proxy's export); stop. Says when bodies are unavailable; installs no certificate.",
      input: z
        .object({
          action: z.enum(['paths', 'start', 'read', 'stop']),
          via: z.enum(VIA).optional(),
          proxy: z.string().max(100).optional(),
          app: z.string().max(200).optional(),
          har: z.string().max(1_000).optional(),
          contains: z.string().max(200).optional(),
          limit: z.number().int().min(1).max(MAX_ENTRIES).default(DEFAULT_ENTRIES),
        })
        .strict(),
      output: NetworkOut,
      annotations: DESTRUCTIVE,
      run: async ({ action, via, proxy, app, har, contains, limit }) => {
        const s = await ctx.session();
        const serial = s.device.serial;
        const now = captures.read(serial);
        if (action === 'paths') {
          const ways = await paths(s);
          const t = ways.map((p) => `${p.via}: ${p.sees ?? `no: ${String(p.refused)}`}`).join('\n');
          return reply(clean(t), { done: clean(t), paths: ways });
        }
        if (action === 'start') {
          if (!via) {
            const here = (await paths(s)).filter((p) => p.sees).map((p) => p.via);
            throw new ToolError(
              `start needs via: ${here.length ? `this device has ${here.join(', ')}` : `none of ${VIA.join(', ')} works on this device`}`,
              'INVALID_ARGUMENT',
              'network paths says what each sees, and what it costs',
            );
          }
          if (now)
            throw new ToolError(
              `${now.via} has been capturing on ${serial} since ${new Date(now.since).toISOString()}: stop it first`,
              'INVALID_ARGUMENT',
            );
          const target = app ?? s.appId;
          if (target) checkApp(ctx.policy, target);
          if (via === 'proxy') {
            const was = await s.device.settings.get('proxy');
            const want = proxy ?? was;
            if (want === 'none')
              throw new ToolError(
                `give proxy: host:port (this device has none set)`,
                'INVALID_ARGUMENT',
              );
            if (!/^[\w.-]+:\d+$/.test(want))
              throw new ToolError(`proxy: host:port, not ${want}`, 'INVALID_ARGUMENT');
            // a device left on a dead proxy has no network at all
            if (/^(127\.0\.0\.1|localhost):/.test(want) && !(await listening(want)))
              throw new ToolError(
                `nothing listens on ${want}: start your proxy first`,
                'NOT_FOUND',
              );
            if (was !== want) await setCondition(s, 'proxy', want);
            captures.write(serial, { via, since: Date.now(), proxy: want, owner: s.owner });
            const t = `traffic goes through ${want}${was === want ? ' (it already did)' : `, ${was} before`}. ${SEES_PROXY}`;
            return reply(t, { done: t });
          }
          if (!s.device.network)
            throw new ToolError(`this device has no ${via} way: use proxy`, 'UNSUPPORTED');
          const way = (await s.device.network.paths()).find((p) => p.via === via);
          if (way?.refused) throw new ToolError(way.refused, 'UNSUPPORTED');
          reportProgress(`starting ${via}`);
          const handle = await s.device.network.start(via, target);
          captures.write(serial, { via, since: Date.now(), handle, owner: s.owner });
          if (via === 'probe') s.acted();
          const t = `capturing by ${via}${via === 'probe' ? `: ${target ?? 'the app'} was restarted with it` : ''}${way?.sees ? `; it sees ${way.sees}` : ''}`;
          return reply(t, { done: t });
        }
        if (action === 'stop') {
          if (!now) throw new ToolError(`no capture runs on ${serial}`, 'NOT_FOUND');
          const end = await endCapture(s);
          return answer(now, end ?? { entries: [] }, contains, limit, now.via);
        }
        // read
        if (har) {
          if (!existsSync(har)) throw new ToolError(`no such file: ${har}`, 'NOT_FOUND');
          const entries = await harEntries(har, now?.since);
          return answer(now, { entries }, contains, limit, har);
        }
        if (!now)
          throw new ToolError(
            `no capture runs on ${serial}: start one, or give har (a proxy's export)`,
            'NOT_FOUND',
          );
        if (now.via === 'proxy') reportProgress('exporting from the proxy');
        const read = await readCapture(s, now);
        if (read)
          return answer(now, read, contains, limit, now.via === 'proxy' ? 'the proxy' : now.via);
        throw new ToolError(
          `the traffic went through ${String(now.proxy)}, whose list this tool cannot read: export the proxy's session as HAR and give har`,
          'UNSUPPORTED',
        );
      },
    }),
  ];
}
