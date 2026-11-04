import { createHash, timingSafeEqual } from 'node:crypto';
import {
  createServer as createListener,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Op } from '@appdyno/ops';
import { createServer } from './server.js';

const PATH = '/mcp';
const MAX_BODY = 4 * 1024 * 1024;
/** Neither a hosted client nor this protocol says it has left: this long with no call means it has. */
const IDLE_MS = 10 * 60_000;
const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]'];

/** One client's tools, and how its time with the devices ends. */
export type Seat = { ops: Record<string, Op>; end(): Promise<void> };

export type HttpOptions = {
  host: string;
  /** 0 takes a free one. */
  port: number;
  token: string;
  open(): Seat;
  log(line: object): void;
  idleMs?: number;
};

/** A `--http` value: this Mac's own addresses and no others, as a phone is driven from here. */
export function listenOn(address: string) {
  const [, host, port] = /^(127\.\d+\.\d+\.\d+|localhost|\[::1\]):(\d+)$/.exec(address) ?? [];
  if (!host || Number(port) > 65_535)
    throw new Error(`--http listens on this Mac alone, as 127.0.0.1:<port>, not on ${address}`);
  return { host: host.replace(/^\[|\]$/g, ''), port: Number(port) };
}

const digest = (s: string) => createHash('sha256').update(s).digest();

function refuse(
  res: ServerResponse,
  status: number,
  message: string,
  id: unknown = null,
  headers: Record<string, string> = {},
) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message } }));
}

async function bodyOf(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY) return undefined;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    return undefined;
  }
}

/**
 * The same server over Streamable HTTP, on this Mac's loopback, behind a token and an `Origin` check.
 *
 * Stateless: a server and transport per POST, as a hosted client opens a session per tool call and drops it
 * with no word. What lasts is the seat: one context for one client, known by the name it gives, kept
 * across its connections until it has been idle for `idleMs`. Once it has called a tool another client is
 * refused; one that only looked holds nothing, or a health check would keep the next client out. The token
 * comes as a bearer header, or as the last part of the path for the hosted clients with no field for a
 * header. No host check: a tunnel sends its own name.
 */
export async function serveHttp({ host, port, token, open, log, idleMs = IDLE_MS }: HttpOptions) {
  let held: (Seat & { client?: string; acted?: boolean; since: string }) | undefined;
  let leaving: Promise<void> | undefined;
  let busy = 0;
  let idle: NodeJS.Timeout | undefined;
  /** Each call's way to stop it: a cancel comes by a POST of its own. */
  const running = new Map<unknown, () => void>();
  let origins = new Set<string>();

  const leave = () => {
    const seat = held;
    held = undefined;
    if (seat) leaving = seat.end().finally(() => (leaving = undefined));
  };

  const call = async (req: IncomingMessage, res: ServerResponse, body: unknown) => {
    await leaving;
    const message = (body ?? {}) as {
      id?: unknown;
      method?: string;
      params?: { requestId?: unknown };
    };
    if (message.method === 'notifications/cancelled') {
      running.get(message.params?.requestId)?.();
      res.writeHead(202).end();
      return;
    }
    const client = isInitializeRequest(body) ? body.params.clientInfo.name : undefined;
    if (client && held?.acted && held.client !== client) {
      log({ http: 'refused', status: 409, client, heldBy: held.client });
      refuse(
        res,
        409,
        `this server serves one client at a time and ${held.client} has held it since ${held.since}. It is free ${idleMs / 60_000} minutes after that client's last call, or when the server restarts`,
        message.id,
      );
      return;
    }
    // shortcut: a client that outlived its seat calls on with no name, so another may then take the seat
    // beside it; only `initialize` says who is calling, until protocol versions carry a client in each call
    held ??= { ...open(), since: new Date().toISOString() };
    if (client) held.client = client;
    held.acted ||= message.method === 'tools/call';
    const server = createServer(held.ops, log);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const stop = () => void server.close();
    if (message.id !== undefined) running.set(message.id, stop);
    // closing the server ends what its call was doing: nobody is left to answer
    res.once('close', () => {
      running.delete(message.id);
      stop();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  };

  const route = async (req: IncomingMessage, res: ServerResponse) => {
    const { origin } = req.headers;
    if (origin && !origins.has(origin)) {
      log({ http: 'refused', status: 403, origin });
      refuse(res, 403, `requests from ${origin} are not accepted`);
      return;
    }
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    if (pathname !== PATH && !pathname.startsWith(`${PATH}/`)) {
      refuse(res, 404, 'not found');
      return;
    }
    const given =
      pathname === PATH
        ? /^bearer (.+)$/i.exec(req.headers.authorization ?? '')?.[1]
        : pathname.slice(PATH.length + 1);
    if (!given || !timingSafeEqual(digest(given), digest(token))) {
      log({ http: 'refused', status: 401 });
      refuse(res, 401, 'a token is required', null, { 'www-authenticate': 'Bearer' });
      return;
    }
    if (req.method !== 'POST') {
      refuse(res, 405, 'POST only: this server keeps no sessions', null, { allow: 'POST' });
      return;
    }
    busy++;
    clearTimeout(idle);
    res.once('close', () => {
      if (--busy === 0 && held) idle = setTimeout(leave, idleMs);
    });
    const body = await bodyOf(req);
    if (body === undefined) refuse(res, 400, `the body must be JSON of at most ${MAX_BODY} bytes`);
    else await call(req, res, body);
  };

  const listener = createListener((req, res) => {
    route(req, res).catch((e: unknown) => {
      log({ http: 'failed', error: (e as Error)?.message ?? String(e) });
      if (res.headersSent) res.destroy();
      else refuse(res, 500, 'internal error');
    });
  });
  await new Promise<void>((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(port, host, resolve);
  });
  const bound = (listener.address() as AddressInfo).port;
  origins = new Set(LOOPBACK.map((h) => `http://${h}:${bound}`));

  return {
    url: `http://${host.includes(':') ? `[${host}]` : host}:${bound}${PATH}`,
    /** No more calls: those running stop, and the seat's conditions go back. */
    async stop() {
      clearTimeout(idle);
      const closed = new Promise((resolve) => listener.close(resolve));
      listener.closeAllConnections();
      await closed;
      leave();
      await leaving;
    },
  };
}
