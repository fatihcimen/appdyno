import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Adb, androidProvider, simulatorProvider, sleep } from './workspace.js';
import { opsOn, type Call, SIM_FIXTURE } from './helpers.js';

/**
 * A real crash on the fixture, found by `crashes`, then named from a real symbol file: a function that only
 * that file can name, in a library or a binary that has lost it. Android: the fixture as `assembleDebug`
 * leaves it, whose APK holds a stripped library, on the device APPDYNO_ANDROID_SERIAL names; this needs a
 * tombstone, and a device keeps 6 of an app in some minutes, so a run soon after many crashes has none. A simulator
 * (APPDYNO_IOS_UDID) needs a stripped Release build with its dSYM beside it, in APPDYNO_IOS_RELEASE_BUILD:
 *
 *   xcodebuild build -project ios/Appdyno.xcodeproj -target Fixture -configuration Release \
 *     -sdk iphonesimulator ARCHS=arm64 ONLY_ACTIVE_ARCH=NO DEBUG_INFORMATION_FORMAT=dwarf-with-dsym \
 *     DEPLOYMENT_POSTPROCESSING=YES STRIP_INSTALLED_PRODUCT=YES SYMROOT=<dir>
 *
 * The Debug build goes back on the simulator at the end, for the suites that need it.
 */
const APP = 'dev.appdyno.fixture';
const ANDROID = process.env.APPDYNO_ANDROID_SERIAL;
const SIMULATOR = process.env.APPDYNO_IOS_UDID;
const RELEASE = process.env.APPDYNO_IOS_RELEASE_BUILD;
const LIBS = join(
  import.meta.dirname,
  '../android/fixture/build/intermediates/merged_native_libs/debug/mergeDebugNativeLibs/out/lib',
);

/** Crashes the fixture by a button of its crash screen, and waits for a report that says `shows`. */
const crash = async (call: Call, button: string, shows: RegExp) => {
  const since = new Date().toISOString();
  await call('terminate_app');
  await call('launch_app');
  await call('open_link', { url: 'appdyno-fixture://open/crash' });
  await call('wait_for', { id: button, timeoutMs: 8_000 });
  await call('tap', { selector: { id: button } });
  for (let i = 0; i < 40; i++) {
    const { data } = await call('crashes', { since });
    if (data.reports?.some((r) => shows.test(`${r.reason}\n${r.detail}`))) return since;
    await sleep(500);
  }
  throw new Error('no report of the crash');
};

const report = async (call: Call, since: string, symbols?: string) => {
  const r = await call('crashes', { since, ...(symbols && { symbols }) });
  return { ...r, report: r.data.reports?.[0] };
};

describe.skipIf(!ANDROID)('a crash on an emulator', () => {
  let call: Call;
  beforeAll(() => {
    call = opsOn(androidProvider(new Adb()), ANDROID!, APP).call;
  });

  it('finds a native crash, and only its symbols name the function', async () => {
    const since = await crash(call, 'crash_native', /signal 11/);
    const bare = await report(call, since);
    expect(bare.report!.detail).toContain('signal 11 (SIGSEGV)');
    expect(bare.report!.detail).toContain('libfixture_native.so');
    expect(bare.report!.detail).not.toContain('fixture_native_crash');
    expect(bare.report!.symbolicated).toBeUndefined();

    const named = await report(call, since, LIBS);
    expect(named.report!.detail).toMatch(
      /#00 libfixture_native\.so fixture_native_crash crash\.c:4:\d+/,
    );
    expect(named.report!.detail).toContain('Java_dev_appdyno_fixture_Native_crash crash.c:7');
    expect(named.data.note).toBeUndefined();
    expect(readFileSync(named.report!.symbolicated!, 'utf8')).toContain('fixture_native_crash');

    // the same library for another ABI is another build, with its own id
    const other = await report(call, since, join(LIBS, 'x86_64'));
    expect(other.data.note).toMatch(
      /libfixture_native\.so: the crash is of build \w+, these symbols of \w+/,
    );
    expect(other.report!.detail).not.toContain('fixture_native_crash');

    const none = await call('crashes', { since, symbols: '/no/such/folder' });
    expect(none.data.code).toBe('NOT_FOUND');
    expect(none.text).toContain('no such folder of symbols');
  });

  it('says a crash with no tombstone has nothing to name', async () => {
    const since = await crash(call, 'crash', /CRASH/);
    const r = await report(call, since, LIBS);
    expect(r.report!.symbolicated).toBeUndefined();
    expect(r.data.note).toContain('only a native crash leaves a tombstone');
  });
});

describe.skipIf(!SIMULATOR || !RELEASE)('a crash on a simulator', () => {
  let call: Call;
  const build = join(RELEASE ?? '', 'Release-iphonesimulator');
  const dir = mkdtempSync(join(tmpdir(), 'appdyno-dsym-'));
  const other = join(dir, 'other.dSYM');

  beforeAll(() => {
    expect(existsSync(join(build, 'Fixture.app.dSYM'))).toBe(true);
    execFileSync('xcrun', ['simctl', 'install', SIMULATOR!, join(build, 'Fixture.app')]);
    // a real dSYM of another binary: what a stale one looks like
    const source = join(dir, 'other.c');
    writeFileSync(source, 'int main(void) { return 0; }\n');
    const binary = join(dir, 'other');
    // in two steps: dsymutil reads the debug information from the object file, which one step would delete
    execFileSync('xcrun', ['clang', '-g', '-arch', 'arm64', '-c', source, '-o', `${binary}.o`]);
    execFileSync('xcrun', ['clang', '-arch', 'arm64', `${binary}.o`, '-o', binary]);
    execFileSync('xcrun', ['dsymutil', binary, '-o', other]);
    call = opsOn(simulatorProvider(), SIMULATOR!, APP).call;
  });
  afterAll(() => {
    if (existsSync(SIM_FIXTURE))
      execFileSync('xcrun', ['simctl', 'install', SIMULATOR!, SIM_FIXTURE]);
  });

  it('finds a crash, and only the dSYM with its UUID names the function', async () => {
    const since = await crash(call, 'crash', /EXC_BREAKPOINT/);
    const bare = await report(call, since);
    expect(bare.report!.reason).toContain('EXC_BREAKPOINT');
    expect(bare.report!.detail).toMatch(/^Fixture$/m);
    expect(bare.report!.detail).not.toContain('fixtureCrash');

    for (const symbols of [build, join(build, 'Fixture.app.dSYM')]) {
      const named = await report(call, since, symbols);
      expect(named.report!.detail).toContain('Fixture fixtureCrash(_:)');
      expect(named.data.note).toBeUndefined();
      expect(readFileSync(named.report!.symbolicated!, 'utf8')).toContain('fixtureCrash');
    }

    const wrong = await report(call, since, other);
    expect(wrong.report!.detail).not.toContain('fixtureCrash');
    expect(wrong.report!.symbolicated).toBeUndefined();
    expect(wrong.data.note).toMatch(/no dSYM for Fixture [0-9a-f-]+: .*other\.dSYM has other /);
    expect(wrong.data.note).not.toContain('Gestures');
  });

  it('refuses a path with no dSYM', async () => {
    const none = await call('crashes', { symbols: '/no/such/thing.dSYM' });
    expect(none.data.code).toBe('NOT_FOUND');
    const empty = await call('crashes', { symbols: mkdtempSync(join(tmpdir(), 'appdyno-none-')) });
    expect(empty.text).toContain('no .dSYM under');
  });
});
