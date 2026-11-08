import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert, describe, expect, it, vi } from 'vitest';
import type { Adb } from '../src/adb.js';
import {
  allExits,
  androidCrashes,
  crashReports,
  exitCounts,
  parseExitInfo,
} from '../src/crashes.js';
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
    expect(report?.detail).toBe(
      [
        'signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0x0000000000000000',
        '#00 pc 0000000000000660 libfixture_native.so',
        '#01 pc 0000000000377030 libart.so (art_quick_generic_jni_trampoline+144)',
      ].join('\n'),
    );
    expect(report?.tombstone).toContain('backtrace:');
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
        exec: (_s: string, c: string) =>
          Promise.resolve(c.includes('exit-info') ? exit(reason) : ''),
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

describe('how an app ended', () => {
  const block = (at: string, reason: string, rest: string) => `  ApplicationExitInfo #0:
          timestamp=2026-11-04 ${at} pid=24296 realUid=10205 packageUid=10205 definingUid=10205 user=0
          process=dev.appdyno.fixture ${reason}
          importance=100 ${rest} state=empty trace=null
`;
  /** As an emulator with API 34 printed them, each provoked on purpose. */
  const INFO = [
    block(
      '14:01:28.548',
      'reason=10 (USER REQUESTED) subreason=21 (FORCE STOP) status=0',
      'pss=0.00 rss=0.00 description=stop dev.appdyno.fixture due to from pid 24341',
    ),
    block(
      '14:01:20.000',
      'reason=4 (APP CRASH(EXCEPTION)) subreason=0 (UNKNOWN) status=0',
      'pss=0.00 rss=0.00 description=crash',
    ),
    block(
      '14:01:10.000',
      'reason=8 (PERMISSION CHANGE) subreason=0 (UNKNOWN) status=0',
      'pss=0.00 rss=0.00 description=permissions revoked',
    ),
    block(
      '14:01:00.000',
      'reason=10 (USER REQUESTED) subreason=24 (KILL BACKGROUND) status=0',
      'pss=0.00 rss=0.00 description=kill background',
    ),
    block(
      '14:00:50.000',
      'reason=2 (SIGNALED) subreason=0 (UNKNOWN) status=9',
      'pss=0.00 rss=0.00 description=null',
    ),
    block(
      '14:00:40.000',
      'reason=1 (EXIT_SELF) subreason=0 (UNKNOWN) status=3',
      'pss=0.00 rss=0.00 description=null',
    ),
    block(
      '14:00:30.000',
      'reason=16 (PACKAGE UPDATED) subreason=0 (UNKNOWN) status=0',
      'pss=62MB rss=147MB description=stop dev.appdyno.fixture due to installPackageLI',
    ),
    block(
      '14:00:20.000',
      'reason=10 (USER REQUESTED) subreason=21 (FORCE STOP) status=0',
      'pss=0.00 rss=0.00 description=stop',
    ),
  ].join('');

  it('reads every reason in full, with what tells one end from another', () => {
    expect(exitCounts(allExits(INFO))).toEqual([
      { reason: 'USER REQUESTED FORCE STOP', count: 2, newest: '2026-11-04 14:01:28.548' },
      { reason: 'APP CRASH(EXCEPTION)', count: 1, newest: '2026-11-04 14:01:20.000' },
      { reason: 'PERMISSION CHANGE', count: 1, newest: '2026-11-04 14:01:10.000' },
      { reason: 'USER REQUESTED KILL BACKGROUND', count: 1, newest: '2026-11-04 14:01:00.000' },
      { reason: 'SIGNALED status 9', count: 1, newest: '2026-11-04 14:00:50.000' },
      { reason: 'EXIT_SELF status 3', count: 1, newest: '2026-11-04 14:00:40.000' },
      {
        reason: 'PACKAGE UPDATED',
        count: 1,
        newest: '2026-11-04 14:00:30.000',
        memory: 'pss 62MB, rss 147MB',
      },
    ]);
  });

  it('takes no memory from a phone in another language that kept none', () => {
    const turkish = block(
      '14:00:40.000',
      'reason=1 (EXIT_SELF) subreason=0 (UNKNOWN) status=3',
      'pss=0,00 rss=0,00 description=null',
    );
    const [exit] = allExits(turkish);
    assert(exit);
    expect(exit.memory).toBeUndefined();
  });

  it('still calls only an end nobody asked for a death', () => {
    expect(parseExitInfo(INFO).map((e) => e.reason)).toEqual(['APP CRASH(EXCEPTION)', 'SIGNALED']);
  });
});

describe('an ANR', () => {
  const anr = (subject: string) => `========================================
2026-11-04 14:04:02 data_app_anr (compressed text, 22759 bytes)
Process: dev.appdyno.fixture
Foreground: Yes
Subject: ${subject}

"main" prio=5 tid=1 Sleeping
`;
  const INPUT = 'Input dispatching timed out (dev.appdyno.fixture/.Main is not responding)';

  it('gives what it was as a report, not every thread', () => {
    const [report] = crashReports('', anr(INPUT), { app: 'dev.appdyno.fixture', limit: 5 });
    expect(report?.detail).toBe(`Subject: ${INPUT}`);
  });
});
