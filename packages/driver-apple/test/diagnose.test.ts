import { mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest';
import { must, type CrashesQuery } from '@appdyno/core';
import {
  crashExits,
  endReports,
  parseIps,
  phoneCrashes,
  reportsIn,
  simulatorCrashes,
} from '../src/crashes.js';
import type { Devicectl } from '../src/devicectl.js';
import { entriesOf, logShowArgs, placeLines } from '../src/logs.js';

const UDID = '8BC57F11-901C-4DF6-A2B9-2A3B7DE1B79D';
const OTHER = '11111111-2222-3333-4444-555555555555';

/** A time `ms` ago as a report says one. */
const ago = (ms: number) =>
  new Date(Date.now() - ms).toISOString().replace('T', ' ').replace('Z', ' +0000');

/**
 * A report as a simulator's app leaves one: its path names the simulator, and so does its coalition. A system app's
 * path is in the runtime's volume, which names none; a report of neither names no simulator. `at`: when it was
 * written, `captured`: when the crash was, some seconds before.
 */
const ips = (
  bundle: string,
  device = UDID,
  path: 'app' | 'system' = 'app',
  { at = '2026-11-03 00:05:11.00 +0300', captured }: { at?: string; captured?: string } = {},
) =>
  [
    JSON.stringify({ bundleID: bundle, timestamp: at, bug_type: '309' }),
    JSON.stringify({
      ...(captured && { captureTime: captured }),
      procPath:
        path === 'app' && device
          ? `/Users/x/Library/Developer/CoreSimulator/Devices/${device}/data/Containers/Bundle/Application/A/App.app/App`
          : '/Volumes/VOLUME/*/Preferences.app/Preferences',
      ...(device ? { coalitionName: `com.apple.CoreSimulator.SimDevice.${device}` } : {}),
      exception: { type: 'EXC_BAD_ACCESS', signal: 'SIGSEGV' },
      termination: { indicator: 'Segmentation fault: 11' },
      faultingThread: 1,
      usedImages: [{ name: 'libsystem' }, { name: 'App' }],
      threads: [
        { frames: [{ imageIndex: 0, symbol: 'idle' }] },
        {
          frames: [
            { imageIndex: 1, symbol: 'crash()' },
            { imageIndex: 0, symbol: 'start' },
          ],
        },
      ],
    }),
  ].join('\n');

describe('crash reports', () => {
  it('copies from a phone what can say how an app ended, newest first, not what devicectl cannot take', () => {
    const file = (relativePath: string, lastModDate: string, bug_type?: string) => ({
      relativePath,
      metadata: { lastModDate, ...(bug_type && { extendedAttributes: { bug_type } }) },
    });
    const files = [
      file('19:24.spindump.txt', '2026-11-03T10:00:00Z'),
      file('Fixture-1.ips.ca.synced', '2026-11-03T10:00:00Z', '211'),
      file('Fixture-feedback.ips', '2026-11-03T10:00:00Z', '211'),
      file('Fixture-old.ips', '2026-11-01T10:00:00Z', '309'),
      file('Fixture-new.ips', '2026-11-03T10:00:00Z', '309'),
      file('Retired/Fixture.cpu_resource-1.ips', '2026-11-02T10:00:00Z', '385'),
      file('SpringBoard-1.ips', '2026-11-03T10:00:00Z', '309'),
      file('FixtureKit-1.ips', '2026-11-03T10:00:00Z', '309'),
      file('Retired/Other-Fixture-1.ips', '2026-11-03T10:00:00Z', '309'),
    ];
    const q = { app: 'a', limit: 5 };
    expect(endReports(files, q, 'Fixture').map((f) => f.relativePath)).toEqual([
      'Fixture-new.ips',
      'Retired/Fixture.cpu_resource-1.ips',
      'Fixture-old.ips',
    ]);
    const since = Date.parse('2026-11-02T12:00:00Z');
    expect(endReports(files, { ...q, since }, 'Fixture').map((f) => f.relativePath)).toEqual([
      'Fixture-new.ips',
    ]);
  });

  it('reads what a .ips says', () => {
    expect(parseIps(ips('dev.app'))).toMatchObject({
      bundle: 'dev.app',
      at: '2026-11-03 00:05:11.00 +0300',
      reason: 'EXC_BAD_ACCESS SIGSEGV Segmentation fault: 11',
      detail: 'App crash()\nlibsystem start',
    });
    expect(parseIps('not json')).toBeUndefined();
  });

  it("reads an uncaught exception's reason and where it was thrown, not the abort that ended it", () => {
    const [head = '', body = ''] = ips('dev.app').split('\n');
    const frame = (imageIndex: number, symbol: string) => ({ imageIndex, symbol });
    const thrown = {
      ...(JSON.parse(body) as object),
      exception: { type: 'EXC_CRASH', signal: 'SIGABRT' },
      termination: { indicator: 'Abort trap: 6' },
      faultingThread: 0,
      usedImages: [{ name: 'libsystem_c.dylib' }, { name: 'CoreFoundation' }, { name: 'WMF' }],
      threads: [{ frames: [frame(0, '__pthread_kill'), frame(0, 'abort')] }],
      lastExceptionBacktrace: [
        frame(1, '__exceptionPreprocess'),
        frame(1, 'objc_exception_throw'),
        frame(2, '-[MWKDataStore setupLegacyDataStore]'),
        frame(2, '-[MWKDataStore init]'),
      ],
    };
    const reason =
      "*** Terminating app due to uncaught exception 'NSInvalidArgumentException', reason: '*** -[NSURL initFileURLWithPath:isDirectory:]: nil string parameter'";
    // a phone's report says the reason; a simulator's has only where it was thrown
    const asi = { 'libsystem_c.dylib': ['abort() called'], CoreFoundation: [reason] };
    expect(parseIps(`${head}\n${JSON.stringify({ ...thrown, asi })}`)).toMatchObject({
      reason: `EXC_CRASH SIGABRT Abort trap: 6, ${reason}`,
      detail: 'WMF -[MWKDataStore setupLegacyDataStore]\nWMF -[MWKDataStore init]',
    });
    expect(parseIps(`${head}\n${JSON.stringify(thrown)}`)).toMatchObject({
      reason: 'EXC_CRASH SIGABRT Abort trap: 6',
      detail: 'WMF -[MWKDataStore setupLegacyDataStore]\nWMF -[MWKDataStore init]',
    });
  });

  const named = (a: { reports: { file?: string }[] }) =>
    a.reports.map((r) => r.file?.split('/').pop());

  /** A report of `bundle` written `ageMs` ago, its file as old. */
  const put = (dir: string, name: string, bundle: string, ageMs: number, device = UDID) => {
    const f = join(dir, name);
    writeFileSync(f, ips(bundle, device, 'app', { at: ago(ageMs) }));
    const t = (Date.now() - ageMs) / 1000;
    utimesSync(f, t, t);
  };

  it('keeps to the app, the simulator, the time and the limit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'appdyno-ips-'));
    put(dir, 'new.ips', 'dev.app', 1_000);
    put(dir, 'old.ips', 'dev.app', 60_000);
    put(dir, 'other-app.ips', 'dev.other', 1_000);
    put(dir, 'dev.application.ips', 'dev.application', 1_000);
    put(dir, 'other-sim.ips', 'dev.app', 1_000, OTHER);
    writeFileSync(join(dir, 'note.txt'), 'not a report');
    const q = { app: 'dev.app', limit: 5 };
    expect(named(await simulatorCrashes(UDID, q, dir))).toEqual(['new.ips', 'old.ips']);
    const since = await simulatorCrashes(UDID, { ...q, since: Date.now() - 10_000 }, dir);
    expect(named(since)).toEqual(['new.ips']);
    expect(await reportsIn(dir, { ...q, limit: 1 })).toHaveLength(1);
    expect((await simulatorCrashes(UDID, q, join(dir, 'none'))).reports).toEqual([]);
  });

  it("goes by a report's own time, not its file's, which macOS moves on at each crash once it keeps no more", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'appdyno-ips-'));
    // three hours old, its file touched by the crash a moment ago, which left no report of its own
    writeFileSync(
      join(dir, 'Shop-105440.ips'),
      ips('dev.app', UDID, 'app', { at: ago(3 * 3_600_000) }),
    );
    put(dir, 'Shop-141215.ips', 'dev.app', 60_000);
    const q = { app: 'dev.app', limit: 1 };
    expect(named(await simulatorCrashes(UDID, q, dir))).toEqual(['Shop-141215.ips']);
    expect(
      (await simulatorCrashes(UDID, { ...q, since: Date.now() - 5_000 }, dir)).reports,
    ).toEqual([]);
    // a crash from before the time asked whose report was written after it is none of it
    writeFileSync(
      join(dir, 'Shop-141300.ips'),
      ips('dev.app', UDID, 'app', { at: ago(1_000), captured: ago(30_000) }),
    );
    expect(
      (await simulatorCrashes(UDID, { ...q, since: Date.now() - 20_000 }, dir)).reports,
    ).toEqual([]);
    expect(named(await simulatorCrashes(UDID, { ...q, since: Date.now() - 50_000 }, dir))).toEqual([
      'Shop-141300.ips',
    ]);
  });

  it("gives the app's own report alone where asked, not its extension's of the same moment", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'appdyno-ips-'));
    put(dir, 'Shop.ips', 'dev.app', 2_000);
    put(dir, 'WidgetsExtension.ips', 'dev.app.Widgets', 1_000);
    const q = { app: 'dev.app', limit: 1 };
    expect(named(await simulatorCrashes(UDID, q, dir))).toEqual(['WidgetsExtension.ips']);
    expect(named(await simulatorCrashes(UDID, { ...q, own: true }, dir))).toEqual(['Shop.ips']);
    // an extension asked for by its own id is its own
    const widgets = { app: 'dev.app.Widgets', limit: 1, own: true };
    expect(named(await simulatorCrashes(UDID, widgets, dir))).toEqual(['WidgetsExtension.ips']);
  });

  it("keeps the crashes of the app's own extensions, and names which", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'appdyno-ips-'));
    writeFileSync(join(dir, 'Widgets.ips'), ips('dev.app.SpringboardWidgets'));
    const [report] = (await simulatorCrashes(UDID, { app: 'dev.app', limit: 5 }, dir)).reports;
    expect(report?.reason).toBe(
      'EXC_BAD_ACCESS SIGSEGV Segmentation fault: 11, in its extension dev.app.SpringboardWidgets',
    );
  });

  it('says when macOS keeps no more reports of the process, and how to have the next kept', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'appdyno-ips-'));
    for (let i = 0; i < 24; i++)
      writeFileSync(join(dir, `Fixture-2026-11-09-${String(i)}.ips`), '');
    writeFileSync(join(dir, 'Other-2026-11-09-1.ips'), '');
    const q = { app: 'dev.app', limit: 5 };
    expect((await simulatorCrashes(UDID, q, dir, 'Fixture')).note).toBeUndefined();
    writeFileSync(join(dir, 'Fixture-2026-11-09-24.ips'), '');
    const full = await simulatorCrashes(UDID, q, dir, 'Fixture');
    expect(full.note).toBe(
      'this Mac holds 25 crash reports of Fixture, and macOS saves none past 25: a crash now leaves no report. Move Fixture-*.ips out of ~/Library/Logs/DiagnosticReports, and the next one is kept',
    );
    // alone, for what waits for a report that will not come
    expect(full.unkept).toBe(full.note);
    expect((await simulatorCrashes(UDID, q, dir)).note).toBeUndefined();
  });

  it("takes a simulator's report only where it names that simulator, a system app's by its coalition, and says what it left out", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'appdyno-ips-'));
    writeFileSync(join(dir, 'mine.ips'), ips('com.apple.Preferences', UDID, 'system'));
    writeFileSync(join(dir, 'theirs.ips'), ips('com.apple.Preferences', OTHER, 'system'));
    writeFileSync(join(dir, 'anyones.ips'), ips('com.apple.Preferences', ''));
    const a = await simulatorCrashes(UDID, { app: 'com.apple.Preferences', limit: 5 }, dir);
    expect(a.reports.map((r) => r.file?.split('/').pop())).toEqual(['mine.ips']);
    expect(a.note).toBe(
      "left out 1 of another simulator, and 1 that name no simulator, so none could be told to be this one's",
    );
    expect((await simulatorCrashes(UDID, { app: 'dev.none', limit: 5 }, dir)).note).toBeUndefined();
  });
});

describe("an iPhone's crash reports", () => {
  const PHONE = '00008110-000000000000001E';
  const APPS: Record<string, string> = {
    'dev.app': 'file:///private/var/containers/Bundle/Application/A/Fixture.app/',
    'dev.two': 'file:///private/var/containers/Bundle/Application/B/Two%20Go.app/',
  };
  /** The phone's crash folder: every process's reports, by the bundle each is of. */
  const ON_PHONE: Record<string, string> = {
    'Fixture-2026-11-17-100000.ips': 'dev.app',
    'Retired/Fixture.cpu_resource-2026-11-16-100000.ips': 'dev.app',
    // another app's process of the same name
    'Fixture-2026-11-17-110000.ips': 'dev.other',
    'SpringBoard-2026-11-17-100000.ips': 'com.apple.springboard',
    'FixtureKit-2026-11-17-100000.ips': 'dev.kit',
    'Retired/MobileNotes-2026-11-16-100000.ips': 'com.apple.mobilenotes',
    'Two Go-2026-11-17-100000.ips': 'dev.two',
  };
  let crashDir: string;
  const files = (dir: string) => (readdirSync(dir, { recursive: true }) as string[]).sort();
  /** `cut`: a report whose copy is written, then fails, as a read cut short. */
  const phone = (cut?: string) => {
    const pulled: string[] = [];
    const ctl = {
      udid: PHONE,
      app: (b: string) => Promise.resolve(APPS[b] && { bundleIdentifier: b, url: APPS[b] }),
      json: (args: string[]) => {
        if (args[1] === 'info') {
          const listed = Object.keys(ON_PHONE).map((relativePath) => ({
            relativePath,
            metadata: {
              lastModDate: new Date().toISOString(),
              extendedAttributes: { bug_type: '309' },
            },
          }));
          return Promise.resolve({ result: { files: listed } });
        }
        const of = (flag: string) => must(args[args.indexOf(flag) + 1], flag);
        pulled.push(of('--source'));
        writeFileSync(of('--destination'), ips(must(ON_PHONE[of('--source')], 'a report'), ''));
        return of('--source') === cut ? Promise.reject(new Error('cut')) : Promise.resolve({});
      },
    } as unknown as Devicectl;
    return { ctl, pulled };
  };

  beforeEach(() => {
    const state = mkdtempSync(join(tmpdir(), 'appdyno-phone-crashes-'));
    vi.stubEnv('APPDYNO_STATE_DIR', state);
    crashDir = join(state, 'crashes', PHONE);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("copies only the app's own, and writes no other process's", async () => {
    const { ctl, pulled } = phone();
    const a = await phoneCrashes(ctl, { app: 'dev.app', limit: 5 });
    expect(pulled.sort()).toEqual([
      'Fixture-2026-11-17-100000.ips',
      'Fixture-2026-11-17-110000.ips',
      'Retired/Fixture.cpu_resource-2026-11-16-100000.ips',
    ]);
    expect(files(crashDir)).toEqual([
      '.swept',
      'Fixture-2026-11-17-100000.ips',
      'Retired',
      'Retired/Fixture.cpu_resource-2026-11-16-100000.ips',
    ]);
    expect(a.reports).toHaveLength(2);
    expect(a.note).toBeUndefined();
    // what is held is not asked for again
    const again = phone();
    await phoneCrashes(again.ctl, { app: 'dev.app', limit: 5 });
    expect(again.pulled).toEqual(['Fixture-2026-11-17-110000.ips']);
  });

  it('deletes, once, what a version before left of other processes, and keeps what was asked since', async () => {
    mkdirSync(join(crashDir, 'Retired'), { recursive: true });
    writeFileSync(join(crashDir, 'SpringBoard-old.ips'), ips('com.apple.springboard', ''));
    writeFileSync(join(crashDir, 'Retired/MobileNotes-old.ips'), ips('com.apple.mobilenotes', ''));
    writeFileSync(join(crashDir, 'Fixture-old.ips'), ips('dev.app', ''));
    writeFileSync(join(crashDir, 'note.ips'), 'not a report');
    await phoneCrashes(phone().ctl, { app: 'dev.app', limit: 5 });
    expect(files(crashDir)).not.toContain('SpringBoard-old.ips');
    expect(files(crashDir)).not.toContain('Retired/MobileNotes-old.ips');
    expect(files(crashDir)).not.toContain('note.ips');
    expect(files(crashDir)).toContain('Fixture-old.ips');
    const two = phone();
    const b = await phoneCrashes(two.ctl, { app: 'dev.two', limit: 5 });
    expect(two.pulled).toEqual(['Two Go-2026-11-17-100000.ips']);
    expect(b.reports).toHaveLength(1);
    // the first app's stay
    expect(files(crashDir)).toContain('Fixture-old.ips');
    expect(files(crashDir)).toContain('Fixture-2026-11-17-100000.ips');
  });

  it('leaves no copy of a read cut short', async () => {
    const { ctl } = phone('Fixture-2026-11-17-110000.ips');
    await expect(phoneCrashes(ctl, { app: 'dev.app', limit: 5 })).rejects.toThrow('cut');
    expect(files(crashDir).filter((n) => n.includes('110000') || n.startsWith('.part-'))).toEqual(
      [],
    );
  });

  it('copies nothing of an app the phone does not have, and says why', async () => {
    const { ctl, pulled } = phone();
    const a = await phoneCrashes(ctl, { app: 'dev.gone', limit: 5 });
    expect(pulled).toEqual([]);
    expect(a.reports).toEqual([]);
    expect(a.note).toBe(
      'dev.gone is not on this phone, and its reports are named after its process: none was copied',
    );
    expect(files(crashDir)).toEqual(['.swept']);
  });
});

describe('how an app ended, as a reading', () => {
  const report = (at: string) => ({ at, reason: 'EXC_CRASH' });
  const of = (...at: string[]) => {
    const asked: CrashesQuery[] = [];
    return {
      asked,
      crashes: (q: CrashesQuery) => {
        asked.push(q);
        return Promise.resolve({ reports: at.map(report), source: 'a folder' });
      },
    };
  };
  const since = Date.parse('2026-11-05T10:00:00+03:00');

  it('counts what is newer than the run by the time in each report, in that report’s zone', async () => {
    const { crashes } = of('2026-11-05 10:30:00.00 +0300', '2026-11-05 09:30:00.00 +0300');
    const { value } = await crashExits(crashes, 'dev.app', since);
    expect(value.run).toEqual({ crashes: 1, total: 1 });
    expect(value.held).toEqual({ crashes: 2, total: 2 });
  });

  it('holds a week of reports as a stock, and none of it as this run’s', async () => {
    const { crashes } = of('2026-10-29 09:30:00.00 +0300');
    const { value } = await crashExits(crashes, 'dev.app', since);
    expect(value.run).toEqual({ crashes: 0, total: 0 });
    expect(value.held.crashes).toBe(1);
  });

  it('has no reading of a run asked for with no time, or with a report of no time', async () => {
    expect((await crashExits(of('').crashes, 'dev.app')).value.run).toBeUndefined();
    const undated = of('2026-11-05 10:30:00.00 +0300', '');
    expect((await crashExits(undated.crashes, 'dev.app', since)).value.run).toBeUndefined();
  });

  it('says a full list is at least that many', async () => {
    const full = of(...Array.from({ length: 100 }, () => '2026-11-05 09:30:00.00 +0300'));
    expect((await crashExits(full.crashes, 'dev.app', since)).value.held.atLeast).toBe(true);
    const some = of('2026-11-05 09:30:00.00 +0300');
    expect((await crashExits(some.crashes, 'dev.app', since)).value.held.atLeast).toBeUndefined();
  });

  it('asks a query of no age: what it holds counts every report', async () => {
    const { crashes, asked } = of();
    await crashExits(crashes, 'dev.app', since);
    const [query] = asked;
    assert(query);
    expect(query.since).toBeUndefined();
  });
});

describe('simulator log', () => {
  const app = '/Library/Developer/Runtimes/Applications/Preferences.app';

  it('asks for the app by its path, at the level and from the time', () => {
    const args = logShowArgs(UDID, app, {
      app: 'com.apple.Preferences',
      since: new Date(2026, 10, 3, 1, 2, 3).getTime(),
      level: 'debug',
      maxLines: 10,
    });
    expect(args).toEqual(
      expect.arrayContaining(['spawn', UDID, 'log', 'show', '--info', '--debug']),
    );
    expect(args[args.indexOf('--start') + 1]).toBe('2026-11-03 01:02:03');
    expect(args.at(-1)).toBe(
      'processImagePath CONTAINS "/Preferences.app/" AND subsystem != "com.apple.dt.xctest"',
    );
  });

  it("reads the app's own lines and Apple's errors below debug, and never XCTest's", () => {
    const at = (level: 'info' | 'error' | 'debug') =>
      must(logShowArgs(UDID, app, { app: 'a.b', level, maxLines: 10 }).at(-1), 'a predicate');
    for (const level of ['info', 'error'] as const) {
      expect(at(level)).toContain('subsystem != "com.apple.dt.xctest"');
      expect(at(level)).toContain('NOT subsystem BEGINSWITH "com.apple." OR messageType == error');
      expect(at(level)).toContain('category == "UIKBRenderingLog"');
    }
    expect(at('debug')).not.toContain('BEGINSWITH');
  });

  it('error means error and fault', () => {
    const args = logShowArgs(UDID, app, { app: 'a.b', level: 'error', maxLines: 10 });
    expect(args).toContain('--last');
    expect(args.at(-1)).toContain('messageType == fault');
  });

  it('gives a message of several lines as one, and none cut from its start', () => {
    expect(
      entriesOf([
        '    "XC_kAXXCAttributeWindowContextId" = 1;',
        '2026-11-05 04:46:59.959 F  App[1:2] it went wrong',
        '    timeEntry = 1;',
        '2026-11-05 04:46:59.960 Df App[1:2] next',
      ]),
    ).toEqual([
      '2026-11-05 04:46:59.959 F  App[1:2] it went wrong\n    timeEntry = 1;',
      '2026-11-05 04:46:59.960 Df App[1:2] next',
    ]);
  });

  describe('lines on the clock', () => {
    const AT = new Date(2026, 10, 5, 4, 46, 59, 959).getTime();

    it("reads this Mac's local time, and the rank of a line", () => {
      const [first, second] = placeLines([
        '2026-11-05 04:46:59.959 Df SpringBoard[23436:143f1ae] [com.apple] a message',
        '2026-11-05 04:46:59.960 E  SpringBoard[23436:143f1ae] [com.apple] it failed',
      ]);
      expect(first?.mark).toEqual({ at: AT });
      expect(second?.mark).toEqual({ at: AT + 1, level: 'error' });
      expect(second?.line).toBe('E  SpringBoard[23436:143f1ae] [com.apple] it failed');
    });

    it('keeps the later lines of one message where the message is', () => {
      const placed = placeLines([
        '2026-11-05 04:46:59.959 F  App[1:2] it went wrong',
        ' now: 4986292486976 seconds: 1793843219.967673',
        '    timeEntry = <STStatusBarDataStringEntry: 0x113c12060>;',
      ]);
      expect(placed.map((p) => p.mark)).toEqual([
        { at: AT, level: 'error' },
        { at: AT, level: 'error' },
        { at: AT, level: 'error' },
      ]);
    });

    it('leaves out a line with nothing before it to go on from', () => {
      expect(placeLines(['    a line cut from its message'])).toEqual([]);
    });
  });
});
