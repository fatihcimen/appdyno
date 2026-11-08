import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, assert, beforeAll, describe, expect, it } from 'vitest';
import { MirrorSession, viewerBinary, ViewerProcess } from '../packages/core/src/index.js';
import { AndroidDevice } from '../packages/driver-android/src/index.js';
import type { IosPhoneDevice } from '../packages/driver-apple/src/index.js';
import { untilWithin } from './until.js';

/**
 * What a person types in a window of our own iPhone (APPDYNO_IPHONE_UDID), through what is built: the letters given and
 * no others, into the field tapped and no other, and in no file on this Mac. On our own Android phone
 * (APPDYNO_ANDROID_SERIAL), the letters.
 */
const udid = process.env.APPDYNO_IPHONE_UDID ?? '';
const serial = process.env.APPDYNO_ANDROID_SERIAL ?? '';
const FIXTURE = 'dev.appdyno.fixture';
const FORM = 'appdyno-fixture://open/form';
const packages = join(import.meta.dirname, '../packages');
const until = untilWithin(30_000);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What a phone's own layout turns into something else, by key position: `-` went in as `*`, `quick` as `quıck`. */
const HARD = [' ', '-', 'i', 'ı', '@', '"', 'I', 'İ', 'ğ', 'ş', 'ç'];
const WORD = 'zqwordofaperson';
const SECRET = 'zqs3cr3t';

type Element = { id?: string; label: string; x: number; y: number; flags?: string[] };

/** What drives a phone, filled in as a suite begins. */
type Driven = { device?: IosPhoneDevice | AndroidDevice; session?: MirrorSession };

const on = (w: Driven) => {
  const device = () => {
    assert(w.device, 'a device');
    return w.device;
  };
  const session = () => {
    assert(w.session, 'a window');
    return w.session;
  };
  const field = async (id: string): Promise<Element | undefined> =>
    (await device().read(FIXTURE)).list.find((e: Element) => e.id === id);
  /** A field the test goes on with. */
  const found = async (id: string) => {
    const e = await field(id);
    assert(e, id);
    return e;
  };
  const tap = async ({ x, y }: Element) => {
    const { window } = await device().read(FIXTURE);
    assert(window, 'its window');
    const { w: width, h } = window;
    session().send({ kind: 'touch', p: 0, x: x / width, y: y / h });
    await pause(80);
    session().send({ kind: 'touch', p: 2, x: x / width, y: y / h });
  };
  const form = async () => {
    await device().terminate(FIXTURE);
    await device().launch(FIXTURE);
    await device().openUrl(FORM, FIXTURE);
    await until('the field', async () => !!(await field('name_input')));
    // a screen still sliding in takes no touch
    await pause(1_500);
  };
  const typed = (s: string) => session().send({ kind: 'text', s });
  const hardOnes = async () => {
    await form();
    const name = await found('name_input');
    await tap(name);
    await until('its focus', async () => !!(await found('name_input')).flags?.includes('focused'));
    const at = { x: name.x, y: name.y };
    for (const ch of HARD) {
      await device().typeText('x', { at, replace: true, settle: false });
      typed(`${ch}x`);
      await until(`${ch} by a window`, async () => (await found('name_input')).label === `x${ch}x`);
      await device().typeText(`y${ch}y`, { at, replace: true, settle: false });
      await until(`${ch} by the tool`, async () => (await found('name_input')).label === `y${ch}y`);
    }
  };
  return { device, field, found, tap, form, typed, hardOnes };
};

describe.runIf(udid)('letters in a window on an iPhone', () => {
  // from what is built, as a Node worker cannot start from sources
  let built: typeof import('../packages/core/src/index.js') &
    typeof import('../packages/driver-apple/src/index.js');
  let phone: IosPhoneDevice;
  const w: Driven = {};
  const { device, field, found, tap, form, typed, hardOnes } = on(w);
  let runner: number | undefined;
  const keys = (text: string, into?: Element) =>
    // eslint-disable-next-line @typescript-eslint/dot-notation -- the runner's own call, protected, which a dot does not reach
    phone['call']('text.keys', { text, ...(into && { into }) }, 30_000);

  beforeAll(async () => {
    built = {
      ...((await import(
        join(packages, 'core/dist/index.js')
      )) as typeof import('../packages/core/src/index.js')),
      ...((await import(
        join(packages, 'driver-apple/dist/index.js')
      )) as typeof import('../packages/driver-apple/src/index.js')),
    };
    phone = new built.IosPhoneDevice(udid);
    w.device = phone;
    runner = (await phone.open()).pid;
    await phone.launch(FIXTURE);
    const binary = await built.viewerBinary();
    const session = new built.MirrorSession({
      mirror: phone.mirror,
      viewer: () =>
        new Promise((resolve) => {
          resolve(new built.ViewerProcess(binary, ['--headless']));
        }),
      options: { quality: 'auto' },
      title: 'a test',
      onChange: () => undefined,
    });
    w.session = session;
    await session.start();
    await until('the picture', () => session.status.state === 'live');
  }, 300_000);

  afterAll(async () => {
    await w.session?.stop('the test ended');
    await w.device?.terminate(FIXTURE).catch(() => undefined);
    await w.device?.stopAgent().catch(() => undefined);
    w.device?.close();
  }, 60_000);

  it('are the ones given, whatever layout the phone has, as are the tool’s', hardOnes, 180_000);

  it.each([100, 900])(
    'after a tap on a secure field %i ms before go there and nowhere else',
    async (gap) => {
      await form();
      await tap(await found('name_input'));
      typed('Ada');
      await until('the name', async () => (await found('name_input')).label === 'Ada');
      await tap(await found('password_input'));
      await pause(gap);
      typed('s3');
      await until('the secret', async () => (await found('password_input')).label === '••');
      expect((await found('name_input')).label).toBe('Ada');
    },
    90_000,
  );

  it('for a field that does not have the focus go nowhere', async () => {
    await form();
    await tap(await found('name_input'));
    typed('Ada');
    await until('the name', async () => (await found('name_input')).label === 'Ada');
    const from = Date.now();
    await expect(keys('s3', await field('password_input'))).rejects.toMatchObject({
      code: 'NO_FOCUS',
    });
    expect(Date.now() - from).toBeGreaterThan(5_000);
    expect((await found('name_input')).label).toBe('Ada');
    expect((await found('password_input')).label).not.toContain('•');
  }, 60_000);

  it('leave no word in what xcodebuild keeps', async () => {
    await form();
    await tap(await found('name_input'));
    typed(WORD);
    await until('the word', async () => (await found('name_input')).label === WORD);
    await tap(await found('password_input'));
    await device().typeText(SECRET, { settle: false });
    await until('the secret', async () =>
      (await found('password_input')).label.startsWith('••••••••'),
    );
    const name = await found('name_input');
    await device().typeText(WORD, { at: { x: name.x, y: name.y }, replace: true, settle: false });
    await device().read(FIXTURE);

    const kept = join(built.stateDir(), `ios-${udid}.kept`);
    const files = (readdirSync(kept, { recursive: true }) as string[])
      .map((f) => join(kept, f))
      .filter((f) => statSync(f).isFile());
    // nothing found in nothing would say nothing: this is where these lines were
    expect(files.some((f) => /Session-.*\.log$/.test(f))).toBe(true);
    const log = join(built.stateDir(), `ios-${udid}.log`);
    for (const file of [log, ...files]) {
      const text = readFileSync(file).toString('latin1');
      expect(text, file).not.toContain(WORD);
      expect(text, file).not.toContain(SECRET);
      expect(text, file).not.toContain('KeyEventComplete');
      expect(text, file).not.toMatch(/value: \S/);
    }
  }, 90_000);

  it('kept one runner through all of this', async () => {
    expect((await phone.open()).pid).toBe(runner);
  });
});

describe.runIf(serial)('letters in a window on an Android phone', () => {
  const w: Driven = {};
  const { hardOnes } = on(w);

  beforeAll(async () => {
    w.device = new AndroidDevice(serial);
    await w.device.open();
    await w.device.launch(FIXTURE);
    const binary = await viewerBinary();
    const session = new MirrorSession({
      mirror: w.device.mirror,
      viewer: () =>
        new Promise((resolve) => {
          resolve(new ViewerProcess(binary, ['--headless']));
        }),
      options: { quality: 'auto' },
      title: 'a test',
      onChange: () => undefined,
    });
    w.session = session;
    await session.start();
    await until('the picture', () => session.status.state === 'live');
  }, 120_000);

  afterAll(async () => {
    await w.session?.stop('the test ended');
    await w.device?.terminate(FIXTURE).catch(() => undefined);
    w.device?.close();
  }, 60_000);

  it('are the ones given, as are the tool’s', hardOnes, 180_000);
});
