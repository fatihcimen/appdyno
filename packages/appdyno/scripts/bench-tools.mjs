// Tool-level latency: the MCP tools as an agent calls them (in-process transport, real device), on the
// fixture app. Usage: node scripts/bench-tools.mjs <serial> [n]  (build first; run on a quiet machine)
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '@appdyno/mcp';
import { DEFAULT_POLICY, opsFor, ServerContext } from '@appdyno/ops';
import { Adb, androidProvider, stats } from '../dist/index.js';
import { timedCalls } from './timed.mjs';

const [serial, nArg] = process.argv.slice(2);
if (!serial) {
  console.error('usage: bench-tools.mjs <serial> [n]');
  process.exit(2);
}
const n = Number(nArg ?? 30);
const APP = 'dev.appdyno.fixture';
const adb = new Adb();
const ctx = new ServerContext(
  { ...DEFAULT_POLICY, devices: new RegExp(`^${serial}$`) },
  [androidProvider(adb)],
  {
    device: serial,
    app: APP,
  },
);
const server = createServer(opsFor(ctx), () => undefined);
const [a, b] = InMemoryTransport.createLinkedPair();
await server.connect(a);
const client = new Client({ name: 'bench', version: '0' });
await client.connect(b);
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) throw new Error(`${name}: ${r.content.map((c) => c.text).join(' ')}`);
  return r.content.map((c) => c.text ?? '').join('\n');
};
const ref = (text, label) => new RegExp(`(@[a-z0-9-]+) \\w+ "${label}"`).exec(text)?.[1];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const home = async () => {
  await adb.exec(serial, `am start -W -n ${APP}/.MainActivity -f 0x10008000`);
  await pause(1_200);
  return call('screen');
};
const out = {};
const measure = async (name, fn, between) => {
  const { ms, failed } = await timedCalls(n, fn, between);
  out[name] = stats(ms, failed);
  console.error(name, JSON.stringify(out[name]));
};

let screen = await home();
await measure('tool.screen', () => call('screen'));
const title = ref(screen, 'appdyno fixture');
await measure('tool.tap.unchanged', () => call('tap', { ref: title }));
await measure(
  'tool.tap.navigate',
  async () => {
    const s = await call('screen');
    await call('tap', { ref: ref(s, 'FORM') });
  },
  async () => {
    await call('press_key', { key: 'back', read: 'none' });
    await pause(800);
  },
);
await adb.exec(
  serial,
  `am start -W -a android.intent.action.VIEW -d appdyno-fixture://open/form ${APP}`,
);
await pause(1_200);
screen = await call('screen');
const field = ref(screen, 'Your name');
await measure('tool.type_text.20tr', () =>
  call('type_text', { ref: field, text: 'Çağrı İşgüzar Öğün Ş', replace: true }),
);
await home();
await measure('tool.screenshot', async () => {
  await call('tap', { ref: title, read: 'none' }); // a new action: the next screenshot is not a repeat
  await call('screenshot');
});
console.log(JSON.stringify(out, null, 2));
ctx.close();
process.exit(0);
