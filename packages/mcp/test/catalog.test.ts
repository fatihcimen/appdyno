import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DEFAULT_POLICY, opsFor, ServerContext } from '@appdyno/ops';
import { expect, it } from 'vitest';
import { INSTRUCTIONS } from '../src/brand.js';
import { createServer } from '../src/server.js';

/** A client's search reads names and descriptions, and may read only the start: each word here finds its tool there. */
const SEARCHED: Record<string, string> = {
  emulator: 'simulator',
  simulator: 'simulator',
  'deep link': 'open_link',
  'dark mode': 'device_setting',
  fingerprint: 'device_setting',
  'face id': 'device_setting',
  'push notification': 'push',
  'universal link': 'open_link',
  'app link': 'open_link',
  'long press': 'gesture',
  landscape: 'set_orientation',
  gps: 'set_location',
  install: 'app',
  logcat: 'logs',
  anr: 'crashes',
  'screen mirror': 'mirror',
  'network traffic': 'network',
  'visual regression': 'visual',
  'accessibility tree': 'screen',
  performance: 'perf_snapshot',
  jank: 'perf_trace',
  startup: 'perf_launch',
  'memory leaks': 'perf_heap',
  'regression gate': 'perf_compare',
  'repeatable test': 'flow',
};

it('is found by the words people search for, where a search reads them', () => {
  const ops = opsFor(new ServerContext(DEFAULT_POLICY, []));
  const missed = Object.entries(SEARCHED).filter(
    ([word, tool]) => !ops[tool]!.description.slice(0, 200).toLowerCase().includes(word),
  );
  expect(missed).toEqual([]);
});

it('says what it is for first, within what a client keeps of its instructions', () => {
  expect(INSTRUCTIONS.length).toBeLessThanOrEqual(4_096);
  for (const word of ['iOS', 'Android', 'simulators', 'emulators', 'phones'])
    expect(INSTRUCTIONS.slice(0, 100)).toContain(word);
});

it('has every tool in the table of the docs, and what they say of steps as the tool says it', () => {
  const doc = readFileSync(new URL('../../../docs/reference/tools.md', import.meta.url), 'utf8');
  const ops = opsFor(new ServerContext(DEFAULT_POLICY, []));
  const start = doc.indexOf('| purpose');
  const table = doc.slice(start, doc.indexOf('\n\n', start));
  expect(Object.keys(ops).filter((name) => !table.includes(`\`${name}\``))).toEqual([]);
  const limit = /at most (\d+),/.exec(ops.steps!.description)?.[1];
  expect(doc).toContain(`\`steps\` runs up to ${limit} steps`);
  expect(doc).toContain(`${Object.keys(ops).length} tools`);
});

it('keeps the tool catalog within its budget', async () => {
  const ctx = new ServerContext(DEFAULT_POLICY, []);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer(opsFor(ctx), () => undefined).connect(a);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(b);
  const { tools } = await client.listTools();
  expect(tools).toHaveLength(Object.keys(opsFor(ctx)).length);
  expect(JSON.stringify({ tools }).length).toBeLessThanOrEqual(28_148);
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
