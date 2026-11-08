import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert, describe, expect, it } from 'vitest';
import type { CrashesQuery } from '@appdyno/core';
import { crashExits, endReports, parseIps, reportsIn, simulatorCrashes } from '../src/crashes.js';
import { logShowArgs, placeLines } from '../src/logs.js';

const UDID = '8BC57F11-901C-4DF6-A2B9-2A3B7DE1B79D';
const OTHER = '11111111-2222-3333-4444-555555555555';

const ips = (bundle: string, device = UDID) =>
  [
    JSON.stringify({
      bundleID: bundle,
      timestamp: '2026-11-03 00:05:11.00 +0300',
      bug_type: '309',
    }),
    JSON.stringify({
      procPath: `/Users/x/Library/Developer/CoreSimulator/Devices/${device}/data/Containers/Bundle/Application/A/App.app/App`,
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
      file('Analytics-1.ips.ca.synced', '2026-11-03T10:00:00Z', '211'),
      file('SiriSearchFeedback-1.ips', '2026-11-03T10:00:00Z', '211'),
      file('Fixture-old.ips', '2026-11-01T10:00:00Z', '309'),
      file('Fixture-new.ips', '2026-11-03T10:00:00Z', '309'),
      file('Retired/App-cpu.ips', '2026-11-02T10:00:00Z', '385'),
    ];
    expect(endReports(files, { app: 'a', limit: 5 }).map((f) => f.relativePath)).toEqual([
      'Fixture-new.ips',
      'Retired/App-cpu.ips',
      'Fixture-old.ips',
    ]);
    expect(
      endReports(files, { app: 'a', limit: 5, since: Date.parse('2026-11-02T12:00:00Z') }).map(
        (f) => f.relativePath,
      ),
    ).toEqual(['Fixture-new.ips']);
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

  it('keeps to the app, the simulator, the time and the limit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'appdyno-ips-'));
    const put = (name: string, text: string, ageMs: number) => {
      const f = join(dir, name);
      writeFileSync(f, text);
      const t = (Date.now() - ageMs) / 1000;
      utimesSync(f, t, t);
    };
    put('new.ips', ips('dev.app'), 1_000);
    put('old.ips', ips('dev.app'), 60_000);
    put('other-app.ips', ips('dev.other'), 1_000);
    put('other-sim.ips', ips('dev.app', OTHER), 1_000);
    put('note.txt', 'not a report', 1_000);
    const q = { app: 'dev.app', limit: 5 };
    const a = await simulatorCrashes(UDID, q, dir);
    expect(a.reports.map((r) => r.file?.split('/').pop())).toEqual(['new.ips', 'old.ips']);
    const since = await simulatorCrashes(UDID, { ...q, since: Date.now() - 10_000 }, dir);
    expect(since.reports).toHaveLength(1);
    expect(await reportsIn(dir, { ...q, limit: 1 })).toHaveLength(1);
    expect((await simulatorCrashes(UDID, q, join(dir, 'none'))).reports).toEqual([]);
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

  it('asks a query of no age: its `since` goes by a file’s time, here a copy’s', async () => {
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
    expect(args.at(-1)).toBe('processImagePath CONTAINS "/Preferences.app/"');
  });

  it('error means error and fault', () => {
    const args = logShowArgs(UDID, app, { app: 'a.b', level: 'error', maxLines: 10 });
    expect(args).toContain('--last');
    expect(args.at(-1)).toContain('messageType == fault');
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
