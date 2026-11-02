import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DEFAULT_POLICY, opsFor, ServerContext } from '@appdyno/ops';
import { expect, it } from 'vitest';
import { createServer } from '../src/server.js';

it('keeps the tool catalog within its budget (phase 2 lowers it)', async () => {
  const ctx = new ServerContext(DEFAULT_POLICY, []);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer(opsFor(ctx), () => undefined).connect(a);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(b);
  const { tools } = await client.listTools();
  expect(tools).toHaveLength(Object.keys(opsFor(ctx)).length);
  expect(JSON.stringify({ tools }).length).toBeLessThanOrEqual(40_000);
});
