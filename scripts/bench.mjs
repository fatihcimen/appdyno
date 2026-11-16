#!/usr/bin/env node
// What a model pays to do a task through this server: its calls, its tokens and its time, on a simulator.
//   pnpm build && node scripts/bench.mjs <simulator id> [--tasks login,crash] [--model <name>] [--out <file.json>]
//   [--keep <dir>: each run's stream as the client wrote it]
//
// Each task is one run of an MCP client's command line in print mode (`claude -p`), which must be signed in. The
// client is given this checkout's server and nothing else: no other server, no tool of its own, none of this Mac's
// settings. Its stream says every call and the tokens the run took; what the task left on the device is then asked
// of the device, by a client of this script's own, so a model's word that it is done is no proof.
//
// The simulator is always named, and needs the fixture (dev.appdyno.fixture) installed. Four tasks run on the
// fixture; it has no settings screen, so `setting` runs in the simulator's own Settings app. A run costs model
// usage: one run a task, and no more than --budget dollars each (2 unless given).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { must } from '@appdyno/core';

const APP = 'dev.appdyno.fixture';
const SETTINGS = 'com.apple.Preferences';
const MAIN = join(import.meta.dirname, '../packages/appdyno/dist/main.js');
/** A run that takes longer is ended: a model that loops pays for every turn. */
const RUN_MS = 10 * 60_000;

const [udid = '', ...flags] = process.argv.slice(2);
/** @param {string} name */
const flag = (name) => {
  const at = flags.indexOf(`--${name}`);
  return at < 0 ? undefined : flags[at + 1];
};
if (!/^[0-9A-F]{8}-[0-9A-F-]{27}$/i.test(udid)) {
  console.error(
    'usage: bench.mjs <simulator id> [--tasks a,b] [--model name] [--budget usd] [--out file.json] [--keep dir]',
  );
  process.exit(2);
}

const state = mkdtempSync(join(tmpdir(), 'appdyno-bench-'));
const flowFile = join(state, 'form.flow');
/** The server as the client and this script both start it: one device, the two apps, a state folder of its own. */
const SERVER = {
  command: process.execPath,
  args: [
    MAIN,
    'mcp',
    ...['--device', udid, '--allow-devices', `^${udid}$`],
    ...['--app', APP, '--allow-apps', `${APP},${SETTINGS}`],
  ],
  env: { APPDYNO_STATE_DIR: state, APPDYNO_SILENT: '1' },
};

/**
 * A tool's answer as this script reads it.
 * @typedef {{
 *   isError?: boolean;
 *   content: { type: string; text?: string }[];
 *   structuredContent?: { matches?: unknown[]; reports?: unknown[] };
 * }} Answer
 * @typedef {(name: string, args?: Record<string, unknown>) => Promise<Answer & { text: string }>} Call
 */

/** @param {string[]} args */
const simctl = (...args) =>
  spawnSync('xcrun', ['simctl', ...args], { encoding: 'utf8' }).stdout.trim();

/**
 * The five tasks: what the model is asked, what is put back before it, and what proves it on the device after.
 * @type {Record<string, { ask: string; before?: () => void; done: (call: Call, said: string, since: string) => Promise<boolean> }>}
 */
const TASKS = {
  login: {
    ask: `In the app ${APP}, open the Form screen, enter the name Ada and the password hunter2, send the form, and tell me the line the app answers with.`,
    done: async (call, said) =>
      !(await call('check_element', { selector: { text: 'Sent: Ada' }, check: 'exists' }))
        .isError && said.includes('Sent: Ada'),
  },
  basket: {
    ask: `In the app ${APP}, open the List screen and put Product 1, Product 2 and Product 3 in the basket, one of each. Tell me what the three rows show after.`,
    done: async (call) =>
      (await call('read_screen', { selector: { text: 'In basket: 1' } })).structuredContent?.matches
        ?.length === 3,
  },
  setting: {
    ask: `In the Settings app (${SETTINGS}) of this simulator, find the Increase Contrast setting and turn it on. Tell me where it was.`,
    before: () => {
      simctl('ui', udid, 'increase_contrast', 'disabled');
      simctl('terminate', udid, SETTINGS);
    },
    done: () => Promise.resolve(simctl('ui', udid, 'increase_contrast') === 'enabled'),
  },
  crash: {
    ask: `In the app ${APP}, open the link appdyno-fixture://open/crash and press Crash. Tell me why the app died, with the log line that says so.`,
    done: async (call, said, since) => {
      // a simulator writes its report some seconds after the end
      for (let i = 0; i < 30; i++) {
        if (
          (await call('read_logs', { source: 'crashes', since })).structuredContent?.reports?.length
        )
          return /fixture crash/i.test(said);
        await new Promise((next) => setTimeout(next, 2_000));
      }
      return false;
    },
  },
  flow: {
    ask: `Record a flow in the app ${APP}: open the Form screen, type Ada as the name and send the form. Save the flow as ${flowFile}, then replay that file and tell me whether it passed.`,
    done: async (call) =>
      existsSync(flowFile) && !(await call('run_flow', { action: 'run', file: flowFile })).isError,
  },
};

/**
 * One line of the client's stream, as far as it is read here.
 * @typedef {{
 *   type: string;
 *   subtype?: string;
 *   model?: string;
 *   mcp_servers?: { name: string; status: string }[];
 *   message?: { id?: string; content?: { type: string; name?: string; content?: unknown }[] | string };
 *   result?: string;
 *   is_error?: boolean;
 *   num_turns?: number;
 *   total_cost_usd?: number;
 *   usage?: Record<string, number>;
 * }} Event
 */

/**
 * What a run's stream says it took: the calls of this server's tools, any other tool the client used, the characters
 * of the answers the model was handed and in which form, and the tokens of the whole run.
 * @param {string} stream
 */
function taken(stream) {
  const events = stream
    .split('\n')
    .filter((l) => l.startsWith('{'))
    .map((l) => {
      /** @type {unknown} */
      const parsed = JSON.parse(l);
      return /** @type {Event} */ (parsed);
    });
  const blocks = events.flatMap((e) =>
    Array.isArray(e.message?.content) ? e.message.content.map((b) => ({ ...b, of: e.type })) : [],
  );
  const used = blocks.flatMap((b) => (b.type === 'tool_use' && b.name ? [b.name] : []));
  const answers = blocks
    .filter((b) => b.type === 'tool_result')
    .flatMap((b) =>
      // a picture is no text: it is counted, and its bytes are not
      typeof b.content === 'string'
        ? [b.content]
        : /** @type {{ type: string; text?: string }[]} */ (b.content ?? []).map(
            (c) => c.text ?? '',
          ),
    );
  const end = events.findLast((e) => e.type === 'result');
  const init = events.find((e) => e.type === 'system' && e.subtype === 'init');
  const u = end?.usage ?? {};
  return {
    model: init?.model ?? '',
    connected: init?.mcp_servers?.some((s) => s.name === 'appdyno' && s.status === 'connected'),
    calls: used.filter((n) => n.startsWith('mcp__appdyno__')).map((n) => n.slice(14)),
    other: used.filter((n) => !n.startsWith('mcp__appdyno__')),
    answerChars: answers.reduce((n, a) => n + a.length, 0),
    pictures: answers.filter((a) => a === '').length,
    // a client hands a model an answer's text or its structured content, which starts with the text as a field
    handed: answers.some((a) => a.startsWith('{"text":')) ? 'structured' : 'text',
    input: u.input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    // a model may send several calls in one message: what it pays for is each request, with the whole context
    requests: new Set(events.flatMap((e) => (e.type === 'assistant' ? [e.message?.id] : []))).size,
    usd: end?.total_cost_usd ?? 0,
    said: end?.is_error ? '' : (end?.result ?? ''),
  };
}

/**
 * The client's one run of a task: its stream, and how long it took.
 * @param {string} ask
 */
async function runClient(ask) {
  const config = join(state, 'mcp.json');
  writeFileSync(config, JSON.stringify({ mcpServers: { appdyno: SERVER } }));
  const model = flag('model');
  const started = Date.now();
  const child = spawn(
    'claude',
    [
      ...['-p', ask, '--output-format', 'stream-json', '--verbose'],
      ...['--mcp-config', config, '--strict-mcp-config', '--allowedTools', 'mcp__appdyno'],
      ...['--tools', '', '--setting-sources', '', '--disable-slash-commands'],
      ...['--no-session-persistence', '--max-budget-usd', flag('budget') ?? '2'],
      ...(model ? ['--model', model] : []),
    ],
    // in a folder of its own: the client reads no project's instructions
    { cwd: state, stdio: ['ignore', 'pipe', 'inherit'], timeout: RUN_MS },
  );
  let stream = '';
  child.stdout.setEncoding('utf8').on('data', (/** @type {string} */ chunk) => (stream += chunk));
  await new Promise((done) => child.once('exit', done));
  return { stream, ms: Date.now() - started };
}

/** A client of this script's own on the same server, for what a task left on the device. */
async function checker() {
  const client = new Client({ name: 'bench', version: '1' });
  await client.connect(
    new StdioClientTransport({
      ...SERVER,
      env: { ...process.env, ...SERVER.env },
      stderr: 'ignore',
    }),
  );
  /** @type {Call} */
  const call = async (name, args = {}) => {
    const r = /** @type {Answer} */ (await client.callTool({ name, arguments: args }));
    return { ...r, text: r.content.map((c) => c.text ?? '').join('\n') };
  };
  return { call, close: () => client.close() };
}

const names = (flag('tasks') ?? Object.keys(TASKS).join(',')).split(',');
const rows = [];
try {
  for (const name of names) {
    const task = must(TASKS[name], `the task ${name}, one of ${Object.keys(TASKS).join(', ')}`);
    simctl('terminate', udid, APP);
    rmSync(flowFile, { force: true });
    task.before?.();
    const since = new Date().toISOString();
    const { stream, ms } = await runClient(task.ask);
    if (flag('keep')) writeFileSync(join(must(flag('keep'), 'a folder'), `${name}.jsonl`), stream);
    const { said, ...t } = taken(stream);
    const { call, close } = await checker();
    const ok = await task.done(call, said, since).catch(() => false);
    await close();
    rows.push({ task: name, ok, ...t, calls: t.calls.length, tools: t.calls.join(' '), ms });
    console.error(`${name}: ${ok ? 'done' : 'NOT done'}, ${String(t.calls.length)} calls`);
  }
} finally {
  // the iOS runner outlives the servers that started it: it is this folder's, and ends with it
  for (const pid of spawnSync('pgrep', ['-f', state], { encoding: 'utf8' }).stdout.split('\n'))
    if (pid) spawnSync('kill', [pid]);
  rmSync(state, { recursive: true, force: true });
}

const out = flag('out');
if (out) writeFileSync(out, `${JSON.stringify(rows, null, 2)}\n`);
console.log(
  '| task | done | calls | other tools | answers, chars | pictures | requests | input | cache write | cache read | output | s | handed |',
);
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const r of rows)
  console.log(
    `| ${r.task} | ${r.ok ? 'yes' : 'no'} | ${String(r.calls)} | ${r.other.join(' ') || '0'} | ${String(r.answerChars)} | ${String(r.pictures)} | ${String(r.requests)} | ${String(r.input)} | ${String(r.cacheWrite)} | ${String(r.cacheRead)} | ${String(r.output)} | ${(r.ms / 1000).toFixed(0)} | ${r.handed} |`,
  );
if (rows[0]) console.log(`\nmodel: ${rows[0].model}`);
if (rows.some((r) => !r.connected || r.other.length))
  console.log(
    'a run without this server, or with another tool, measures something else: see above',
  );
