import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Adb, androidProvider, appleProvider, pause, Simctl } from './workspace.js';
import { type Answer, type Call, opsOn } from './helpers.js';
import { Parent } from '../packages/ops/src/mirror/parent.js';
import { liveMirror } from '../packages/ops/src/mirror-state.js';
import type { ServerContext } from '../packages/ops/src/context.js';

/** The fixture's marquee, smooth and with each fault, read from the stream, on the devices the variables name. */
const APP = 'dev.appdyno.fixture';
const ANDROID = process.env.APPDYNO_ANDROID_SERIAL;
const SIMULATOR = process.env.APPDYNO_IOS_UDID;
const PRODUCTS = join(import.meta.dirname, '../ios/.derived/Build/Products/Debug-iphonesimulator');
const WATCH_MS = 3_000;

const ok = <A extends Answer>(r: A) => {
  expect(r.error ? r.text : '').toBe('');
  return r;
};

function watchOf(get: () => Call, ctx: () => ServerContext, serial: string) {
  const call: Call = (n, a) => get()(n, a);
  const open = async (screen: string) => {
    await call('terminate_app');
    ok(await call('launch_app'));
    ok(await call('open_link', { url: `appdyno-fixture://open/${screen}`, read: 'none' }));
    await pause(1_000);
  };
  const watched = async (screen: string) => {
    await open(screen);
    const at = Date.now();
    const { text } = ok(await call('screenshot', { watchMs: WATCH_MS }));
    console.log(`WATCH ${screen} in ${Date.now() - at} ms: ${text.replace(/\n/g, ' | ')}`);
    return text;
  };

  it('says a smooth marquee runs left, smoothly, and at what speed', async () => {
    expect(await watched('marquee')).toMatch(/moves left at \d+\/s, smoothly/);
  });

  it('says one that jumps did', async () => {
    expect(await watched('marquee_jumps')).toMatch(/moves left at \d+\/s, jumped \d+ at/);
  });

  it('says one that runs backwards did', async () => {
    expect(await watched('marquee_back')).toContain('ran backwards at');
  });

  it('says where one is cut', async () => {
    expect(await watched('marquee_cut')).toMatch(/cut at x \d+/);
  });

  it('gives a film strip of timed frames on request', async () => {
    await open('marquee');
    const r = ok(await call('screenshot', { watchMs: 2_000, strip: true }));
    expect(r.text).toMatch(/frames at (\d\.\d, ){3,}/);
  });

  it('shares a window that is already streaming', async () => {
    const parent = new Parent(ctx(), {
      serials: [serial],
      max: 1,
      options: { quality: 'standard' },
      headless: true,
      noInput: true,
      focus: false,
      inputOnClick: false,
      log: () => undefined,
    });
    await parent.open(serial);
    try {
      await vi.waitFor(() => expect(parent.sessions.get(serial)?.status.state).toBe('live'), {
        timeout: 30_000,
      });
      expect(liveMirror(serial)).toBeDefined();
      await open('marquee');
      expect(ok(await call('screenshot', { watchMs: WATCH_MS })).text).toContain('moves left');
    } finally {
      await parent.stopAll('the test is over');
    }
  });

  it('asserts that a thing must move, and that it must not', async () => {
    await open('marquee');
    ok(await call('assert', { check: 'moves', timeoutMs: 1_500 }));
    const still = await call('assert', { check: 'moves', expect: false, timeoutMs: 1_500 });
    expect(still.data.code).toBe('CHECK_FAILED');
    await open('form');
    ok(await call('assert', { check: 'moves', expect: false, timeoutMs: 1_500 }));
  });
}

describe.skipIf(!ANDROID)('a watch on Android', () => {
  let o: ReturnType<typeof opsOn>;
  beforeAll(() => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-watch-')));
    o = opsOn(androidProvider(new Adb()), ANDROID!, APP);
  });
  afterAll(() => o.ctx.close());
  watchOf(
    () => o.call,
    () => o.ctx,
    ANDROID!,
  );
});

describe.skipIf(!SIMULATOR)('a watch on a simulator', () => {
  let o: ReturnType<typeof opsOn>;
  beforeAll(async () => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-watch-')));
    await new Simctl().install(SIMULATOR!, join(PRODUCTS, 'Fixture.app'));
    o = opsOn(appleProvider(), SIMULATOR!, APP);
  }, 300_000);
  afterAll(() => o.ctx.close());
  watchOf(
    () => o.call,
    () => o.ctx,
    SIMULATOR!,
  );
});
