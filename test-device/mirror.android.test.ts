import { execFile, spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  decodePng,
  deviceStateFile,
  MirrorSession,
  viewerBinary,
  ViewerProcess,
  type Mirror,
  type MirrorOptions,
  type MirrorStatus,
} from '../packages/core/src/index.js';
import {
  Adb,
  AndroidDevice,
  AndroidEmulators,
  AndroidMirror,
} from '../packages/driver-android/src/index.js';
import { AndroidAgentLauncher } from '../packages/driver-android/src/agent.js';

/**
 * A mirror on an Android device we hold (APPDYNO_ANDROID_SERIAL; never a default), headless. On an emulator
 * the picture comes by gRPC, and a second part runs the agent's stream, which is the phone's path.
 */
const serial = process.env.APPDYNO_ANDROID_SERIAL;
const emulator = serial?.startsWith('emulator-') ?? false;

const until = async (what: string, test: () => boolean, ms = 60_000) => {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error(`no ${what} in ${ms} ms`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** How many displays of ours the device lists: one made directly, as on Android 11, only the compositor knows of. */
const displaysOf = async (adb: Adb, serial: string) =>
  (await adb.exec(serial, 'dumpsys display; dumpsys SurfaceFlinger')).match(/appdyno-mirror/g)
    ?.length ?? 0;

/** The compositor lets go a moment after the agent did. */
const noneLeft = async (adb: Adb, serial: string) => {
  const end = Date.now() + 10_000;
  while ((await displaysOf(adb, serial)) > 0 && Date.now() < end) await sleep(250);
  expect(await displaysOf(adb, serial)).toBe(0);
};

function start(mirror: Mirror) {
  const seen: MirrorStatus[] = [];
  let viewer: ViewerProcess | undefined;
  const session = new MirrorSession({
    mirror,
    viewer: async () => (viewer = new ViewerProcess(await viewerBinary(), ['--headless'])),
    options: { quality: 'auto' },
    title: 'a test',
    onChange: (s) => seen.push(s),
  });
  return { session, seen, viewerPid: () => viewer?.pid };
}

describe.runIf(serial)('the agent stream', () => {
  const adb = new Adb();
  const launcher = new AndroidAgentLauncher(adb, serial!);
  const stream = new AndroidMirror(adb, serial!, launcher);

  /** The mirror with something added to what a stream asks of the agent. */
  const asking = (start: Record<string, unknown>): Mirror =>
    Object.assign(Object.create(stream) as AndroidMirror, {
      open: (opts: MirrorOptions) => stream.sourceWith(opts, start),
    });

  beforeAll(async () => {
    await viewerBinary();
    await adb.exec(
      serial!,
      'am start -W -a android.intent.action.VIEW -d appdyno-fixture://open/frames dev.appdyno.fixture',
    );
  }, 300_000);

  afterAll(async () => stream.close());

  it('is live in moments, and costs no frame on a still screen', async () => {
    const { session } = start(stream);
    await session.start();
    await until('picture', () => session.status.state === 'live');
    expect(session.status.picture?.codec).toBe('h264');
    await sleep(4_000);
    expect(session.status.stats?.source).toBe('adb');
    expect(String(session.status.stats?.mode)).toContain('top');
    await session.stop('the test ended');
    await noneLeft(adb, serial!);
  }, 120_000);

  it('a person tap reaches the device, in fractions of its screen', async () => {
    const { session } = start(stream);
    await session.start();
    await until('picture', () => session.status.state === 'live');
    await sleep(1_500);
    const marked = session.mark();
    session.send({ kind: 'touch', p: 0, x: 0.5, y: 0.5 });
    session.send({ kind: 'touch', p: 2, x: 0.5, y: 0.5 });
    const ms = await Promise.race([marked, sleep(5_000).then(() => -1)]);
    console.log(`a tap to the next frame: ${ms} ms`);
    expect(session.status.inputFailed).toBe(0);
    await session.stop('the test ended');
  }, 120_000);

  it('the ladder: an encoder that fails is restarted, and each step is said', async () => {
    const { session } = start(asking({ failFirst: 2 }));
    await session.start();
    await until('picture', () => session.status.state === 'live');
    await until('numbers', () => String(session.status.stats?.mode ?? '') !== '');
    expect(String(session.status.stats?.mode)).toContain('restarted 2');
    await session.stop('the test ended');
  }, 120_000);

  it('the ladder to its end: stopped, with the reason', async () => {
    const { session } = start(asking({ failFirst: 1_000 }));
    await session.start();
    const status = await Promise.race([session.stopped, sleep(90_000).then(() => undefined)]);
    expect(status).toMatchObject({ state: 'stopped' });
    expect((status as { why: string }).why).toContain('no encoder took this display');
    await noneLeft(adb, serial!);
  }, 120_000);

  it('HEVC at the user word', async () => {
    const mirror = Object.assign(Object.create(stream) as AndroidMirror, {
      open: (opts: MirrorOptions) => stream.sourceWith({ ...opts, codec: 'hevc' }, {}),
    });
    const { session } = start(mirror);
    await session.start();
    await until('picture', () => session.status.state === 'live');
    expect(session.status.picture?.codec).toBe('hevc');
    await session.stop('the test ended');
  }, 120_000);

  it('a smaller size where one is asked: the picture is that, even and whole', async () => {
    const { session } = start(asking({ maxSize: 800 }));
    await session.start();
    await until('picture', () => session.status.state === 'live');
    const { picture } = session.status;
    expect(Math.max(picture!.w, picture!.h)).toBeLessThanOrEqual(800);
    expect(picture!.w % 8).toBe(0);
    await session.stop('the test ended');
  }, 120_000);

  it('a viewer killed: its stream ends with it, and a new one comes up by itself', async () => {
    const { session, seen, viewerPid } = start(stream);
    await session.start();
    await until('picture', () => session.status.state === 'live');
    const pid = viewerPid()!;
    const before = seen.length;
    process.kill(pid, 'SIGKILL');
    await until('a new picture', () => seen.slice(before).some((s) => s.state === 'live'));
    expect(viewerPid()).not.toBe(pid);
    await session.stop('the test ended');
  }, 120_000);

  it('a parent gone: the agent sees the end, and the display and codec are released', async () => {
    const { session, viewerPid } = start(stream);
    await session.start();
    await until('picture', () => session.status.state === 'live');
    expect(await displaysOf(adb, serial!)).toBeGreaterThan(0);
    // what a dying parent leaves: its viewer sees its stdin end, and goes; with it the connection
    process.kill(viewerPid()!, 'SIGKILL');
    await session.stop('the test ended');
    await noneLeft(adb, serial!);
  }, 120_000);

  it('the agent stopped: reconnects by the existing path', async () => {
    const { session, seen } = start(stream);
    await session.start();
    await until('picture', () => session.status.state === 'live');
    const before = seen.length;
    const { rpc } = await launcher.connect();
    await rpc.call('shutdown', {}, { timeoutMs: 5_000 }).catch(() => undefined);
    await until(
      'reconnecting',
      () => seen.slice(before).some((s) => s.state === 'reconnecting'),
      40_000,
    );
    await until('a new picture', () => seen.slice(before).some((s) => s.state === 'live'), 90_000);
    await session.stop('the test ended');
  }, 180_000);

  it('a screen put to sleep is named, and the picture comes back when it wakes', async () => {
    const { session, seen } = start(stream);
    await session.start();
    await until('picture', () => session.status.state === 'live');
    const before = seen.length;
    try {
      await adb.exec(serial!, 'input keyevent KEYCODE_SLEEP');
      await until(
        'its need',
        () => session.status.state === 'waiting' && session.status.need === 'asleep',
        20_000,
      );
    } finally {
      await adb.exec(serial!, 'input keyevent KEYCODE_WAKEUP');
    }
    await until('a new picture', () => seen.slice(before).some((s) => s.state === 'live'), 40_000);
    await adb.exec(serial!, 'wm dismiss-keyguard');
    await session.stop('the test ended');
  }, 120_000);

  it('rotation: the picture restarts at the new size, with no new session', async () => {
    const device = new AndroidDevice(serial!, adb);
    await device.open();
    const { session } = start(stream);
    await session.start();
    await until('picture', () => session.status.state === 'live');
    const portrait = session.status.picture!;
    try {
      await device.setOrientation(1);
      await until('landscape', () => session.status.picture!.w > session.status.picture!.h, 30_000);
      expect(session.status.state).toBe('live');
    } finally {
      await device.setOrientation(0);
      device.close();
    }
    await until('portrait', () => session.status.picture!.h === portrait.h, 30_000);
    await session.stop('the test ended');
  }, 120_000);
});

describe.runIf(serial && process.env.APPDYNO_MIRROR_WINDOW === '1')('the one real window', () => {
  it('shows the agent stream by its layer, and a click on the picture moves the fixture', async () => {
    const adb = new Adb();
    const device = new AndroidDevice(serial!, adb);
    const { screen } = await device.open();
    await adb.exec(serial!, 'am force-stop dev.appdyno.fixture');
    await adb.exec(
      serial!,
      'am start -W -a android.intent.action.VIEW -d appdyno-fixture://open/frames dev.appdyno.fixture',
    );
    let node;
    for (let i = 0; i < 40 && !node; i++) {
      node = (await device.tree()).nodes.find((n) => n.id?.endsWith('frames_light'));
      if (!node) await sleep(500);
    }
    device.close();
    expect(node).toBeDefined();
    const [left, top, right, bottom] = node!.b;
    const session = new MirrorSession({
      mirror: device.mirror,
      viewer: async () => new ViewerProcess(await viewerBinary(), ['--behind']),
      options: { quality: 'auto' },
      title: 'a test window',
    });
    await session.start();
    try {
      await until('picture', () => session.status.state === 'live');
      await sleep(2_000);
      const marked = session.mark();
      session.poke((left + right) / 2 / screen.w, (top + bottom) / 2 / screen.h);
      const ms = await Promise.race([marked, sleep(5_000).then(() => -1)]);
      console.log(`a click on the window to the next frame: ${ms} ms`);
      expect(ms).toBeGreaterThan(0);
      await sleep(1_500);
      // an emulator's picture is drawn by its own path, with no decoder's layer
      if (session.status.stats?.source !== 'pixels') {
        expect(session.status.stats?.layer).toBe('ok');
      }
      expect(Number(session.status.stats?.shown)).toBeGreaterThan(5);
    } finally {
      await session.stop('the test ended');
    }
  }, 180_000);
});

/** The command line itself, where the package is built: a parent is a process of its own. */
const MAIN = join(import.meta.dirname, '../packages/appdyno/dist/main.js');

describe.runIf(serial && existsSync(MAIN))('a parent on the command line', () => {
  const adb = new Adb();
  const launcher = new AndroidAgentLauncher(adb, serial!);
  const stateFile = deviceStateFile('mirror', serial!);
  const pidsOf = (pattern: string) =>
    spawnSync('pgrep', ['-f', pattern]).stdout.toString().trim().split('\n').filter(Boolean);

  // a file replaced is gone for a moment
  const stateText = () => {
    try {
      return readFileSync(stateFile, 'utf8');
    } catch {
      return '';
    }
  };
  const parents: ReturnType<typeof spawn>[] = [];
  afterAll(() => {
    for (const p of parents) p.kill();
  });

  const parent = () => {
    const child = spawn(
      process.execPath,
      [MAIN, 'mirror', '--device', serial!, '--headless', '--share'],
      { stdio: 'ignore' },
    );
    parents.push(child);
    return child;
  };

  it('killed outright: its viewer goes, the agent lets go of the display, and the next start is clean', async () => {
    const child = parent();
    await until('its file', () => existsSync(stateFile), 60_000);
    await until('a stream', () => stateText().includes('"state":"live"'), 120_000);
    // an emulator's picture comes by its own port, with no display of ours
    if (!emulator) expect(await displaysOf(adb, serial!)).toBeGreaterThan(0);
    const viewer = spawnSync('pgrep', ['-P', String(child.pid)])
      .stdout.toString()
      .trim();
    expect(viewer).not.toBe('');
    child.kill('SIGKILL');
    await until('the viewer gone', () => !pidsOf('appdyno-viewer').includes(viewer), 20_000);
    const { rpc } = await launcher.connect();
    const end = Date.now() + 15_000;
    let active = 1;
    while (active > 0 && Date.now() < end) {
      active = (await rpc.call('stream.status', {}, { timeoutMs: 5_000 })).result.active;
      await sleep(200);
    }
    expect(active).toBe(0);
    rpc.close();
    await noneLeft(adb, serial!);
    // its file is left, and is no mirror: the next start does not take it for one
    expect(existsSync(stateFile)).toBe(true);
    const next = parent();
    await until('the next start', () => stateText().includes(`"pid":${next.pid}`), 60_000);
    await until('its picture', () => stateText().includes('"state":"live"'), 120_000);
    // a second window on the device: refused, naming the first
    const second = spawnSync(
      process.execPath,
      [MAIN, 'mirror', '--device', serial!, '--headless', '--share'],
      {
        encoding: 'utf8',
        timeout: 60_000,
      },
    );
    expect(second.status).toBe(1);
    expect(second.stdout).toContain(`already has a window: pid ${next.pid}`);
    // asked to end, it ends what it opened, and leaves no file
    const status = spawnSync(process.execPath, [MAIN, 'mirror', 'status'], {
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(status.stdout).toContain(`${serial}: live`);
    // not a blocking call: the parent's end is seen only once this process has reaped it
    const closed = await promisify(execFile)(process.execPath, [
      MAIN,
      'mirror',
      'close',
      '--device',
      serial!,
    ]);
    expect(closed.stdout + closed.stderr).toContain('closed the mirror');
    await until('its file gone', () => !existsSync(stateFile), 20_000);
  }, 300_000);
});

describe.runIf(emulator)('an emulator picture by gRPC', () => {
  const adb = new Adb();
  const device = new AndroidDevice(serial!, adb);

  afterAll(() => device.close());

  it('one frame from the shared file is the screen, right side up and whole', async () => {
    const { session } = start(device.mirror);
    await viewerBinary();
    await session.start();
    await until('picture', () => session.status.state === 'live');
    expect(session.status.picture?.codec).toBe('pixels');
    expect(session.status.note).toBeUndefined();
    await sleep(3_000);
    const { w, h } = session.status.picture!;
    const file = deviceStateFile('mirror', serial!).replace(/\.json$/, `-${process.pid}.rgba`);
    const pixels = readFileSync(file).subarray(0, w * h * 4);
    const png = decodePng(await adb.execBuffer(serial!, 'screencap -p'))!;
    expect([png.width, png.height]).toEqual([w, h]);
    // a still screen: every row of the file's frame is the same row of the device's own screenshot
    let far = 0;
    const { channels } = png;
    const statusBar = Math.floor(h * 0.05);
    for (let y = statusBar; y < h; y += 7)
      for (let x = 0; x < w; x += 7) {
        const a = (y * w + x) * 4;
        const b = (y * w + x) * channels;
        const d =
          Math.abs(pixels[a]! - png.data[b]!) +
          Math.abs(pixels[a + 1]! - png.data[b + 1]!) +
          Math.abs(pixels[a + 2]! - png.data[b + 2]!);
        if (d > 24) far++;
      }
    const samples = Math.ceil((h - statusBar) / 7) * Math.ceil(w / 7);
    console.log(`file against screenshot: ${far} of ${samples} samples differ`);
    expect(far / samples).toBeLessThan(0.02);
    await session.stop('the test ended');
  }, 180_000);

  it('a guest that turns: the picture stands up, at the turned size, with no new session', async () => {
    const { session } = start(device.mirror);
    await session.start();
    await until('picture', () => session.status.state === 'live');
    const { w, h } = session.status.picture!;
    await device.open();
    try {
      await device.setOrientation(1);
      await until('a turned picture', () => session.status.picture!.w === h, 30_000);
      expect(session.status.picture!.h).toBe(w);
      expect(session.status.state).toBe('live');
    } finally {
      await device.setOrientation(0);
    }
    await until('upright again', () => session.status.picture!.w === w, 30_000);
    await session.stop('the test ended');
  }, 120_000);

  it('a viewer killed: the picture comes back from the same emulator, with no agent restarted', async () => {
    const { session, seen, viewerPid } = start(device.mirror);
    await session.start();
    await until('picture', () => session.status.state === 'live');
    const pid = viewerPid()!;
    const before = seen.length;
    process.kill(pid, 'SIGKILL');
    await until('a new picture', () => seen.slice(before).some((s) => s.state === 'live'));
    expect(viewerPid()).not.toBe(pid);
    await session.stop('the test ended');
  }, 120_000);

  it('ticks follow the fixture while it moves, and stop when it stops', async () => {
    await adb.exec(
      serial!,
      'am start -W -a android.intent.action.VIEW -d appdyno-fixture://open/ticker dev.appdyno.fixture',
    );
    const { session, seen } = start(device.mirror);
    await session.start();
    await until('picture', () => session.status.state === 'live');
    await sleep(4_000);
    const arrived = seen.flatMap((s) => (s.stats ? [Number(s.stats.arrived)] : []));
    expect(Math.max(...arrived)).toBeGreaterThan(0);
    await session.stop('the test ended');
  }, 120_000);
});

/**
 * Unplugged, as near as an emulator comes: it is killed under the stream and booted again by `simulator`'s own
 * path, so that this also runs its gRPC flags. Names our own AVD; it costs a whole boot.
 */
const avd = process.env.APPDYNO_MIRROR_RESTART_AVD;

describe.runIf(emulator && avd)('an emulator killed under its stream', () => {
  it('waits with its need, and is live again once it is back', async () => {
    const adb = new Adb();
    const device = new AndroidDevice(serial!, adb);
    const { session, seen } = start(device.mirror);
    await session.start();
    await until('picture', () => session.status.state === 'live', 120_000);
    await adb.run(['-s', serial!, 'emu', 'kill'], 30_000);
    await until(
      'its need',
      () => session.status.state === 'waiting' && session.status.need === 'not-connected',
      60_000,
    );
    const back = seen.length;
    await new AndroidEmulators(adb).boot(avd!);
    await until('a new picture', () => seen.slice(back).some((s) => s.state === 'live'), 240_000);
    expect(session.status.picture?.codec).toBe('pixels');
    expect(session.status.note).toBeUndefined();
    await session.stop('the test ended');
  }, 600_000);
});
