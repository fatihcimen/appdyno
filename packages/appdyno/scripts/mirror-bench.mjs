// What a mirror does on one device, against its targets (docs/mirror.md): frames per second on the fixture,
// capture to arrival, touch to first changed frame, decode, and the viewer's own cost on a still screen.
// All arrive-on-Mac figures. Every number has the host's load beside it, and a miss above load 60 says
// "run it later": it is no proof either way. It reads the screen before it touches.
//
// Usage: node scripts/mirror-bench.mjs <device> [--seconds 12] [--taps 10] [--out file] [--window]
//        node scripts/mirror-bench.mjs <device> --soak <minutes>
// A soak holds a stream and touches the screen now and then: its memory and descriptors must stay flat, and
// frames must still move at its end.
// Build first. No device is ever a default.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { parseArgs } from 'node:util';
import {
  Adb,
  AndroidDevice,
  IosSimulatorDevice,
  MirrorSession,
  startViewer,
} from '../dist/index.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    seconds: { type: 'string', default: '12' },
    taps: { type: 'string', default: '10' },
    out: { type: 'string' },
    window: { type: 'boolean', default: false },
    soak: { type: 'string' },
  },
});
const serial = positionals[0];
if (!serial) {
  console.error(
    'usage: mirror-bench.mjs <device> [--seconds 12] [--taps 10] [--out file] [--window]',
  );
  process.exit(2);
}
const SECONDS = Number(values.seconds);
const TAPS = Number(values.taps);
const FIXTURE = 'dev.appdyno.fixture';
const LOAD_LIMIT = 60;

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const load = () => Number(loadavg()[0].toFixed(0));
const percentile = (values, p) => {
  const sorted = values.filter((v) => v >= 0).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : -1;
};
const median = (values) => percentile(values, 0.5);

const isUdid = /^[0-9A-F]{8}-/.test(serial);
const kind = isUdid ? 'simulator' : serial.startsWith('emulator-') ? 'emulator' : 'phone';
const adb = new Adb();
const device = isUdid ? new IosSimulatorDevice(serial) : new AndroidDevice(serial, adb);

const seconds = [];
const session = new MirrorSession({
  mirror: device.mirror,
  viewer: startViewer(!values.window),
  options: { quality: 'auto' },
  title: `bench ${serial}`,
  onChange: (s) => {
    if (s.stats && s.stats !== seconds.at(-1)) seconds.push(s.stats);
  },
});

const waitFor = async (what, test, ms = 120_000) => {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end)
      throw new Error(`no ${what} in ${ms} ms: ${JSON.stringify(session.status)}`);
    await pause(50);
  }
};

/** The numbers of the seconds from now, once they have passed. */
const during = async (ms) => {
  const from = seconds.length;
  await pause(ms);
  return seconds.slice(from);
};

/** A screen that has stopped moving: a second with no frame in it. */
const still = async (ms = 15_000) => {
  const from = seconds.length;
  await waitFor('still screen', () => seconds.slice(from).some((n) => n.arrived === 0), ms);
};

const adbShell = (cmd) => adb.exec(serial, cmd, { timeoutMs: 30_000 });

/** Android: the fixture's screen with a button that animates each vsync for 2 s, and where it is. */
async function prepareAndroid() {
  // what it left on another screen stays in front of a link to this one
  await adbShell(`am force-stop ${FIXTURE}`);
  await adbShell(
    `am start -W -a android.intent.action.VIEW -d appdyno-fixture://open/frames ${FIXTURE}`,
  );
  await pause(1_500);
  const { screen } = await device.open();
  const tree = await device.tree();
  const node = tree.nodes.find((n) => n.id?.endsWith('frames_light'));
  if (!node) throw new Error('the fixture frames screen is not on the device: install the fixture');
  const [left, top, right, bottom] = node.b;
  return { x: (left + right) / 2 / screen.w, y: (top + bottom) / 2 / screen.h, animateMs: 2_000 };
}

/**
 * A simulator: Settings, a long list on any simulator. The fixture's List sits behind iOS's question about
 * its link, and with no runner there is nothing here that reads the screen to answer it.
 */
async function prepareSimulator() {
  execFileSync('xcrun', ['simctl', 'launch', serial, 'com.apple.Preferences'], {
    encoding: 'utf8',
  });
  await pause(2_500);
  return { on: 'Settings' };
}

const tapAt = (x, y) => {
  session.send({ kind: 'touch', p: 0, x, y });
  session.send({ kind: 'touch', p: 2, x, y });
};

let dragUp = true;
/**
 * A flick along the list, and back along it on the next call: a list has an end. The list then coasts at the
 * display's own rate; a finger held on it would move it only as often as these moves come.
 */
const drag = async () => {
  const x = 0.5;
  const steps = 24;
  const [from, to] = dragUp ? [0.8, 0.2] : [0.2, 0.8];
  dragUp = !dragUp;
  session.send({ kind: 'touch', p: 0, x, y: from });
  for (let i = 1; i <= steps; i++) {
    session.send({ kind: 'touch', p: 1, x, y: from + ((to - from) * i) / steps });
    await pause(16);
  }
  session.send({ kind: 'touch', p: 2, x, y: to });
};

/** Frames a guest drew in that time, by its own count: a limit the path cannot beat. */
async function guestRate(act, ms) {
  const framesOf = async () =>
    Number(
      /Total frames rendered: (\d+)/.exec(await adbShell(`dumpsys gfxinfo ${FIXTURE}`))?.[1] ?? 0,
    );
  const before = await framesOf();
  await act();
  await pause(ms);
  return ((await framesOf()) - before) / (ms / 1000);
}

const result = { serial, kind, date: new Date().toISOString(), runs: [] };
const note = (name, value, target, ok) => {
  const row = { name, value, target, ok, load: load() };
  result.runs.push(row);
  const verdict =
    ok === undefined
      ? ''
      : ok
        ? 'ok'
        : row.load > LOAD_LIMIT
          ? 'miss, at high load: run it later'
          : 'MISS';
  console.log(
    `${name}: ${value}${target ? ` (target ${target})` : ''}, load ${row.load}${verdict ? `: ${verdict}` : ''}`,
  );
};

await session.start();
const opening = Date.now();
await waitFor('picture', () => session.status.state === 'live');
note('first picture', `${Date.now() - opening} ms`);
const picture = session.status.picture;
note('picture', `${picture.w}x${picture.h} ${picture.codec}`);

// the viewer on a still screen, after what starting it cost has passed
await pause(3_000);
const quiet = await during(5_000);
const cpu = median(quiet.map((n) => Number(n.cpu)));
note('still screen, viewer CPU', `${cpu} % of a core`, '<= 2', cpu <= 2);
const rss = Math.max(...quiet.map((n) => Number(n.rssMb)));
note('viewer RSS', `${rss} MB`, '< 150', rss < 150);

const prepared = isUdid ? await prepareSimulator() : await prepareAndroid();
if (prepared.on) note('on', prepared.on);
await still().catch(() =>
  note('still screen', 'never: a moving screen makes the touch figure mean nothing'),
);

if (values.soak) {
  const act = () => (isUdid ? drag() : tapAt(prepared.x, prepared.y));
  const end = Date.now() + Number(values.soak) * 60_000;
  await pause(60_000);
  const early = seconds.slice(-30);
  while (Date.now() < end) {
    await act();
    await pause(5_000);
  }
  const late = seconds.slice(-30);
  const top = (list, key) => Math.max(...list.map((n) => Number(n[key])));
  note(
    'RSS, a minute in and at the end',
    `${top(early, 'rssMb')}, ${top(late, 'rssMb')} MB`,
    'flat, < 150',
    top(late, 'rssMb') < 150 && top(late, 'rssMb') < top(early, 'rssMb') * 1.2,
  );
  note(
    'descriptors',
    `${top(early, 'fds')}, ${top(late, 'fds')}`,
    'no growth',
    top(late, 'fds') <= top(early, 'fds'),
  );
  note(
    'frames in the last 30 s',
    late.reduce((a, n) => a + Number(n.arrived), 0),
    'still moving',
    top(late, 'arrived') > 0,
  );
  note('state', session.status.state, 'live', session.status.state === 'live');
  await session.stop('the soak ended');
  device.close?.();
  if (values.out) writeFileSync(values.out, JSON.stringify(result, null, 2));
  process.exit(result.runs.some((r) => r.ok === false) ? 1 : 0);
}

// touch to first changed frame: from a still screen, so that the next frame is the touch's own
const touches = [];
for (let i = 0; i < TAPS; i++) {
  await still();
  const marked = session.mark();
  if (isUdid) void drag();
  else tapAt(prepared.x, prepared.y);
  touches.push(await Promise.race([marked, pause(5_000).then(() => -1)]));
  await pause(isUdid ? 1_000 : prepared.animateMs);
}
const touchTarget = { phone: 80, emulator: 120, simulator: 80 }[kind];
const touch = median(touches);
note(
  'touch to first changed frame, p50',
  `${touch} ms [${touches.join(', ')}]`,
  `<= ${touchTarget}`,
  touch >= 0 && touch <= touchTarget,
);

// frames per second while it moves: only full seconds of motion, the first and last are part still
await still();
let guest;
const moved = [];
const start = Date.now();
while (Date.now() - start < SECONDS * 1000) {
  const from = seconds.length;
  if (isUdid) await drag();
  else if (kind === 'emulator')
    guest = await guestRate(async () => tapAt(prepared.x, prepared.y), prepared.animateMs);
  else tapAt(prepared.x, prepared.y);
  await pause(isUdid ? 200 : kind === 'emulator' ? 500 : prepared.animateMs + 500);
  moved.push(...seconds.slice(from));
}
// a screen that coasts slows its own rate as it stops: only seconds of real motion say anything of this path
const fullSeconds = moved.filter((n) => Number(n.arrived) >= 30);
const fps = median(fullSeconds.map((n) => Number(n.arrived)));
const best = Math.max(...fullSeconds.map((n) => Number(n.arrived)));
const fpsTarget =
  kind === 'emulator'
    ? guest
      ? `>= ${(guest * 0.9).toFixed(1)} (90 % of the guest's ${guest.toFixed(1)})`
      : ''
    : kind === 'simulator'
      ? '>= 58'
      : '>= 59 at a 60 Hz display';
const fpsNeeded = kind === 'emulator' ? (guest ?? 0) * 0.9 : kind === 'simulator' ? 58 : 59;
note(
  'frames/s while moving, median',
  `${fps} (best ${best}; ${fullSeconds.length} s counted)`,
  fpsTarget,
  fps >= fpsNeeded,
);

const p95 = (key) => median(fullSeconds.map((n) => Number(n[key])));
if (kind === 'simulator') {
  const gap = p95('gapP95');
  note('frame gap p95', `${gap} ms`, '<= 20', gap <= 20);
}
if (kind === 'phone') {
  const c50 = p95('captureP50');
  const c95 = p95('captureP95');
  note('capture to arrival', `p50 ${c50}, p95 ${c95} ms`, '<= 35, <= 50', c50 <= 35 && c95 <= 50);
}
if (kind !== 'simulator') {
  const decode = p95('decodeP95');
  if (decode >= 0) note('decode p95', `${decode} ms`, '<= 8', decode <= 8);
}
note('Mbit/s', median(fullSeconds.map((n) => Number(n.mbps))));
note('mode', `${fullSeconds.at(-1)?.source} ${fullSeconds.at(-1)?.mode}`);

await session.stop('the bench ended');
device.close?.();
if (values.out) writeFileSync(values.out, JSON.stringify(result, null, 2));
const misses = result.runs.filter((r) => r.ok === false);
const proven = misses.filter((r) => r.load <= LOAD_LIMIT);
console.log(
  misses.length === 0
    ? 'all targets met'
    : `${misses.length} missed, of which ${proven.length} below load ${LOAD_LIMIT}`,
);
process.exit(proven.length ? 1 : 0);
