import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Adb, androidProvider, appleProvider, Simctl } from 'appdyno';
import { type Answer, type Call, IPHONE, onIphone, opsOn } from './helpers.js';

/**
 * A sequence of any tools in one call, against the fixture, on the emulator APPDYNO_ANDROID_SERIAL names and the
 * simulator APPDYNO_IOS_UDID names, with the longest there may be, and how long it took.
 */
const APP = 'dev.appdyno.fixture';
const ANDROID = process.env.APPDYNO_ANDROID_SERIAL;
const SIMULATOR = process.env.APPDYNO_IOS_UDID;
const PRODUCTS = join(import.meta.dirname, '../ios/.derived/Build/Products/Debug-iphonesimulator');

const ok = <A extends Answer>(r: A) => {
  expect(r.error ? r.text : '').toBe('');
  return r;
};

function stepsOf(get: () => Call) {
  const call: Call = (n, a) => get()(n, a);

  it('reads, takes pictures and acts across screens, and says each answer', async () => {
    await call('terminate_app');
    ok(await call('launch_app'));
    const r = ok(
      await call('steps', {
        steps: [
          { action: 'screenshot' },
          { action: 'tap', selector: { text: 'Form' }, read: 'diff' },
          { action: 'wait_for', id: 'name_input' },
          { action: 'type_text', selector: { id: 'name_input' }, text: 'Ali' },
          { action: 'find', id: 'name_input' },
          { action: 'screenshot' },
          { action: 'device_info' },
        ],
      }),
    );
    expect(r.text).toMatch(/^1\. image /m);
    expect(r.text).toMatch(/^2\. tapped /m);
    expect(r.text).toMatch(/^5\. @\w+ textField/m);
    expect(r.text).toMatch(/^6\. image /m);
    expect(r.text).toContain(`foreground: ${APP}`);
  });

  it('runs the most it may, with each step answered', async () => {
    await call('terminate_app');
    ok(await call('launch_app'));
    ok(await call('open_link', { url: 'appdyno-fixture://open/form' }));
    const started = Date.now();
    const r = ok(
      await call('steps', {
        steps: [
          { action: 'tap', selector: { id: 'name_input' } },
          ...Array.from({ length: 29 }, (_, i) => ({ action: 'press_key', key: `${i % 10}` })),
        ],
      }),
    );
    expect(r.text.split('\n').filter((l) => /^\d+\. pressed/.test(l))).toHaveLength(29);
    // what a client's usual limit of a minute means here
    console.log(`30 steps in ${Date.now() - started} ms`);
  });
}

describe.skipIf(!ANDROID)('steps on Android', () => {
  let o: ReturnType<typeof opsOn>;
  beforeAll(() => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-steps-')));
    o = opsOn(androidProvider(new Adb()), ANDROID!, APP);
  });
  afterAll(() => o.ctx.close());
  stepsOf(() => o.call);
});

describe.skipIf(!SIMULATOR)('steps on a simulator', () => {
  let o: ReturnType<typeof opsOn>;
  beforeAll(async () => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-steps-')));
    await new Simctl().install(SIMULATOR!, join(PRODUCTS, 'Fixture.app'));
    o = opsOn(appleProvider(), SIMULATOR!, APP);
  }, 300_000);
  afterAll(() => o.ctx.close());
  stepsOf(() => o.call);
});

describe.skipIf(!IPHONE)('steps on an iPhone', () => {
  let o: Awaited<ReturnType<typeof onIphone>>;
  beforeAll(async () => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-steps-')));
    o = await onIphone(APP);
  }, 300_000);
  afterAll(async () => {
    await o.call('terminate_app');
    await o.ctx.end();
    o.ctx.close();
  }, 60_000);
  stepsOf(() => o.call);
});
