import { afterAll, describe, expect, it } from 'vitest';
import { appleProvider, Simctl } from 'appdyno';
import { type Answer, opsOn } from './helpers.js';

/**
 * Creates a simulator of a model and starts it, with APPDYNO_IOS_UDID set for a Mac that has simulators at all: what
 * it makes is deleted again, and nothing else is touched.
 */
const SIMULATOR = process.env.APPDYNO_IOS_UDID;

const ok = <A extends Answer>(r: A) => {
  expect(r.error ? r.text : '').toBe('');
  return r;
};

describe.skipIf(!SIMULATOR)('a simulator of a model', () => {
  const simctl = new Simctl();
  let made: string | undefined;
  afterAll(async () => {
    if (!made) return;
    await simctl.shutdown(made);
    await simctl.exec(['delete', made]);
  }, 240_000);

  it('is created on a runtime that runs it, and started', async () => {
    const { call } = opsOn(appleProvider(), SIMULATOR!, 'dev.appdyno.fixture');
    const r = ok(await call('simulator', { action: 'create', name: 'iPhone SE (3rd generation)' }));
    made = r.data.serial;
    expect(await simctl.state(made!)).toBe('Booted');
    expect(r.text).toContain(`xcrun simctl delete ${made}`);
    const none = await call('simulator', { action: 'create', name: 'Nokia 3310' });
    expect(none.data.code).toBe('NOT_FOUND');
    expect(none.text).toContain('no runtime on this Mac runs a Nokia 3310');
  }, 240_000);
});
