#!/usr/bin/env node
// How fast this tool answers an MCP client: the table in docs/reference/perf.md, from a simulator's Settings app.
//   pnpm build && node scripts/speed.mjs <simulator id> [rounds]
//
// Each tap opens General, About, and the next read must find "Model" there: a tap that landed nowhere stops the run.
// The device is always named, and it needs only its own Settings.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';

const [udid, rounds = '12'] = process.argv.slice(2);
if (!udid) {
  console.error('usage: speed.mjs <simulator id> [rounds]');
  process.exit(2);
}

const state = mkdtempSync(join(tmpdir(), 'appdyno-speed-'));
const server = spawn(
  process.execPath,
  [
    join(import.meta.dirname, '../packages/appdyno/dist/main.js'),
    'mcp',
    '--device',
    udid,
    '--allow-devices',
    `^${udid}$`,
  ],
  { stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, APPDYNO_STATE_DIR: state } },
);

const write = (message) =>
  server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
const waiting = new Map();
let nextId = 1;
let buffered = '';
server.stdout.setEncoding('utf8').on('data', (chunk) => {
  buffered += chunk;
  for (let at = buffered.indexOf('\n'); at >= 0; at = buffered.indexOf('\n')) {
    const message = JSON.parse(buffered.slice(0, at));
    buffered = buffered.slice(at + 1);
    waiting.get(message.id)?.(message);
  }
});
const request = (method, params) =>
  new Promise((done) => {
    const id = nextId++;
    waiting.set(id, done);
    write({ id, method, params });
  });

/** One tool call as a client makes it, timed around the whole round trip. A refusal ends the run. */
async function call(name, args = {}) {
  const start = performance.now();
  const { result } = await request('tools/call', { name, arguments: args });
  const ms = performance.now() - start;
  const text = result.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('\n');
  if (result.isError) throw new Error(`${name} refused: ${text.slice(0, 200)}`);
  return { ms, text };
}

const pause = (ms) => new Promise((done) => setTimeout(done, ms));

/** Reads until the screen holds this word: how a tap is proved to have landed. */
async function until(word) {
  for (let i = 0; i < 40; i++) {
    if ((await call('screen')).text.includes(word)) return;
    await pause(100);
  }
  throw new Error(`no "${word}" on the screen`);
}

const backToGeneral = async () => {
  await pause(700);
  await call('tap', { selector: { text: 'General', role: 'button' }, read: 'none' });
  await until('Language & Region');
  await pause(900);
};

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

await request('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'speed', version: '1' },
});
write({ method: 'notifications/initialized' });

const loadBefore = loadavg()[0];
await call('open_link', { settings: 'general' });
await until('Language & Region');
await pause(800);
const { text: page } = await call('screen');
// rows alike share a header, `cell x=201 clickable:`, and each keeps its own y
const place = /x=(\d+)[^]*?"About" (\d+)/.exec(page);
if (!place) throw new Error('no row About on the screen');
const [x, y] = [Number(place[1]), Number(place[2])];

const ABOUT = { selector: { text: 'About' } };
const refOf = (text) => /(@\S+) "About"/.exec(text)?.[1];
/** @type {[string, (text: string) => object][]} */
const TAPS = [
  ['`tap` by coordinate, `read: none`', () => ({ x, y, read: 'none' })],
  ['`tap` by ref, `read: none`', (text) => ({ ref: refOf(text), read: 'none' })],
  ['`tap` by selector, `read: none`', () => ({ ...ABOUT, read: 'none' })],
  ['`tap` by selector, waits for the screen', () => ABOUT],
  ['`tap` by ref, waits for the screen', (text) => ({ ref: refOf(text) })],
];

/** @type {{ ms: number[]; chars: number[] }} */
const reads = { ms: [], chars: [] };
/** @type {[string, number[], number][]} */
const rows = [];
for (const [what, args] of TAPS) {
  /** @type {number[]} */
  const times = [];
  /** @type {number[]} */
  const chars = [];
  for (let i = 0; i < Number(rounds); i++) {
    const read = await call('screen');
    reads.ms.push(read.ms);
    reads.chars.push(read.text.length);
    const tap = await call('tap', args(read.text));
    times.push(tap.ms);
    chars.push(tap.text.length);
    await until('Model');
    await backToGeneral();
  }
  rows.push([what, times, median(chars)]);
}

const row = ([what, ms, chars]) =>
  `| ${what} | ${median(ms).toFixed(0)} | ${Math.min(...ms).toFixed(0)}-${Math.max(...ms).toFixed(0)} | ${chars.toLocaleString('en-US')} |`;
console.log('| call | median, ms | range, ms | answer, characters |');
console.log('| ---- | ---------- | --------- | ------------------ |');
console.log(row(['`screen`', reads.ms, median(reads.chars)]));
for (const each of rows) console.log(row(each));
console.log(
  `\n${rounds} rounds a tap, ${reads.ms.length} reads, every tap proved by the next read. Load ${loadBefore.toFixed(1)} before, ${loadavg()[0].toFixed(1)} after.`,
);

// a server writes to its state folder as it ends
const ended = new Promise((done) => server.once('exit', done));
server.kill();
await ended;
rmSync(state, { recursive: true, force: true });
process.exit(0);
