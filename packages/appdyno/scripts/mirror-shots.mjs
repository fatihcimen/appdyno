// Pictures of a window, in light and dark, with nothing brought forward: each viewer runs kept off every screen,
// is put in a state by its own messages, and is drawn by the window server. The screen is a real simulator's.
//
// Usage: node scripts/mirror-shots.mjs <simulator udid> <folder> [--model "iPhone 17 Pro"] [state...]
// Build first. No device is ever a default.
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { viewerBinary } from '@appdyno/core';

const SETTLE_MS = 900;
const FIRST_MS = 700;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { model: { type: 'string', default: 'iPhone 17 Pro' } },
});
const [udid, folder, ...only] = positionals;
if (!udid || !folder) {
  console.error('usage: mirror-shots.mjs <simulator udid> <folder> [--model name] [state...]');
  process.exit(2);
}

const live = { op: 'status', state: 'live' };
const CONTROLS = ['home', 'appSwitch', 'lock', 'volumeUp', 'volumeDown', 'siri', 'controlCenter'];
const call = (tool, ms, ok, args) => ({ op: 'activity', tool, ms, ok, args, time: '15:12:04' });

/** Each state as the messages that bring it about. */
const STATES = {
  window: [live],
  stats: [live, { op: 'poke', pane: 0 }, { pause: 2_500 }],
  activity: [
    live,
    { op: 'poke', pane: 1 },
    call('tap', 41, true, '{"text":"Settings"}'),
    call('screen', 88, true, '{}'),
    call('type_text', 310, true, '{"text":"11 characters"}'),
    call('launch_app', 1204, false, '{"app":"com.example.gone"}'),
  ],
  apps: [live, { op: 'poke', pane: 2 }, { pause: 1_000 }],
  flow: [
    live,
    {
      op: 'flow',
      on: true,
      lines: [
        'launch',
        'tap id=name_input',
        'type "Ada" replace',
        'tap id=password_input',
        'type "${PASSWORD_INPUT}" replace',
        'tap x=201 y=700 screen=402x874 !coordinates',
        'tap id=submit',
      ],
      look: ['step 6: coordinates'],
    },
    {
      op: 'element',
      role: 'button',
      label: 'Send',
      ref: '@45l2',
      id: 'submit',
      tap: 'tap id=submit',
      rect: { x: 0.04, y: 0.398, w: 0.097, h: 0.024 },
      contrast: ['text contrast 2.31:1 (#8E8E93 on #FFFFFF), under 4.5:1'],
    },
  ],
  asleep: [
    {
      op: 'status',
      state: 'waiting',
      title: 'The device is asleep',
      fix: 'Wake it, and the picture comes back by itself.',
    },
  ],
  handoff: [
    live,
    {
      op: 'banner',
      id: 'shot',
      text: 'Face ID needs a person: look at the phone, then carry on here.',
      needsDone: true,
    },
  ],
  driving: [live, { op: 'agent', driving: true, tool: 'tap' }],
  frameless: [live, { op: 'poke', control: 'frame' }],
};

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** One viewer, off every screen, and the file it wrote. */
async function shoot(binary, state, appearance) {
  const child = spawn(binary, ['--behind', '--appearance', appearance], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const send = (m) => child.stdin.write(`${JSON.stringify(m)}\n`);
  const waiting = new Map();
  let buffered = '';
  child.stdout.setEncoding('utf8').on('data', (s) => {
    buffered += s;
    for (let at = buffered.indexOf('\n'); at >= 0; at = buffered.indexOf('\n')) {
      const line = buffered.slice(0, at);
      buffered = buffered.slice(at + 1);
      if (!line.startsWith('{')) continue;
      const m = JSON.parse(line);
      waiting.get(m.op)?.(m);
    }
  });
  const until = (op) => new Promise((done) => waiting.set(op, done));
  const ready = until('ready');
  await ready;
  const first = until('first');
  send({
    op: 'attach',
    source: { kind: 'surface', udid },
    title: 'shots',
    input: true,
    look: {
      name: values.model,
      frame: { model: values.model, platform: 'ios' },
      controls: CONTROLS,
    },
  });
  await first;
  await pause(FIRST_MS);
  for (const m of STATES[state]) {
    if (m.pause) await pause(m.pause);
    else send(m);
  }
  await pause(SETTLE_MS);
  const file = join(resolve(folder), `${state}-${appearance}.png`);
  const snapped = until('snapped');
  send({ op: 'snapshot', file });
  const { ok } = await snapped;
  child.stdin.end();
  if (!ok) throw new Error(`no picture of ${state}, ${appearance}`);
  return file;
}

const binary = await viewerBinary();
for (const state of only.length ? only : Object.keys(STATES)) {
  if (!STATES[state]) throw new Error(`no such state: ${state}`);
  for (const appearance of ['light', 'dark']) console.log(await shoot(binary, state, appearance));
}
