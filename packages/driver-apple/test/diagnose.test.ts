import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseIps, reportsIn, simulatorCrashes } from '../src/crashes.js';
import { logShowArgs } from '../src/logs.js';

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
    expect(a.reports.map((r) => r.file!.split('/').pop())).toEqual(['new.ips', 'old.ips']);
    const since = await simulatorCrashes(UDID, { ...q, since: Date.now() - 10_000 }, dir);
    expect(since.reports).toHaveLength(1);
    expect(await reportsIn(dir, { ...q, limit: 1 })).toHaveLength(1);
    expect((await simulatorCrashes(UDID, q, join(dir, 'none'))).reports).toEqual([]);
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
});
