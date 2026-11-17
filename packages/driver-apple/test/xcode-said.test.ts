import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Simctl } from '../src/simctl.js';
import { Simulators } from '../src/simulators.js';

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A developer folder whose simctl prints `stdout`, says `stderr` and ends with `code`. */
function simctlSaying(o: { stderr?: string; code?: number; stdout?: string }) {
  const dir = mkdtempSync(join(tmpdir(), 'appdyno-xcode-said-'));
  made.push(dir);
  mkdirSync(join(dir, 'usr/bin'), { recursive: true });
  writeFileSync(join(dir, 'out'), o.stdout ?? '');
  writeFileSync(join(dir, 'err'), o.stderr ?? '');
  writeFileSync(
    join(dir, 'usr/bin/simctl'),
    `#!/bin/sh\ncat "${dir}/out"\ncat "${dir}/err" >&2\nexit ${String(o.code ?? 0)}\n`,
  );
  chmodSync(join(dir, 'usr/bin/simctl'), 0o755);
  return new Simulators(new Simctl({ ...process.env, DEVELOPER_DIR: dir }), () =>
    Promise.resolve(),
  );
}

const runtime = (name: string, id: string, more: Record<string, unknown> = {}) => ({
  name,
  identifier: `com.apple.CoreSimulator.SimRuntime.${id}`,
  platform: 'iOS',
  ...more,
});

describe('what Xcode says when it cannot answer', () => {
  it('is said as why every simulator is missing, with what to do', async () => {
    const tools = simctlSaying({
      stderr: 'xcrun: error: unable to find utility "simctl", not a developer tool or in PATH',
      code: 72,
    });
    await expect(tools.startable()).rejects.toMatchObject({
      message: 'Xcode is not selected: the Command Line Tools in use have no simulators',
      hint: expect.stringContaining('sudo xcode-select -s') as unknown,
    });
    const license = simctlSaying({
      stderr:
        "You have not agreed to the Xcode license agreements. Please run 'sudo xcodebuild -license' from within a Terminal window",
      code: 69,
    });
    await expect(license.catalog()).rejects.toMatchObject({
      message: "Xcode's license is not agreed to",
    });
  });

  it('is said in its own words where it is anything else', async () => {
    const odd = simctlSaying({ stderr: 'something new', code: 1 });
    await expect(odd.startable()).rejects.toMatchObject({ message: 'simctl list: something new' });
  });
});

describe('what can be made', () => {
  it('pairs each runtime with the models it runs', async () => {
    const tools = simctlSaying({
      stdout: JSON.stringify({
        devicetypes: [
          { name: 'iPhone 18 Pro', identifier: 'a', productFamily: 'iPhone' },
          { name: 'iPhone Duo', identifier: 'b', productFamily: 'iPhone' },
          { name: 'Apple TV', identifier: 'c', productFamily: 'Apple TV' },
        ],
        runtimes: [
          runtime('iOS 26.5', 'iOS-26-5', { supportedDeviceTypes: [{ identifier: 'a' }] }),
          runtime('iOS 27.2', 'iOS-27-2-iPhone19-4', {
            supportedDeviceTypes: [{ identifier: 'b' }],
          }),
          runtime('iOS 27.2', 'iOS-27-2', { isAvailable: false, availabilityError: 'gone' }),
        ],
      }),
    });
    expect(await tools.catalog()).toEqual({
      models: [
        { id: 'a', name: 'iPhone 18 Pro' },
        { id: 'b', name: 'iPhone Duo' },
      ],
      systems: [
        { id: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5', name: 'iOS 26.5', models: ['a'] },
        {
          id: 'com.apple.CoreSimulator.SimRuntime.iOS-27-2-iPhone19-4',
          name: 'iOS 27.2',
          models: ['b'],
        },
      ],
    });
  });

  it('says where no runtime is installed, or none can be used, and what to do', async () => {
    const none = simctlSaying({ stdout: JSON.stringify({ devicetypes: [], runtimes: [] }) });
    await expect(none.catalog()).rejects.toMatchObject({
      message: 'No iOS runtime is installed',
      hint: 'Xcode, Settings, Components: get iOS, then try again',
    });
    const unusable = simctlSaying({
      stdout: JSON.stringify({
        devicetypes: [],
        runtimes: [
          runtime('iOS 27.2', 'iOS-27-2', {
            isAvailable: false,
            availabilityError: 'it is still downloading',
          }),
        ],
      }),
    });
    await expect(unusable.catalog()).rejects.toMatchObject({
      message: 'No iOS runtime can be used: it is still downloading',
    });
  });
});
