// What a mirror does on one device, against its targets (docs/reference/mirror.md): frames per second on the fixture,
// capture to arrival, touch to first changed frame, decode, and the viewer's own cost on a still screen.
// All arrive-on-Mac figures. Every number has the host's load beside it, and a miss above load 60 says
// "run it later": it is no proof either way. It reads the screen before it touches.
//
// Usage: node scripts/mirror-bench.mjs <device> [--seconds 12] [--taps 10] [--out file] [--window] [--wifi] [--max-size lines]
//        node scripts/mirror-bench.mjs <device> --soak <minutes>
// A soak holds a stream and touches the screen now and then: its memory and descriptors must stay flat, and
// frames must still move at its end.
// Build first. No device is ever a default.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { parseArgs } from 'node:util';
import { byMinute, quietAndBusy } from './mirror-bench-minutes.mjs';
import { MirrorSession, must, startViewer, ViewerProcess, viewerBinary } from '@appdyno/core';
import { Adb, AndroidDevice } from '@appdyno/driver-android';
import { IosPhoneDevice, IosSimulatorDevice } from '@appdyno/driver-apple';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    seconds: { type: 'string', default: '12' },
    taps: { type: 'string', default: '10' },
    out: { type: 'string' },
    window: { type: 'boolean', default: false },
    wifi: { type: 'boolean', default: false },
    soak: { type: 'string' },
    'max-size': { type: 'string' },
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

/** @param {number} ms */
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const load = () => Number(must(loadavg()[0], "the host's load").toFixed(0));
/**
 * @param {number[]} values
 * @param {number} p
 */
const percentile = (values, p) => {
  const sorted = values.filter((v) => v >= 0).sort((a, b) => a - b);
  return sorted.length
    ? must(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))], 'the percentile')
    : -1;
};
/** @param {number[]} values */
const median = (values) => percentile(values, 0.5);

const isIphone = /^[0-9A-F]{8}-[0-9A-F]{16}$/.test(serial);
const isUdid = !isIphone && /^[0-9A-F]{8}-/.test(serial);
const kind = isIphone
  ? 'iphone'
  : isUdid
    ? 'simulator'
    : serial.startsWith('emulator-')
      ? 'emulator'
      : 'phone';
const adb = new Adb();
const device = isIphone
  ? new IosPhoneDevice(serial)
  : isUdid
    ? new IosSimulatorDevice(serial)
    : new AndroidDevice(serial, adb);
// an Android phone at a size asked for, which `auto` then leaves alone, as touch follows a picture's pixels
if (values['max-size']) {
  const phone = /** @type {import('@appdyno/driver-android').AndroidMirror} */ (device.mirror);
  phone.open = (o) => phone.sourceWith(o, { maxSize: Number(values['max-size']) });
}

/** @typedef {import('@appdyno/core').MirrorStats} Stats */
/** @type {(Stats & { load: number })[]} */
const seconds = [];
/** @type {Stats | undefined} */
let lastStats;
const session = new MirrorSession({
  mirror: device.mirror,
  // a real window stays behind the others, on a Mac someone is using
  viewer: values.window
    ? async () => new ViewerProcess(await viewerBinary(), ['--behind'])
    : startViewer(true),
  options: { quality: 'auto', ...(values.wifi && { wifi: true }) },
  title: `bench ${serial}`,
  onChange: (s) => {
    if (s.stats && s.stats !== lastStats) {
      lastStats = s.stats;
      seconds.push({ ...s.stats, load: load() });
    }
  },
});

/**
 * @param {string} what
 * @param {() => boolean} test
 */
const waitFor = async (what, test, ms = 120_000) => {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end)
      throw new Error(`no ${what} in ${ms} ms: ${JSON.stringify(session.status)}`);
    await pause(50);
  }
};

/**
 * The numbers of the seconds from now, once they have passed.
 * @param {number} ms
 */
const during = async (ms) => {
  const from = seconds.length;
  await pause(ms);
  return seconds.slice(from);
};

/** A screen that has stopped moving: two seconds with no frame, as a scroll bar fades a moment after a list stops. */
const still = async (ms = 20_000) => {
  const from = seconds.length;
  await waitFor(
    'still screen',
    () => {
      const since = seconds.slice(from);
      return since.length >= 2 && since.slice(-2).every((n) => n.arrived === 0);
    },
    ms,
  );
};

/** @param {string} cmd */
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
  // a fresh start of the app on a loaded Mac is not drawn at once
  let node;
  for (let i = 0; i < 40 && !node; i++) {
    node = (await device.tree()).nodes.find((n) => n.id?.endsWith('frames_light'));
    if (!node) await pause(500);
  }
  if (!node) throw new Error('the fixture frames screen is not on the device: install the fixture');
  // the driver lets go: a person's window holds no UI automation, whose cost the app would pay
  device.close();
  const [left, top, right, bottom] = node.b;
  return { x: (left + right) / 2 / screen.w, y: (top + bottom) / 2 / screen.h, animateMs: 2_000 };
}

/**
 * A simulator: Settings, a long list on any simulator. The fixture's List sits behind iOS's question about
 * its link, and with no runner there is nothing here that reads the screen to answer it.
 */
const prepareSimulator = async () => {
  execFileSync('xcrun', ['simctl', 'launch', serial, 'com.apple.Preferences'], {
    encoding: 'utf8',
  });
  await pause(2_500);
  return { on: 'Settings' };
};

/**
 * An iPhone: the fixture's List, known to be on the screen before any touch, as a phone left alone may lock and a
 * blind flick on its home screen opens Spotlight. The runner reads the screen, and is let go of after.
 */
/**
 * @param {string} screen
 * @param {(e: import('@appdyno/core').Screen['list'][number]) => boolean} [wanted]
 */
const showOnIphone = async (screen, wanted) => {
  execFileSync(
    'xcrun',
    [
      'devicectl',
      'device',
      'process',
      'launch',
      '--device',
      serial,
      '--terminate-existing',
      '--payload-url',
      `appdyno-fixture://open/${screen}`,
      FIXTURE,
    ],
    { encoding: 'utf8', timeout: 60_000 },
  );
  await pause(1_500);
  if (!wanted) return;
  await device.open();
  // what the runner reads is the app it was told of
  await device.launch(FIXTURE);
  // the app's launch is on the screen for a moment first
  const end = Date.now() + 20_000;
  for (;;) {
    const { list } = await device.read(FIXTURE);
    if (list.some(wanted)) return;
    if (Date.now() > end) throw new Error(`the fixture's ${screen} is not on the phone's screen`);
    await pause(500);
  }
};

/** @param {import('@appdyno/core').Screen['list'][number]} e */
const isRow = (e) => e.id === 'row_name';

async function prepareIphone() {
  await showOnIphone('list', isRow);
  return { on: 'the fixture list' };
}

/**
 * @param {number} x
 * @param {number} y
 */
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

/** Frames a guest has drawn, by its own count: a limit the path cannot beat. */
const guestFrames = async () =>
  Number(
    /Total frames rendered: (\d+)/.exec(await adbShell(`dumpsys gfxinfo ${FIXTURE}`))?.[1] ?? 0,
  );

/** The rate a phone's display runs at now: a target of 60 frames says nothing of a 90 or 120 Hz panel. */
const displayHz = async () => {
  const rate = /renderFrameRate ([\d.]+)/.exec(await adbShell('dumpsys display'))?.[1];
  if (!rate) throw new Error("the display's rate is not in dumpsys display on this device");
  return Number(rate);
};

const result = {
  serial,
  kind,
  date: new Date().toISOString(),
  /** @type {{ name: string; value: unknown; target?: string; ok?: boolean; load: number }[]} */
  runs: [],
  /** @type {import('./mirror-bench-minutes.mjs').Minute[] | undefined} */
  minutes: undefined,
};
/**
 * @param {string} name
 * @param {string | number} value
 * @param {string} [target]
 * @param {boolean} [ok]
 */
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

/**
 * Ends it; of an iPhone, what its stream counted, and what the phone says of the stop.
 * @param {string} why
 */
const finish = async (why) => {
  const last = seconds.at(-1);
  if (isIphone && last) {
    note(
      'packets',
      `${String(last.lostPackets)} lost, ${String(last.latePackets)} late of ${String(last.packets)}; ${String(last.heldPictures)} pictures held, ${String(last.droppedPictures)} dropped`,
    );
    note(
      'freezes',
      `${String(last.freezes)}, longest ${String(last.longestFreezeMs)} ms, ${(Number(last.frozenMs) / 1000).toFixed(1)} s in all`,
    );
    const minutes = byMinute(seconds);
    for (const line of quietAndBusy(minutes, LOAD_LIMIT)) note('held', line);
    result.minutes = minutes;
    for (const m of minutes.filter((x) => x.lost || x.held)) {
      note(
        `minute ${m.minute}`,
        `${m.lost} lost, ${m.held} held, ${m.dropped} dropped, ${m.frozenMs} ms frozen, its thread away ${m.lagMs} ms at most, load up to ${m.load}`,
      );
    }
  }
  await session.stop(why);
  if (isIphone) {
    const proved = /** @type {{ stopProved?: boolean }} */ (device.mirror).stopProved;
    note(
      'the stop',
      proved ? 'the phone says it ended' : 'no word from the phone',
      'proved',
      proved === true,
    );
    await device.stopAgent().catch(() => undefined);
  }
  device.close();
};

await session.start();
const opening = Date.now();
await waitFor('picture', () => session.status.state === 'live');
note('first picture', `${Date.now() - opening} ms`);
const picture = session.status.picture;
if (!picture) throw new Error('live with no picture');
note('picture', `${picture.w}x${picture.h} ${picture.codec}`);

// the viewer on a still screen, after what starting it cost has passed
await pause(3_000);
const quiet = await during(5_000);
const cpu = median(quiet.map((n) => Number(n.cpu)));
const cpuLimit = isIphone ? 10 : 2;
note('still screen, viewer CPU', `${cpu} % of a core`, `<= ${cpuLimit}`, cpu <= cpuLimit);
const rss = Math.max(...quiet.map((n) => Number(n.rssMb)));
note('viewer RSS', `${rss} MB`, '< 150', rss < 150);

const prepared = isIphone
  ? await prepareIphone()
  : isUdid
    ? await prepareSimulator()
    : await prepareAndroid();
if ('on' in prepared) note('on', prepared.on);
/** Android's: the fixture's button that animates, and where it is. */
const button = 'x' in prepared ? prepared : undefined;
const settled = isIphone ? () => pause(1_500) : still;
await settled().catch(() =>
  note('still screen', 'never: a moving screen makes the touch figure mean nothing'),
);

if (values.soak) {
  // the heaviest a phone sends: nothing touches it, and a held stream was seen to keep it awake
  if (isIphone) await showOnIphone('noise');
  const act = async () => {
    if (button) tapAt(button.x, button.y);
    else if (isUdid) await drag();
  };
  const begun = Date.now();
  const end = begun + Number(values.soak) * 60_000;
  /** @type {typeof seconds | undefined} */
  let early;
  let soakMark = 0;
  while (Date.now() < end) {
    // from the start: a phone left alone for its minute goes dark
    await act();
    await pause(5_000);
    if (!early && Date.now() - begun > 60_000) early = seconds.slice(-30);
    const last = seconds.at(-1);
    if (isIphone && last && Math.floor((Date.now() - begun) / 300_000) !== soakMark) {
      soakMark = Math.floor((Date.now() - begun) / 300_000);
      note(
        `at ${soakMark * 5} min`,
        `${String(last.arrived)} frames/s, ${String(last.mbps)} Mbit/s, viewer ${String(last.rssMb)} MB, this process ${Math.round(process.memoryUsage().rss / 1e6)} MB`,
      );
    }
  }
  const late = seconds.slice(-30);
  /**
   * @param {typeof seconds | undefined} list
   * @param {string} key
   */
  const top = (list, key) =>
    Math.max(...must(list, 'a minute of the soak').map((n) => Number(n[key])));
  note(
    'RSS, a minute in and at the end',
    `${top(early, 'rssMb')}, ${top(late, 'rssMb')} MB`,
    'flat, < 150',
    top(late, 'rssMb') < 150 && top(late, 'rssMb') < top(early, 'rssMb') + 5,
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
  await finish('the soak ended');
  if (values.out) writeFileSync(values.out, JSON.stringify(result, null, 2));
  process.exit(result.runs.some((r) => r.ok === false) ? 1 : 0);
}

// touch to first changed frame: from a still screen, so that the next frame is the touch's own
const touches = [];
for (let i = 0; i < TAPS; i++) {
  await settled();
  const marked = session.mark();
  if (button) tapAt(button.x, button.y);
  else void drag();
  touches.push(await Promise.race([marked, pause(5_000).then(() => -1)]));
  await pause(button ? button.animateMs : 1_000);
}
const touchTarget = { phone: 80, emulator: 120, simulator: 80, iphone: 150 }[kind];
const touch = median(touches);
note(
  'touch to first changed frame, p50',
  `${touch} ms [${touches.join(', ')}]`,
  `<= ${touchTarget}`,
  touch >= 0 && touch <= touchTarget,
);

// frames per second while it moves: on Android the animation is kept going, so that every second is motion
if (isIphone) await showOnIphone('noise');
await settled();
const moved = [];
const guestBefore = kind === 'emulator' ? await guestFrames() : 0;
const start = Date.now();
while (Date.now() - start < SECONDS * 1000) {
  const from = seconds.length;
  if (isIphone) {
    await pause(1_000);
  } else if (button) {
    tapAt(button.x, button.y);
    await pause(button.animateMs - 100);
  } else {
    await drag();
    await pause(200);
  }
  moved.push(...seconds.slice(from));
}
const guest =
  kind === 'emulator'
    ? ((await guestFrames()) - guestBefore) / ((Date.now() - start) / 1000)
    : undefined;
// a screen that coasts slows its own rate as it stops: only seconds of real motion say anything of this path
const fullSeconds = moved.slice(1).filter((n) => Number(n.arrived) >= 30);
const fps = median(fullSeconds.map((n) => Number(n.arrived)));
const best = Math.max(...fullSeconds.map((n) => Number(n.arrived)));
const hz = kind === 'phone' ? await displayHz() : 60;
// what a phone's picture must hold is 60 frames, or all its display has: `auto` trades what is past that for a touch
const fpsNeeded =
  kind === 'emulator'
    ? (guest ?? 0) * 0.9
    : kind === 'phone'
      ? Math.min(59, Math.floor((hz * 59) / 60))
      : 58;
const fpsTarget =
  kind === 'emulator'
    ? guest
      ? `>= ${fpsNeeded.toFixed(1)} (90 % of the guest's ${guest.toFixed(1)})`
      : ''
    : kind === 'phone'
      ? `>= ${fpsNeeded} at its ${Math.round(hz)} Hz display`
      : '>= 58';
note(
  'frames/s while moving, median',
  `${fps} (best ${best}; ${fullSeconds.length} s counted)`,
  fpsTarget,
  fps >= fpsNeeded,
);

/** @param {string} key */
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
note(
  'mode',
  `${String(fullSeconds.at(-1)?.source)} ${String(fullSeconds.at(-1)?.mode)}, ${String(fullSeconds.at(-1)?.decoder)}`,
);
note('inputs', `${session.status.inputFailed} failed, ${session.status.inputDropped} moves merged`);

await finish('the bench ended');
if (values.out) writeFileSync(values.out, JSON.stringify(result, null, 2));
const misses = result.runs.filter((r) => r.ok === false);
const proven = misses.filter((r) => r.load <= LOAD_LIMIT);
console.log(
  misses.length === 0
    ? 'all targets met'
    : `${misses.length} missed, of which ${proven.length} below load ${LOAD_LIMIT}`,
);
process.exit(proven.length ? 1 : 0);
