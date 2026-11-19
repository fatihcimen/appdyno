import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SimulatorMirror } from '../packages/driver-apple/src/mirror-sim.js';
import { macSyncsPasteboard } from '../packages/driver-apple/src/sim-clipboard.js';
import { simulatorProvider } from './workspace.js';
import { opsOn } from './helpers.js';

/**
 * Our own simulator's clipboard (APPDYNO_IOS_UDID, never a default) while the Simulator.app on this Mac syncs
 * pasteboards, as it does by default: each way this tool writes it is refused, saying how to turn the sync off, and the
 * Mac's clipboard, read by its change count alone, and the setting are as they were. Nothing can be written even so:
 * `simctl pbcopy` is held here, and the copy keys go with nothing selected.
 */
vi.mock('node:child_process', async (original) => {
  const real = await original<typeof import('node:child_process')>();
  const spawn = (...a: Parameters<typeof real.spawn>) => {
    // options may stand where the arguments go
    const args: unknown = a[1];
    if (Array.isArray(args) && args.includes('pbcopy'))
      throw new Error('a write reached simctl pbcopy');
    return real.spawn(...a);
  };
  return { ...real, spawn };
});

const udid = process.env.APPDYNO_IOS_UDID ?? '';
const APP = 'com.apple.Preferences';
const REFUSED = /turn off Edit › Automatically Sync Pasteboard in Simulator/;
const FLOW = join(mkdtempSync(join(tmpdir(), 'appdyno-clipboard-')), 'clipboard.flow');
writeFileSync(FLOW, [`app ${APP}`, 'clipboard "a text of the test"', ''].join('\n'));

const changeCount = () =>
  execFileSync(
    'osascript',
    [
      '-l',
      'JavaScript',
      '-e',
      'ObjC.import("AppKit"); $.NSPasteboard.generalPasteboard.changeCount',
    ],
    { encoding: 'utf8' },
  ).trim();
const setting = () => {
  try {
    return execFileSync(
      'defaults',
      ['read', 'com.apple.iphonesimulator', 'PasteboardAutomaticSync'],
      { encoding: 'utf8' },
    ).trim();
  } catch {
    return 'none written';
  }
};

describe.skipIf(!udid)("a simulator's clipboard while Simulator.app syncs it", () => {
  let o: ReturnType<typeof opsOn>;
  beforeAll(() => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-clipboard-state-')));
    o = opsOn(simulatorProvider(), udid, APP);
  });
  afterAll(() => o.ctx.close());

  it('refuses each write, and leaves the Mac clipboard and the setting as they were', async (ctx) => {
    // with no sync running nothing reaches the Mac, and one is had only by starting a person's Simulator.app
    if (!(await macSyncsPasteboard())) return ctx.skip();
    const count = changeCount();
    const was = setting();
    const writes = [
      ['set_device', { name: 'clipboard', value: 'a text of the test' }],
      ['run_flow', { action: 'run', file: FLOW }],
      ['press_key', { key: 'command+c' }],
      ['press_key', { key: 'command+x' }],
    ] as const;
    for (const [name, args] of writes) {
      const r = await o.call(name, args);
      expect(r.error, name).toBe(true);
      expect(r.text, name).toMatch(REFUSED);
    }
    const mirror = new SimulatorMirror(udid);
    const told: unknown[] = [];
    await mirror.open(undefined, undefined, (m) => told.push(m));
    await expect(mirror.input({ kind: 'text', s: 'ş' })).rejects.toThrow(REFUSED);
    await mirror.close();
    expect(told).toContainEqual({ op: 'note', text: expect.stringMatching(REFUSED) as unknown });
    expect(changeCount()).toBe(count);
    expect(setting()).toBe(was);
  });
});
