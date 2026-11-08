import { execFileSync } from 'node:child_process';
import { assert, describe, expect, it } from 'vitest';
import type { LiveSample } from '../packages/core/src/index.js';
import { PhoneLive } from '../packages/driver-apple/src/phone-live.js';

/** Our own iPhone (APPDYNO_IPHONE_UDID), from what is built, with the fixture installed and the phone open. */
const udid = process.env.APPDYNO_IPHONE_UDID ?? '';
const FIXTURE = 'dev.appdyno.fixture';

describe.runIf(udid)('an iPhone numbers with no runner', () => {
  it('gives a second of the fixture, and stops when told, twice over', async () => {
    execFileSync('xcrun', [
      'devicectl',
      'device',
      'process',
      'launch',
      '--device',
      udid,
      '--terminate-existing',
      FIXTURE,
    ]);
    const samples: LiveSample[] = [];
    const stop = await new PhoneLive(udid).start((s) => samples.push(s), FIXTURE);
    const end = Date.now() + 30_000;
    while (!samples.some((s) => s.cpuPercent !== undefined) && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 100));
    }
    stop();
    stop();
    const last = samples.at(-1);
    assert(last);
    expect(last.app).toBe(FIXTURE);
    expect(last.cpuPercent).toBeGreaterThanOrEqual(0);
    expect(last.memoryMb).toBeGreaterThan(1);
    expect(last.threads).toBeGreaterThan(0);
    expect(last.absent?.jankyFrames).toBeTruthy();
    expect(last.absent?.networkInKbps).toBeTruthy();
    expect('jankyFrames' in last).toBe(false);

    const seen = samples.length;
    await new Promise((r) => setTimeout(r, 2_500));
    expect(samples).toHaveLength(seen);
  }, 60_000);

  it('says the app is not running, and gives no number for it', async () => {
    const samples: LiveSample[] = [];
    const stop = await new PhoneLive(udid).start((s) => samples.push(s), 'dev.appdyno.nothing');
    const end = Date.now() + 30_000;
    while (samples.length < 2 && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 100));
    }
    stop();
    expect(samples.at(-1)?.absent?.cpuPercent).toContain('not running');
    expect(samples.at(-1)?.cpuPercent).toBeUndefined();
  }, 60_000);
});
