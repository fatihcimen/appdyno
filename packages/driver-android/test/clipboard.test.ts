import { beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from '@appdyno/core';
import type { Adb } from '../src/adb.js';
import { AndroidAgentLauncher } from '../src/agent.js';
import { sharedWithMac } from '../src/clipboard.js';
import { AndroidDevice } from '../src/device.js';

vi.mock('@appdyno/core', async (original) => ({
  ...(await original<typeof import('@appdyno/core')>()),
  run: vi.fn(),
}));

// as `ps -o args=` lists them
const SDK = '/Users/a/Library/Android/sdk/emulator';
const WINDOWED = `${SDK}/qemu/darwin-aarch64/qemu-system-aarch64 -avd Pixel_9 -port 5554 -no-snapshot-save -no-boot-anim -grpc 50051 -grpc-use-token`;
const HEADLESS = `${SDK}/qemu/darwin-aarch64/qemu-system-aarch64-headless -avd qa -port 5556 -no-window -no-audio`;
const OTHERS = [
  '/usr/sbin/cfprefsd agent',
  // the launcher, which execs one of the two
  `${SDK}/emulator -avd qa -port 5556 -no-window -no-audio`,
  `${SDK}/netsimd -s {"devices":[]} --logtostderr`,
].join('\n');

/** This Mac's processes as the fake `ps` lists them. */
const mac = (processes: string) =>
  vi.mocked(run).mockResolvedValue({ stdout: processes, stderr: '' });
/** A device whose agent is never reached here: what gets past the guard says so. */
const device = (serial: string) => new AndroidDevice(serial, {} as Adb);
const listed = () => vi.mocked(run).mock.calls.filter(([cmd]) => cmd === 'ps').length;

describe("an emulator's clipboard and the Mac's", () => {
  beforeEach(() => {
    vi.mocked(run).mockReset();
    vi.spyOn(AndroidAgentLauncher.prototype, 'connect').mockRejectedValue(
      new Error('reached the device'),
    );
  });

  it('is apart only while every emulator on this Mac is a headless one', () => {
    expect(sharedWithMac(`${OTHERS}\n${HEADLESS}`)).toBe(false);
    expect(sharedWithMac(HEADLESS.replaceAll('aarch64', 'x86_64'))).toBe(false);
    expect(sharedWithMac(`${OTHERS}\n${HEADLESS}\n${WINDOWED}`)).toBe(true);
    expect(sharedWithMac(WINDOWED.replaceAll('aarch64', 'x86_64'))).toBe(true);
    // Android Studio's, its window kept inside the studio
    expect(sharedWithMac(`${WINDOWED} -qt-hide-window -idle-grpc-timeout 300`)).toBe(true);
    // no emulator found to say how this one runs, and a QEMU of something else
    expect(sharedWithMac(OTHERS)).toBe(true);
    expect(sharedWithMac(`${HEADLESS}\n/opt/homebrew/bin/qemu-system-aarch64 -M virt`)).toBe(true);
  });

  it('refuses a read, a write and a key that copies or pastes while it may be shared, before the agent', async () => {
    mac(`${OTHERS}\n${WINDOWED}\n${HEADLESS}`);
    const d = device('emulator-5556');
    const refused = (start: RegExp) => ({
      code: 'UNSUPPORTED',
      message: expect.stringMatching(start) as unknown,
      hint: expect.stringContaining('-no-window') as unknown,
    });
    const shares = "an emulator with a window shares its clipboard with this Mac's, so";
    await expect(d.setClipboard('pano')).rejects.toMatchObject(
      refused(new RegExp(`^${shares} this text would go on your Mac's clipboard`)),
    );
    await expect(d.getClipboard()).rejects.toMatchObject(
      refused(/a read would hand it out: one started with -no-window shares none$/),
    );
    await expect(d.key('v', {}, ['command'])).rejects.toMatchObject(refused(/a paste would put/));
    await expect(d.key('c', {}, ['control'])).rejects.toMatchObject(refused(/what it copies/));
    await expect(d.key('x', {}, ['command'])).rejects.toMatchObject(refused(/what it copies/));
    expect(listed()).toBe(5);
  });

  it('lets them reach a headless emulator and a phone, and lists nothing for anything else', async () => {
    mac(`${OTHERS}\n${HEADLESS}`);
    await expect(device('emulator-5556').setClipboard('pano')).rejects.toThrow(
      'reached the device',
    );
    mac(WINDOWED);
    await expect(device('R5CT1234ABC').getClipboard()).rejects.toThrow('reached the device');
    await expect(device('emulator-5554').key('a', {}, ['command'])).rejects.toThrow(
      'reached the device',
    );
    await expect(device('emulator-5554').key('v')).rejects.toThrow('reached the device');
    expect(listed()).toBe(1);
  });
});
