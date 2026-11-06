import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { battery, noteLocks, type SeenLock } from '../src/perf/battery.js';
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

describe('a wake lock read again and again', () => {
  const lock = (acquiredMsAgo: number, tag = 'fixture:held') => ({ tag, acquiredMsAgo });

  it('is one lock, whatever the reads’ lateness puts its time at', () => {
    const held: SeenLock[] = [];
    // acquired at 1,499 and 1,501: a reckoning of itself by 3 s buckets falls either side of an edge
    expect(noteLocks(held, [lock(8_501)], 10_000)).toBe(true);
    expect(noteLocks(held, [lock(9_499)], 11_000)).toBe(false);
    expect(held).toEqual([
      expect.objectContaining({ tag: 'fixture:held', acquired: 1_499, lastSeen: 11_000 }),
    ]);
  });

  it('is two where one read lists two of a tag, however close', () => {
    const held: SeenLock[] = [];
    noteLocks(held, [lock(100), lock(200)], 10_000);
    noteLocks(held, [lock(1_100), lock(1_200)], 11_000);
    expect(held.map((h) => [h.acquired, h.lastSeen])).toEqual([
      [9_900, 11_000],
      [9_800, 11_000],
    ]);
  });

  it('is another when it came later than a lock’s lateness can explain, or by another tag', () => {
    const held: SeenLock[] = [];
    noteLocks(held, [lock(0)], 10_000);
    expect(noteLocks(held, [lock(0)], 14_000)).toBe(true);
    expect(noteLocks(held, [lock(4_000, 'fixture:other')], 14_000)).toBe(true);
    expect(held).toHaveLength(3);
  });
});

describe('a window of battery signals', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** A device that shows these locks at each read, the last again; two reads of its alarms, before and after. */
  const device = (locks: string[][], alarms = ['', ALARMS]) => {
    let read = 0;
    let alarmsRead = 0;
    const shell = async (cmd: string) => {
      if (cmd.includes('pm list packages')) return `package:dev.appdyno.fixture uid:${UID}\n`;
      if (cmd.includes('dumpsys power')) {
        const held = locks[Math.min(read++, locks.length - 1)]!;
        return `Wake Locks: size=${held.length}\n${held.join('\n')}\n`;
      }
      if (cmd.includes('dumpsys alarm')) return alarms[Math.min(alarmsRead++, 1)]!;
      return JOBS;
    };
    return { shell } as never;
  };
  const held = (ago: string, tag = 'fixture:held', owner = `uid=${UID} pid=1`) =>
    `  PARTIAL_WAKE_LOCK  '${tag}' ACQ=-${ago} (${owner})`;
  const over = async (d: never, windowMs = 3_000) => {
    const reading = battery(d, 'dev.appdyno.fixture', windowMs);
    await vi.advanceTimersByTimeAsync(windowMs + 2_000);
    return (await reading).value;
  };

  it('counts a lock read at each pass once, however its time wavers, and no more than the window', async () => {
    const v = await over(
      device([[held('1s499ms')], [held('2s501ms')], [held('3s499ms')], [held('4s501ms')]]),
    );
    expect(v.wakeLocks).toHaveLength(1);
    expect(v.wakeLocks[0]).toMatchObject({ tag: 'fixture:held', count: 1 });
    expect(v.wakeLockMs).toBeLessThanOrEqual(v.windowMs);
    expect(v.wakeLockPercent).toBeLessThanOrEqual(100);
    expect(v.longestLockMs).toBeGreaterThan(v.wakeLockMs);
  });

  it('adds up two locks of a tag, one after the other', async () => {
    const v = await over(device([[held('0ms')], [held('1s')], [], [held('0ms')]]), 4_000);
    expect(v.wakeLocks).toHaveLength(1);
    expect(v.wakeLocks[0]?.count).toBe(2);
  });

  it('lists what the system holds for the app, and leaves it out of what Play counts', async () => {
    const v = await over(device([[held('1s', 'AudioMix', 'uid=1041 pid=5 ws=WorkSource{10469}')]]));
    expect(v.wakeLocks[0]).toMatchObject({ tag: 'AudioMix', exempt: 'audio' });
    expect(v.wakeLockMs).toBe(0);
    expect(v.wakeLockPercent).toBe(0);
    expect(v.longestLockMs).toBe(0);
  });

  it('counts the alarms of the window alone, and goes by the time it really read', async () => {
    const v = await over(device([[]]));
    expect(v.windowMs).toBe(3_000);
    expect(v.wakeups).toBe(6);
    expect(v.wakeupsPerHour).toBe(7_200);
    expect(v.alarms).toBe(9);
    expect(v.alarmTags).toEqual([
      { tag: '*walarm*:fixture.alarm', alarms: 6, wakeups: 6 },
      { tag: '*alarm*:fixture.quiet', alarms: 3, wakeups: 0 },
    ]);
    expect(v.wakeLocks).toEqual([]);
  });
});

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
