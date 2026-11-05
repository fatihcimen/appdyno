import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  decodePng,
  MirrorSession,
  viewerBinary,
  ViewerProcess,
  type InputEvent,
} from '../packages/core/src/index.js';
import { IosSimulatorDevice } from '../packages/driver-apple/src/index.js';
import { DEFAULT_POLICY, ServerContext } from '../packages/ops/src/index.js';
import { windowControls, windowLook } from '../packages/ops/src/mirror/controls.js';
import { windowMeasures } from '../packages/ops/src/mirror/measures.js';
import { expectSamePicture, shownByWindow } from './window-picture.js';

/**
 * A window's controls on our own booted simulator (APPDYNO_IOS_UDID; never a default): a real window, kept off
 * every screen, driven by its own events. It leaves the simulator on its home screen, upright.
 */
const udid = process.env.APPDYNO_IOS_UDID;
/** A first turn may have to build the simulator's runner. */
const ROTATE_MS = 420_000;
const SCREEN_MS = 30_000;
/** Where a new simulator's home screen has it. */
const SETTINGS = { x: 0.845, y: 0.483 };

/**
 * The share of a screen that differs between two pictures, in the band of bare wallpaper below a new home screen's icons:
 * a widget above it and the clock change by themselves, and what covers the screen covers this too.
 */
const changedShare = (before: Buffer, after: Buffer) => {
  const [a, b] = [decodePng(before)!, decodePng(after)!];
  let changed = 0;
  let seen = 0;
  for (let y = Math.floor(a.height * 0.58); y < a.height * 0.8; y += 31) {
    for (let x = 0; x < a.width; x += 29, seen++) {
      const i = (y * a.width + x) * a.channels;
      if (Math.abs(a.data[i]! - b.data[i]!) + Math.abs(a.data[i + 1]! - b.data[i + 1]!) > 24)
        changed++;
    }
  }
  return changed / seen;
};

const until = async (what: string, test: () => boolean, ms = 30_000) => {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error(`no ${what} in ${ms} ms`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

describe.runIf(udid)("a window's controls on a simulator", () => {
  const device = new IosSimulatorDevice(udid!);
  const inputs: InputEvent[] = [];
  const told: Record<string, unknown>[] = [];
  let session: MirrorSession;
  const control = (name: string) => session.tell({ op: 'poke', control: name });
  const picture = async () => (await device.mirror.screenshot('png')).data;
  const settled = () => new Promise((r) => setTimeout(r, 1_200));
  /** A shared Mac's device takes its time: what counts is that the screen gets there. */
  const screenBecomes = async (test: (now: Buffer) => boolean) => {
    const end = Date.now() + SCREEN_MS;
    for (;;) {
      const now = await picture();
      if (test(now)) return;
      if (Date.now() > end) throw new Error(`the screen did not change in ${SCREEN_MS} ms`);
      await settled();
    }
  };

  /** What a screen shows once it has stopped moving: a picture taken in a press's animation is no way back to compare. */
  const steady = async () => {
    let was: Buffer = await picture();
    await screenBecomes((now) => {
      const still = changedShare(was, now) < 0.01;
      was = now;
      return still;
    });
    return was;
  };

  beforeAll(async () => {
    const binary = await viewerBinary();
    const hardware = await device.hardware();
    expect(hardware.model).toBeTruthy();
    const measures = windowMeasures(new ServerContext(DEFAULT_POLICY, []), device);
    const controls = windowControls(device, hardware, () => session, measures);
    const input = device.mirror.input.bind(device.mirror);
    device.mirror.input = async (e) => {
      inputs.push(e);
      await input(e);
    };
    session = new MirrorSession({
      mirror: device.mirror,
      viewer: async () => new ViewerProcess(binary, ['--behind']),
      options: { quality: 'auto' },
      title: 'a window under test',
      look: windowLook(hardware),
      press: controls.press,
      onWindow: controls.onWindow,
    });
    const tell = session.tell.bind(session);
    session.tell = (m) => {
      told.push(m);
      tell(m);
    };
    await session.start();
    await until('picture', () => session.status.state === 'live');
    // an app closes to the page its icon is on: what these clicks aim at is on Settings' page, whatever ran before
    execFileSync('xcrun', ['simctl', 'launch', udid!, 'com.apple.Preferences']);
  }, 120_000);

  afterAll(async () => {
    await session?.stop('done');
    device.close();
  });

  it('sends the toolbar Home to the device', async () => {
    inputs.length = 0;
    control('home');
    await until('home', () => inputs.some((e) => e.kind === 'button' && e.name === 'home'));
  });

  it('shows what the simulator shows, where it shows it', async () => {
    const device = await steady();
    expectSamePicture(await shownByWindow(session), device);
  }, 60_000);

  it(
    'opens Control Center by a real drag from the edge, over the whole screen',
    async () => {
      const before = await steady();
      inputs.length = 0;
      control('controlCenter');
      await until('finger up', () => inputs.some((e) => e.kind === 'touch' && e.p === 2));
      // a slow device gets the newest of a drag: what counts is that it opened
      await screenBecomes((now) => changedShare(before, now) > 0.5);
      control('home');
      await screenBecomes((now) => changedShare(before, now) < 0.1);
    },
    3 * SCREEN_MS,
  );

  it(
    'opens an app from a click on its icon, as a mouse does',
    async () => {
      const before = await steady();
      // Settings, where a new simulator's home screen has it
      session.poke(0.845, 0.483);
      await screenBecomes((now) => changedShare(before, now) > 0.5);
      control('home');
      await screenBecomes((now) => changedShare(before, now) < 0.1);
    },
    3 * SCREEN_MS,
  );

  it(
    'opens the App Switcher by Home pressed twice',
    async () => {
      const before = await steady();
      control('appSwitch');
      await screenBecomes((now) => changedShare(before, now) > 0.1);
      control('home');
      await screenBecomes((now) => changedShare(before, now) < 0.1);
    },
    3 * SCREEN_MS,
  );

  it(
    'holds a right click down as a long press, and the device sees one',
    async () => {
      const before = await steady();
      inputs.length = 0;
      // on an icon, whose menu comes at once: bare wallpaper waits longer than a press does
      session.tell({ op: 'poke', x: SETTINGS.x, y: SETTINGS.y, right: true });
      await until('finger down', () => inputs.some((e) => e.kind === 'touch' && e.p === 0));
      const down = Date.now();
      await until('finger up', () => inputs.some((e) => e.kind === 'touch' && e.p === 2));
      expect(Date.now() - down).toBeGreaterThan(500);
      await screenBecomes((now) => changedShare(before, now) > 0.02);
      control('home');
      await settled();
    },
    3 * SCREEN_MS,
  );

  it('lists the apps when the pane opens', async () => {
    told.length = 0;
    session.tell({ op: 'poke', pane: 2 });
    await until('the list', () => told.some((m) => m.op === 'apps'));
    const { apps } = told.find((m) => m.op === 'apps') as { apps: { id: string }[] };
    expect(apps.map((a) => a.id)).toContain('com.apple.Preferences');
  }, 40_000);

  it('copies the screen at once, with no runner', async () => {
    told.length = 0;
    const asked = Date.now();
    control('copy');
    await until('a picture', () => told.some((m) => m.op === 'copied'));
    expect(Date.now() - asked).toBeLessThan(10_000);
    const { file } = told.find((m) => m.op === 'copied') as { file: string };
    expect(existsSync(file)).toBe(true);
    // a PNG's own first bytes
    expect(readFileSync(file).subarray(1, 4).toString()).toBe('PNG');
  }, 40_000);

  it(
    'turns the device and back, in an app that turns, and its picture stands up',
    async () => {
      execFileSync('xcrun', ['simctl', 'launch', udid!, 'com.apple.mobilesafari']);
      await settled();
      expect(session.status.picture!.h).toBeGreaterThan(session.status.picture!.w);
      control('rotateLeft');
      await until(
        'a turned picture',
        () => {
          const p = session.status.picture!;
          return p.w > p.h;
        },
        ROTATE_MS,
      );
      control('rotateRight');
      await until(
        'an upright picture',
        () => {
          const p = session.status.picture!;
          return p.h > p.w;
        },
        60_000,
      );
      execFileSync('xcrun', ['simctl', 'terminate', udid!, 'com.apple.mobilesafari']);
    },
    ROTATE_MS + 80_000,
  );

  it('leaves the simulator up', () => {
    expect(
      execFileSync('xcrun', ['simctl', 'list', 'devices', 'booted'], { encoding: 'utf8' }),
    ).toContain(udid);
  });
});
