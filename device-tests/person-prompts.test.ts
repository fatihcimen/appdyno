import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Adb, androidProvider, simulatorProvider, Simctl } from './workspace.js';
import { type Answer, type Call, IPHONE, onIphone, opsOn, SIM_FIXTURE } from './helpers.js';

/**
 * A prompt only a person can answer, said by the call that met it with nothing asked: on the simulator APPDYNO_IOS_UDID
 * names and the emulator APPDYNO_ANDROID_SERIAL names, which is given a PIN for it if it has none, and keeps none it was given.
 */
const APP = 'dev.appdyno.fixture';
const ANDROID = process.env.APPDYNO_ANDROID_SERIAL;
const EMULATOR = ANDROID?.startsWith('emulator-');
const SIMULATOR = process.env.APPDYNO_IOS_UDID;
const PIN = '1234';

const ok = <A extends Answer>(r: A) => {
  expect(r.error ? r.text : '').toBe('');
  return r;
};

const asks = async (call: Call) => {
  await call('terminate_app');
  ok(await call('open_link', { url: 'appdyno-fixture://open/biometric' }));
  return ok(await call('tap', { selector: { id: 'authenticate' } }));
};

describe.skipIf(!SIMULATOR)('a prompt on a simulator', () => {
  let o: ReturnType<typeof opsOn>;
  beforeAll(async () => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-person-')));
    await new Simctl().install(SIMULATOR!, SIM_FIXTURE);
    o = opsOn(simulatorProvider(), SIMULATOR!, APP);
    ok(await o.call('device_setting', { name: 'biometric', value: 'enroll' }));
  }, 300_000);
  afterAll(() => o.ctx.close());

  const passes = async () => {
    ok(await o.call('device_setting', { name: 'biometric', value: 'match' }));
    ok(await o.call('wait_for', { id: 'result', text: 'Authenticated', timeoutMs: 8_000 }));
  };

  // a run's first sheet took 3 to 5 s, after the tap's answer: the next read has it
  it('Face ID: a read and a picture say so, as does a tap once a sheet has been up', async () => {
    await asks(o.call);
    await vi.waitFor(
      async () => expect(ok(await o.call('screen')).text).toContain('needs a person: Face ID'),
      { timeout: 10_000, interval: 1_000 },
    );
    expect(ok(await o.call('screenshot')).text).toContain('needs a person: Face ID');
    await passes();
    const r = await asks(o.call);
    expect(r.text).toContain('needs a person: Face ID');
    expect(r.data.warnings.join()).toContain('Face ID');
    await passes();
    expect(ok(await o.call('screen')).text).not.toContain('needs a person');
  });
});

describe.skipIf(!IPHONE)('a prompt on an iPhone', () => {
  // a phone with no face enrolled raises no prompt, and enrolling one is its owner's
  it('Face ID: the tap that raised it says so', async (t) => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-person-')));
    const o = await onIphone(APP);
    const r = await asks(o.call);
    if (/not enrolled/.test(r.text)) return t.skip();
    expect(r.text).toContain('needs a person');
    await o.call('terminate_app');
    await o.ctx.end();
    o.ctx.close();
  }, 300_000);
});

describe.skipIf(!EMULATOR)('a prompt on an emulator', () => {
  const adb = (...words: string[]) =>
    execFileSync('adb', ['-s', ANDROID!, 'shell', ...words], { encoding: 'utf8' });
  const enrolled = () => !/"count":0/.test(adb('dumpsys', 'fingerprint'));
  let o: ReturnType<typeof opsOn>;
  let ours = false;
  beforeAll(async () => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-person-')));
    o = opsOn(androidProvider(new Adb()), ANDROID!, APP);
    ok(await o.call('launch_app'));
    if (!enrolled()) adb('locksettings', 'set-pin', PIN);
    ours = !enrolled();
  }, 120_000);
  afterAll(async () => {
    if (ours) adb('locksettings', 'clear', '--old', PIN);
    o.ctx.close();
  });

  // with a fingerprint the system asks for that instead
  it('a credential: a read says the system is asking for it', async (t) => {
    if (enrolled()) return t.skip();
    // Android 17 asks inside the biometric prompt
    const field =
      Number(adb('getprop', 'ro.build.version.sdk')) >= 37
        ? 'compose_credential_view'
        : 'lockPassword';
    // a PIN just set takes a moment to count as one
    for (let i = 0; i < 5; i++) {
      adb('am', 'start', '-a', 'android.app.action.CONFIRM_DEVICE_CREDENTIAL');
      if ((await o.call('wait_for', { id: field, timeoutMs: 2_000 })).data.met) break;
    }
    expect(ok(await o.call('screen')).text).toContain('needs a person: a passcode');
    ok(await o.call('press_key', { key: 'back' }));
  });

  // a fingerprint is enrolled by settings.test.ts, which keeps it
  it('a fingerprint: the tap that raised it says so', async (t) => {
    if (!enrolled()) return t.skip();
    const r = await asks(o.call);
    expect(r.text).toContain('needs a person: a fingerprint or a face');
    expect(ok(await o.call('screenshot')).text).toContain('needs a person');
    ok(await o.call('device_setting', { name: 'biometric', value: 'match' }));
    ok(await o.call('wait_for', { id: 'result', text: 'Authenticated', timeoutMs: 8_000 }));
  });

  it('a page of the permission controller wants no person for its words', async () => {
    const r = ok(await o.call('open_link', { settings: 'privacy', read: 'full' }));
    expect(r.text).not.toContain('needs a person');
  });
});
