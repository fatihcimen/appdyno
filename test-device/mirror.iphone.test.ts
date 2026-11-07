import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { MirrorStatus, ViewerLink } from '../packages/core/src/index.js';
import { expectSamePicture, shownByWindow } from './window-picture.js';
import { DEFAULT_POLICY, ServerContext } from '../packages/ops/src/index.js';
import { windowControls } from '../packages/hub/src/controls.js';
import { windowMeasures } from '../packages/hub/src/measures.js';
import { untilWithin } from './until.js';

/**
 * A mirror on our own iPhone (APPDYNO_IPHONE_UDID; never a default), through what is built: the stream's thread runs only
 * from built files, so build first. Each touch reads the screen first: a phone left alone may lock, and a blind flick on
 * its home screen opens Spotlight. Headless, unless APPDYNO_MIRROR_WINDOW=1 asks for the one real window.
 */
const udid = process.env.APPDYNO_IPHONE_UDID;
const FIXTURE = 'dev.appdyno.fixture';
const packages = join(import.meta.dirname, '../packages');
const dist = join(packages, 'appdyno/dist');
const headless = process.env.APPDYNO_MIRROR_WINDOW !== '1';

const until = untilWithin(30_000);

const show = (screen: string) =>
  execFileSync(
    'xcrun',
    [
      'devicectl',
      'device',
      'process',
      'launch',
      '--device',
      udid!,
      '--terminate-existing',
      '--payload-url',
      `appdyno-fixture://open/${screen}`,
      FIXTURE,
    ],
    { encoding: 'utf8', timeout: 60_000 },
  );

describe.runIf(udid)('mirror on an iPhone', () => {
  // from what is built, as a Node worker cannot start from sources
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let built: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let device: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let session: any;
  let viewerProcess: (ViewerLink & { pid?: number }) | undefined;
  let runner: number | undefined;
  const seen: MirrorStatus[] = [];

  const status = () => session.status as MirrorStatus;
  const read = () => device.read(FIXTURE);
  /** The length of the picture from low to high, whichever way the phone is. */
  const flick = async () => {
    session.send({ kind: 'touch', p: 0, x: 0.5, y: 0.8 });
    for (let i = 1; i <= 18; i++) {
      session.send({ kind: 'touch', p: 1, x: 0.5, y: 0.8 - i * 0.03 });
      await new Promise((r) => setTimeout(r, 16));
    }
    session.send({ kind: 'touch', p: 2, x: 0.5, y: 0.26 });
  };
  const firstRowMoved = async () => {
    const first = (await read()).list.find((e: { id?: string }) => e.id === 'row_name');
    return first && first.label !== 'Product 1';
  };

  const start = async () => {
    const binary = await built.viewerBinary();
    session = new built.MirrorSession({
      mirror: device.mirror,
      viewer: async () =>
        (viewerProcess = new built.ViewerProcess(binary, [headless ? '--headless' : '--behind'])),
      options: { quality: 'auto' },
      title: 'a test',
      onChange: (s: MirrorStatus) => seen.push(s),
    });
    await session.start();
  };

  beforeAll(async () => {
    // the package's own index holds only `connect`
    built = {
      ...(await import(join(packages, 'core/dist/index.js'))),
      ...(await import(join(packages, 'driver-apple/dist/index.js'))),
    };
    device = new built.IosPhoneDevice(udid!);
    runner = (await device.open()).pid;
    await device.launch(FIXTURE);
    await start();
  }, 300_000);

  afterAll(async () => {
    await session?.stop('the test ended');
    await device?.stopAgent?.().catch(() => undefined);
    device?.close();
  }, 60_000);

  it('is live in moments at the phone own size, in 4:4:4 by the hardware', async () => {
    await until('picture', () => status().state === 'live');
    expect(status().picture).toMatchObject({ codec: 'hevc' });
    expect(status().picture!.h).toBeGreaterThan(status().picture!.w);
    await until('frames', () => Number(status().stats?.arrived ?? 0) > 0);
    // both told by the first image, which comes after the first frame's arrival
    await until('the mode', () => status().stats?.mode === 'mode 7');
    await until('the decoder', () => status().stats?.decoder === 'hardware 444f');
    if (!headless) await until('the window to show it', () => status().stats?.layer === 'ok');
  }, 60_000);

  it.runIf(!headless)(
    'shows what the phone shows, where it shows it',
    async () => {
      show('list');
      await until('the list', async () =>
        (await read()).list.some((e: { id?: string }) => e.id === 'row_name'),
      );
      await new Promise((r) => setTimeout(r, 2_000));
      const own = (await device.screenshot({ format: 'png' })).data as Buffer;
      expectSamePicture(await shownByWindow(session), own);
    },
    90_000,
  );

  it('a flick moves the list, read before and after', async () => {
    show('list');
    let before: { label: string; y: number } | undefined;
    await until('the list', async () => {
      before = (await read()).list.find((e: { id?: string }) => e.id === 'row_name');
      return !!before && before.label === 'Product 1';
    });
    await flick();
    await until('a moved list', firstRowMoved);
    expect(status().inputFailed).toBe(0);
  }, 90_000);

  it('a tap lands on the button under it, read first', async () => {
    show('list');
    let add: { x: number; y: number } | undefined;
    let width = 0;
    let height = 0;
    await until('its button', async () => {
      const s = await read();
      add = s.list.find((e: { id?: string }) => e.id === 'add_button');
      width = s.window?.w ?? 0;
      height = s.window?.h ?? 0;
      return !!add && width > 0;
    });
    session.send({ kind: 'touch', p: 0, x: add!.x / width, y: add!.y / height });
    await new Promise((r) => setTimeout(r, 80));
    session.send({ kind: 'touch', p: 2, x: add!.x / width, y: add!.y / height });
    await until('a count', async () =>
      (await read()).list.some((e: { label: string }) => e.label === 'In basket: 1'),
    );
  }, 90_000);

  describe('text with no key on the keyboard', () => {
    const pasteboard = (action: string, input?: string) =>
      execFileSync('xcrun', ['devicectl', 'device', 'pasteboard', action, '--device', udid!], {
        encoding: 'utf8',
        ...(input && { input }),
      });
    const field = async (id: string) =>
      (await read()).list.find((e: { id?: string }) => e.id === id);
    const focus = async (id: string) => {
      show('form');
      await new Promise((r) => setTimeout(r, 2_000));
      await device.launch(FIXTURE);
      await device.openUrl('appdyno-fixture://open/form', FIXTURE);
      await until('the field', async () => !!(await field(id)));
      // a screen still sliding in takes no touch
      await new Promise((r) => setTimeout(r, 1_500));
      await until('its focus', async () => {
        const { x, y, flags } = await field(id);
        if (flags?.includes('focused')) return true;
        const { w, h } = (await read()).window;
        session.send({ kind: 'touch', p: 0, x: x / w, y: y / h });
        await new Promise((r) => setTimeout(r, 80));
        session.send({ kind: 'touch', p: 2, x: x / w, y: y / h });
        await new Promise((r) => setTimeout(r, 1_500));
        return false;
      });
    };

    it('goes by the runner, with no question and the pasteboard left as it was', async () => {
      pasteboard('copy', 'a person copied this');
      await focus('name_input');
      session.send({ kind: 'text', s: 'çay 12' });
      await until('the words', async () => (await field('name_input'))?.label === 'çay 12');
      expect(pasteboard('paste')).toContain('a person copied this');
    }, 120_000);

    it('with no runner goes by the pasteboard, which gets back what it held', async () => {
      device.mirror.keysOnly = true;
      pasteboard('copy', 'a person copied this');
      await focus('name_input');
      session.send({ kind: 'text', s: 'çay 12' });
      await until('the prompt', async () => {
        await new Promise((r) => setTimeout(r, 1_000));
        return pasteboard('paste').startsWith('çay 12');
      });
      // the phone's own question sits outside the app, where nothing reads its buttons: a person's touch on the first,
      // again until the words come, as it takes a moment to show and the form below takes such a touch harmlessly
      await until('the words', async () => {
        await new Promise((r) => setTimeout(r, 2_500));
        session.send({ kind: 'touch', p: 0, x: 0.5, y: 0.54 });
        await new Promise((r) => setTimeout(r, 80));
        session.send({ kind: 'touch', p: 2, x: 0.5, y: 0.54 });
        await new Promise((r) => setTimeout(r, 1_000));
        return (await field('name_input'))?.label === 'çay 12';
      });
      await until('what it held', () => pasteboard('paste').startsWith('a person copied this'));
    }, 120_000);

    it('with no runner stays off a pasteboard for a secure field', async () => {
      pasteboard('copy', 'still here');
      await focus('password_input');
      session.send({ kind: 'text', s: 'çay' });
      await new Promise((r) => setTimeout(r, 6_000));
      expect(pasteboard('paste')).not.toContain('çay');
      device.mirror.keysOnly = false;
    }, 120_000);
  });

  it('a side button turns it dark: the mirror says so, keeps its stream, and a click lights it', async () => {
    show('list');
    await until('the list', async () =>
      (await read()).list.some((e: { id?: string }) => e.id === 'row_name'),
    );
    session.send({ kind: 'button', name: 'lock' });
    const dark = () =>
      status().state === 'waiting' && (status() as { need?: string }).need === 'asleep';
    await until('its word', dark, 15_000);
    // a new stream would light it again
    await new Promise((r) => setTimeout(r, 8_000));
    expect(dark()).toBe(true);
    expect(Number(status().stats?.arrived)).toBeLessThanOrEqual(2);
    // a click on a dark window is a person who wants the screen back; with no window, what it calls
    if (headless) await device.mirror.wake();
    else session.poke(0.5, 0.5);
    await until('its picture back', () => status().state === 'live', 20_000);
    // it stands at the lock screen, and a second press opens a phone with no passcode
    await new Promise((r) => setTimeout(r, 1_000));
    // by the window's own menu where there is one
    if (headless) session.send({ kind: 'button', name: 'home' });
    else session.tell({ op: 'poke', button: 'home' });
    await until('the app again', async () =>
      (await read()).list.some((e: { id?: string }) => e.id === 'row_name'),
    );
  }, 120_000);

  it('a turned phone stands its picture up, and a tap lands on what it shows', async () => {
    await device.setOrientation(0);
    show('list');
    await new Promise((r) => setTimeout(r, 2_000));
    // what the runner reads is the app it last launched, and this is a new process of it
    await device.launch(FIXTURE);
    await until('the list', async () =>
      (await read()).list.some((e: { id?: string }) => e.id === 'add_button'),
    );
    const { w, h } = status().picture!;
    try {
      let count = 0;
      for (const rotation of [1, 3] as const) {
        await device.setOrientation(rotation);
        await until('its side', () => status().picture?.w === h && status().picture?.h === w);
        // a tap during the turn's animation goes nowhere
        await new Promise((r) => setTimeout(r, 2_500));
        const screen = await read();
        expect(screen.window.w).toBeGreaterThan(screen.window.h);
        const add = screen.list.find((e: { id?: string }) => e.id === 'add_button');
        const [x, y] = [add.x / screen.window.w, add.y / screen.window.h];
        if (headless) {
          session.send({ kind: 'touch', p: 0, x, y });
          await new Promise((r) => setTimeout(r, 80));
          session.send({ kind: 'touch', p: 2, x, y });
        } else session.poke(x, y);
        count += 1;
        await until('a count', async () =>
          (await read()).list.some((e: { label: string }) => e.label === `In basket: ${count}`),
        );
      }
      await flick();
      await until('a moved list', firstRowMoved);
    } finally {
      // a phone left on its side fails every test after it, and a person finds it so
      await device.setOrientation(0);
    }
    await until('upright', () => status().picture?.w === w && status().picture?.h === h);
  }, 180_000);

  it('a stream begun on a phone already on its side takes its first touch', async () => {
    await session.stop('a test turns the phone first');
    await device.setOrientation(1);
    try {
      await start();
      await until('picture', () => status().state === 'live');
      show('list');
      await new Promise((r) => setTimeout(r, 2_000));
      await device.launch(FIXTURE);
      await until('the list', async () =>
        (await read()).list.some((e: { id?: string }) => e.id === 'row_name'),
      );
      await flick();
      await until('a moved list', firstRowMoved);
    } finally {
      await device.setOrientation(0);
    }
  }, 180_000);

  it('the window screenshot button saves a picture and copies it, on a Desktop of its own', async () => {
    const home = mkdtempSync(join(tmpdir(), 'appdyno-button-'));
    const desktop = join(home, 'Desktop');
    mkdirSync(desktop);
    const tell = vi.spyOn(session, 'tell');
    const realHome = process.env.HOME;
    process.env.HOME = home;
    try {
      const measures = windowMeasures(new ServerContext(DEFAULT_POLICY, []), device);
      const controls = windowControls(device, await device.hardware(), () => session, measures);
      controls.onWindow({ op: 'control', name: 'screenshot' });
      await until('its file', () => readdirSync(desktop).some((f) => f.endsWith('.png')));
      const file = readdirSync(desktop).find((f) => f.endsWith('.png'))!;
      await until('a whole picture', () => statSync(join(desktop, file)).size > 1_000);
      expect(readFileSync(join(desktop, file))[0]).toBe(0x89);
      // a viewer with no person at it copies to a board of its own, as a test in the viewer's holds
      expect(tell).toHaveBeenCalledWith(expect.objectContaining({ op: 'copied' }));
    } finally {
      tell.mockRestore();
      process.env.HOME = realHome;
      rmSync(home, { recursive: true, force: true });
    }
  }, 60_000);

  it('a screenshot goes by the phone own service, in either format', async () => {
    for (const format of ['png', 'jpeg'] as const) {
      const { meta, data } = await device.screenshot({ format });
      expect(meta.format).toBe(format);
      expect(meta.h).toBeGreaterThan(meta.w);
      expect(data.length).toBe(meta.bytes);
      expect(data[0]).toBe(format === 'png' ? 0x89 : 0xff);
    }
  }, 60_000);

  it('a viewer killed comes back, with a new key for its picture', async () => {
    const pid = viewerProcess!.pid!;
    process.kill(pid, 'SIGKILL');
    await until('a new viewer', () => viewerProcess!.pid !== pid);
    await until('its picture', () => status().state === 'live', 60_000);
    await until('its frames', () => Number(status().stats?.decoded ?? 0) > 0, 30_000);
  }, 120_000);

  it('a stop proves the end: a next session finds no other client, and starts', async () => {
    await session.stop('the test goes on');
    await start();
    await until('a new picture', () => status().state === 'live', 60_000);
    expect(status().state).toBe('live');
  }, 120_000);

  it('a parent killed leaves nothing in the way of the next', async () => {
    await session.stop('the test goes on');
    device.close();
    const child = spawn(process.execPath, [
      join(dist, 'main.js'),
      'mirror',
      '--device',
      udid!,
      '--headless',
      '--seconds',
      '120',
    ]);
    let said = '';
    child.stdout.setEncoding('utf8').on('data', (s: string) => (said += s));
    await until('a live parent', () => said.includes('live'), 60_000);
    child.kill('SIGKILL');
    device = new built.IosPhoneDevice(udid!);
    await start();
    await until('a picture after it', () => status().state === 'live', 60_000);
  }, 180_000);

  // a read that loses its runner starts another and tries again, so nothing else here would show one lost
  it('kept one runner through all of this', async () => {
    expect((await device.open()).pid).toBe(runner);
  });
});
