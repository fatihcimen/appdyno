import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, assert, beforeAll, describe, expect, it } from 'vitest';
import { Adb, androidProvider } from './workspace.js';
import { opsOn, type Call } from './helpers.js';

/**
 * A Baseline Profile on the fixture's release build, whose start is 150 controls of Compose, on the device
 * APPDYNO_ANDROID_SERIAL names, with an API of 31 or more for the `.dm` this picks:
 *
 *   (cd android && ./gradlew :fixture:assembleDebug :fixture:assembleRelease)
 *
 * The build's folder holds a `.dm` per range of API, and one for another range installs and compiles nothing,
 * where Android 17 refuses the install. The debug build goes back at the end. Each install is `manage_app install`,
 * which answers a Xiaomi's prompt before an install over USB: no person taps it.
 */
const APP = 'dev.appdyno.fixture';
const SERIAL = process.env.APPDYNO_ANDROID_SERIAL ?? '';
const OUT = join(import.meta.dirname, '../android/fixture/build/outputs/apk');
const RELEASE = join(OUT, 'release/fixture-release.apk');
const DM_FOR_THIS_API = join(OUT, 'release/baselineProfiles/0/fixture-release.dm');
const DM_FOR_OLDER = join(OUT, 'release/baselineProfiles/1/fixture-release.dm');

const adb = (...words: string[]) =>
  execFileSync('adb', ['-s', SERIAL, ...words], { encoding: 'utf8' });
const state = () =>
  /status=[\w-]+\] \[reason=[\w-]+/.exec(adb('shell', 'pm', 'art', 'dump', APP))?.[0];

describe.skipIf(!SERIAL)('a Baseline Profile', { timeout: 300_000 }, () => {
  let call: Call;
  /** The fixture fresh from these files, as one install; a refusal throws its words. */
  const installed = async (...files: string[]) => {
    // before the uninstall: a build not made leaves the fixture on the device
    const missing = files.filter((f) => !existsSync(f));
    if (missing.length > 0)
      throw new Error(
        `build the fixture first, (cd android && ./gradlew :fixture:assembleDebug :fixture:assembleRelease): no ${missing.join(', ')}`,
      );
    // an install that failed before left none to uninstall, and the debug build still goes back at the end
    adb('shell', `pm uninstall ${APP} >/dev/null || true`);
    const r = await call('manage_app', { action: 'install', files });
    if (r.error) throw new Error(r.text);
    process.stderr.write(`--- install\n${r.text}\n---\n`);
  };
  const profile = async (app = APP) => {
    const r = await call('measure_performance', {
      metric: 'launch',
      app,
      baselineProfile: true,
      repeats: 4,
    });
    process.stderr.write(`--- ${app}\n${r.text}\n---\n`);
    return r;
  };

  beforeAll(() => {
    call = opsOn(androidProvider(new Adb()), SERIAL, APP).call;
  });
  afterAll(() => installed(join(OUT, 'debug/fixture-debug.apk')));

  it('refuses a debuggable build: it stays at verify whatever is asked', async () => {
    await installed(join(OUT, 'debug/fixture-debug.apk'));
    const r = await call('measure_performance', {
      metric: 'launch',
      baselineProfile: true,
      repeats: 1,
    });
    expect(r.data.code).toBe('UNSUPPORTED');
    expect(r.text).toContain('measure a release build');
  });

  it('reads present, not applied, and starts faster with it, as the gate calls it', async () => {
    await installed(RELEASE);
    const before = state();
    const r = await profile();
    const b = r.data.baselineProfile;
    assert(b);
    expect(b.present).toBe(true);
    expect(b.applied).toBe(false);
    // a Samsung names a fresh install's reason install-speg: its filter is verify all the same, nothing compiled
    expect(b.state).toMatch(/^status=verify reason=install(-speg)?$/);
    expect(b.rules).toBeGreaterThan(1_000);
    expect(b.withoutMs).toHaveLength(12);
    expect(b.withMs).toHaveLength(12);
    expect(b.verdict).toBe('worth-it');
    expect(r.text).toContain('not applied');
    expect(r.text).toMatch(/cold start \d+ ms without, \d+ ms with: \d+ ms faster/);
    // the app ends compiled as an install leaves it: a reset names its reason install, where a Samsung's said install-speg
    const filter = (s: string | undefined) => s?.replace(/\] \[reason=.*/, '');
    expect(filter(state())).toBe(filter(before));
  });

  it('reads applied from a .dm of this Android, and it survives the measure', async () => {
    await installed(RELEASE, DM_FOR_THIS_API);
    expect(state()).toContain('status=speed-profile');
    const r = await profile();
    const b = r.data.baselineProfile;
    assert(b);
    expect(b.applied).toBe(true);
    expect(b.state).toBe('status=speed-profile reason=install-dm');
    expect(b.verdict).toBe('worth-it');
    expect(state()).toContain('status=speed-profile');
  });

  it('calls a .dm that compiled nothing what it is, whatever its reason says', async () => {
    if (Number(adb('shell', 'getprop', 'ro.build.version.sdk')) >= 37) {
      // Android 17 refuses the install of a .dm for another range of API, so none compiles nothing
      await expect(installed(RELEASE, DM_FOR_OLDER)).rejects.toThrow(
        'was not installed: the device cannot load the profile its .dm holds ("The profile is in the wrong format")',
      );
      await installed(RELEASE);
      return;
    }
    // the app is installed all the same, where the device may warn that it could not load the profile, which adb 37
    // exits 1 for and appdyno quotes
    await installed(RELEASE, DM_FOR_OLDER);
    expect(state()).toContain('reason=install-dm');
    const r = await call('measure_performance', {
      metric: 'launch',
      baselineProfile: true,
      repeats: 1,
    });
    expect(r.data.baselineProfile?.applied).toBe(false);
    expect(r.text).toContain('delivered, and it compiled nothing');
  });

  it('says an APK has no profile, on an app that has none', async () => {
    const r = await profile('com.android.shell');
    expect(r.data.baselineProfile?.present).toBe(false);
    expect(r.text).toContain('none in the APK');
    expect(r.data.baselineProfile?.withoutMs).toEqual([]);
  });
});
