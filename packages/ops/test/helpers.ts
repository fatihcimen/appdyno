import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Client,
  InMemoryTransport,
  StreamableHTTPClientTransport,
  type ElicitResult,
} from '@modelcontextprotocol/client';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { must } from '@appdyno/core';
import { createServer } from '@appdyno/mcp';
import { latestRuns, runKeys } from '@appdyno/perf';
import {
  DEFAULT_POLICY,
  opsFor,
  ServerContext,
  type Op,
  type OpData,
  type OpName,
} from '../src/index.js';
import { FakeDevice } from './fake-device.js';

/** The operations, each held to its output schema: an answer must be what that says, no more and no less. */
export const checkedOps = (ctx: ServerContext): Record<string, Op> =>
  Object.fromEntries(
    Object.entries(opsFor(ctx)).map(([name, op]) => [
      name,
      {
        ...op,
        handler: async (args) => {
          const r = await op.handler(args);
          op.output.strict().parse(r.data);
          return r;
        },
      },
    ]),
  );

/** Calls operations as their tools do: through their input schema, with their text and data back. */
export const callerOf = (ctx: ServerContext) => {
  const ops = checkedOps(ctx);
  return async <N extends OpName>(name: N, args: Record<string, unknown> = {}) => {
    const op = must(ops[name], `the op ${name}`);
    const r = await op.handler(op.input.parse(args));
    return {
      text: r.blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n'),
      data: r.data as OpData<N>,
    };
  };
};

/** One tool on a phone that answers `measures`: its answer, and what was kept of it, none if nothing was. */
export async function keptBy(
  tool: OpName,
  args: Record<string, unknown>,
  measures: Record<string, unknown>,
): Promise<{
  lines: string[];
  data: Record<string, unknown>;
  kept: { kind: string; value: number; source: string }[];
}> {
  const device = new FakeDevice();
  device.virtual = false;
  Object.defineProperty(device, 'measure', {
    value: { ...device.measure, ...measures },
  });
  const measurements = mkdtempSync(join(tmpdir(), 'appdyno-kept-'));
  const ctx = new ServerContext(
    DEFAULT_POLICY,
    [
      {
        list: () => Promise.resolve([{ serial: device.serial, state: 'device', ready: true }]),
        handles: () => true,
        open: () => device,
      },
    ],
    { device: device.serial, app: 'dev.app', measurements, perf: measurements },
  );
  const { text, data } = await callerOf(ctx)(tool, args);
  const [key] = await runKeys(measurements, { app: 'dev.app' });
  const run = key ? must((await latestRuns(measurements, key, 1))[0], 'the newest run') : [];
  return {
    lines: text.split('\n'),
    data,
    kept: run.map(({ kind, value, source }) => ({ kind, value, source })),
  };
}

/** The revisions the server serves: the newest of 2025's, and 2026-07-28, where no request goes back to a client. */
export const REVISIONS = ['2025-11-25', '2026-07-28'] as const;
export type Revision = (typeof REVISIONS)[number];

/**
 * A client of this context's server, in this process, on `revision`; with `answer`, one that shows the server's
 * questions to a person. No in-memory entry serves 2026-07-28: the HTTP one does, its fetch called here.
 */
export async function linkedClient(
  ctx: ServerContext,
  log: Parameters<typeof createServer>[1] = () => undefined,
  answer?: (question: string) => ElicitResult['action'],
  revision: Revision = '2025-11-25',
) {
  const ops = checkedOps(ctx);
  const client = new Client(
    { name: 'test', version: '0' },
    {
      ...(answer && { capabilities: { elicitation: {} } }),
      ...(revision === '2026-07-28' && { versionNegotiation: { mode: { pin: revision } } }),
    },
  );
  if (answer)
    client.setRequestHandler('elicitation/create', (r) => ({ action: answer(r.params.message) }));
  if (revision === '2026-07-28') {
    const handler = createMcpHandler(() => createServer(ops, log));
    const fetch = (url: string | URL, init?: RequestInit) => handler.fetch(new Request(url, init));
    await client.connect(
      new StreamableHTTPClientTransport(new URL('http://in.process/mcp'), { fetch }),
    );
  } else {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createServer(ops, log).connect(a);
    await client.connect(b);
  }
  return client;
}
