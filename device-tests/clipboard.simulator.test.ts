import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SimulatorMirror } from '../packages/driver-apple/src/mirror-sim.js';
import {
  macSyncsPasteboard,
  refuseWhereSynced,
} from '../packages/driver-apple/src/sim-clipboard.js';
import { RpcDevice, Simctl, simulatorProvider } from './workspace.js';
import { opsOn } from './helpers.js';

/**
 * Our own simulator's clipboard (APPDYNO_IOS_UDID, never a default) while the Simulator.app on this Mac syncs
 * pasteboards, as it does by default: each way this tool writes or reads it is refused, saying how to turn the sync off,
 * and the Mac's clipboard, read by its change count alone, and the setting are as they were. Nothing is written or read
 * even if a refusal failed: `simctl pbcopy` and `pbpaste` are held here behind the same refusal, their own places in it
 * a unit test's, the runner reads nothing, and the copy keys go with nothing selected.
 */
const udid = process.env.APPDYNO_IOS_UDID ?? '';
const APP = 'com.apple.Preferences';
const REFUSED = /turn off Edit › Automatically Sync Pasteboard in Simulator/;
const flow = (name: string, step: string) => {
  const file = join(mkdtempSync(join(tmpdir(), 'appdyno-clipboard-')), `${name}.flow`);
  writeFileSync(file, [`app ${APP}`, step, ''].join('\n'));
  return file;
};
const PUT = flow('put', 'clipboard "a text of the test"');
const CHECK = flow('check', 'clipboard equals="a text of the test" timeoutMs=1000');

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
  const pbcopy = vi.fn(async () => {
    await refuseWhereSynced('write');
    throw new Error('a write reached simctl pbcopy');
  });
  const pbpaste = vi.fn(async (): Promise<string> => {
    await refuseWhereSynced('read');
    throw new Error('a read reached simctl pbpaste');
  });
  beforeAll(() => {
    vi.spyOn(Simctl.prototype, 'pbcopy').mockImplementation(pbcopy);
    vi.spyOn(Simctl.prototype, 'pbpaste').mockImplementation(pbpaste);
    vi.spyOn(RpcDevice.prototype, 'getClipboard').mockRejectedValue(
      new Error('a read reached the runner'),
    );
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-clipboard-state-')));
    o = opsOn(simulatorProvider(), udid, APP);
  });
  afterAll(() => {
    o.ctx.close();
    vi.restoreAllMocks();
  });

  it('refuses each write and read, and leaves the Mac clipboard and the setting as they were', async (ctx) => {
    // with no sync running nothing reaches the Mac, and one is had only by starting a person's Simulator.app
    if (!(await macSyncsPasteboard())) return ctx.skip();
    const count = changeCount();
    const was = setting();
    const asked = [
      ['set_device', { name: 'clipboard', value: 'a text of the test' }],
      ['run_flow', { action: 'run', file: PUT }],
      ['press_key', { key: 'command+c' }],
      ['press_key', { key: 'command+x' }],
      ['set_device', { name: 'clipboard' }],
      ['run_flow', { action: 'run', file: CHECK }],
    ] as const;
    for (const [name, args] of asked) {
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
    // the clipboard, the flow's step and the window each went by simctl's write; a read and the check by its read
    expect(pbcopy).toHaveBeenCalledTimes(3);
    expect(pbpaste).toHaveBeenCalledTimes(2);
    expect(changeCount()).toBe(count);
    expect(setting()).toBe(was);
  });
});
