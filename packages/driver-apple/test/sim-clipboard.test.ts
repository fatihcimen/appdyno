import { spawn } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from '@appdyno/core';
import { copies, syncsToMac } from '../src/sim-clipboard.js';
import { HelperActs, type ActsPort } from '../src/sim-act.js';
import { Simctl } from '../src/simctl.js';

vi.mock('@appdyno/core', async (original) => ({
  ...(await original<typeof import('@appdyno/core')>()),
  run: vi.fn(),
}));
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn: vi.fn(),
}));

const UDID = '11111111-2222-3333-4444-555555555555';
const SIMULATOR =
  '/Applications/Xcode.app/Contents/Developer/Applications/Simulator.app/Contents/MacOS/Simulator';
const OTHERS =
  '/usr/sbin/cfprefsd\n/usr/libexec/Simulator\n/Applications/Notes.app/Contents/MacOS/Notes';

/** This Mac as the fakes have it: its processes, and what `defaults` reads of the sync, none where it fails. */
function mac(processes: string, setting: string | undefined) {
  vi.mocked(run).mockImplementation(((cmd: string) =>
    cmd === 'ps'
      ? Promise.resolve({ stdout: processes, stderr: '' })
      : setting === undefined
        ? Promise.reject(new Error('does not exist'))
        : Promise.resolve({ stdout: `${setting}\n`, stderr: '' })) as unknown as typeof run);
}

const REFUSED = {
  code: 'UNSUPPORTED',
  message: expect.stringContaining('turn off Edit › Automatically Sync Pasteboard') as unknown,
};

describe("Simulator.app's pasteboard sync", () => {
  beforeEach(() => {
    vi.mocked(spawn).mockReset();
    vi.mocked(run).mockReset();
  });
  /** Whether simctl was run for `command`, not only `ps` and `defaults`. */
  const ran = (command: string) =>
    vi.mocked(run).mock.calls.some(([, args]) => (args as string[] | undefined)?.includes(command));

  it('is live while Simulator.app runs with it on, or with nothing written', () => {
    expect(syncsToMac(`${OTHERS}\n${SIMULATOR}\n`, '1\n')).toBe(true);
    expect(syncsToMac(`${SIMULATOR}  \n${OTHERS}`, undefined)).toBe(true);
    expect(syncsToMac(SIMULATOR, '0\n')).toBe(false);
    expect(syncsToMac(SIMULATOR, 'NO')).toBe(false);
    expect(syncsToMac(OTHERS, '1')).toBe(false);
  });

  it('refuses a simulator clipboard before simctl runs', async () => {
    mac(`${OTHERS}\n${SIMULATOR}`, undefined);
    await expect(new Simctl().pbcopy(UDID, 'pano')).rejects.toMatchObject({
      ...REFUSED,
      message: expect.stringMatching(
        /^Simulator's pasteboard sync would put this text on your Mac's clipboard/,
      ) as unknown,
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('lets simctl write where Simulator.app does not run', async () => {
    mac(OTHERS, '1');
    vi.mocked(spawn).mockImplementation(() => {
      throw new Error('spawned');
    });
    await expect(new Simctl().pbcopy(UDID, 'pano')).rejects.toThrow('spawned');
  });

  it("refuses to read a simulator's clipboard, which holds the Mac's, before simctl runs", async () => {
    mac(SIMULATOR, '1');
    await expect(new Simctl().pbpaste(UDID)).rejects.toMatchObject({
      ...REFUSED,
      message: expect.stringMatching(
        /^Simulator's pasteboard sync puts your Mac's clipboard on this simulator's, and a read would hand it out/,
      ) as unknown,
      hint: expect.stringContaining('where the app shows it') as unknown,
    });
    expect(ran('pbpaste')).toBe(false);
    mac(SIMULATOR, '0');
    await new Simctl().pbpaste(UDID);
    expect(ran('pbpaste')).toBe(true);
  });

  it('refuses Command-C and Command-X before a key goes, and names no other key a copy', async () => {
    mac(SIMULATOR, '1');
    const send = vi.fn();
    const acts = new HelperActs({
      direct: { send, screenKnown: true },
      helperInput: () => true,
    } as unknown as ActsPort);
    for (const key of ['c', 'x'])
      await expect(
        acts.act({ kind: 'key', key, modifiers: ['command'] }, {}),
      ).rejects.toMatchObject({
        ...REFUSED,
        message: expect.stringContaining('would put what it copies on') as unknown,
      });
    expect(send).not.toHaveBeenCalled();
    expect(copies({ kind: 'key', key: 'v', modifiers: ['command'] })).toBe(false);
    expect(copies({ kind: 'key', key: 'c', modifiers: ['shift'] })).toBe(false);
    expect(copies({ kind: 'key', key: 'c' })).toBe(false);
    expect(copies({ kind: 'tap', x: 1, y: 1 })).toBe(false);
  });
});
