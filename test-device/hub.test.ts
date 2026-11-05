import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { viewerBinary, ViewerProcess, type ViewerMessage } from '../packages/core/src/index.js';
import { appleProvider } from '../packages/driver-apple/src/index.js';
import { DEFAULT_POLICY, ServerContext, runHub } from '../packages/ops/src/index.js';
import { liveMirror } from '../packages/ops/src/mirror/state.js';

/**
 * `appdyno hub` on a simulator we hold and have shut down (APPDYNO_IOS_UDID; never a default): its real window, kept off
 * every screen, driven by its own buttons. A window it opens is a process of its own, from what is built, so build first.
 * APPDYNO_SHOTS names a folder for pictures of it.
 */
const udid = process.env.APPDYNO_IOS_UDID;
const main = join(import.meta.dirname, '../packages/appdyno/dist/main.js');
const BOOT_MS = 180_000;
const WINDOW_MS = 120_000;
const MADE = 'appdyno-hub-made';

const until = async (what: string, test: () => boolean, ms: number) => {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error(`no ${what} in ${ms} ms`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

const booted = () =>
  execFileSync('xcrun', ['simctl', 'list', 'devices', 'booted'], { encoding: 'utf8' }).includes(
    udid!,
  );

describe.runIf(udid)('the hub', () => {
  const told: ViewerMessage[] = [];
  let link: ViewerProcess;
  let done: Promise<number>;
  const press = (name: string) => link.send({ op: 'poke', id: udid, press: name });
  const picture = async (name: string) => {
    const shots = process.env.APPDYNO_SHOTS;
    if (!shots) return;
    link.send({ op: 'snapshot', file: join(shots, `hub-${name}.png`) });
    await new Promise((r) => setTimeout(r, 1_000));
  };

  beforeAll(async () => {
    expect(booted()).toBe(false);
    const look = process.env.APPDYNO_HUB_LOOK ?? 'dark';
    link = new ViewerProcess(await viewerBinary(), ['--hub', '--behind', '--appearance', look]);
    link.onMessage((m) => told.push(m));
    // only ours, unless a picture is to show the Mac's whole list: nothing else here is pressed
    const whole = process.env.APPDYNO_HUB_ALL === '1';
    const policy = whole ? DEFAULT_POLICY : { ...DEFAULT_POLICY, devices: new RegExp(`^${udid}$`) };
    const ctx = new ServerContext(policy, [appleProvider()], {
      mirrorCommand: [process.execPath, main, 'mirror'],
    });
    done = runHub(ctx, { focus: false, behind: true, log: () => undefined, viewer: link });
    await new Promise((r) => setTimeout(r, 3_000));
  }, 60_000);

  afterAll(async () => {
    link?.kill();
    await done;
    if (udid && booted()) execFileSync('xcrun', ['simctl', 'shutdown', udid]);
  }, 60_000);

  it(
    'starts a simulator, opens a window of its own on it, closes that and stops it',
    async () => {
      await picture('stopped');
      press('power');
      await until('a booted simulator', booted, BOOT_MS);
      await new Promise((r) => setTimeout(r, 4_000));
      press('window');
      await until('a window', () => liveMirror(udid!)?.status.state === 'live', WINDOW_MS);
      const window = liveMirror(udid!)!;
      expect(window.pid).not.toBe(process.pid);
      await new Promise((r) => setTimeout(r, 3_000));
      await picture('open');
      press('window');
      await until('the window to close', () => !liveMirror(udid!), WINDOW_MS);
      press('power');
      await until('a stopped simulator', () => !booted(), BOOT_MS);
    },
    2 * (BOOT_MS + WINDOW_MS),
  );

  it(
    'makes a new simulator from what this Mac has, by its sheet',
    async () => {
      const named = () =>
        execFileSync('xcrun', ['simctl', 'list', 'devices', '-j'], { encoding: 'utf8' }).includes(
          MADE,
        );
      expect(named()).toBe(false);
      link.send({ op: 'poke', ask: 'simulator' });
      await new Promise((r) => setTimeout(r, 2_000));
      await picture('new');
      link.send({ op: 'poke', press: 'create', name: MADE });
      try {
        await until('the new simulator', named, WINDOW_MS);
      } finally {
        if (named()) execFileSync('xcrun', ['simctl', 'delete', MADE], { stdio: 'ignore' });
      }
      expect(named()).toBe(false);
    },
    2 * WINDOW_MS,
  );
});
