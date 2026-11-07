#!/usr/bin/env node
// How fast this tool answers an MCP client: the table in docs/reference/perf.md, on the fixture app, on any device.
//   pnpm build && node scripts/speed.mjs <device id> [runs]
//
// Each run starts the server as a client does, then makes the common calls on the fixture, each proved by its
// answer: a tap that landed nowhere, or anything refused, stops the run. The device is always named, and it needs
// the fixture (dev.appdyno.fixture) installed. The fixture is stopped before each launch, so each is a cold one.
// A run before the measured ones starts what the device needs, and only its first read is kept, apart.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';

const APP = 'dev.appdyno.fixture';
const [serial, runs = '5'] = process.argv.slice(2);
if (!serial) {
  console.error('usage: speed.mjs <device id> [runs]');
  process.exit(2);
}
/** A simulator's or an iPhone's id, against an Android serial. */
const IOS = /^[0-9A-F]{8}-[0-9A-F]{4,}/i.test(serial);

/**
 * A server as a client starts one, over stdio, and what it says of each call on stderr. Its state folder lasts the
 * whole script, as a user's does.
 */
function server(state) {
  const child = spawn(
    process.execPath,
    [
      join(import.meta.dirname, '../packages/appdyno/dist/main.js'),
      'mcp',
      '--device',
      serial,
      '--allow-devices',
      `^${serial}$`,
      '--app',
      APP,
      '--allow-apps',
      APP,
    ],
    { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, APPDYNO_STATE_DIR: state } },
  );
  /** @type {Map<number, (message: any) => void>} */
  const waiting = new Map();
  /** @type {number[]} */
  const served = [];
  let nextId = 1;
  const lines = (stream, each) => {
    let buffered = '';
    stream.setEncoding('utf8').on('data', (chunk) => {
      buffered += chunk;
      for (let at = buffered.indexOf('\n'); at >= 0; at = buffered.indexOf('\n')) {
        each(buffered.slice(0, at));
        buffered = buffered.slice(at + 1);
      }
    });
  };
  lines(child.stdout, (line) => {
    const message = JSON.parse(line);
    waiting.get(message.id)?.(message);
  });
  // the server's own time of each call, from its log
  lines(child.stderr, (line) => {
    const said = line.startsWith('{') ? JSON.parse(line) : {};
    if (said.tool) served.push(said.ms);
  });
  const write = (message) =>
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  /** One request, timed around the whole round trip. */
  const request = async (method, params) => {
    const start = performance.now();
    /** @type {any} */
    const message = await new Promise((done) => {
      const id = nextId++;
      waiting.set(id, done);
      write({ id, method, params });
    });
    return { ms: performance.now() - start, message };
  };
  const ended = new Promise((done) => child.once('exit', done));
  return {
    request,
    write,
    /** What the server logged of the last call, once its line is in. */
    servedLast: async () => {
      for (let i = 0; served.length === 0 && i < 50; i++) await pause(10);
      return served.shift();
    },
    stop: async () => {
      // a server writes to its state folder as it ends
      child.kill();
      await ended;
    },
  };
}

const pause = (ms) => new Promise((done) => setTimeout(done, ms));

/** Each call's times: the client's round trip, the server's own, and the settle an action's answer says. */
/** @type {Map<string, { ms: number[]; served: number[]; settle: number[] }>} */
const times = new Map();
const timed = (what, ms, served, settle) => {
  const t = times.get(what) ?? { ms: [], served: [], settle: [] };
  t.ms.push(ms);
  if (served !== undefined) t.served.push(served);
  if (settle !== undefined) t.settle.push(settle);
  times.set(what, t);
};
/** @type {number[]} */
const loads = [];

/** One run: a new server, `initialize`, `tools/list`, then each call, proved by what it answers. */
async function run(s, warmUp) {
  const init = await s.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'speed', version: '1' },
  });
  s.write({ method: 'notifications/initialized' });
  const list = await s.request('tools/list', {});
  if (!list.message.result?.tools?.length) throw new Error('tools/list listed no tool');

  /**
   * One tool call; `proof` must be in its answer, in any case (Android's buttons say FORM). A refusal ends the run.
   * An untitled call is not kept.
   */
  const call = async (what, name, args, proof) => {
    const { ms, message } = await s.request('tools/call', { name, arguments: args });
    const served = await s.servedLast();
    const { result } = message;
    const text = result.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('\n');
    if (result.isError) throw new Error(`${name} refused: ${text.slice(0, 300)}`);
    const has = (word) => text.toLowerCase().includes(word.toLowerCase());
    const missing = proof && !(typeof proof === 'string' ? has(proof) : proof(result));
    if (missing) throw new Error(`${what || name}: no proof in its answer: ${text.slice(0, 300)}`);
    if (what && !warmUp) timed(what, ms, served, result.structuredContent?.settleMs);
    return { text, result };
  };

  const devices = await call('`list_devices`', 'list_devices', {}, serial);
  if (/held by pid/.test(devices.text.split('\n').find((l) => l.startsWith(serial)) ?? ''))
    throw new Error(`another process holds ${serial}: ${devices.text}`);
  const first = await s.request('tools/call', { name: 'screen', arguments: {} });
  if (first.message.result.isError) throw new Error('the first read was refused');
  timed(
    warmUp ? '`screen`, first of all: starts what the device needs' : '`screen`, first of a server',
    first.ms,
    await s.servedLast(),
  );
  if (warmUp) return;
  timed('`initialize`', init.ms);
  timed('`tools/list`', list.ms);

  await call('', 'terminate_app', {});
  const inFront = (r) => r.structuredContent?.foreground === APP;
  await call('`launch_app` of the fixture, cold', 'launch_app', { app: APP }, inFront);
  await call('`screen`', 'screen', {}, 'Form');
  // iOS has no back key: its back is the screen's own control
  const back = (what, proof) =>
    IOS
      ? call(what, 'tap', { selector: { text: 'Back', role: 'button' } }, proof)
      : call(what, 'press_key', { key: 'back' }, proof);
  // the first touch of a server and of an app's process pays for itself: the untimed one, before the two taps compared
  await call('', 'tap', { selector: { text: 'List' } }, 'Product 1');
  await call('`swipe`', 'swipe', { direction: 'up' }, (r) => r.structuredContent?.changed === true);
  await back('', 'Form');
  const found = await call(
    '`find`',
    'find',
    { text: 'Form' },
    (r) => r.structuredContent?.matches?.length === 1,
  );
  const at = found.result.structuredContent.matches[0];
  await call('`tap` by coordinate', 'tap', { x: at.x, y: at.y }, 'Send');
  // the home screen's title: a phone in Turkish says LİST
  await back('back', 'appdyno fixture');
  await call('`tap` by selector', 'tap', { selector: { text: 'Form' } }, 'Send');
  await call(
    '`type_text` into a field by selector',
    'type_text',
    { selector: { id: 'name_input' }, text: 'speed' },
    'speed',
  );
  await call('`wait_for` an element on the screen', 'wait_for', { text: 'Send' }, 'found');
  await call('`screenshot`', 'screenshot', {}, (r) => r.content.some((c) => c.type === 'image'));
  await call('`logs`, 20 lines', 'logs', { maxLines: 20 }, 'lines of');
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const state = mkdtempSync(join(tmpdir(), 'appdyno-speed-'));
let failed;
try {
  for (let i = 0; i <= Number(runs); i++) {
    loads.push(loadavg()[0]);
    const s = server(state);
    try {
      await run(s, i === 0);
    } finally {
      await s.stop();
    }
  }
} catch (e) {
  failed = e;
}
loads.push(loadavg()[0]);
rmSync(state, { recursive: true, force: true });
if (failed) {
  console.error(`stopped: ${failed.message}`);
  process.exit(1);
}

const ms = (values) => (values.length ? median(values).toFixed(0) : '');
console.log('| call | median, ms | worst, ms | in the server, median | settle, median |');
console.log('| ---- | ---------- | --------- | --------------------- | -------------- |');
for (const [what, t] of times)
  console.log(
    `| ${what} | ${ms(t.ms)} | ${Math.max(...t.ms).toFixed(0)} | ${ms(t.served)} | ${ms(t.settle)} |`,
  );
console.log(
  `\n${runs} runs on ${serial}, each with a new server, every call proved by its answer. Host load ${Math.min(...loads).toFixed(1)}-${Math.max(...loads).toFixed(1)}.`,
);
process.exit(0);
