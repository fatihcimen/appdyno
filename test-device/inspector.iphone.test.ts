import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { Devicectl } from '../packages/driver-apple/src/devicectl.js';
import { PhoneInspector } from '../packages/driver-apple/src/phone-inspector.js';

/**
 * Our own iPhone (APPDYNO_IPHONE_UDID) with no runner, from what is built. The phone must be awake and open: each press
 * here reads its screen first, and a phone found on its lock screen fails the first check, with nothing pressed.
 */
const udid = process.env.APPDYNO_IPHONE_UDID;
const FIXTURE = 'dev.appdyno.fixture';

const launch = () =>
  execFileSync('xcrun', [
    'devicectl',
    'device',
    'process',
    'launch',
    '--device',
    udid!,
    '--terminate-existing',
    FIXTURE,
  ]);

describe.runIf(udid)('an iPhone with no runner', () => {
  const inspector = () => new PhoneInspector(new Devicectl(udid!));

  it('reads a screen, presses by id, and reads the next', async () => {
    launch();
    await new Promise((r) => setTimeout(r, 1_500));
    const first = await inspector().elements();
    expect(first.map((e) => e.identifier)).toContain('open_form');
    expect(new Set(first.map((e) => e.caption)).size).toBe(first.length);

    expect((await inspector().press('open_form')).identifier).toBe('open_form');
    await new Promise((r) => setTimeout(r, 1_000));
    const next = await inspector().elements();
    expect(next.map((e) => e.caption)).toContain('Enter your details');
    expect(next.map((e) => e.identifier)).not.toContain('open_form');
    launch();
  }, 60_000);

  it('presses nothing for a name the screen does not hold', async () => {
    await expect(inspector().press('no_such_thing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  }, 30_000);
});
