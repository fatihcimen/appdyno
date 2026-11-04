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
  expect(JSON.stringify({ tools }).length).toBeLessThanOrEqual(26_615);
  expect(JSON.stringify(tools)).not.toMatch(/\$schema|taskSupport|"additionalProperties":false/);
  // what the server's instructions say once, and a test that sees it if the words on the tools change
  expect(JSON.stringify(tools)).not.toMatch(
    /"description":"(default: the selected app|kept under this name|iOS simulator: frame probe; relaunches the app)"/,
  );
  const flag = (op: string, name: string) =>
    (opsFor(ctx)[op]!.input.toJSONSchema().properties as Record<string, { description?: string }>)[
      name
    ]!.description;
  expect(flag('crashes', 'app')).toBe('default: the selected app');
  expect(flag('perf_snapshot', 'scenario')).toBe('kept under this name');
  expect(flag('perf_launch', 'probe')).toBe('iOS simulator: frame probe; relaunches the app');
  expect(tools.every((t) => t.inputSchema.type === 'object')).toBe(true);
  expect(
    tools.filter((t) => 'device' in (t.inputSchema.properties ?? {})).map((t) => t.name),
  ).toEqual(['use_device']);
});
