import {
  Client,
  StreamableHTTPClientTransport,
  type Transport,
} from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

/** A first `npx` downloads the package before anything answers. */
const PROBE_MS = 60_000;
const TAIL = 2_000;

/**
 * Whether a server answers as a client would find it. `missing`: no such command. `slow`: no answer in time. `ended`:
 * it stopped before it answered, with the end of what it said. `held`: another client has the server.
 */
export type Probe =
  | { ok: true; tools: number }
  | { ok: false; why: 'missing' | 'slow' | 'ended' | 'held'; tail?: string };

/** Starts as a client, says who it is and asks for the list: no tool is called, so nothing touches a device or counts as a call. */
async function listed(transport: Transport, heard: () => string, ms: number): Promise<Probe> {
  const client = new Client({ name: 'appdyno-check', version: '1' });
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<Probe>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, why: 'slow' }), ms);
  });
  const asked = (async (): Promise<Probe> => {
    await client.connect(transport);
    const { tools } = await client.listTools();
    return { ok: true, tools: tools.length };
  })().catch((e: unknown): Probe => {
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT')
      return { ok: false, why: 'missing' };
    const message = e instanceof Error ? e.message : String(e);
    if (/\b409\b/.test(message)) return { ok: false, why: 'held' };
    return { ok: false, why: 'ended', tail: heard() || message };
  });
  try {
    return await Promise.race([asked, late]);
  } finally {
    clearTimeout(timer);
    await client.close().catch(() => undefined);
  }
}

/** The command a client's entry runs, as that client would run it. */
export function probeCommand(
  o: { command: string; args: string[]; env: Record<string, string>; cwd?: string },
  ms = PROBE_MS,
) {
  const transport = new StdioClientTransport({
    command: o.command,
    args: o.args,
    env: o.env,
    ...(o.cwd && { cwd: o.cwd }),
    stderr: 'pipe',
  });
  let said = '';
  transport.stderr?.on('data', (chunk: Buffer) => {
    said = (said + chunk.toString()).slice(-TAIL);
  });
  return listed(transport, () => said.trim(), ms);
}

/** The server over HTTP, as a client on this Mac reaches it: what a tunnel would pass on. */
export function probeHttp(url: string, token: string, ms = PROBE_MS) {
  const headers = { authorization: `Bearer ${token}` };
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } });
  return listed(transport, () => '', ms);
}
