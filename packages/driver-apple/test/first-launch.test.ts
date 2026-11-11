import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeviceError } from '@appdyno/protocol';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Devicectl } from '../src/devicectl.js';
import { firstLaunchCheck, firstLaunchDone } from '../src/first-launch.js';
import { PhoneApnsTarget } from '../src/phone-apns.js';

const PHONE = '00001234-0123456789ABCDEF';

/**
 * A developer folder whose xcodebuild says by `status` whether the first launch is done, noting each time it is asked,
 * and whose devicectl leaves a mark: no test may start the real one, which would start that first launch.
 */
function developerDir() {
  const dir = mkdtempSync(join(tmpdir(), 'appdyno-first-launch-'));
  const bin = join(dir, 'usr/bin');
  mkdirSync(bin, { recursive: true });
  const tool = (name: string, body: string) => {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  tool(
    'xcodebuild',
    `[ "$1" = -checkFirstLaunchStatus ] || exit 2\necho asked >> "${dir}/asked"\nexit "$(cat "${dir}/status")"`,
  );
  tool('devicectl', `echo ran >> "${dir}/ran"\necho '{"result":{}}'`);
  const said = (file: string) =>
    existsSync(join(dir, file)) ? readFileSync(join(dir, file), 'utf8').split('\n').length - 1 : 0;
  return {
    dir,
    set: (status: number) => writeFileSync(join(dir, 'status'), String(status)),
    asked: () => said('asked'),
    ran: () => said('ran'),
  };
}

describe("Xcode's first launch, before devicectl", () => {
  const xcode = developerDir();
  beforeAll(() => vi.stubEnv('DEVELOPER_DIR', xcode.dir));
  afterAll(() => vi.unstubAllEnvs());

  it('refuses at once while it is not done, saying how a person does it, and starts no devicectl', async () => {
    xcode.set(69);
    const call = new Devicectl(PHONE).json(['list', 'devices']);
    await expect(call).rejects.toThrow(DeviceError);
    const e = (await call.catch((x: unknown) => x)) as DeviceError;
    expect(e.code).toBe('PERMISSION_REQUIRED');
    expect(e.message).toContain("Xcode's first-launch setup is not done");
    expect(e.hint).toContain('sudo xcodebuild -runFirstLaunch');
    expect(e.hint).toContain('open Xcode once');
    // the pasteboard and a followed console are refused alike
    await expect(new Devicectl(PHONE).readPasteboard()).rejects.toThrow(/first-launch/);
    const target = new PhoneApnsTarget(new Devicectl(PHONE), new Map());
    await expect(target.lines('dev.app', 'device')).rejects.toThrow(/first-launch/);
    expect(xcode.ran()).toBe(0);
    expect(await firstLaunchCheck()).toMatchObject({
      name: 'xcode first launch',
      ok: false,
      warn: true,
      fix: expect.stringContaining('sudo xcodebuild -runFirstLaunch') as unknown,
    });
  });

  it('is asked again once a person has done it, and then not again in this process', async () => {
    xcode.set(0);
    const before = xcode.asked();
    expect(await new Devicectl(PHONE).json(['list', 'devices'])).toEqual({ result: {} });
    expect(xcode.ran()).toBe(1);
    xcode.set(69);
    await new Devicectl(PHONE).json(['list', 'devices']);
    expect(xcode.asked()).toBe(before + 1);
    expect(xcode.ran()).toBe(2);
  });

  it('says it is done in doctor', async () => {
    xcode.set(0);
    expect(await firstLaunchCheck()).toEqual({
      name: 'xcode first launch',
      ok: true,
      detail: 'done',
    });
  });

  it('is not asked without an xcodebuild of Xcode', async () => {
    const none = mkdtempSync(join(tmpdir(), 'appdyno-no-xcode-'));
    expect(await firstLaunchDone({ DEVELOPER_DIR: none })).toBeUndefined();
    expect(await firstLaunchCheck({ DEVELOPER_DIR: none })).toBeUndefined();
  });
});
