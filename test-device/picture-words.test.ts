import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Adb, androidProvider, appleProvider, Simctl } from 'appdyno';
import { type Answer, type Call, IPHONE, onIphone, opsOn } from './helpers.js';

/**
 * A screen whose words are only a picture, on the emulator APPDYNO_ANDROID_SERIAL names and the simulator
 * APPDYNO_IOS_UDID names: the fixture's canvas, with nothing of them in the tree.
 */
const APP = 'dev.appdyno.fixture';
const ANDROID = process.env.APPDYNO_ANDROID_SERIAL;
const SIMULATOR = process.env.APPDYNO_IOS_UDID;
const PRODUCTS = join(import.meta.dirname, '../ios/.derived/Build/Products/Debug-iphonesimulator');

const ok = <A extends Answer>(r: A) => {
  expect(r.error ? r.text : '').toBe('');
  return r;
};

function wordsOf(get: () => Call) {
  const call: Call = (n, a) => get()(n, a);
  const canvas = async () => {
    await call('terminate_app');
    ok(await call('launch_app'));
    ok(await call('open_link', { url: 'appdyno-fixture://open/canvas' }));
  };

  it('reads them, says where they came from, and finds them', async () => {
    await canvas();
    const r = ok(await call('wait_for', { text: 'Start Game', timeoutMs: 10_000 }));
    expect(r.data.met).toBe(true);
    const screen = ok(await call('screen'));
    expect(screen.text).toContain('"Start Game"');
    expect(screen.text).toContain('read from the picture');
    const found = ok(await call('find', { text: 'Start Game' })).data.matches[0]!;
    expect(found.bounds.w).toBeGreaterThan(50);
  });

  it('taps them by their words, and sees the picture change', async () => {
    await canvas();
    ok(await call('wait_for', { text: 'Start Game', timeoutMs: 10_000 }));
    ok(await call('tap', { selector: { text: 'Start Game' } }));
    const r = ok(await call('wait_for', { text: 'Game Over', timeoutMs: 10_000 }));
    expect(r.data.met).toBe(true);
  });
}

describe.skipIf(!ANDROID)('a picture on Android', () => {
  let o: ReturnType<typeof opsOn>;
  beforeAll(() => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-words-')));
    o = opsOn(androidProvider(new Adb()), ANDROID!, APP);
  });
  afterAll(() => o.ctx.close());
  wordsOf(() => o.call);
});

describe.skipIf(!SIMULATOR)('a picture on a simulator', () => {
  let o: ReturnType<typeof opsOn>;
  beforeAll(async () => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-words-')));
    await new Simctl().install(SIMULATOR!, join(PRODUCTS, 'Fixture.app'));
    o = opsOn(appleProvider(), SIMULATOR!, APP);
  }, 300_000);
  afterAll(() => o.ctx.close());
  wordsOf(() => o.call);
});

describe.skipIf(!IPHONE)('a picture on an iPhone', () => {
  let o: Awaited<ReturnType<typeof onIphone>>;
  beforeAll(async () => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-words-')));
    o = await onIphone(APP);
  }, 300_000);
  afterAll(async () => {
    await o.call('terminate_app');
    await o.ctx.end();
    o.ctx.close();
  }, 60_000);
  wordsOf(() => o.call);
});
