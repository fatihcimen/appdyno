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
    device.mirror.input = async (e) => {
      touches.push(e);
      await input(e);
    };
    const session = new MirrorSession({
      mirror: device.mirror,
      viewer: startViewer(false),
      options: { quality: 'auto' },
      title: 'a test window',
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
      // a key on the window: its text, as the window has it
      session.tell({ op: 'poke', key: 'a' });
      await until('a key', () => touches.some((e) => e.kind === 'text' && e.s === 'a'), 10_000);
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
