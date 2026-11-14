import { DeviceError } from '@appdyno/protocol';

const CONNECT_MS = 5_000;
const CALL_MS = 15_000;

/** The Chrome DevTools Protocol over one WebSocket: calls, and the events it brings. */
export class CdpSession {
  private next = 1;
  private readonly waiting = new Map<number, (m: Message) => void>();
  private readonly listeners = new Map<string, ((params: Record<string, unknown>) => void)[]>();

  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(String(e.data)) as Message;
      if (m.id !== undefined) {
        this.waiting.get(m.id)?.(m);
        this.waiting.delete(m.id);
      } else if (m.method) for (const f of this.listeners.get(m.method) ?? []) f(m.params ?? {});
    });
    ws.addEventListener('close', () => {
      for (const w of this.waiting.values())
        w({ error: { message: 'the DevTools connection closed' } });
      this.waiting.clear();
    });
  }

  static open(url: string): Promise<CdpSession> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const fail = (why: string) =>
        reject(new DeviceError('AGENT_UNAVAILABLE', `DevTools at ${url}: ${why}`));
      const timer = setTimeout(() => {
        ws.close();
        fail(`no answer in ${CONNECT_MS} ms`);
      }, CONNECT_MS);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve(new CdpSession(ws));
      });
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        fail('the connection failed');
      });
    });
  }

  on(method: string, f: (params: Record<string, unknown>) => void) {
    this.listeners.set(method, [...(this.listeners.get(method) ?? []), f]);
  }

  send(method: string, params: Record<string, unknown> = {}, timeoutMs = CALL_MS) {
    const id = this.next++;
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new DeviceError('TIMEOUT', `DevTools ${method}: no answer in ${timeoutMs} ms`));
      }, timeoutMs);
      this.waiting.set(id, (m) => {
        clearTimeout(timer);
        if (m.error) reject(new DeviceError('INTERNAL', `DevTools ${method}: ${m.error.message}`));
        else resolve(m.result ?? {});
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** A JavaScript expression's value; a thrown error is a refusal with its text. */
  async evaluate(expression: string): Promise<unknown> {
    const r = (await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })) as {
      result?: { value?: unknown; description?: string };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    };
    if (r.exceptionDetails)
      throw new DeviceError(
        'INVALID_ARGUMENT',
        `the script threw: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? 'an error'}`,
      );
    return r.result?.value;
  }

  close() {
    this.ws.close();
  }
}

type Message = {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message: string };
};

/** A page or runtime as a DevTools endpoint lists it at `/json/list`. */
export type DevToolsTarget = {
  id: string;
  title?: string;
  url?: string;
  type?: string;
  description?: string;
  webSocketDebuggerUrl?: string;
};

/** This Mac, by any of its names. */
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];

/**
 * Whether a target's socket is where the endpoint that listed it is, this Mac and its port: what the list names is the
 * listing's to say, as an app on a device or any server on that port, and anywhere else it would have this Mac call.
 */
export function onEndpoint(base: string, socket: string) {
  // `URL.parse` came in Node 22.1, and engines lets 22.0 in
  const at = URL.canParse(socket) ? new URL(socket) : undefined;
  return (
    !!at &&
    ['ws:', 'wss:'].includes(at.protocol) &&
    !at.username &&
    !at.password &&
    LOOPBACK.includes(at.hostname) &&
    at.port === new URL(base).port
  );
}

export async function devToolsTargets(base: string): Promise<DevToolsTarget[]> {
  // a redirect is answered as it is: followed, it would send this Mac's request to any host
  const res = await fetch(`${base}/json/list`, {
    // a connection kept for a next request outlives a port forwarded for this one alone, and holds the app's socket
    headers: { connection: 'close' },
    redirect: 'manual',
    signal: AbortSignal.timeout(CONNECT_MS),
  });
  if (!res.ok) throw new DeviceError('INTERNAL', `${base}/json/list answered ${res.status}`);
  return (await res.json()) as DevToolsTarget[];
}
