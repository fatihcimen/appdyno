import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  buildScreen,
  MirrorSession,
  viewerBinary,
  ViewerProcess,
  type Device,
  type DeviceProvider,
  type ScreenElement,
} from '../packages/core/src/index.js';
import { AndroidDevice, FOCUS_READ } from '../packages/driver-android/src/index.js';
import { IosSimulatorDevice } from '../packages/driver-apple/src/index.js';
import { DEFAULT_POLICY, flowsFor, opsFor, ServerContext } from '../packages/ops/src/index.js';
import { windowControls, windowLook } from '../packages/hub/src/controls.js';
import { windowFlow } from '../packages/hub/src/flow.js';
import { windowMeasures } from '../packages/hub/src/measures.js';
import { untilWithin } from './until.js';

/**
 * A flow made by real clicks: a real window, kept off every screen, given the events a mouse sends, on our own
 * simulator (APPDYNO_IOS_UDID), Android device (APPDYNO_ANDROID_SERIAL) or iPhone (APPDYNO_IPHONE_UDID), each with the
 * fixture installed; never a default. What it writes is replayed through `flow` where it was made and on the other
 * kinds. The clicks' places come from a read of this test's own, so the recorder is told nothing but what a mouse would
 * tell it.
 */
const UDID = process.env.APPDYNO_IOS_UDID;
const SERIAL = process.env.APPDYNO_ANDROID_SERIAL;
const IPHONE = process.env.APPDYNO_IPHONE_UDID;
const BUILT = join(import.meta.dirname, '../packages/driver-apple/dist/index.js');
const APP = 'dev.appdyno.fixture';
const FORM = 'appdyno-fixture://open/form';
const LIST = 'appdyno-fixture://open/list';
const A11Y = 'appdyno-fixture://open/a11y';
const FRAMES = 'appdyno-fixture://open/frames';
const PASSWORD = 'p4ss-w0rd-7788';
/** A first use may start a runner, and compile the viewer. */
const LONG_MS = 300_000;
const TAPS = 15;
const AUDIT_MS = 200_000;
const HOVER_MS = 30_000;
/** A viewer's numbers are a second's. */
const STATS_MS = 1_100;
/** A scroll bar fades a moment after a list stops. */
const QUIET_SECONDS = 2;
const STILL_MS = 8_000;
const STILL_IPHONE_MS = 2_500;
/** What a click may gain from a recording: a display's tick or two, which no person feels. */
const ADDED_MS = 30;
/** Above this a Mac's own load is what is measured. */
const LOAD_LIMIT = 60;

const home = mkdtempSync(join(tmpdir(), 'appdyno-record-'));
mkdirSync(join(home, 'Desktop'));
// a flow's file goes under another HOME for a moment, and the state folder must not go with it
process.env.APPDYNO_STATE_DIR ??= join(home, 'state');
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

const until = untilWithin(60_000);

/** A link opens a screen from the app's first one: a screen left open may swallow it. */
const restart = async (device: Device) => {
  await device.open();
  await device.terminate(APP);
  await device.launch(APP);
  await pause(1_500);
};

const providerOf = (device: Device): DeviceProvider => ({
  list: async () => [{ serial: device.serial, state: 'device', ready: true }],
  handles: () => true,
  open: () => device,
});

/** The whole of a window's parent, as `appdyno mirror` makes it, with a window kept behind. */
async function windowOn(device: Device) {
  const ctx = new ServerContext(DEFAULT_POLICY, [providerOf(device)], {
    device: device.serial,
    app: APP,
  });
  const ops = opsFor(ctx);
  const binary = await viewerBinary();
  const hardware = await device.hardware();
  const told: Record<string, unknown>[] = [];
  const measures = windowMeasures(ctx, device);
  const controls = windowControls(device, hardware, () => session, measures);
  const flow = windowFlow(ctx, device, hardware, () => session, controls.measuring);
  const session: MirrorSession = new MirrorSession({
    mirror: device.mirror,
    viewer: async () => new ViewerProcess(binary, ['--behind']),
    options: { quality: 'auto' },
    title: 'a recording window',
    look: windowLook(hardware),
    press: controls.press,
    onWindow: (m) => {
      if (!flow.onWindow(m)) controls.onWindow(m);
    },
    onInput: flow.input,
  });
  const tell = session.tell.bind(session);
  session.tell = (m) => {
    told.push(m);
    tell(m);
  };
  await session.start();
  await until('a picture', () => session.status.state === 'live');
  const poke = (m: Record<string, unknown>) => session.tell({ op: 'poke', ...m });
  const flowSaid = () =>
    told.filter((m) => m.op === 'flow').at(-1) as
      { on: boolean; starting: boolean; lines: string[]; file?: string } | undefined;
  const size = () => device.hello!.screen;
  const screen = async () =>
    buildScreen(await device.tree(), { port: device.platformScreen, appId: APP });
  const place = (e: ScreenElement) => ({ x: e.x / size().w, y: e.y / size().h });
  /** An element of the screen as a person sees it: it may still be coming. */
  const element = async (test: (e: ScreenElement) => boolean, what: string) => {
    const end = Date.now() + 15_000;
    for (;;) {
      const hit = (await screen()).list.find(test);
      if (hit) return hit;
      if (Date.now() > end) throw new Error(`${what} is not on the screen`);
      await pause(200);
    }
  };
  /** A real click, and a person's pause before the next. */
  const click = async (id: string) => {
    poke(place(await element((e) => e.id === id, id)));
    await pause(900);
  };
  const type = async (text: string) => {
    for (const ch of text) {
      poke({ text: ch });
      await pause(30);
    }
    await pause(500);
  };
  const startRecording = async () => {
    poke({ control: 'recordFlow' });
    await until('a recording', () => flowSaid()?.on === true);
  };
  /** A flow's file goes on a Desktop of its own. */
  const onOwnDesktop = async (work: () => Promise<void>) => {
    const was = process.env.HOME;
    process.env.HOME = home;
    await work().finally(() => (process.env.HOME = was));
  };
  const stopRecording = async () => {
    await onOwnDesktop(async () => {
      poke({ control: 'recordFlow' });
      await until('a file', () => !!flowSaid()?.file);
    });
    return flowSaid()!.file!;
  };
  return {
    ops,
    session,
    sendsWhenStill: device.mirror.sendsWhenStill === true,
    told,
    poke,
    flowSaid,
    screen,
    place,
    element,
    click,
    type,
    startRecording,
    stopRecording,
    close: async () => {
      // a test that failed half way leaves a recording running
      await onOwnDesktop(() => flow.end());
      await controls.end();
      await session.stop('done');
    },
  };
}

/** What has the focus, with no agent: the Android device's. */
const focusIsFixture = async () =>
  execFileSync('adb', ['-s', SERIAL!, 'shell', FOCUS_READ], { encoding: 'utf8' }).includes(APP);

/** Where an element came to rest, as a fraction of the screen. */
const restingPlace = async (device: Device, id: string) => {
  let was = '';
  for (;;) {
    const now = buildScreen(await device.tree(), { port: device.platformScreen, appId: APP });
    const hit = now.list.find((e) => e.id === id);
    const place = hit && `${hit.x},${hit.y}`;
    if (place && place === was) {
      const { w, h } = device.hello!.screen;
      return { x: hit.x / w, y: hit.y / h };
    }
    was = place ?? '';
    await pause(400);
  }
};

const open = (w: Awaited<ReturnType<typeof windowOn>>, url: string) =>
  w.ops.open_link!.handler(w.ops.open_link!.input.parse({ url }));

/** A flow's run on a device of its own, as `appdyno flow run` runs it. */
const replay = async (device: Device, file: string) => {
  const ctx = new ServerContext(DEFAULT_POLICY, [providerOf(device)], {
    device: device.serial,
    app: APP,
  });
  await restart(device);
  const r = await flowsFor(ctx).replay(file, { params: { PASSWORD_INPUT: PASSWORD } });
  expect(r.failure?.message).toBeUndefined();
  return r;
};

/** A pointer resting on an element, moved a little as a hand does: a hover answers by what was last read. */
const hovering = async (
  w: Awaited<ReturnType<typeof windowOn>>,
  e: ScreenElement,
  done: () => boolean,
) => {
  const end = Date.now() + HOVER_MS;
  while (!done()) {
    if (Date.now() > end) throw new Error(`no answer for ${e.ref} in ${HOVER_MS} ms`);
    w.poke({ hover: true, ...w.place(e) });
    await pause(200);
  }
};

const form = async (w: Awaited<ReturnType<typeof windowOn>>) => {
  await w.startRecording();
  await open(w, FORM);
  await w.click('name_input');
  await w.type('Ada');
  await w.click('password_input');
  await w.type(PASSWORD);
  await w.click('submit');
  // the element inspector, on what the app came to
  await w.element((e) => e.id === 'result', 'the result');
  await pause(600);
  const result = await w.element((e) => e.id === 'result', 'the result');
  w.poke({ pane: 1 });
  await pause(400);
  await hovering(w, result, () => w.told.some((m) => m.op === 'element' && m.id === 'result'));
  w.poke({ click: 'assert' });
  await pause(200);
  w.poke(w.place(result));
  await until('an assertion', () => w.flowSaid()!.lines.some((l) => l.startsWith('assert')));
  w.poke({ click: 'touch' });
  await pause(200);
  return w.stopRecording();
};

const checkForm = (file: string) => {
  const text = readFileSync(file, 'utf8');
  expect(text).toContain(`app ${APP}`);
  expect(text).toContain('secret PASSWORD_INPUT');
  expect(text).toContain('type "${PASSWORD_INPUT}"');
  expect(text).toContain('tap id=name_input');
  expect(text).toContain('type "Ada"');
  expect(text).toContain('tap id=submit');
  expect(text).toContain('assert id=result check=text equals="Sent: Ada"');
  expect(text).not.toContain(PASSWORD);
  expect(text).not.toContain('!coordinates');
  return text;
};

/** A list a finger has left coasts for a while: a click aims at where things came to rest. */
const atRest = async (w: Awaited<ReturnType<typeof windowOn>>) => {
  let was = '';
  for (;;) {
    const now = (await w.screen()).list.map((e) => `${e.label} ${e.y}`).join();
    if (now === was) return;
    was = now;
    await pause(400);
  }
};

/** A screen goes on drawing for seconds after a touch: only on a still one is the next picture a click's own. */
const still = async (w: Awaited<ReturnType<typeof windowOn>>) => {
  // an iPhone's stream keeps sending on a still screen: time is all there is to go by
  if (w.sendsWhenStill) return pause(STILL_IPHONE_MS);
  const began = Date.now();
  let quiet = 0;
  while (quiet < QUIET_SECONDS && Date.now() - began < STILL_MS) {
    await pause(STATS_MS);
    quiet = w.session.status.stats?.arrived === 0 ? quiet + 1 : 0;
  }
};

/** What a click costs: from the click to the first picture it changed. A fixed place: only ever on the fixture. */
const clickMs = async (
  w: Awaited<ReturnType<typeof windowOn>>,
  add: { x: number; y: number },
  inFront: () => Promise<boolean>,
) => {
  const times: number[] = [];
  for (let i = 0; i < TAPS; i++) {
    await still(w);
    if (!(await inFront())) throw new Error('the fixture left the screen: no more clicks');
    const marked = w.session.mark();
    // what a click changes is lost in what an iPhone keeps sending: a flick along the list, and back, is told apart
    const way = i % 2 ? [0.25, 0.75] : [0.75, 0.25];
    w.poke(w.sendsWhenStill ? { x: 0.5, y: way[0], x2: 0.5, y2: way[1], seconds: 0.2 } : add);
    times.push(await Promise.race([marked, pause(3_000).then(() => -1)]));
  }
  return times.filter((t) => t >= 0);
};

const scrolled = async (w: Awaited<ReturnType<typeof windowOn>>) => {
  await w.startRecording();
  await open(w, LIST);
  await w.element((e) => e.label === 'Product 1', 'the first row');
  for (let i = 0; i < 2; i++) {
    w.poke({ x: 0.5, y: 0.75, x2: 0.5, y2: 0.3, seconds: 0.25 });
    await pause(1_200);
  }
  await atRest(w);
  const row = (await w.screen()).list.filter((e) => /^Product \d+$/.test(e.label)).at(-2)!;
  await pause(500);
  w.poke(w.place(row));
  await pause(900);
  w.poke({ ...w.place(row), right: true });
  await pause(1_500);
  w.poke({ button: 'home' });
  await pause(1_000);
  return w.stopRecording();
};

/** An iPhone's stream runs only from what is built, as a Node worker cannot start from sources. */
const builtPhone = async (): Promise<Device> => {
  const built = (await import(BUILT)) as { IosPhoneDevice: new (udid: string) => Device };
  return new built.IosPhoneDevice(IPHONE!);
};

const kinds = [
  { name: 'simulator', serial: UDID, device: async () => new IosSimulatorDevice(UDID!) },
  { name: 'Android', serial: SERIAL, device: async () => new AndroidDevice(SERIAL!) },
  { name: 'iPhone', serial: IPHONE, device: builtPhone },
];
const made = new Map<string, string>();

describe.each(kinds)('a flow recorded in a window on $name', ({ name, serial, device }) => {
  it.runIf(serial)(
    'writes clicks, typing, a password and an assertion by selector, and replays them',
    async () => {
      const d = await device();
      await restart(d);
      const w = await windowOn(d);
      try {
        const file = await form(w);
        console.log(`${name}, load ${loadavg()[0]!.toFixed(0)}:\n${checkForm(file)}`);
        made.set(name, file);
      } finally {
        await w.close();
      }
      await replay(await device(), made.get(name)!);
    },
    LONG_MS,
  );

  it.runIf(serial)(
    'turns swipes to what they reached, and takes a long press and Home',
    async () => {
      const d = await device();
      await restart(d);
      const w = await windowOn(d);
      let file: string;
      try {
        file = await scrolled(w);
      } finally {
        await w.close();
      }
      const text = readFileSync(file, 'utf8');
      console.log(`${name}:\n${text}`);
      expect(text).toMatch(/scroll_to .*text="Product \d+"/);
      expect(text).not.toMatch(/^swipe /m);
      expect(text).toMatch(/^tap .*text="Product \d+"/m);
      expect(text).toMatch(/^long_press .*text="Product \d+"/m);
      expect(text).toMatch(/^press_key home/m);
      await replay(await device(), file);
    },
    LONG_MS,
  );

  it.runIf(serial)(
    'says of what is under the pointer what an audit says, and moves nothing to read it',
    async () => {
      const d = await device();
      await restart(d);
      const w = await windowOn(d);
      try {
        await open(w, A11Y);
        const faint = await w.element((e) => e.id === 'a11y_faint', 'the faint text');
        w.poke({ pane: 1 });
        await pause(400);
        const said = () =>
          w.told.filter((m) => m.op === 'element' && m.id === 'a11y_faint').at(-1) as
            | { role: string; ref: string; selector: string; tap: string; contrast: string[] }
            | undefined;
        await hovering(w, faint, () => !!said());
        // an audit may have a runner to start, and answers with what is held
        await until('its contrast', () => (said()?.contrast.length ?? 0) > 0, AUDIT_MS);
        console.log(`${name}: ${JSON.stringify(said())}`);
        expect(said()).toMatchObject({ role: 'text', tap: 'tap id=a11y_faint' });
        expect(said()!.ref).toMatch(/^@/);
        expect(said()!.contrast.join()).toMatch(/contrast/i);
        const after = await w.element((e) => e.id === 'a11y_faint', 'the faint text');
        expect(after.rect).toEqual(faint.rect);
      } finally {
        await w.close();
      }
    },
    LONG_MS,
  );

  it.runIf(serial)(
    "adds little to a click's time",
    async () => {
      // the place is read on a connection of its own: a window with no recording holds no UI automation, and pays for none
      const android = name === 'Android';
      // a list's first Add may lie under a phone's status bar: the bench's button is clear of it, and draws each frame for 2 s
      const first = await device();
      await restart(first);
      await first.openUrl(android ? FRAMES : LIST, APP);
      const add = await restingPlace(first, android ? 'frames_light' : 'add_button');
      if (android) first.close();
      const d = android ? await device() : first;
      const w = await windowOn(d);
      const inFront = android ? focusIsFixture : async () => (await d.foreground()) === APP;
      try {
        const off = await clickMs(w, add, inFront);
        await w.startRecording();
        const on = await clickMs(w, add, inFront);
        const load = loadavg()[0]!.toFixed(0);
        console.log(`off ${off.join(' ')}\non ${on.join(' ')}`);
        console.log(
          `${name}: click to first changed picture, p50 ${median(off)} ms off, ${median(on)} ms on, ${TAPS} clicks each, load ${load}`,
        );
        expect(off.length).toBeGreaterThan(TAPS / 2);
        expect(on.length).toBeGreaterThan(TAPS / 2);
        if (Number(load) < LOAD_LIMIT) expect(median(on) - median(off)).toBeLessThan(ADDED_MS);
        await w.stopRecording();
      } finally {
        await w.close();
      }
    },
    LONG_MS,
  );
});

describe('a flow recorded on one kind', () => {
  it.for(kinds.flatMap((from) => kinds.filter((to) => to !== from).map((to) => ({ from, to }))))(
    'from $from.name replays on $to.name',
    { timeout: LONG_MS },
    async ({ from, to }, ctx) => {
      const file = made.get(from.name);
      if (!file || !to.serial) return ctx.skip();
      await replay(await to.device(), file);
    },
  );
});

afterAll(async () => {
  rmSync(home, { recursive: true, force: true });
  for (const { serial, device } of kinds) if (serial) await (await device()).terminate(APP);
});
