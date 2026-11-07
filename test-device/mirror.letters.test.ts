import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { untilWithin } from './until.js';

/**
 * What a person types in a window of our own iPhone (APPDYNO_IPHONE_UDID), through what is built: the letters given and
 * no others, into the field tapped and no other.
 */
const udid = process.env.APPDYNO_IPHONE_UDID;
const FIXTURE = 'dev.appdyno.fixture';
const FORM = 'appdyno-fixture://open/form';
const packages = join(import.meta.dirname, '../packages');
const until = untilWithin(30_000);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What a phone's own layout turns into something else, by key position: `-` went in as `*`, `quick` as `quıck`. */
const HARD = ['-', 'i', 'ı', '@', '"', 'I', 'İ', 'ğ', 'ş', 'ç'];

type Element = { id?: string; label: string; x: number; y: number; flags?: string[] };

describe.runIf(udid)('letters in a window on an iPhone', () => {
  // from what is built, as a Node worker cannot start from sources
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let built: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let device: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let session: any;
  let runner: number | undefined;

  const field = async (id: string): Promise<Element> =>
    (await device.read(FIXTURE)).list.find((e: Element) => e.id === id);
  const tap = async ({ x, y }: Element) => {
    const { w, h } = (await device.read(FIXTURE)).window;
    session.send({ kind: 'touch', p: 0, x: x / w, y: y / h });
    await pause(80);
    session.send({ kind: 'touch', p: 2, x: x / w, y: y / h });
  };
  const form = async () => {
    await device.terminate(FIXTURE);
    await device.launch(FIXTURE);
    await device.openUrl(FORM, FIXTURE);
    await until('the field', async () => !!(await field('name_input')));
    // a screen still sliding in takes no touch
    await pause(1_500);
  };
  const typed = (s: string) => session.send({ kind: 'text', s });
  const keys = (text: string, into?: Element) =>
    device.call('text.keys', { text, ...(into && { into }) }, 30_000);

  beforeAll(async () => {
    built = {
      ...(await import(join(packages, 'core/dist/index.js'))),
      ...(await import(join(packages, 'driver-apple/dist/index.js'))),
    };
    device = new built.IosPhoneDevice(udid!);
    runner = (await device.open()).pid;
    await device.launch(FIXTURE);
    const binary = await built.viewerBinary();
    session = new built.MirrorSession({
      mirror: device.mirror,
      viewer: async () => new built.ViewerProcess(binary, ['--headless']),
      options: { quality: 'auto' },
      title: 'a test',
      onChange: () => undefined,
    });
    await session.start();
    await until('the picture', () => session.status.state === 'live');
  }, 300_000);

  afterAll(async () => {
    await session?.stop('the test ended');
    await device?.terminate(FIXTURE).catch(() => undefined);
    await device?.stopAgent?.().catch(() => undefined);
    device?.close();
  }, 60_000);

  it('are the ones given, whatever layout the phone has, as are the tool’s', async () => {
    await form();
    const name = await field('name_input');
    await tap(name);
    await until('its focus', async () => !!(await field('name_input')).flags?.includes('focused'));
    const at = { x: name.x, y: name.y };
    for (const ch of HARD) {
      await device.typeText('x', { at, replace: true, settle: false });
      typed(`${ch}x`);
      await until(`${ch} by a window`, async () => (await field('name_input')).label === `x${ch}x`);
      await device.typeText(`y${ch}y`, { at, replace: true, settle: false });
      await until(`${ch} by the tool`, async () => (await field('name_input')).label === `y${ch}y`);
    }
  }, 180_000);

  it.each([100, 900])(
    'after a tap on a secure field %i ms before go there and nowhere else',
    async (gap) => {
      await form();
      await tap(await field('name_input'));
      typed('Ada');
      await until('the name', async () => (await field('name_input')).label === 'Ada');
      await tap(await field('password_input'));
      await pause(gap);
      typed('s3');
      await until('the secret', async () => (await field('password_input')).label === '••');
      expect((await field('name_input')).label).toBe('Ada');
    },
    90_000,
  );

  it('for a field that does not have the focus go nowhere', async () => {
    await form();
    await tap(await field('name_input'));
    typed('Ada');
    await until('the name', async () => (await field('name_input')).label === 'Ada');
    const from = Date.now();
    await expect(keys('s3', await field('password_input'))).rejects.toMatchObject({
      code: 'NO_FOCUS',
    });
    expect(Date.now() - from).toBeGreaterThan(5_000);
    expect((await field('name_input')).label).toBe('Ada');
    expect((await field('password_input')).label).not.toContain('•');
  }, 60_000);

  it('kept one runner through all of this', async () => {
    expect((await device.open()).pid).toBe(runner);
  });
});
