import { sleep, type BatterySignals, type Measured } from '@appdyno/core';
import { assertPkg } from '../adb.js';
import { parseAlarmStats, parseJobStarts, parseWakeLocks, type HeldLock } from './parse-battery.js';
import { at, sh, uidOf, type PerfDevice } from './shared.js';

/** Often enough that a lock of a few seconds is seen; a shorter one between two reads is not, and the answer says so. */
const LOCK_READ_MS = 1_000;
/** A lock read twice is the same lock if it was acquired within this of itself: its age is read to the millisecond, late. */
const SAME_LOCK_MS = 3_000;

export type SeenLock = HeldLock & { acquired: number; lastSeen: number };

/**
 * What one read saw, added to `held`, and whether any of it is new. Two locks of a tag in one read are two locks, however
 * close: a read lists each lock once.
 */
export function noteLocks(held: SeenLock[], read: HeldLock[], now: number) {
  const matched = new Set<SeenLock>();
  let fresh = false;
  for (const lock of read) {
    const acquired = now - lock.acquiredMsAgo;
    const same = held.find(
      (h) =>
        h.tag === lock.tag && !matched.has(h) && Math.abs(h.acquired - acquired) < SAME_LOCK_MS,
    );
    if (same) {
      Object.assign(same, lock, { acquired: same.acquired, lastSeen: now });
      matched.add(same);
    } else {
      const seen = { ...lock, acquired, lastSeen: now };
      held.push(seen);
      matched.add(seen);
      fresh = true;
    }
  }
  return fresh;
}

const LOCKS = "dumpsys power | sed -n '/^Wake Locks:/,/^$/p'";
const JOBS = "| sed -n '/^ *Job history:/,/^$/p'";

const asPerHour = (count: number, windowMs: number) =>
  windowMs ? Math.round((count / windowMs) * 3_600_000) : 0;

/**
 * Wake locks, wakeups and jobs over a window, from the platform's own counts, with no power model. Nothing is reset and
 * `dumpsys battery unplug` is never run: batterystats counts these on battery only, and a phone on a cable never is, so
 * locks are read as they are held, and alarms and jobs from counts that go on whatever the power source.
 */
export async function battery(
  d: PerfDevice,
  pkg: string,
  windowMs: number,
): Promise<Measured<BatterySignals>> {
  assertPkg(pkg);
  const uid = await uidOf(d, pkg);
  const alarms = () => sh(d, `dumpsys alarm | grep -A200 -E '^ *[^ ]*:${pkg} \\+'`, 60_000);
  const alarmsBefore = await alarms();
  const t0 = Date.now();
  const held: SeenLock[] = [];
  const raw: string[] = [];
  while (Date.now() - t0 < windowMs) {
    const text = await sh(d, LOCKS);
    if (noteLocks(held, parseWakeLocks(text, uid), Date.now())) raw.push(text);
    await sleep(Math.min(LOCK_READ_MS, Math.max(0, windowMs - (Date.now() - t0))));
  }
  const windowRead = Date.now() - t0;
  const [alarmsAfter, jobs] = [await alarms(), await sh(d, `dumpsys jobscheduler ${pkg} ${JOBS}`)];

  const byTag = new Map<string, BatterySignals['wakeLocks'][number]>();
  for (const lock of held) {
    // this window's time; how long it has been held at all is what a stuck lock is judged by
    const ms = lock.lastSeen - Math.max(lock.acquired, t0);
    const row = byTag.get(lock.tag);
    byTag.set(lock.tag, {
      tag: lock.tag,
      ms: (row?.ms ?? 0) + ms,
      longestMs: Math.max(row?.longestMs ?? 0, lock.lastSeen - lock.acquired),
      count: (row?.count ?? 0) + 1,
      ...(lock.exempt && { exempt: lock.exempt }),
    });
  }
  const wakeLocks = [...byTag.values()].sort((a, b) => b.ms - a.ms);
  const counted = wakeLocks.filter((l) => !l.exempt);
  const wakeLockMs = counted.reduce((a, l) => a + l.ms, 0);
  const [before, after] = [parseAlarmStats(alarmsBefore, pkg), parseAlarmStats(alarmsAfter, pkg)];
  const wakeups = after.wakeups - before.wakeups;
  return {
    value: {
      windowMs: windowRead,
      wakeLocks,
      wakeLockMs,
      wakeLockPercent: windowRead ? Math.round((wakeLockMs / windowRead) * 1_000) / 10 : 0,
      longestLockMs: Math.max(0, ...counted.map((l) => l.longestMs)),
      wakeups,
      wakeupsPerHour: asPerHour(wakeups, windowRead),
      alarms: after.alarms - before.alarms,
      alarmTags: Object.entries(after.tags).flatMap(([tag, t]) => {
        const grew = {
          tag,
          alarms: t.alarms - (before.tags[tag]?.alarms ?? 0),
          wakeups: t.wakeups - (before.tags[tag]?.wakeups ?? 0),
        };
        return grew.alarms > 0 ? [grew] : [];
      }),
      jobs: parseJobStarts(jobs, pkg, windowRead),
      note: 'read as they happen, with no power model and nothing reset: a lock held for under a second may not be seen',
    },
    raw: [...raw, alarmsBefore, alarmsAfter, jobs].join('\n---\n'),
    at: at(),
  };
}
