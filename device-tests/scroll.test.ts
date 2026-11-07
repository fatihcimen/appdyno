import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Adb, androidProvider, simulatorProvider, Simctl } from './workspace.js';
import { type Answer, type Call, IPHONE, onIphone, opsOn, SIM_FIXTURE } from './helpers.js';

/**
 * `swipe exact` against what the fixture's list shows, on the emulator APPDYNO_ANDROID_SERIAL names and the simulator
 * APPDYNO_IOS_UDID names. The rows are one height apart, so where any row is says how far the list went.
 */
const APP = 'dev.appdyno.fixture';
const ANDROID = process.env.APPDYNO_ANDROID_SERIAL;
const SIMULATOR = process.env.APPDYNO_IOS_UDID;
/** Tap units: a row's place rounds to a whole one at both ends. */
const CLOSE = 4;

const ok = <A extends Answer>(r: A) => {
  expect(r.error ? r.text : '').toBe('');
  return r;
};

function scrollOf(get: () => Call) {
  const call: Call = (n, a) => get()(n, a);
  const list = async () => {
    await call('terminate_app');
    ok(await call('launch_app'));
    ok(await call('open_link', { url: 'appdyno-fixture://open/list' }));
    ok(await call('wait_for', { text: 'Product 1', timeoutMs: 8_000 }));
  };
  /** A list's offset, from a row's number, its place and the rows' spacing. */
  const offset = async (spacing: number) => {
    const rows = (await call('find', { text: 'Product' })).data.matches;
    const row = rows[Math.floor(rows.length / 2)]!;
    return Number(/Product (\d+)/.exec(row.label)![1]) * spacing - row.y;
  };
  const spacing = async () => {
    const y = async (n: number) =>
      (await call('find', { text: `Product ${n}` })).data.matches[0]!.y;
    return ((await y(7)) - (await y(1))) / 6;
  };

  it('moves the content by the distance and stops', async () => {
    await list();
    const gap = await spacing();
    const was = await offset(gap);
    const r = ok(await call('swipe', { direction: 'up', distance: 300, exact: true }));
    expect(Math.abs((await offset(gap)) - was - 300)).toBeLessThanOrEqual(CLOSE);
    expect(r.text).toMatch(/^scrolled up \d+ of 300 in \d strokes?/);
  });

  it('goes back down by as much, in several strokes when it is long', async () => {
    await list();
    const gap = await spacing();
    const was = await offset(gap);
    const far = Math.round(1.5 * ok(await call('device_info')).data.screen.h);
    const r = ok(await call('swipe', { direction: 'up', distance: far, exact: true }));
    expect(r.text).toMatch(new RegExp(`of ${far} in [2-9] strokes`));
    expect(Math.abs((await offset(gap)) - was - far)).toBeLessThanOrEqual(CLOSE);
    ok(await call('swipe', { direction: 'down', distance: far, exact: true }));
    expect(Math.abs((await offset(gap)) - was)).toBeLessThanOrEqual(CLOSE);
  });

  it('says where the list ended, which is no failure', async () => {
    await list();
    const r = ok(await call('swipe', { direction: 'down', distance: 500, exact: true }));
    expect(r.text).toMatch(/^scrolled down \d+ of 500 in \d strokes?: the list ended/);
  });
}

describe.skipIf(!ANDROID)('exact scrolling on Android', () => {
  let o: ReturnType<typeof opsOn>;
  beforeAll(() => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-scroll-')));
    o = opsOn(androidProvider(new Adb()), ANDROID!, APP);
  });
  afterAll(() => o.ctx.close());
  scrollOf(() => o.call);
});

describe.skipIf(!SIMULATOR)('exact scrolling on a simulator', () => {
  let o: ReturnType<typeof opsOn>;
  beforeAll(async () => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-scroll-')));
    await new Simctl().install(SIMULATOR!, SIM_FIXTURE);
    o = opsOn(simulatorProvider(), SIMULATOR!, APP);
  }, 300_000);
  afterAll(() => o.ctx.close());
  scrollOf(() => o.call);
});

describe.skipIf(!IPHONE)('exact scrolling on an iPhone', () => {
  let o: Awaited<ReturnType<typeof onIphone>>;
  beforeAll(async () => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-scroll-')));
    o = await onIphone(APP);
  }, 300_000);
  afterAll(async () => {
    await o.call('terminate_app');
    await o.ctx.end();
    o.ctx.close();
  }, 60_000);
  scrollOf(() => o.call);
});
