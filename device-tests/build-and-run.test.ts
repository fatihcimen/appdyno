import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Adb } from '../packages/driver-android/src/adb.js';
import { AndroidDevice } from '../packages/driver-android/src/device.js';
import { Devicectl } from '../packages/driver-apple/src/devicectl.js';
import { PhoneApps } from '../packages/driver-apple/src/phone-manage.js';
import { Simctl } from '../packages/driver-apple/src/simctl.js';
import { SimulatorApps } from '../packages/driver-apple/src/simulator-manage.js';

/**
 * This repo's fixture built from source and installed on a real device: our own simulator (APPDYNO_IOS_UDID), emulator
 * or phone (APPDYNO_ANDROID_SERIAL), or iPhone (APPDYNO_IPHONE_UDID, with XCODE_XCCONFIG_FILE naming a team). One build
 * tool at a time on a shared Mac.
 */
const FIXTURE = 'dev.appdyno.fixture';
const repo = join(import.meta.dirname, '..');
const xcode = { project: join(repo, 'ios/Appdyno.xcodeproj'), scheme: 'Runner' };
const MINUTES = 15 * 60_000;

describe('build and run on a device', () => {
  const simulator = process.env.APPDYNO_IOS_UDID ?? '';
  it.runIf(simulator)(
    'a scheme on a simulator',
    async () => {
      const apps = new SimulatorApps(new Simctl(), simulator);
      expect(await apps.buildAndInstall(xcode)).toBe(FIXTURE);
      expect((await apps.listApps(false)).map((a) => a.id)).toContain(FIXTURE);
    },
    MINUTES,
  );

  it.runIf(simulator)(
    'says what a build said was wrong',
    async () => {
      const apps = new SimulatorApps(new Simctl(), simulator);
      await expect(
        apps.buildAndInstall({ ...xcode, scheme: 'NoSuchScheme' }),
      ).rejects.toMatchObject({
        code: 'BUILD_FAILED',
        message: expect.stringContaining('NoSuchScheme') as string,
      });
    },
    MINUTES,
  );

  const iphone = process.env.APPDYNO_IPHONE_UDID ?? '';
  it.runIf(iphone)(
    'a scheme on an iPhone',
    async () => {
      const apps = new PhoneApps(new Devicectl(iphone));
      expect(await apps.buildAndInstall(xcode)).toBe(FIXTURE);
    },
    MINUTES,
  );

  const serial = process.env.APPDYNO_ANDROID_SERIAL ?? '';
  it.runIf(serial)(
    'a variant on Android',
    async () => {
      const { apps } = new AndroidDevice(serial, new Adb());
      const project = join(repo, 'android');
      expect(await apps.buildAndInstall({ project, scheme: 'fixture' })).toBe(FIXTURE);
      expect((await apps.listApps(false)).map((a) => a.id)).toContain(FIXTURE);
    },
    MINUTES,
  );
});
