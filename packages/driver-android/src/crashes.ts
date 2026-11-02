import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stateDir, type CrashesAnswer, type CrashesQuery, type CrashReport } from '@appdyno/core';
import { type Adb, shq } from './adb.js';

/** Reasons that are the app's end as nobody asked for it; the rest (a user's stop, a new install) are left out. */
const DEATHS = /CRASH|ANR|LOW.?MEMORY|SIGNALED|EXCESSIVE|INITIALIZATION|FREEZER/i;

const TAGS = ['data_app_crash', 'data_app_native_crash', 'data_app_anr'];

type Exit = { at: string; time: number; reason: string; detail?: string };

/**
 * The exits in `dumpsys activity exit-info <pkg>`, newest first as printed, deaths only. Shortcut: its
 * times are the device's local time read in the host's zone; a phone in another zone needs its offset.
 */
export function parseExitInfo(text: string): Exit[] {
  return text
    .split(/ApplicationExitInfo #\d+:/)
    .slice(1)
    .flatMap((block) => {
      const at = /timestamp=(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d+)?)/.exec(block)?.[1];
      const reason = /\breason=\d+ \((.*?)\) subreason=/.exec(block)?.[1];
      if (!at || !reason || !DEATHS.test(reason)) return [];
      const description = /description=(.*?)(?: state=| trace=|$)/m.exec(block)?.[1]?.trim();
      return [
        {
          at,
          time: new Date(at.replace(' ', 'T')).getTime(),
          reason,
          ...(description && description !== 'null' && { detail: description }),
        },
      ];
    });
}

type Drop = { at: string; time: number; tag: string; text: string };

/** The entries of `dumpsys dropbox --print <tags>` that are about `app`. */
export function parseDropbox(text: string, app: string): Drop[] {
  return text.split(/^={10,}\s*$/m).flatMap((block) => {
    const h = /^\s*(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) (\w+) \(/.exec(block);
    if (!h || !new RegExp(`^(Process|Package): ${app.replace(/\./g, '\\.')}\\b`, 'm').test(block))
      return [];
    return [
      {
        at: h[1]!,
        time: new Date(h[1]!.replace(' ', 'T')).getTime(),
        tag: h[2]!,
        text: block.trim(),
      },
    ];
  });
}

/** The first lines of a dropbox entry's stack: what is under its headers. */
const stackOf = (entry: string) =>
  entry
    .split(/\n\s*\n/)
    .slice(1)
    .join('\n')
    .split('\n')
    .slice(0, 6)
    .join('\n')
    .trim();

/** Exits with the stack of the dropbox entry written within seconds of each; dropbox-only entries too. */
export function crashReports(exitInfo: string, dropbox: string, q: CrashesQuery): CrashReport[] {
  const drops = parseDropbox(dropbox, q.app);
  const near = (t: number) => drops.find((d) => Math.abs(d.time - t) < 5_000);
  const fromExits = parseExitInfo(exitInfo).map((e) => {
    const stack = near(e.time);
    return {
      time: e.time,
      at: e.at,
      reason: e.reason,
      ...((stack ? stackOf(stack.text) : e.detail) && {
        detail: stack ? stackOf(stack.text) : e.detail!,
      }),
    };
  });
  const orphans = drops
    .filter((d) => !fromExits.some((e) => Math.abs(e.time - d.time) < 5_000))
    .map((d) => ({ time: d.time, at: d.at, reason: d.tag, detail: stackOf(d.text) }));
  return [...fromExits, ...orphans]
    .filter((r) => !q.since || r.time >= q.since)
    .sort((a, b) => b.time - a.time)
    .slice(0, q.limit)
    .map(({ time: _time, ...r }) => r);
}

export async function androidCrashes(
  adb: Adb,
  serial: string,
  q: CrashesQuery,
): Promise<CrashesAnswer> {
  const exitInfo = await adb.exec(serial, `dumpsys activity exit-info ${shq(q.app)}`);
  // one tag per command: given several, dumpsys dropbox looks for entries that are all of them
  const dropbox = await adb.exec(
    serial,
    TAGS.map((t) => `dumpsys dropbox --print ${t}`).join('; '),
  );
  const reports = crashReports(exitInfo, dropbox, q);
  if (reports.length === 0)
    return { reports, source: 'dumpsys activity exit-info, dumpsys dropbox' };
  const dir = join(stateDir(), 'crashes');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `${q.app}-${Date.now()}.txt`);
  const about = parseDropbox(dropbox, q.app)
    .map((d) => d.text)
    .join('\n\n');
  await writeFile(file, `${exitInfo}\n\n${about}\n`, { mode: 0o600 });
  return {
    reports: reports.map((r) => ({ ...r, file })),
    source: 'dumpsys activity exit-info, dumpsys dropbox',
  };
}
