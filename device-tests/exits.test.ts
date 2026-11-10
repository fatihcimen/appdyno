import { execFileSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';
import { Adb, androidProvider, sleep } from './workspace.js';
import { opsOn, type Call } from './helpers.js';

/**
 * Each way a process can end, caused and then read back by `crashes`, on the fixture on the device
 * APPDYNO_ANDROID_SERIAL names. A provoked ANR is in `vitals.test.ts`. A low-memory kill is not caused here:
 * nothing on an emulator makes one on demand.
 */
const APP = 'dev.appdyno.fixture';
const SERIAL = process.env.APPDYNO_ANDROID_SERIAL ?? '';
const PERMISSION = 'android.permission.ACCESS_FINE_LOCATION';

const shell = (...words: string[]) =>
  execFileSync('adb', ['-s', SERIAL, 'shell', ...words], { encoding: 'utf8' }).trim();

describe.skipIf(!SERIAL)('how an app ended', () => {
  let call: Call;
  /** The reasons `crashes` counts after `cause`, with the app up on its crash screen when it runs. */
  const after = async (cause: () => unknown) => {
    await call('terminate_app');
    await call('open_link', { url: 'appdyno-fixture://open/crash' });
    await call('wait_for', { id: 'exit', timeoutMs: 8_000 });
    const since = new Date().toISOString();
    await cause();
    await sleep(2_000);
    const r = await call('crashes', { since });
    return { text: r.text, exits: r.data.exits ?? [] };
  };
  const reasons = (exits: { reason: string }[]) => exits.map((e) => e.reason);

  beforeAll(() => {
    call = opsOn(androidProvider(new Adb()), SERIAL, APP).call;
  });

  it('reads an app that left by itself, with its code', async () => {
    const { exits, text } = await after(() => call('tap', { selector: { id: 'exit' } }));
    expect(reasons(exits)).toContain('EXIT_SELF status 3');
    expect(text).toContain('EXIT_SELF status 3');
  });

  it('reads a signal, with its number', async () => {
    const { exits } = await after(() => shell('run-as', APP, 'kill', '-9', shell('pidof', APP)));
    expect(reasons(exits)).toContain('SIGNALED status 9');
  });

  it('reads a kill in the background apart from a force stop', async () => {
    const { exits } = await after(async () => {
      shell('input', 'keyevent', 'KEYCODE_HOME');
      await sleep(1_000);
      shell('am', 'kill', APP);
    });
    // a Xiaomi with Android 16 names no subreason for it: it is a user's request all the same, and no force stop
    expect(reasons(exits)).toContainEqual(
      expect.stringMatching(/^USER REQUESTED( KILL BACKGROUND)?$/),
    );
    const stopped = await after(() => shell('am', 'force-stop', APP));
    expect(reasons(stopped.exits)).toContain('USER REQUESTED FORCE STOP');
  });

  it('reads a permission taken away while it ran', async () => {
    // held first: a suite before this one may have installed the app again, with nothing granted, and a revoke of what
    // the app does not hold ends nothing
    shell('pm', 'grant', APP, PERMISSION);
    const { exits } = await after(() => shell('pm', 'revoke', APP, PERMISSION));
    shell('pm', 'grant', APP, PERMISSION);
    expect(reasons(exits)).toContain('PERMISSION CHANGE');
  });

  it('reads a crash, kept as a report too', async () => {
    const { exits, text } = await after(() => call('tap', { selector: { id: 'crash' } }));
    expect(reasons(exits)).toContain('APP CRASH(EXCEPTION)');
    expect(text).toContain('1 crash report');
  });
});
