import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DEFAULT_POLICY, opsFor, ServerContext } from '@appdyno/ops';
import { expect, it } from 'vitest';
import { createServer } from '../src/server.js';

it('keeps the tool catalog within its budget', async () => {
  const ctx = new ServerContext(DEFAULT_POLICY, []);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer(opsFor(ctx), () => undefined).connect(a);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(b);
  const { tools } = await client.listTools();
  expect(tools).toHaveLength(Object.keys(opsFor(ctx)).length);
  expect(JSON.stringify({ tools }).length).toBeLessThanOrEqual(25_000);
  expect(JSON.stringify(tools)).not.toMatch(/\$schema|taskSupport|"additionalProperties":false/);
  expect(tools.every((t) => t.inputSchema.type === 'object')).toBe(true);
  expect(
    tools.filter((t) => 'device' in (t.inputSchema.properties ?? {})).map((t) => t.name),
  ).toEqual(['use_device']);
});
