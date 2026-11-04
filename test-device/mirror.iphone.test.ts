import { execFileSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MirrorStatus, ViewerLink } from '../packages/core/src/index.js';

/**
 * A mirror on our own iPhone (APPDYNO_IPHONE_UDID; never a default), through what is built: the stream's thread runs only
 * from built files, so build first. Each touch reads the screen first: a phone left alone may lock, and a blind flick on
 * its home screen opens Spotlight. Headless, unless APPDYNO_MIRROR_WINDOW=1 asks for the one real window.
 */
const udid = process.env.APPDYNO_IPHONE_UDID;
const FIXTURE = 'dev.appdyno.fixture';
const dist = join(import.meta.dirname, '../packages/appdyno/dist');
const headless = process.env.APPDYNO_MIRROR_WINDOW !== '1';

const until = async (what: string, test: () => boolean | Promise<boolean>, ms = 30_000) => {
  const end = Date.now() + ms;
  while (!(await test())) {
    if (Date.now() > end) throw new Error(`no ${what} in ${ms} ms`);
    await new Promise((r) => setTimeout(r, 100));
  }
};

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
  const seen: MirrorStatus[] = [];

  const status = () => session.status as MirrorStatus;
  const read = () => device.read(FIXTURE);

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
    built = await import(join(dist, 'index.js'));
    device = new built.IosPhoneDevice(udid!);
    await device.open();
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
    expect(status().stats?.mode).toBe('mode 7');
    expect(String(status().stats?.decoder)).toBe('hardware 444f');
    if (!headless) await until('the window to show it', () => status().stats?.layer === 'ok');
  }, 60_000);

  it('a flick moves the list, read before and after', async () => {
    show('list');
    let before: { label: string; y: number } | undefined;
    await until('the list', async () => {
      before = (await read()).list.find((e: { id?: string }) => e.id === 'row_name');
      return !!before && before.label === 'Product 1';
    });
    session.send({ kind: 'touch', p: 0, x: 0.5, y: 0.8 });
    for (let i = 1; i <= 18; i++) {
      session.send({ kind: 'touch', p: 1, x: 0.5, y: 0.8 - i * 0.03 });
      await new Promise((r) => setTimeout(r, 16));
    }
    session.send({ kind: 'touch', p: 2, x: 0.5, y: 0.26 });
    await until('a moved list', async () => {
      const first = (await read()).list.find((e: { id?: string }) => e.id === 'row_name');
      return first && first.label !== 'Product 1';
    });
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
    session.send({ kind: 'button', name: 'home' });
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
    await device.setOrientation(1);
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
    await until('a count', async () =>
      (await read()).list.some((e: { label: string }) => e.label === 'In basket: 1'),
    );
    await device.setOrientation(0);
    await until('upright', () => status().picture?.w === w && status().picture?.h === h);
  }, 120_000);

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
});
