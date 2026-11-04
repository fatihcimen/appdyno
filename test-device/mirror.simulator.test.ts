import { execFileSync, spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MirrorSession,
  startViewer,
  viewerBinary,
  ViewerProcess,
  type InputEvent,
  type MirrorStatus,
  type ViewerLink,
} from '../packages/core/src/index.js';
import { IosSimulatorDevice } from '../packages/driver-apple/src/index.js';

/**
 * A mirror on our own booted simulator (APPDYNO_IOS_UDID; never a default). Headless, unless
 * APPDYNO_MIRROR_WINDOW=1 asks for the one real window, which is closed right after.
 */
const udid = process.env.APPDYNO_IOS_UDID;

const until = async (what: string, test: () => boolean, ms = 30_000) => {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error(`no ${what} in ${ms} ms`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

const percentile = (values: number[], p: number) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length * p)]!;

describe.runIf(udid)('mirror on a simulator', () => {
  const device = new IosSimulatorDevice(udid!);
  const seen: MirrorStatus[] = [];
  let viewerProcess: ViewerProcess | undefined;
  let session: MirrorSession;

  beforeAll(async () => {
    const binary = await viewerBinary();
    session = new MirrorSession({
      mirror: device.mirror,
      viewer: async () => {
        const started: ViewerLink = (viewerProcess = new ViewerProcess(binary, ['--headless']));
        return started;
      },
      options: { quality: 'auto' },
      title: 'a test',
      onChange: (s) => seen.push(s),
    });
    await session.start();
  }, 300_000);

  afterAll(async () => {
    await session?.stop('the test ended');
    device.close();
  });

  it('is live in moments, at the simulator own size', async () => {
    await until('picture', () => session.status.state === 'live');
    const { picture } = session.status;
    expect(picture?.codec).toBe('surface');
    expect(picture?.w).toBeGreaterThan(300);
  });

  it('costs next to nothing on a still screen', async () => {
    await new Promise((r) => setTimeout(r, 4_000));
    const stats = session.status.stats!;
    expect(stats.source).toBe('surface');
    expect(Number(stats.cpu)).toBeLessThan(10);
    expect(Number(stats.rssMb)).toBeLessThan(150);
  });

  it('a person drag reaches the simulator, and the screen answers', async () => {
    execFileSync('xcrun', ['simctl', 'launch', udid!, 'com.apple.Preferences']);
    await new Promise((r) => setTimeout(r, 3_000));
    const times: number[] = [];
    for (let round = 0; round < 8; round++) {
      await new Promise((r) => setTimeout(r, 800));
      const marked = session.mark();
      session.send({ kind: 'touch', p: 0, x: 0.5, y: 0.75 });
      for (let i = 1; i <= 12; i++) {
        session.send({ kind: 'touch', p: 1, x: 0.5, y: 0.75 - i * 0.03 });
        await new Promise((r) => setTimeout(r, 16));
      }
      session.send({ kind: 'touch', p: 2, x: 0.5, y: 0.39 });
      times.push(
        await Promise.race([marked, new Promise<number>((r) => setTimeout(() => r(-1), 5_000))]),
      );
    }
    const answered = times.filter((t) => t >= 0);
    expect(answered.length).toBeGreaterThanOrEqual(6);
    console.log(
      `touch to first changed frame: p50 ${percentile(answered, 0.5)} ms, all ${times.join(', ')}`,
    );
    expect(session.status.inputFailed).toBe(0);
  }, 60_000);

  it('a viewer killed is restarted by itself', async () => {
    const pid = viewerProcess!.pid!;
    const before = seen.length;
    process.kill(pid, 'SIGKILL');
    await until('restart', () => seen.slice(before).some((s) => s.state === 'live'), 60_000);
    expect(viewerProcess!.pid).not.toBe(pid);
    expect(session.status.state).toBe('live');
  }, 90_000);

  it('a second connection to the input helper leaves the first one working', async () => {
    const hid = await device.direct.probe().catch(() => undefined);
    expect(hid?.input === undefined || hid.input === 'ok').toBe(true);
    session.send({ kind: 'touch', p: 0, x: 0.5, y: 0.5 });
    session.send({ kind: 'touch', p: 2, x: 0.5, y: 0.5 });
    await new Promise((r) => setTimeout(r, 500));
    expect(session.status.inputFailed).toBe(0);
  }, 60_000);
});

describe.runIf(udid && process.env.APPDYNO_MIRROR_WINDOW === '1')('the one real window', () => {
  it('shows the simulator, and a click on it goes back as a touch in the device coordinates', async () => {
    const device = new IosSimulatorDevice(udid!);
    const input = device.mirror.input.bind(device.mirror);
    const touches: InputEvent[] = [];
    const answered: string[] = [];
    device.mirror.input = async (e) => {
      touches.push(e);
      await input(e);
    };
    const session = new MirrorSession({
      mirror: device.mirror,
      viewer: async () => new ViewerProcess(await viewerBinary(), ['--behind']),
      options: { quality: 'auto' },
      title: 'a test window',
      onDone: (id) => answered.push(id),
    });
    await session.start();
    try {
      await until('picture', () => session.status.state === 'live');
      await new Promise((r) => setTimeout(r, 2_000));
      expect(session.status.touchedAt).toBeUndefined();
      session.poke(0.5, 0.25);
      await until('touch', () => touches.length >= 2, 10_000);
      // a mouse on the window: the picture's quarter from the top, as a fraction of the device's screen
      expect(touches[0]).toMatchObject({ kind: 'touch', p: 0 });
      expect((touches[0] as { x: number }).x).toBeCloseTo(0.5, 2);
      expect((touches[0] as { y: number }).y).toBeCloseTo(0.25, 2);
      expect(touches[1]).toMatchObject({ kind: 'touch', p: 2 });
      // a key that reaches a window that is not key goes nowhere: what is typed elsewhere is no device's to have
      session.tell({ op: 'poke', key: 'a' });
      await new Promise((r) => setTimeout(r, 1_000));
      expect(touches.filter((e) => e.kind === 'text')).toEqual([]);
      // what sits over the picture: a mark, a line of activity in its panel, a banner answered, and no sound
      session.tell({ op: 'agent', driving: true, tool: 'tap' });
      session.tell({ op: 'activity', line: 'tap 3 ms ok' });
      session.tell({ op: 'poke', panel: true });
      session.tell({ op: 'banner', id: 'r1', text: 'Face ID', needsDone: true, sound: false });
      session.tell({ op: 'poke', done: true });
      await until('an answer', () => answered.includes('r1'), 10_000);
      session.tell({ op: 'agent', driving: false });
      session.tell({ op: 'poke', panel: true });
      await new Promise((r) => setTimeout(r, 500));
      expect(session.status.state).toBe('live');
      expect(session.status.inputFailed).toBe(0);
      expect(Number(session.status.stats?.shown ?? 0)).toBeGreaterThanOrEqual(0);
    } finally {
      await session.stop('the test ended');
      device.close();
    }
    const left = spawnSync('pgrep', ['-f', 'appdyno-viewer']).stdout.toString().trim();
    console.log(`viewers left on this Mac: ${left || 'none'}`);
  }, 120_000);
});

/** It costs a shutdown and a whole boot of our own simulator. */
describe.runIf(udid && process.env.APPDYNO_MIRROR_RESTART === '1')(
  'a simulator shut down under its window',
  () => {
    it('waits with its need, and is live again once it is booted', async () => {
      const device = new IosSimulatorDevice(udid!);
      const seen: MirrorStatus[] = [];
      const session = new MirrorSession({
        mirror: device.mirror,
        viewer: startViewer(true),
        options: { quality: 'auto' },
        title: 'a test',
        onChange: (s) => seen.push(s),
      });
      await session.start();
      try {
        await until('picture', () => session.status.state === 'live');
        execFileSync('xcrun', ['simctl', 'shutdown', udid!]);
        await until(
          'its need',
          () => session.status.state === 'waiting' && session.status.need === 'simulator-off',
          60_000,
        );
        const back = seen.length;
        execFileSync('xcrun', ['simctl', 'bootstatus', udid!, '-b'], { timeout: 300_000 });
        await until(
          'a new picture',
          () => seen.slice(back).some((s) => s.state === 'live'),
          60_000,
        );
      } finally {
        await session.stop('the test ended');
        device.close();
      }
    }, 420_000);
  },
);

/** It needs the runner, which sets the orientation, and so its build, and an app that turns in front. */
describe.runIf(udid && process.env.APPDYNO_MIRROR_ROTATE === '1')('a simulator that turns', () => {
  const APP = 'dev.appdyno.fixture';
  const window = process.env.APPDYNO_MIRROR_WINDOW === '1';

  it('stands its picture up, and a touch lands on what the picture shows', async () => {
    const device = new IosSimulatorDevice(udid!);
    await device.open();
    await device.launch(APP);
    const told: unknown[] = [];
    const open = device.mirror.open.bind(device.mirror);
    device.mirror.open = (opts, signal, tell) =>
      open(opts, signal, (m) => {
        if (m.op === 'turns') told.push(m.turns);
        tell?.(m);
      });
    const binary = await viewerBinary();
    let viewer: ViewerProcess | undefined;
    const session = new MirrorSession({
      mirror: device.mirror,
      viewer: async () =>
        (viewer = new ViewerProcess(binary, [window ? '--behind' : '--headless'])),
      options: { quality: 'auto' },
      title: 'a test',
    });
    const shaped = (w: number, h: number) =>
      session.status.picture?.w === w && session.status.picture?.h === h;
    await session.start();
    try {
      await until('picture', () => session.status.state === 'live');
      const { w, h } = session.status.picture!;
      expect(h).toBeGreaterThan(w);

      for (const rotation of [1, 3] as const) {
        await device.terminate(APP);
        await device.launch(APP);
        await device.setOrientation(rotation);
        // the runner's two sides are the system's landscape right and left, which take one and three turns
        await until('its turns', () => told.at(-1) === rotation);
        await until('a picture on its side', () => shaped(h, w));
        await new Promise((r) => setTimeout(r, 1_000));
        // the button where the app has it on the turned screen, touched as a click on the picture would
        const screen = await device.read(APP);
        const button = screen.list.find((e) => e.id?.startsWith('open_'))!;
        expect(screen.window!.w).toBeGreaterThan(screen.window!.h);
        const x = button.x / screen.window!.w;
        const y = button.y / screen.window!.h;
        if (window) session.poke(x, y);
        else {
          session.send({ kind: 'touch', p: 0, x, y });
          session.send({ kind: 'touch', p: 2, x, y });
        }
        const end = Date.now() + 15_000;
        let gone = false;
        while (!gone && Date.now() < end) {
          gone = !(await device.read(APP)).list.some((e) => e.id === button.id);
        }
        expect(gone, `the touch at ${x}, ${y} with the device at ${rotation}`).toBe(true);
      }

      // a viewer that comes back starts turned
      const pid = viewer!.pid!;
      process.kill(pid, 'SIGKILL');
      await until(
        'a restart',
        () => viewer!.pid !== pid && session.status.state === 'live',
        60_000,
      );
      await until('the same shape', () => shaped(h, w));

      // an app that does not turn is upright, though the device has turned
      execFileSync('xcrun', ['simctl', 'launch', udid!, 'com.apple.Preferences']);
      await until('an upright app', () => shaped(w, h));
      await device.launch(APP);
      await until('a turned app', () => shaped(h, w));

      await device.setOrientation(0);
      await until('the picture upright again', () => shaped(w, h));
      expect(session.status.state).toBe('live');
      expect(session.status.inputFailed).toBe(0);
    } finally {
      await session.stop('the test ended');
      await device.stopAgent().catch(() => undefined);
      device.close();
    }
  }, 600_000);
});
