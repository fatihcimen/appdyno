import { describe, expect, it } from 'vitest';
import {
  parseAlarmStats,
  parseDuration,
  parseJobStarts,
  parseWakeLocks,
} from '../src/perf/parse-battery.js';

const UID = 10469;

/** As a Xiaomi with Android 16 wrote them, and as AOSP writes what is held on the app's behalf. */
const LOCKS = `Wake Locks: size=4
  PARTIAL_WAKE_LOCK                 'fixture:held' ACQ=-1s682ms (uid=10469 pid=30953 pkg=dev.appdyno.fixture)
  PARTIAL_WAKE_LOCK                 'AudioMix' ACQ=-2m3s (uid=1041 pid=500 ws=WorkSource{10469})
  PARTIAL_WAKE_LOCK                 'other:lock' ACQ=-5s (uid=10123 pid=700)
  FULL_WAKE_LOCK                    'fixture:screen' ACQ=-5s (uid=10469 pid=30953)
`;

const ALARMS = `  u0a469:dev.appdyno.fixture +25ms running, 6 wakeups:
    +25ms 6 wakes 6 alarms, last -7s308ms:
      *walarm*:fixture.alarm
    +1s2ms 0 wakes 3 alarms, last -1m:
      *alarm*:fixture.quiet
  1000:com.android.systemui +2s969ms running, 10 wakeups:
    +1s 10 wakes 10 alarms, last -5s:
      *walarm*:other
`;

const JOBS = `  Job history:
             -879ms   START: #u0a469/1 dev.appdyno.fixture/.FixtureJob
             -862ms    STOP: #u0a469/1 dev.appdyno.fixture/.FixtureJob onStartJob returned false
           -1m2s3ms   START: #u0a469/1 dev.appdyno.fixture/.FixtureJob
             -500ms   START: #u0a123/9 com.other/.Job
`;

describe('a battery read from the platform’s own counts', () => {
  it('reads the platform’s way of writing a time', () => {
    expect(parseDuration('-1s682ms')).toBe(1_682);
    expect(parseDuration('+25ms')).toBe(25);
    expect(parseDuration('-1h2m3s4ms')).toBe(3_723_004);
    expect(parseDuration('-2d1h')).toBe(176_400_000);
  });

  it('lists the partial wake locks of this app, and what the system holds for it', () => {
    expect(parseWakeLocks(LOCKS, UID)).toEqual([
      { tag: 'fixture:held', acquiredMsAgo: 1_682 },
      { tag: 'AudioMix', acquiredMsAgo: 123_000, exempt: 'audio' },
    ]);
  });

  it('has none when none is held', () => {
    expect(parseWakeLocks('Wake Locks: size=0\n', UID)).toEqual([]);
  });

  it('adds up a package’s alarms and stops at the next package', () => {
    expect(parseAlarmStats(ALARMS, 'dev.appdyno.fixture')).toEqual({
      wakeups: 6,
      alarms: 9,
      tags: {
        '*walarm*:fixture.alarm': { wakeups: 6, alarms: 6 },
        '*alarm*:fixture.quiet': { wakeups: 0, alarms: 3 },
      },
    });
    expect(parseAlarmStats('', 'dev.appdyno.fixture').wakeups).toBe(0);
  });

  it('counts a package’s jobs that began in the window', () => {
    expect(parseJobStarts(JOBS, 'dev.appdyno.fixture', 10_000)).toBe(1);
    expect(parseJobStarts(JOBS, 'dev.appdyno.fixture', 120_000)).toBe(2);
    expect(parseJobStarts('', 'dev.appdyno.fixture', 120_000)).toBe(0);
  });
});
