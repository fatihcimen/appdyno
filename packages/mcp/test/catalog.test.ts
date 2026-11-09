import { readFileSync } from 'node:fs';
import {
  Client,
  InMemoryTransport,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { DATA_LOSS, DATA_LOSS_WORDS, DEFAULT_POLICY, opsFor, ServerContext } from '@appdyno/ops';
import { assert, expect, it } from 'vitest';
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
  const missed = Object.entries(SEARCHED).filter(([word, tool]) => {
    const op = ops[tool];
    assert(op, tool);
    return !op.description.slice(0, 200).toLowerCase().includes(word);
  });
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
  const limit = /at most (\d+),/.exec(ops.steps?.description ?? '')?.[1];
  assert(limit, 'steps says its limit');
  expect(doc).toContain(`\`steps\` runs up to ${limit} steps`);
  expect(doc).toContain(`${Object.keys(ops).length} tools`);
});

it('names in the docs and in its instructions each action that asks the person first, and no other', () => {
  const doc = readFileSync(new URL('../../../docs/reference/tools.md', import.meta.url), 'utf8');
  const start = doc.indexOf('## What asks the person first');
  const section = doc.slice(start, doc.indexOf('\n## ', start + 1));
  const listed = [...section.matchAll(/^- `([a-z_]+ [a-z_]+)`:/gm)].map((m) => m[1]);
  expect(listed.sort()).toEqual(Object.keys(DATA_LOSS).sort());
  expect(INSTRUCTIONS).toContain(`${DATA_LOSS_WORDS} ask the person first.`);
  expect(DATA_LOSS_WORDS).toContain('app revoke, app grant on an iPhone, device_setting keychain');
});

it('lists the same tools on both revisions, byte for byte, and says the same of itself', async () => {
  const ops = opsFor(new ServerContext(DEFAULT_POLICY, []));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer(ops, () => undefined).connect(a);
  const legacy = new Client({ name: 'test', version: '0' });
  await legacy.connect(b);
  // no in-memory entry serves 2026-07-28: the HTTP one does, its fetch called here
  const handler = createMcpHandler(() => createServer(ops, () => undefined));
  const modern = new Client(
    { name: 'test', version: '0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } },
  );
  const fetch = (url: string | URL, init?: RequestInit) => handler.fetch(new Request(url, init));
  await modern.connect(
    new StreamableHTTPClientTransport(new URL('http://in.process/mcp'), { fetch }),
  );
  expect([legacy, modern].map((c) => c.getNegotiatedProtocolVersion())).toEqual([
    '2025-11-25',
    '2026-07-28',
  ]);
  const [was, now] = await Promise.all([legacy, modern].map((c) => c.listTools()));
  assert(was && now);
  expect(JSON.stringify(now.tools)).toBe(JSON.stringify(was.tools));
  expect(modern.getServerVersion()).toEqual(legacy.getServerVersion());
  expect(modern.getInstructions()).toBe(INSTRUCTIONS);
  expect(modern.getServerCapabilities()).toEqual(legacy.getServerCapabilities());
});

it('keeps the tool catalog within its budget', async () => {
  const ctx = new ServerContext(DEFAULT_POLICY, []);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer(opsFor(ctx), () => undefined).connect(a);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(b);
  const { tools } = await client.listTools();
  expect(tools).toHaveLength(Object.keys(opsFor(ctx)).length);
  expect(JSON.stringify({ tools }).length).toBeLessThanOrEqual(27_584);
  expect(JSON.stringify(tools)).not.toMatch(
    /\$schema|taskSupport|"additionalProperties":false|"(minimum|maximum)":/,
  );
  // what the server's instructions say once, and a test that sees it if the words on the tools change
  expect(JSON.stringify(tools)).not.toMatch(
    /"description":"(default: the selected app|kept under this name|iOS simulator: frame probe; relaunches the app)"/,
  );
  const flag = (op: string, name: string) => {
    const properties = opsFor(ctx)[op]?.input.toJSONSchema().properties as
      Record<string, { description?: string }> | undefined;
    const property = properties?.[name];
    assert(property, `${op} has ${name}`);
    return property.description;
  };
  expect(flag('crashes', 'app')).toBe('default: the selected app');
  expect(flag('perf_snapshot', 'scenario')).toBe('kept under this name');
  expect(flag('perf_launch', 'probe')).toBe('iOS simulator: frame probe; relaunches the app');
  // a limit stays out of the catalog, but the words of a tool do not deny one
  const typeText = tools.find((t) => t.name === 'type_text');
  assert(typeText);
  expect(typeText.description).toContain('up to 500 characters');
  for (const t of tools) expect(t.inputSchema.type).toBe('object');
  expect(
    tools.filter((t) => 'device' in (t.inputSchema.properties ?? {})).map((t) => t.name),
  ).toEqual(['use_device']);
});
