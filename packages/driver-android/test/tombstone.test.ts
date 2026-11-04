import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Adb } from '../src/adb.js';
import { androidCrashes, crashReports } from '../src/crashes.js';
import { namedFrames, namedTombstone, shortFrame } from '../src/tombstone.js';

const PC =
  '      #00 pc 0000000000000660  /data/app/~~QX==/dev.appdyno.fixture-Bo==/base.apk!libfixture_native.so (offset 0x7d4000) (BuildId: d775acdaccea)';

/** `ndk-stack`, as it printed on an emulator. */
const NAMED = `********** Crash dump: **********
Build fingerprint: 'google/sdk_gphone64_arm64/emu64a:14/UE1A.230829.050/12077443:userdebug/dev-keys'
#00 0x0000000000000660 /data/app/~~QX==/dev.appdyno.fixture-Bo==/base.apk!libfixture_native.so (offset 0x7d4000) (BuildId: d775acdaccea)
                                                                                                                                        fixture_native_crash
                                                                                                                                        /Users/someone/fixture/src/main/cpp/crash.c:4:90
#01 0x0000000000000684 /data/app/~~QX==/dev.appdyno.fixture-Bo==/base.apk!libfixture_native.so (offset 0x7d4000) (Java_dev_appdyno_fixture_Native_crash+24) (BuildId: d775acdaccea)
                                                                                                                                        Java_dev_appdyno_fixture_Native_crash
                                                                                                                                        /Users/someone/fixture/src/main/cpp/crash.c:7:5
#02 0x0000000000377030 /apex/com.android.art/lib64/libart.so (art_quick_generic_jni_trampoline+144) (BuildId: b10f5696fea1)
Crash dump is completed
`;

/** The same with the symbols of another build: a line each, under each frame it could not name. */
const OTHER = `********** Crash dump: **********
WARNING: Mismatched build id for out/lib/x86_64/libfixture_native.so
WARNING:   Expected 1dd276e8da54
WARNING:   Found    ab7cc72d1337
#00 0x0000000000000688 /data/app/~~P8==/dev.appdyno.fixture-sD==/base.apk!libfixture_native.so (offset 0x7d4000) (BuildId: 1dd276e8da54)
WARNING: Mismatched build id for out/lib/x86_64/libfixture_native.so
WARNING:   Expected 1dd276e8da54
WARNING:   Found    ab7cc72d1337
#01 0x00000000000006ac /data/app/~~P8==/dev.appdyno.fixture-sD==/base.apk!libfixture_native.so (offset 0x7d4000) (BuildId: 1dd276e8da54)
`;

const dropbox = `========================================
2026-11-04 13:14:50 data_app_native_crash (text, 3000 bytes)
Process: dev.appdyno.fixture
Package: dev.appdyno.fixture v1 (0.1.0)

*** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***
Build fingerprint: 'google/sdk_gphone64_arm64/emu64a:14/UE1A/1:userdebug/dev-keys'
ABI: 'arm64'
signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0x0000000000000000

backtrace:
${PC}
      #01 pc 0000000000377030  /apex/com.android.art/lib64/libart.so (art_quick_generic_jni_trampoline+144) (BuildId: b10f5696fea1)
`;

describe('a tombstone', () => {
  it('reads a frame by its library, with none of what tells builds apart', () => {
    expect(shortFrame(PC)).toBe('#00 pc 0000000000000660 libfixture_native.so');
  });

  it('gives its signal and frames as a report’s detail, not its headers', () => {
    const [report] = crashReports('', dropbox, { app: 'dev.appdyno.fixture', limit: 5 });
    expect(report!.detail).toBe(
      [
        'signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0x0000000000000000',
        '#00 pc 0000000000000660 libfixture_native.so',
        '#01 pc 0000000000377030 libart.so (art_quick_generic_jni_trampoline+144)',
      ].join('\n'),
    );
    expect(report!.tombstone).toContain('backtrace:');
  });

  it('joins what ndk-stack names to each frame', () => {
    expect(namedFrames(NAMED)).toEqual({
      frames: [
        '#00 libfixture_native.so fixture_native_crash crash.c:4:90',
        '#01 libfixture_native.so (Java_dev_appdyno_fixture_Native_crash+24) Java_dev_appdyno_fixture_Native_crash crash.c:7:5',
        '#02 libart.so (art_quick_generic_jni_trampoline+144)',
      ],
      otherBuilds: [],
    });
  });

  it('names no frame from another build, and says which, once', () => {
    expect(namedFrames(OTHER)).toEqual({
      frames: ['#00 libfixture_native.so', '#01 libfixture_native.so'],
      otherBuilds: [
        'libfixture_native.so: the crash is of build 1dd276e8da54, these symbols of ab7cc72d1337',
      ],
    });
  });

  describe('asked for with none to be had', () => {
    const exit = (reason: string) => `  ApplicationExitInfo #0:
    timestamp=2026-11-04 13:23:19.203 pid=9932 realUid=10192
    process=dev.appdyno.fixture reason=5 (${reason}) subreason=0 (UNKNOWN) status=11
    description=crash
`;
    const noteOf = async (reason: string) => {
      vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-tomb-')));
      const adb = {
        exec: async (_s: string, c: string) => (c.includes('exit-info') ? exit(reason) : ''),
      };
      const q = { app: 'dev.appdyno.fixture', limit: 5, symbols: '/no/such/folder' };
      const { note, reports } = await androidCrashes(adb as unknown as Adb, 'emulator-5554', q);
      vi.unstubAllEnvs();
      expect(reports).toHaveLength(1);
      return note;
    };

    it('says a native crash’s tombstone is late or was not kept, and that nothing else has one', async () => {
      expect(await noteOf('APP CRASH(NATIVE)')).toContain('has no tombstone');
      expect(await noteOf('APP CRASH(NATIVE)')).toContain('Android keeps few of them');
      expect(await noteOf('APP CRASH(EXCEPTION)')).toBe(
        'nothing to name: only a native crash leaves a tombstone',
      );
    });
  });

  it('refuses a folder that is not there, and an SDK with no NDK, saying so', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'appdyno-tomb-')), 't.txt');
    await expect(namedTombstone(dropbox, '/no/such/folder', file)).rejects.toThrow(
      'no such folder of symbols',
    );
    vi.stubEnv('ANDROID_HOME', '/no/such/sdk');
    await expect(namedTombstone(dropbox, tmpdir(), file)).rejects.toThrow('takes ndk-stack');
    vi.unstubAllEnvs();
  });
});
