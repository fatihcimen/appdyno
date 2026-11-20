import { spawn } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from '@appdyno/core';
import { NODE_FLAGS as F } from '@appdyno/protocol';
import { pasteboardKey, syncsToMac } from '../src/sim-clipboard.js';
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
// as `ps -o args=` lists them
const SIMULATOR =
  '/Applications/Xcode.app/Contents/Developer/Applications/Simulator.app/Contents/MacOS/Simulator';
const XCODE_27 = '/Applications/Xcode-27.2.0.app/Contents';
const DEVICE_HUB = `${XCODE_27}/Applications/DeviceHub.app/Contents/MacOS/DeviceHub`;
const TRAMPOLINE = `${XCODE_27}/Applications/DeviceHub.app/Contents/MacOS/DevicesTrampoline`;
const DEVICES_MENU = '/Library/Developer/Applications/DevicesMenu.app/Contents/MacOS/DevicesMenu';
const SYNC_WITH_HOST = `${XCODE_27}/Developer/usr/bin/devicectl device pasteboard sync-with-host --device ${UDID}`;
const OTHERS = [
  '/usr/sbin/cfprefsd agent',
  '/usr/libexec/Simulator',
  '/Applications/Notes.app/Contents/MacOS/Notes',
  `${XCODE_27}/Developer/usr/bin/devicectl device info displays --device ${UDID}`,
  '/Library/Developer/PrivateFrameworks/CoreSimulator.framework/Versions/A/XPCServices/SimLaunchHost.arm64.xpc/Contents/MacOS/SimLaunchHost.arm64',
].join('\n');
/** What syncs, by name, as this Mac has it. */
const syncing = (processes: string, setting: string | undefined) =>
  syncsToMac(processes, setting).map((s) => s.who);

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

describe("a simulator's pasteboard sync with the Mac", () => {
  beforeEach(() => {
    vi.mocked(spawn).mockReset();
    vi.mocked(run).mockReset();
  });
  /** Whether simctl was run for `command`, not only `ps` and `defaults`. */
  const ran = (command: string) =>
    vi.mocked(run).mock.calls.some(([, args]) => (args as string[] | undefined)?.includes(command));

  it('is live while Simulator.app runs with it on, or with nothing written', () => {
    expect(syncing(`${OTHERS}\n${SIMULATOR}\n`, '1\n')).toEqual(['Simulator']);
    expect(syncing(`${SIMULATOR}  \n${OTHERS}`, undefined)).toEqual(['Simulator']);
    expect(syncing(`${SIMULATOR} -CurrentDeviceUDID ${UDID}`, 'yes')).toEqual(['Simulator']);
    expect(syncing(SIMULATOR, '0\n')).toEqual([]);
    expect(syncing(SIMULATOR, 'NO')).toEqual([]);
    expect(syncing(OTHERS, '1')).toEqual([]);
  });

  it("is live while Xcode 27's Device Hub runs, with no Simulator.app, whatever Simulator's switch says", () => {
    // Simulator's switch was all the guard read, and Xcode 27 ships no Simulator.app: this read as no sync
    expect(syncing(`${OTHERS}\n${DEVICE_HUB}`, '0')).toEqual(['Device Hub']);
    expect(syncing(`${OTHERS}\n${DEVICE_HUB}`, undefined)).toEqual(['Device Hub']);
    expect(syncing(TRAMPOLINE, '0')).toEqual(['Device Hub']);
    expect(syncing(DEVICES_MENU, '0')).toEqual(['Device Hub']);
    expect(syncing(`${SIMULATOR}\n${DEVICE_HUB}`, '0')).toEqual(['Device Hub']);
    expect(syncing(`${SIMULATOR}\n${DEVICE_HUB}`, '1')).toEqual(['Simulator', 'Device Hub']);
    expect(
      syncing(`${XCODE_27}/Applications/Instruments.app/Contents/MacOS/Instruments`, '1'),
    ).toEqual([]);
  });

  it("is live while devicectl syncs a device's pasteboard with the host", () => {
    expect(syncing(`${OTHERS}\n${SYNC_WITH_HOST}`, '0')).toEqual(['devicectl']);
    expect(syncing(`xcrun devicectl device pasteboard sync-with-host -d ${UDID}`, '0')).toEqual([
      'devicectl',
    ]);
  });

  it('refuses each use of the pasteboard while Device Hub runs, saying to quit it, before simctl runs', async () => {
    mac(`${OTHERS}\n${DEVICE_HUB}`, '0');
    await expect(new Simctl().pbcopy(UDID, 'pano')).rejects.toMatchObject({
      code: 'UNSUPPORTED',
      message:
        "Device Hub's pasteboard sync would put this text on your Mac's clipboard: quit Device Hub and its menu bar extra to use a simulator's clipboard",
    });
    await expect(new Simctl().pbpaste(UDID)).rejects.toMatchObject({
      message: expect.stringMatching(
        /^Device Hub's pasteboard sync puts your Mac's clipboard/,
      ) as unknown,
    });
    expect(spawn).not.toHaveBeenCalled();
    expect(ran('pbpaste')).toBe(false);
    mac(`${SIMULATOR}\n${DEVICE_HUB}\n${SYNC_WITH_HOST}`, undefined);
    await expect(new Simctl().pbpaste(UDID)).rejects.toMatchObject({
      message: expect.stringMatching(
        /^Simulator's and Device Hub's and devicectl's pasteboard sync .*: turn off Edit › Automatically Sync Pasteboard in Simulator and quit Device Hub and its menu bar extra and stop `devicectl device pasteboard sync-with-host` to use/,
      ) as unknown,
    });
    expect(ran('pbpaste')).toBe(false);
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

  it('refuses Command-C, Command-X and Command-V into a field before a key goes, by the runner or the helper', async () => {
    mac(SIMULATOR, '1');
    const send = vi.fn();
    const byRunner = vi.fn();
    const acts = new HelperActs({
      direct: { send, screenKnown: true },
      helperInput: () => true,
      byRunner,
    } as unknown as ActsPort);
    // a field with the keyboard focus, whose keys go by the runner, to be read back
    acts.remember({
      windows: [],
      nodes: [
        {
          p: -1,
          w: 0,
          c: 'TextField',
          b: [0, 100, 200, 140],
          f: F.visible | F.editable | F.focused,
        },
      ],
      truncated: false,
      elapsedMs: 1,
      hash: 'form',
    });
    const said = {
      c: 'would put what it copies on',
      x: 'would put what it copies on',
      v: 'a paste would put it',
    };
    for (const [key, words] of Object.entries(said))
      await expect(
        acts.act({ kind: 'key', key, modifiers: ['command'] }, {}),
      ).rejects.toMatchObject({ ...REFUSED, message: expect.stringContaining(words) as unknown });
    mac(DEVICE_HUB, '0');
    await expect(
      acts.act({ kind: 'key', key: 'v', modifiers: ['command'] }, {}),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/^Device Hub's .*a paste would put it/) as unknown,
    });
    expect(send).not.toHaveBeenCalled();
    expect(byRunner).not.toHaveBeenCalled();
    expect(pasteboardKey({ kind: 'key', key: 'v', modifiers: ['command'] })).toBe('paste');
    expect(pasteboardKey({ kind: 'key', key: 'c', modifiers: ['shift'] })).toBeUndefined();
    expect(pasteboardKey({ kind: 'key', key: 'c' })).toBeUndefined();
    expect(pasteboardKey({ kind: 'key', key: 'a', modifiers: ['command'] })).toBeUndefined();
    expect(pasteboardKey({ kind: 'tap', x: 1, y: 1 })).toBeUndefined();
  });
});
