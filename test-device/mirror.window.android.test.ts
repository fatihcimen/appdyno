import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  decodePng,
  MirrorSession,
  viewerBinary,
  ViewerProcess,
} from '../packages/core/src/index.js';
import { Adb, AndroidDevice, FOCUS_READ } from '../packages/driver-android/src/index.js';
import { windowControls, windowLook } from '../packages/ops/src/mirror/controls.js';

/**
 * A person's window on a phone we hold (APPDYNO_ANDROID_SERIAL and APPDYNO_MIRROR_WINDOW=1; never a default): the real
 * window kept off every screen, driven by its own events, with each step read back from the phone itself. A screenshot
 * goes to a folder of this test's, and nothing reaches this Mac's pasteboard.
 */
const serial = process.env.APPDYNO_ANDROID_SERIAL;
const APP = 'dev.appdyno.fixture';
const MS = 20_000;

const until = async (what: string, test: () => boolean | Promise<boolean>, ms = MS) => {
  const end = Date.now() + ms;
  while (!(await test())) {
    if (Date.now() > end) throw new Error(`no ${what} in ${ms} ms`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

const onPhone = !!serial && !serial.startsWith('emulator-');

describe.runIf(onPhone && process.env.APPDYNO_MIRROR_WINDOW === '1')(
  'a phone through its window',
  () => {
    const adb = new Adb();
    const device = new AndroidDevice(serial!, adb);
    const told: Record<string, unknown>[] = [];
    let session: MirrorSession;
    let screen: { w: number; h: number };
    let binary: string;

    const sh = (command: string) => adb.exec(serial!, command);
    const focus = () => sh(FOCUS_READ);
    const show = async (name: string) => {
      await sh(`am force-stop ${APP}`);
      await sh(
        `am start -W -a android.intent.action.VIEW -d appdyno-fixture://open/${name} ${APP}`,
      );
    };
    const nodeOf = async (test: (n: { id?: string; t?: string; d?: string }) => boolean) => {
      const found = (await device.tree()).nodes.find(test);
      if (!found) throw new Error('nothing like that on the screen');
      return found;
    };
    const centre = ({ b: [l, top, r, bottom] }: { b: readonly number[] }) => ({
      x: (l! + r!) / 2 / screen.w,
      y: (top! + bottom!) / 2 / screen.h,
    });
    const poke = (m: Record<string, unknown>) => session.tell({ op: 'poke', ...m });
    const control = (name: string) => poke({ control: name });

    const open = async () => {
      const hardware = await device.hardware();
      const controls = windowControls(device, hardware, () => session);
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
        // the Mac's pasteboard is a person's
        if (m.op !== 'copied') tell(m);
      };
      await session.start();
      await until('a picture', () => session.status.state === 'live', 60_000);
    };

    beforeAll(async () => {
      binary = await viewerBinary();
      ({ screen } = await device.open());
      await device.ensureAwake();
      await show('gestures');
      await open();
    }, 180_000);

    afterAll(async () => {
      await session?.stop('the test ended');
      await device.setOrientation(0).catch(() => undefined);
      device.close();
    });

    it('shows the phone, in a window the system draws', async () => {
      expect(session.status.picture!.h).toBeGreaterThan(session.status.picture!.w);
      const file = join(mkdtempSync(join(tmpdir(), 'appdyno-window-')), 'window.png');
      session.tell({ op: 'snapshot', file });
      await until('a picture of the window', () => {
        try {
          return statSync(file).size > 0;
        } catch {
          return false;
        }
      });
      const png = decodePng(readFileSync(file))!;
      expect(png.width).toBeGreaterThan(100);
    }, 60_000);

    it('a click is a tap on what is under it', async () => {
      await show('form');
      const field = await nodeOf((n) => !!n.id?.endsWith('name_input'));
      poke(centre(field));
      await until('the field focused', async () =>
        (await device.tree()).windows.some((w) => w.type === 2),
      );
    }, 60_000);

    it('what is typed reaches the field', async () => {
      poke({ text: 'merhaba' });
      await until('the text', async () =>
        (await device.tree()).nodes.some((n) => n.id?.endsWith('name_input') && n.t === 'merhaba'),
      );
    }, 60_000);

    it('a right click is a long press: it selects the word under it', async () => {
      const field = await nodeOf((n) => !!n.id?.endsWith('name_input'));
      const before = JSON.stringify((await device.tree()).windows.map((w) => w.b));
      poke({ ...centre(field), right: true });
      await until(
        'the selection',
        async () => JSON.stringify((await device.tree()).windows.map((w) => w.b)) !== before,
      );
    }, 60_000);

    it('a drag is a finger that travels the distance', async () => {
      await show('gestures');
      const pad = await nodeOf((n) => n.d === 'Gesture pad');
      const { x, y } = centre(pad);
      poke({ x, y: y - 0.1, x2: x, y2: y + 0.1, seconds: 0.4 });
      let travel = 0;
      await until('its travel', async () => {
        const said = /travel: (-?\d+)/.exec(
          (await device.tree()).nodes.find((n) => n.t?.includes('travel:'))?.t ?? '',
        );
        travel = Number(said?.[1] ?? 0);
        return travel > 0;
      });
      expect(travel / screen.h).toBeGreaterThan(0.15);
      expect(travel / screen.h).toBeLessThan(0.25);
    }, 60_000);

    it('Home leaves the app, and Recents and Back answer', async () => {
      let now = '';
      const focusIs = async (what: string, test: (f: string) => boolean) =>
        until(what, async () => test((now = await focus()))).catch((e: Error) => {
          throw new Error(`${e.message}: the focus reads ${now.trim()}`);
        });
      await show('form');
      await focusIs('the form', (f) => f.includes('FormActivity'));
      control('home');
      // past the moment between two windows, when nothing has the focus
      await focusIs('the launcher', (f) => f.includes('Window{') && !f.includes(APP));
      const launcher = now;
      // a window's token may change, its name does not
      const named = (f: string) => f.replace(/Window\{\w+ /, '');
      const shown = (await device.tree()).hash;
      control('appSwitch');
      // a maker may draw Recents in its launcher's own window: the screen says, not the focus
      await until('Recents', async () => (await device.tree()).hash !== shown);
      control('home');
      await focusIs('the launcher again', (f) => named(f) === named(launcher));
      await show('form');
      await focusIs('the form again', (f) => f.includes('FormActivity'));
      control('back');
      await focusIs('it gone', (f) => !f.includes('FormActivity'));
    }, 90_000);

    it('turns the phone and back, and the picture stands up each way', async () => {
      await show('gestures');
      const upright = session.status.picture!;
      control('rotateLeft');
      await until(
        'a turned picture',
        () => session.status.picture!.w > session.status.picture!.h,
        30_000,
      );
      expect(session.status.state).toBe('live');
      control('rotateRight');
      await until('an upright picture', () => session.status.picture!.h === upright.h, 30_000);
    }, 90_000);

    it('saves a screenshot of the phone, whole', async () => {
      const home = mkdtempSync(join(tmpdir(), 'appdyno-home-'));
      mkdirSync(join(home, 'Desktop'));
      const was = process.env.HOME;
      process.env.HOME = home;
      try {
        control('screenshot');
        await until('a file', () => readdirSync(join(home, 'Desktop')).length > 0);
        const saved = join(home, 'Desktop', readdirSync(join(home, 'Desktop'))[0]!);
        await until('its bytes', () => statSync(saved).size > 0);
        const png = decodePng(readFileSync(saved))!;
        expect([png.width, png.height]).toEqual([screen.w, screen.h]);
      } finally {
        process.env.HOME = was;
      }
    }, 60_000);

    it('the Inspector opens, and its Apps tab lists what is on the phone', async () => {
      told.length = 0;
      control('inspector');
      poke({ pane: 2 });
      await until('the list', () => told.some((m) => m.op === 'apps'), 30_000);
      const { apps } = told.find((m) => m.op === 'apps') as unknown as { apps: { id: string }[] };
      expect(apps.some((a) => a.id === APP)).toBe(true);
      control('inspector');
    }, 60_000);

    it('the agent killed under its stream: the picture comes back, and a click still lands', async () => {
      await show('form');
      const agents = async () => (await sh("pgrep -f 'dev[.]appdyno[.]agent'")).trim().split('\n');
      const pids = await agents();
      expect(pids[0]).toMatch(/^\d+$/);
      expect(pids).toHaveLength(1);
      const seen: string[] = [];
      const watch = setInterval(() => seen.push(session.status.state), 100);
      try {
        await sh(`kill -9 ${pids.join(' ')}`);
        await until('the loss', () => seen.includes('reconnecting'), 40_000).catch(
          async (e: Error) => {
            throw new Error(
              `${e.message}: it read ${[...new Set(seen)].join(', ')}; agents ${pids.join(' ')} became ${(await agents()).join(' ')}`,
            );
          },
        );
        await until('a new picture', () => session.status.state === 'live', 90_000);
      } finally {
        clearInterval(watch);
      }
      const field = await nodeOf((n) => !!n.id?.endsWith('name_input'));
      poke(centre(field));
      await until('the field focused', async () =>
        (await device.tree()).windows.some((w) => w.type === 2),
      );
    }, 180_000);

    it('closes, and opens again', async () => {
      const closed = session.stopped;
      session.tell({ op: 'quit' });
      await closed;
      await open();
      expect(session.status.state).toBe('live');
    }, 120_000);
  },
);
