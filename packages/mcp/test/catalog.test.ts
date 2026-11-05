import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DEFAULT_POLICY, opsFor, ServerContext } from '@appdyno/ops';
import { expect, it } from 'vitest';
import { createServer } from '../src/server.js';

it('has every tool in the table of the README, and what it says of steps as the tool says it', () => {
  const readme = readFileSync(new URL('../../../README.md', import.meta.url), 'utf8');
  const ops = opsFor(new ServerContext(DEFAULT_POLICY, []));
  const start = readme.indexOf('| purpose');
  const table = readme.slice(start, readme.indexOf('\n\n', start));
  expect(Object.keys(ops).filter((name) => !table.includes(`\`${name}\``))).toEqual([]);
  const limit = /at most (\d+),/.exec(ops.steps!.description)?.[1];
  expect(readme).toContain(`\`steps\` runs up to ${limit} steps`);
});

it('keeps the tool catalog within its budget', async () => {
  const ctx = new ServerContext(DEFAULT_POLICY, []);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer(opsFor(ctx), () => undefined).connect(a);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(b);
  const { tools } = await client.listTools();
  expect(tools).toHaveLength(Object.keys(opsFor(ctx)).length);
  expect(JSON.stringify({ tools }).length).toBeLessThanOrEqual(26_615);
  expect(JSON.stringify(tools)).not.toMatch(
    /\$schema|taskSupport|"additionalProperties":false|"(minimum|maximum)":/,
  );
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
  // a limit stays out of the catalog, but the words of a tool do not deny one
  expect(tools.find((t) => t.name === 'type_text')!.description).toContain('up to 500 characters');
  expect(tools.every((t) => t.inputSchema.type === 'object')).toBe(true);
  expect(
    tools.filter((t) => 'device' in (t.inputSchema.properties ?? {})).map((t) => t.name),
  ).toEqual(['use_device']);
});
